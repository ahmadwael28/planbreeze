/**
 * Textures for floor and wall finishes, at true size: a layout block of tiles with their joints, planks with wood grain
 * or slats with grooves; a plain surface (carpet, microcement) or a wallpaper design; or a photo of the real thing, laid
 * tile by tile (or repeated, for wallpaper). Each is drawn once and shared; surfaces get their own copy, laid from their
 * corner at the finish's angle.
 */
import * as THREE from 'three'
import { bbox } from '@/model/geometry'
import { finishOf, surfaceLayout } from '@/model/finishes'
import type { FloorPiece, Place } from '@/model/finishes'
import type { Point, Room, Surface } from '@/model/types'

/** A photo to lay instead of a color (decoded; see lib/images). */
export type Photo = HTMLImageElement | undefined

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

/** Fine noise over the whole canvas: carpet pile, cement, paper. */
function grain(ctx: CanvasRenderingContext2D, W: number, H: number, amount: number, seed: number) {
  const rand = random(seed)
  const img = ctx.getImageData(0, 0, W, H)
  for (let i = 0; i < img.data.length; i += 4) {
    const k = 1 + (rand() - 0.5) * 2 * amount
    img.data[i] *= k
    img.data[i + 1] *= k
    img.data[i + 2] *= k
  }
  ctx.putImageData(img, 0, 0)
}

/** Draw something at every copy of the block around (0, 0), so it carries on across the block's edges. */
function wrapped(W: number, H: number, draw: (dx: number, dy: number) => void) {
  for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) draw(dx, dy)
}

/** A wallpaper design in its color, over a whole repeat (ppcm pixels per cm). */
function wallpaper(ctx: CanvasRenderingContext2D, design: string, base: string, W: number, H: number, ppcm: number) {
  const dark = lightness(base) < 0.4
  const ink = dark ? shade(base, 0.55) : shade(base, -0.28)
  const soft = dark ? shade(base, 0.25) : shade(base, -0.1)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, W, H)
  const rand = random(design.length * 31)
  if (design === 'linen') {
    // A woven look: fine threads both ways.
    for (let i = 0; i < 1400; i++) {
      const vertical = rand() < 0.5
      ctx.strokeStyle = rand() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.07)'
      ctx.lineWidth = 0.6 + rand()
      const x = rand() * W
      const y = rand() * H
      const l = (2 + rand() * 6) * ppcm
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(vertical ? x : x + l, vertical ? y + l : y)
      ctx.stroke()
    }
  } else if (design === 'stripes') {
    // Wide stripes with a pinstripe between.
    const n = 4
    const sw = W / n
    for (let i = 0; i < n; i++) {
      if (i % 2) {
        ctx.fillStyle = soft
        ctx.fillRect(i * sw, 0, sw, H)
      }
      ctx.fillStyle = ink
      ctx.fillRect(i * sw - 0.15 * ppcm, 0, 0.3 * ppcm, H)
    }
  } else if (design === 'geometric') {
    // An art deco lattice of diamonds, with a fan in each.
    ctx.strokeStyle = ink
    ctx.lineWidth = 0.35 * ppcm
    const cells = 2
    const cw = W / cells
    const ch = H / cells
    for (let i = 0; i <= cells; i++) {
      for (let j = 0; j <= cells; j++) {
        const cx = i * cw
        const cy = j * ch
        ctx.beginPath()
        ctx.moveTo(cx, cy - ch / 2)
        ctx.lineTo(cx + cw / 2, cy)
        ctx.lineTo(cx, cy + ch / 2)
        ctx.lineTo(cx - cw / 2, cy)
        ctx.closePath()
        ctx.stroke()
        for (let k = 1; k <= 3; k++) {
          ctx.beginPath()
          ctx.arc(cx, cy + ch / 2, (k * ch) / 9, Math.PI * 1.25, Math.PI * 1.75)
          ctx.stroke()
        }
      }
    }
  } else {
    // Botanical: leaves on stems, scattered over the repeat.
    for (let i = 0; i < 26; i++) {
      const x = rand() * W
      const y = rand() * H
      const a = rand() * Math.PI * 2
      const l = (4 + rand() * 5) * ppcm
      const color = rand() < 0.5 ? ink : soft
      wrapped(W, H, (dx, dy) => {
        ctx.save()
        ctx.translate(x + dx, y + dy)
        ctx.rotate(a)
        ctx.fillStyle = color
        ctx.strokeStyle = color
        ctx.lineWidth = 0.25 * ppcm
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(0, -l * 1.5)
        ctx.stroke()
        for (let k = 0; k < 4; k++) {
          const t = -l * (0.35 + k * 0.3)
          for (const side of [-1, 1]) {
            ctx.beginPath()
            ctx.ellipse(side * l * 0.22, t, l * 0.24, l * 0.1, side * 0.6, 0, Math.PI * 2)
            ctx.fill()
          }
        }
        ctx.restore()
      })
    }
  }
  grain(ctx, W, H, 0.02, 11)
}

