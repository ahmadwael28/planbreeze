/**
 * Textures for floor finishes, at true size: a layout block of tiles with their joints, or planks with wood grain, or
 * a plain surface (carpet, microcement). Each kind of floor is drawn once and shared; rooms get their own copy, laid
 * from their corner at the floor's angle.
 */
import * as THREE from 'three'
import { bbox } from '@/model/geometry'
import { FLOOR_FINISHES, floorLayout, floorOf } from '@/model/floors'
import type { FloorPiece } from '@/model/floors'
import type { Room, RoomFloor } from '@/model/types'

const cache = new Map<string, { texture: THREE.Texture; block: [number, number] }>()

function random(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
}

/** A hex color made lighter (f > 0) or darker. */
function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.round(Math.min(255, Math.max(0, v * (1 + f))))
    .toString(16)
    .padStart(2, '0')
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`
}

const lightness = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

/** A shared texture for a kind of floor, and the size (cm) one repeat of it covers. */
export function floorTexture(floor: RoomFloor): { texture: THREE.Texture; block: [number, number] } {
  const f = floorOf(floor)
  const key = JSON.stringify([floor.finish, f.color, f.size, f.pattern])
  const hit = cache.get(key)
  if (hit) return hit
  const layout = floorLayout(floor)
  const block: [number, number] = layout ? layout.block : [200, 200]
  const res = 1024
  const ppcm = res / Math.max(...block)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(8, Math.round(block[0] * ppcm))
  canvas.height = Math.max(8, Math.round(block[1] * ppcm))
  const ctx = canvas.getContext('2d')!
  const W = canvas.width
  const H = canvas.height
  const base = f.color
  const dark = lightness(base) < 0.35

  if (!layout) {
    ctx.fillStyle = base
    ctx.fillRect(0, 0, W, H)
    const rand = random(7)
    if (floor.finish === 'concrete') {
      // Soft clouds of lighter and darker trowel marks.
      for (let i = 0; i < 70; i++) {
        const x = rand() * W
        const y = rand() * H
        const r = (0.05 + rand() * 0.2) * W
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0, rand() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)')
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) ctx.fillRect(dx, dy, W, H)
      }
    }
    // Fine grain: carpet pile, or the cement's texture.
    const img = ctx.getImageData(0, 0, W, H)
    const amount = floor.finish === 'carpet' ? 0.08 : 0.025
    for (let i = 0; i < img.data.length; i += 4) {
      const k = 1 + (rand() - 0.5) * 2 * amount
      img.data[i] *= k
      img.data[i + 1] *= k
      img.data[i + 2] *= k
    }
    ctx.putImageData(img, 0, 0)
  } else {
    const tile = f.def.kind === 'tile'
    const joint = tile ? (dark ? '#2b2b2c' : shade(base, -0.16)) : 'rgba(30,20,12,0.55)'
    ctx.fillStyle = tile ? joint : base
    ctx.fillRect(0, 0, W, H)
    const vein = floor.finish === 'marble' ? (dark ? 'rgba(235,235,235,0.55)' : f.color === '#f3eee5' ? 'rgba(176,140,80,0.5)' : 'rgba(120,112,104,0.32)') : ''
    const draw = (piece: FloorPiece, dx: number, dy: number) => {
      const pts = piece.pts.map((p) => ({ x: p.x * ppcm + dx, y: p.y * ppcm + dy }))
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      if (Math.max(...xs) < 0 || Math.min(...xs) > W || Math.max(...ys) < 0 || Math.min(...ys) > H) return
      const rand = random(piece.id * 131 + 17)
      const outline = () => {
        ctx.beginPath()
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
        ctx.closePath()
      }
      ctx.save()
      outline()
      ctx.clip()
      const spread = tile ? (floor.finish === 'marble' ? 0.03 : 0.045) : floor.finish === 'spc' ? 0.06 : 0.1
      ctx.fillStyle = shade(base, (rand() - 0.5) * 2 * spread)
      ctx.fill()
      const cx = xs.reduce((s, x) => s + x, 0) / pts.length
      const cy = ys.reduce((s, y) => s + y, 0) / pts.length
      const e1 = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      const e3 = Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y)
      const len = Math.max(e1, e3)
      const wid = Math.min(e1, e3)
      if (tile) {
        if (floor.finish === 'marble') {
          // Veins wandering across the slab, and soft clouds.
          for (let i = 0; i < 5; i++) {
            const r = Math.max(len, wid) * (0.3 + rand() * 0.5)
            const g = ctx.createRadialGradient(cx + (rand() - 0.5) * len, cy + (rand() - 0.5) * wid, 0, cx, cy, r)
            g.addColorStop(0, dark ? 'rgba(255,255,255,0.04)' : 'rgba(120,110,100,0.06)')
            g.addColorStop(1, 'rgba(0,0,0,0)')
            ctx.fillStyle = g
            ctx.fillRect(cx - len, cy - wid, len * 2, wid * 2)
          }
          ctx.strokeStyle = vein
          for (let i = 0; i < 2 + Math.floor(rand() * 3); i++) {
            ctx.lineWidth = 0.6 + rand() * 2.2
            ctx.beginPath()
            const x0 = cx - len / 2 - 5
            const y0 = cy + (rand() - 0.5) * wid * 1.4
            ctx.moveTo(x0, y0)
            ctx.bezierCurveTo(cx - len / 6, y0 + (rand() - 0.5) * wid, cx + len / 6, cy + (rand() - 0.5) * wid, cx + len / 2 + 5, cy + (rand() - 0.5) * wid * 1.4)
            ctx.stroke()
          }
        } else {
          // A speckle (ceramic) or a gentle mottling (porcelain).
          const n = floor.finish === 'ceramic' ? 50 : 8
          for (let i = 0; i < n; i++) {
            ctx.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)'
            const r = floor.finish === 'ceramic' ? 0.6 + rand() * 1.2 : wid * (0.1 + rand() * 0.25)
            ctx.beginPath()
            ctx.arc(cx + (rand() - 0.5) * len, cy + (rand() - 0.5) * wid, r, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      } else {
        // Wood grain along the plank, and a knot now and then.
        const a = piece.axis
        const nrm = { x: -a.y, y: a.x }
        const lines = Math.max(6, Math.round(wid / 1.6))
        for (let i = 0; i < lines; i++) {
          const across = (rand() - 0.5) * wid
          const amp = 0.4 + rand() * 1.6
          const freq = 1 + rand() * 3
          const ph = rand() * 6
          ctx.strokeStyle = rand() < 0.8 ? `rgba(60,35,15,${0.05 + rand() * 0.1})` : `rgba(255,240,220,${0.05 + rand() * 0.07})`
          ctx.lineWidth = 0.5 + rand() * 1.1
          ctx.beginPath()
          for (let t = -0.55; t <= 0.551; t += 0.05) {
            const off = across + Math.sin(t * freq * Math.PI * 2 + ph) * amp
            const x = cx + a.x * t * len + nrm.x * off
            const y = cy + a.y * t * len + nrm.y * off
            if (t === -0.55) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.stroke()
        }
        if (floor.finish !== 'spc' && rand() < 0.18) {
          const t = (rand() - 0.5) * 0.7
          const kx = cx + a.x * t * len + nrm.x * (rand() - 0.5) * wid * 0.5
          const ky = cy + a.y * t * len + nrm.y * (rand() - 0.5) * wid * 0.5
          for (const [r, al] of [
            [wid * 0.18, 0.12],
            [wid * 0.1, 0.25],
          ]) {
            ctx.fillStyle = `rgba(55,30,12,${al})`
            ctx.beginPath()
            ctx.ellipse(kx, ky, r * 2.2, r, Math.atan2(a.y, a.x), 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }
      ctx.restore()
      // The joint around it.
      outline()
      ctx.strokeStyle = joint
      ctx.lineWidth = tile ? Math.max(1.2, (f.def.grout ?? 0.2) * ppcm) : Math.max(0.8, 0.12 * ppcm)
      ctx.stroke()
    }
    for (const p of layout.pieces) for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) draw(p, dx, dy)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 8
  const out = { texture, block }
  cache.set(key, out)
  return out
}

/**
 * A room's floor material: its finish's texture laid from the room's corner, at the floor's angle (UVs are the plan's
 * x and -y, in cm). The texture is the room's own copy, to dispose with it.
 */
export function floorMaterial(room: Room): THREE.MeshStandardMaterial {
  const floor = room.floor!
  const { texture, block } = floorTexture(floor)
  const t = texture.clone()
  t.userData.roomCopy = true
  const angle = ((floorLayout(floor)?.angle ?? 0) * Math.PI) / 180
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const sx = 1 / block[0]
  const sy = 1 / block[1]
  const b = bbox(room.points)
  const u0 = b.minX
  const v0 = -b.minY
  t.repeat.set(sx, sy)
  t.rotation = angle
  t.offset.set(-sx * (c * u0 + s * v0), -sy * (-s * u0 + c * v0))
  t.needsUpdate = true
  return new THREE.MeshStandardMaterial({ map: t, roughness: FLOOR_FINISHES[floor.finish].roughness, metalness: 0 })
}
