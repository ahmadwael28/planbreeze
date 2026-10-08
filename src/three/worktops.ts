/**
 * Worktops in 3D: a slab's look drawn on a canvas (the veins of marble, the flecks of quartz and granite, the staves
 * and grain of a wooden block, the cloud of concrete), seamless so it tiles, laid by where it is in the room: the
 * worktops of units side by side read as one slab, veins running on from one to the next.
 */
import * as THREE from 'three'
import type { Worktop } from '@/model/symbols'

/** How much slab one texture shows (cm). */
const SIZE = 150

function random(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/** Draw something wrapped round the edges of a w × h canvas, so the texture tiles without seams. */
function wrap(w: number, h: number, draw: (dx: number, dy: number) => void) {
  for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) draw(dx, dy)
}

/** How light a color is, 0 to 1. */
function lightness(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
}

const textures = new Map<string, THREE.CanvasTexture>()

function slabTexture(top: Worktop): THREE.CanvasTexture {
  const hit = textures.get(top.id)
  if (hit) return hit
  const N = 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = N
  const ctx = canvas.getContext('2d')!
  const rand = random([...top.id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 2147483646 || 1)
  const px = N / SIZE
  ctx.fillStyle = top.color
  ctx.fillRect(0, 0, N, N)
  // A soft cloud over the slab: stone and concrete aren't flat.
  const cloud = (count: number, alpha: number, light: boolean) => {
    for (let i = 0; i < count; i++) {
      const x = rand() * N
      const y = rand() * N
      const r = (20 + rand() * 50) * px
      wrap(N, N, (dx, dy) => {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r)
        g.addColorStop(0, light ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2)
      })
    }
  }
  const flecks = (count: number, size: number, colors: string[]) => {
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = colors[Math.floor(rand() * colors.length)]
      const s = size * (0.4 + rand()) * px
      ctx.fillRect(rand() * N, rand() * N, s, s)
    }
  }
  switch (top.kind) {
    case 'marble': {
      cloud(14, 0.06, lightness(top.color) < 0.4)
      // Veins: long wandering lines, a few bold and many faint, along roughly the same way.
      const lean = rand() * Math.PI
      for (let i = 0; i < 26; i++) {
        const bold = i < 5
        let x = rand() * N
        let y = rand() * N
        let a = lean + (rand() - 0.5) * 0.9
        const pts: [number, number][] = [[x, y]]
        const steps = 14 + Math.floor(rand() * 14)
        for (let j = 0; j < steps; j++) {
          a += (rand() - 0.5) * 0.7
          x += Math.cos(a) * 12 * px
          y += Math.sin(a) * 12 * px
          pts.push([x, y])
        }
        ctx.strokeStyle = top.vein ?? '#999'
        // Soft-edged, as veins run into the stone rather than sit on it.
        ctx.globalAlpha = bold ? 0.3 + rand() * 0.2 : 0.08 + rand() * 0.14
        ctx.lineWidth = (bold ? 0.3 + rand() * 0.4 : 0.1 + rand() * 0.15) * px
        ctx.filter = bold ? `blur(${0.25 * px}px)` : 'none'
        ctx.lineCap = 'round'
        wrap(N, N, (dx, dy) => {
          ctx.beginPath()
          pts.forEach(([px1, py1], k) => (k ? ctx.lineTo(px1 + dx, py1 + dy) : ctx.moveTo(px1 + dx, py1 + dy)))
          ctx.stroke()
        })
      }
      ctx.globalAlpha = 1
      ctx.filter = 'none'
      break
    }
    case 'quartz':
      cloud(8, 0.035, false)
      flecks(9000, 0.18, ['rgba(255,255,255,0.55)', 'rgba(0,0,0,0.12)', 'rgba(160,160,160,0.25)'])
      break
    case 'granite':
      flecks(26000, 0.35, ['rgba(255,255,255,0.35)', 'rgba(0,0,0,0.45)', 'rgba(140,130,120,0.5)', 'rgba(90,80,75,0.5)'])
      break
    case 'wood': {
      // Staves 4 cm wide down the length, each its own shade, grain along it.
      const stave = 4 * px
      for (let x = 0; x < N; x += stave) {
        ctx.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,255,255'},${0.04 + rand() * 0.07})`
        ctx.fillRect(x, 0, stave, N)
        for (let k = 0; k < 7; k++) {
          ctx.strokeStyle = `rgba(60,35,15,${0.06 + rand() * 0.1})`
          ctx.lineWidth = (0.05 + rand() * 0.1) * px
          const gx = x + rand() * stave
          ctx.beginPath()
          ctx.moveTo(gx, 0)
          for (let y = 0; y <= N; y += 40) ctx.lineTo(gx + Math.sin(y / 90 + k) * 2, y)
          ctx.stroke()
        }
        ctx.fillStyle = 'rgba(40,25,10,0.25)'
        ctx.fillRect(x, 0, 0.6, N)
      }
      break
    }
    case 'concrete':
      cloud(30, 0.07, false)
      cloud(20, 0.06, true)
      flecks(2500, 0.15, ['rgba(0,0,0,0.25)', 'rgba(255,255,255,0.3)'])
      break
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  textures.set(top.id, tex)
  return tex
}

const ROUGH: Record<Worktop['kind'], number> = { marble: 0.18, quartz: 0.3, granite: 0.28, wood: 0.55, concrete: 0.75 }

const materials = new Map<string, THREE.MeshStandardMaterial>()

/**
 * A worktop's material. Its texture coordinates are set by where the slab is in the room (see `roomUVs`), in cm, so
 * it's the same material for every slab of that worktop. Tinted when selected.
 */
export function worktopMaterial(top: Worktop, highlight: boolean): THREE.MeshStandardMaterial {
  const key = `${top.id}|${highlight}`
  let m = materials.get(key)
  if (!m) {
    const map = slabTexture(top).clone()
    map.repeat.set(1 / SIZE, 1 / SIZE)
    map.needsUpdate = true
    m = new THREE.MeshStandardMaterial({ map, roughness: ROUGH[top.kind], metalness: 0 })
    m.userData.roomUV = true
    if (highlight) {
      m.emissive = new THREE.Color('#2563eb')
      m.emissiveIntensity = 0.45
    }
    materials.set(key, m)
  }
  return m
}

const p = new THREE.Vector3()
const n = new THREE.Vector3()
const normalMatrix = new THREE.Matrix3()

/**
 * Lay the worktops of a placed item by where they are in the room: texture coordinates from the plan position (cm)
 * on top, from along and up on the edges. Call once it's posed.
 */
export function roomUVs(obj: THREE.Object3D) {
  obj.updateMatrixWorld(true)
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !(o.material as THREE.Material).userData?.roomUV) return
    const geo = o.geometry as THREE.BufferGeometry
    const pos = geo.getAttribute('position')
    const nor = geo.getAttribute('normal')
    normalMatrix.getNormalMatrix(o.matrixWorld)
    const uv = new Float32Array(pos.count * 2)
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)
      n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize()
      const flat = Math.abs(n.y) > 0.5
      uv[i * 2] = flat ? p.x : Math.abs(n.x) > Math.abs(n.z) ? p.z : p.x
      uv[i * 2 + 1] = flat ? p.z : p.y
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  })
}