/** A shared texture for a finish, and the size (cm) one repeat of it covers. Null for paint. */
export function surfaceTexture(s: Surface, place: Place = 'floor', photo?: Photo): { texture: THREE.Texture; block: [number, number] } | null {
  const f = finishOf(s, place)
  if (f.def.kind === 'paint') return null
  const key = JSON.stringify([place, s.finish, f.color, f.size, f.pattern, f.design?.id, photo ? s.image : ''])
  const hit = cache.get(key)
  if (hit) return hit
  const layout = surfaceLayout(s, place)
  const block: [number, number] = layout ? layout.block : (f.size ?? [200, 200])
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
    if (photo) {
      // A photo of a wallpaper or carpet: one repeat.
      ctx.drawImage(photo, 0, 0, W, H)
    } else if (f.def.kind === 'paper') {
      wallpaper(ctx, f.design?.id ?? 'linen', base, W, H, ppcm)
    } else {
      ctx.fillStyle = base
      ctx.fillRect(0, 0, W, H)
      const rand = random(7)
      if (s.finish === 'concrete') {
        // Soft clouds of lighter and darker trowel marks.
        for (let i = 0; i < 70; i++) {
          const x = rand() * W
          const y = rand() * H
          const r = (0.05 + rand() * 0.2) * W
          const g = ctx.createRadialGradient(x, y, 0, x, y, r)
          g.addColorStop(0, rand() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)')
          g.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.fillStyle = g
          wrapped(W, H, (dx, dy) => ctx.fillRect(dx, dy, W, H))
        }
      }
      grain(ctx, W, H, s.finish === 'carpet' ? 0.08 : 0.025, 7)
    }
  } else {
    const kind = f.def.kind
    const tile = kind === 'tile'
    const slats = kind === 'slats'
    // Wood-look porcelain gets wood grain, not a stone's speckle.
    const woody = /wood/i.test(f.def.colors.find((c) => c.hex === f.color)?.name ?? '')
    const joint = tile ? (dark ? '#2b2b2c' : shade(base, -0.16)) : slats ? shade(base, dark ? -0.5 : -0.62) : 'rgba(30,20,12,0.55)'
    ctx.fillStyle = tile || slats ? joint : base
    ctx.fillRect(0, 0, W, H)
    const vein = s.finish === 'marble' ? (dark ? 'rgba(235,235,235,0.55)' : f.color === '#f3eee5' ? 'rgba(176,140,80,0.5)' : 'rgba(120,112,104,0.32)') : ''
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
      // The piece's extent along its length and across, around its middle.
      const a = piece.axis
      const nrm = { x: -a.y, y: a.x }
      const along = pts.map((p) => p.x * a.x + p.y * a.y)
      const across = pts.map((p) => p.x * nrm.x + p.y * nrm.y)
      const len = Math.max(...along) - Math.min(...along)
      const wid = Math.max(...across) - Math.min(...across)
      const ma = (Math.max(...along) + Math.min(...along)) / 2
      const mn = (Math.max(...across) + Math.min(...across)) / 2
      const cx = a.x * ma + nrm.x * mn
      const cy = a.y * ma + nrm.y * mn
      if (photo) {
        // The photo along the piece (its long side along the piece's), each a touch lighter or darker; on floors some
        // are turned round as a tiler would, on walls they stay the right way up.
        ctx.translate(cx, cy)
        ctx.rotate(Math.atan2(a.y, a.x) + (place === 'floor' && rand() < 0.5 ? Math.PI : 0))
        if (photo.naturalHeight > photo.naturalWidth * 1.05) {
          ctx.rotate(Math.PI / 2)
          ctx.drawImage(photo, -wid / 2, -len / 2, wid, len)
        } else ctx.drawImage(photo, -len / 2, -wid / 2, len, wid)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        const v = (rand() - 0.5) * 0.08
        ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`
        ctx.fill()
      } else {
        const spread = tile ? (s.finish === 'marble' ? 0.03 : 0.045) : s.finish === 'spc' ? 0.06 : slats ? 0.05 : 0.1
        ctx.fillStyle = shade(base, (rand() - 0.5) * 2 * spread)
        ctx.fill()
        if (tile && !woody) {
          if (s.finish === 'marble') {
            // Veins wandering across the slab, and soft clouds.
            for (let i = 0; i < 5; i++) {
              const r = Math.max(len, wid) * (0.3 + rand() * 0.5)
              const g = ctx.createRadialGradient(cx + (rand() - 0.5) * len, cy + (rand() - 0.5) * wid, 0, cx, cy, r)
              g.addColorStop(0, dark ? 'rgba(255,255,255,0.04)' : 'rgba(120,110,100,0.06)')
              g.addColorStop(1, 'rgba(0,0,0,0)')
              ctx.fillStyle = g
              ctx.fillRect(cx - len, cy - len, len * 2, len * 2)
            }
            ctx.strokeStyle = vein
            for (let i = 0; i < 2 + Math.floor(rand() * 3); i++) {
              ctx.lineWidth = 0.6 + rand() * 2.2
              ctx.beginPath()
              const p0 = { x: cx - (a.x * len) / 2 + nrm.x * (rand() - 0.5) * wid * 1.4, y: cy - (a.y * len) / 2 + nrm.y * (rand() - 0.5) * wid * 1.4 }
              const at = (t: number, o: number) => ({ x: cx + a.x * t * len + nrm.x * o * wid, y: cy + a.y * t * len + nrm.y * o * wid })
              const c1 = at(-1 / 6, rand() - 0.5)
              const c2 = at(1 / 6, rand() - 0.5)
              const p1 = at(0.55, (rand() - 0.5) * 1.4)
              ctx.moveTo(p0.x, p0.y)
              ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p1.x, p1.y)
              ctx.stroke()
            }
          } else {
            // A speckle (ceramic) or a gentle mottling (porcelain).
            const n = s.finish === 'ceramic' ? 50 : 8
            for (let i = 0; i < n; i++) {
              ctx.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)'
              const r = s.finish === 'ceramic' ? 0.6 + rand() * 1.2 : wid * (0.1 + rand() * 0.25)
              ctx.beginPath()
              ctx.arc(cx + (rand() - 0.5) * len * a.x + (rand() - 0.5) * wid * nrm.x, cy + (rand() - 0.5) * len * a.y + (rand() - 0.5) * wid * nrm.y, r, 0, Math.PI * 2)
              ctx.fill()
            }
          }
        } else {
          if (slats) {
            // Rounded off: lighter down the middle, shaded toward the grooves.
            const g = ctx.createLinearGradient(cx - (nrm.x * wid) / 2, cy - (nrm.y * wid) / 2, cx + (nrm.x * wid) / 2, cy + (nrm.y * wid) / 2)
            g.addColorStop(0, 'rgba(0,0,0,0.22)')
            g.addColorStop(0.35, 'rgba(255,255,255,0.06)')
            g.addColorStop(0.65, 'rgba(255,255,255,0.03)')
            g.addColorStop(1, 'rgba(0,0,0,0.3)')
            ctx.fillStyle = g
            ctx.fill()
          }
          // Wood grain along the plank, and a knot now and then.
          const lines = Math.max(slats ? 3 : 6, Math.round(wid / 1.6))
          const grained = !slats || !['#2a2a2b', '#ecebe7', '#8e8b86'].includes(base)
          for (let i = 0; grained && i < lines; i++) {
            const off = (rand() - 0.5) * wid
            const amp = 0.4 + rand() * 1.6
            const freq = 1 + rand() * 3
            const ph = rand() * 6
            ctx.strokeStyle = rand() < 0.8 ? `rgba(60,35,15,${0.05 + rand() * 0.1})` : `rgba(255,240,220,${0.05 + rand() * 0.07})`
            ctx.lineWidth = 0.5 + rand() * 1.1
            ctx.beginPath()
            for (let t = -0.55; t <= 0.551; t += 0.05) {
              const o = off + Math.sin(t * freq * Math.PI * 2 + ph) * amp
              const x = cx + a.x * t * len + nrm.x * o
              const y = cy + a.y * t * len + nrm.y * o
              if (t === -0.55) ctx.moveTo(x, y)
              else ctx.lineTo(x, y)
            }
            ctx.stroke()
          }
          if (!slats && !tile && s.finish !== 'spc' && rand() < 0.18) {
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
      }
      ctx.restore()
      if (slats) return
      // The joint around it.
      outline()
      ctx.strokeStyle = joint
      ctx.lineWidth = tile ? Math.max(1.2, (f.def.grout ?? 0.2) * ppcm) : Math.max(0.8, 0.12 * ppcm)
      ctx.stroke()
    }
    for (const p of layout.pieces) wrapped(W, H, (dx, dy) => draw(p, dx, dy))
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
 * A surface's own copy of its finish's texture, laid from (u0, v0) of its texture coordinates (cm) at the finish's
 * angle; disposed with it.
 */
function laidTexture(s: Surface, place: Place, photo: Photo, u0: number, v0: number) {
  const tex = surfaceTexture(s, place, photo)
  if (!tex) return null
  const t = tex.texture.clone()
  t.userData.roomCopy = true
  const angle = ((surfaceLayout(s, place)?.angle ?? 0) * Math.PI) / 180
  const c = Math.cos(angle)
  const sn = Math.sin(angle)
  const sx = 1 / tex.block[0]
  const sy = 1 / tex.block[1]
  t.repeat.set(sx, sy)
  t.rotation = angle
  t.offset.set(-sx * (c * u0 + sn * v0), -sy * (-sn * u0 + c * v0))
  t.needsUpdate = true
  return t
}

/**
 * A room's floor material: its finish's texture laid from the room's corner (texture coordinates are the plan's x and
 * -y, in cm).
 */
export function floorMaterial(room: Room, photo?: Photo, origin?: Point): THREE.MeshStandardMaterial {
  const floor = room.floor!
  // Laid from the room's corner (or the corner of the whole space it's open to, so it runs on across).
  const o = origin ?? (({ minX, minY }) => ({ x: minX, y: minY }))(bbox(room.points))
  const map = laidTexture(floor, 'floor', photo, o.x, -o.y)
  const f = finishOf(floor, 'floor')
  return new THREE.MeshStandardMaterial({ map, color: map ? '#ffffff' : f.color, roughness: f.def.roughness, metalness: 0 })
}

/**
 * A material for a wall finish, whose texture coordinates are the distance along the wall and the height up it (cm),
 * so tiles start at the floor.
 */
export function wallMaterial(s: Surface, photo?: Photo): THREE.MeshStandardMaterial {
  const map = laidTexture(s, 'wall', photo, 0, 0)
  const f = finishOf(s, 'wall')
  return new THREE.MeshStandardMaterial({ map, color: map ? '#ffffff' : f.color, roughness: f.def.roughness, metalness: 0 })
}
