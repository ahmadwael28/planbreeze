/**
 * Detailed 3D models for furniture, fittings, doors and windows.
 *
 * Everything is in cm, in the symbol's local frame: X across its width, Y up from the floor, Z from
 * back (-depth/2, against the wall) to front (+depth/2). For doors and windows Z runs through the
 * wall, with +Z facing into the room.
 *
 * Models are built from many small parts, then merged per material (`compact`) so the extra detail
 * costs few draw calls.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { inwardNormal, signedArea } from '@/model/geometry'
import { chairsAlong, frameOf, seatsAlong, SOFA } from '@/model/symbols'
import type { PlanSymbol, Point, Room } from '@/model/types'

export const COLORS = {
  wall: '#f4f4f5',
  slab: '#a8a29e',
  wood: '#b08968',
  woodDark: '#7f5539',
  woodLight: '#d2b48c',
  fabric: '#94a3b8',
  fabricLight: '#a9b6c8',
  fabric2: '#cbd5e1',
  headboard: '#64748b',
  accent: '#d08c3c',
  accent2: '#9f5f80',
  white: '#fafaf9',
  ceramic: '#f8fafc',
  metal: '#b4b4bb',
  chrome: '#e4e4e7',
  dark: '#3f3f46',
  black: '#18181b',
  screen: '#0b1220',
  sheet: '#e0e7ff',
  linen: '#f5f5f4',
  pot: '#9a3412',
  soil: '#3b2a20',
  leaves: ['#4d7c0f', '#65a30d', '#3f6212'],
  stone: '#d6d3d1',
  glass: '#bae6fd',
  door: '#d6c3a5',
  barn: '#6f4e37',
  barnDark: '#4a3222',
  frame: '#f5f5f4',
  mirror: '#d5dee8',
  light: '#fef9c3',
  books: ['#b91c1c', '#1d4ed8', '#15803d', '#a16207', '#6b21a8', '#334155', '#e7e5e4', '#0f766e'],
}

export type Finish = 'matte' | 'fabric' | 'wood' | 'satin' | 'gloss' | 'metal' | 'chrome' | 'leaf' | 'ceramic'

const FINISHES: Record<Finish, { roughness: number; metalness: number; flat?: boolean; double?: boolean }> = {
  matte: { roughness: 0.85, metalness: 0 },
  fabric: { roughness: 0.97, metalness: 0 },
  wood: { roughness: 0.6, metalness: 0 },
  satin: { roughness: 0.45, metalness: 0 },
  gloss: { roughness: 0.18, metalness: 0 },
  metal: { roughness: 0.35, metalness: 0.5 },
  chrome: { roughness: 0.12, metalness: 0.45 },
  leaf: { roughness: 0.8, metalness: 0, flat: true },
  ceramic: { roughness: 0.15, metalness: 0, double: true },
}

/** Caches materials per color and finish so the scene uses as few as possible. */
export class Materials {
  private cache = new Map<string, THREE.Material>()

  get(color: string, highlight = false, finish: Finish = 'matte'): THREE.MeshStandardMaterial {
    const key = `${color}|${highlight}|${finish}`
    let m = this.cache.get(key) as THREE.MeshStandardMaterial | undefined
    if (!m) {
      const f = FINISHES[finish]
      m = new THREE.MeshStandardMaterial({ color, roughness: f.roughness, metalness: f.metalness, flatShading: !!f.flat })
      if (f.double) m.side = THREE.DoubleSide
      if (highlight) {
        m.emissive = new THREE.Color('#2563eb')
        m.emissiveIntensity = 0.45
      }
      this.cache.set(key, m)
    }
    return m
  }

  glass(): THREE.Material {
    let m = this.cache.get('glass')
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: COLORS.glass,
        transparent: true,
        opacity: 0.35,
        roughness: 0.1,
        metalness: 0.1,
        depthWrite: false,
      })
      this.cache.set('glass', m)
    }
    return m
  }

  emissive(color: string): THREE.Material {
    const key = `emissive|${color}`
    let m = this.cache.get(key)
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 })
      this.cache.set(key, m)
    }
    return m
  }
}

// ---------------------------------------------------------------------------
// Primitives. Each returns a mesh whose bottom sits at `y`, centered on (x, z).

type Mat = THREE.Material

function mesh(geo: THREE.BufferGeometry, mat: Mat) {
  const m = new THREE.Mesh(geo, mat)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

export function box(w: number, h: number, d: number, x: number, y: number, z: number, mat: Mat) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y + h / 2, z)
  return m
}

/** Box with softened edges (cushions, cabinets, ceramics). */
function rbox(w: number, h: number, d: number, r: number, x: number, y: number, z: number, mat: Mat) {
  const radius = Math.max(0.05, Math.min(r, w / 2 - 0.05, h / 2 - 0.05, d / 2 - 0.05))
  const m = mesh(new RoundedBoxGeometry(w, h, d, 2, radius), mat)
  m.position.set(x, y + h / 2, z)
  return m
}

export function cylinder(r: number, h: number, x: number, y: number, z: number, mat: Mat, scaleZ = 1, rBottom = r, segments = 28) {
  const m = mesh(new THREE.CylinderGeometry(r, rBottom, h, segments), mat)
  m.position.set(x, y + h / 2, z)
  m.scale.z = scaleZ
  return m
}

/** Tapered round leg. */
function leg(x: number, z: number, h: number, mat: Mat, rTop = 2, rBottom = 1.4) {
  return cylinder(rTop, h, x, 0, z, mat, 1, rBottom, 12)
}

/** Solid of revolution from a (radius, height) profile. */
function lathe(profile: [number, number][], x: number, y: number, z: number, mat: Mat, segments = 36) {
  const m = mesh(new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), segments), mat)
  m.position.set(x, y, z)
  return m
}

function blob(r: number, x: number, y: number, z: number, mat: Mat, sy = 1) {
  const m = mesh(new THREE.IcosahedronGeometry(r, 1), mat)
  m.position.set(x, y, z)
  m.scale.y = sy
  return m
}

/** Deterministic pseudo-random numbers, so a model looks the same every time it's built. */
function random(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return () => {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    return (h >>> 0) / 4294967296
  }
}

const CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
]

/** Merge a model's meshes per material: the detail stays, the draw calls don't. */
export function compact(g: THREE.Group): THREE.Group {
  g.updateMatrixWorld(true)
  const byMat = new Map<Mat, THREE.BufferGeometry[]>()
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
    o.geometry.dispose()
    geo.applyMatrix4(o.matrixWorld)
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k)
    geo.clearGroups()
    const list = byMat.get(o.material) ?? []
    list.push(geo)
    byMat.set(o.material, list)
  })
  const out = new THREE.Group()
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos)
    geos.forEach((x) => x.dispose())
    if (!merged) continue
    const m = new THREE.Mesh(merged, mat)
    m.castShadow = !mat.transparent
    m.receiveShadow = true
    out.add(m)
  }
  return out
}

/** Like `compact`, but moving door parts (see `DoorPart`) stay separate pieces, so they can still open and close. */
function compactModel(g: THREE.Group): THREE.Group {
  const parts = g.children.filter((c) => c.userData.door)
  if (!parts.length) return compact(g)
  parts.forEach((p) => g.remove(p))
  const out = compact(g)
  for (const p of parts) {
    const wrap = new THREE.Group()
    wrap.add(...p.children)
    const piece = new THREE.Group()
    piece.position.copy(p.position)
    piece.rotation.copy(p.rotation)
    piece.userData.door = p.userData.door
    const merged = compact(wrap).children
    if (merged.length) piece.add(...merged)
    out.add(piece)
  }
  return out
}

/** A moving part of a door: a leaf turning about its hinge (`angle` to close it), or a panel sliding (`slide` along x to open it). */
export interface DoorPart {
  angle?: number
  slide?: number
}

/** Put a door part in place, from closed (0) to open (1). */
export function poseDoor(o: THREE.Object3D, open: number) {
  const d = o.userData.door as DoorPart
  if (d.angle !== undefined) o.rotation.y = (1 - open) * d.angle
  if (d.slide !== undefined) o.position.x = open * d.slide
  o.userData.open = open
}

/** A leaf built in its open position that turns about a hinge at (hx, z0) to close. */
function hinged(hx: number, z0: number, closeAngle: number, build: (g: THREE.Group) => void) {
  const pivot = new THREE.Group()
  pivot.position.set(hx, 0, z0)
  const inner = new THREE.Group()
  inner.position.set(-hx, 0, -z0)
  build(inner)
  pivot.add(inner)
  pivot.userData.door = { angle: closeAngle } satisfies DoorPart
  return pivot
}

/** A panel built in its closed position that slides `slide` along x to open. */
function sliding(slide: number, build: (g: THREE.Group) => void) {
  const g = new THREE.Group()
  build(g)
  g.userData.door = { slide } satisfies DoorPart
  return g
}

// ---------------------------------------------------------------------------
// Models

interface Kit {
  q: (color: string, finish?: Finish) => Mat
  glass: () => Mat
}

function chair(k: Kit, x: number, z: number, rotDeg: number, w = 44, d = 46) {
  const g = new THREE.Group()
  const wood = k.q(COLORS.wood, 'wood')
  const seatY = 45
  for (const sx of [-1, 1]) {
    g.add(leg(sx * (w / 2 - 3), d / 2 - 3, seatY - 3, wood, 1.8, 1.3))
    // Back legs rise to form the back posts.
    g.add(box(3, 86, 3, sx * (w / 2 - 3), 0, -d / 2 + 2.5, wood))
  }
  g.add(box(w - 2, 5, d - 4, 0, seatY - 6, 0, wood)) // seat frame
  g.add(rbox(w - 3, 5, d - 5, 2, 0, seatY - 2, 0.5, k.q(COLORS.fabric2, 'fabric'))) // cushion
  g.add(rbox(w - 4, 13, 2.6, 1.2, 0, 70, -d / 2 + 2.5, wood)) // top rail
  g.add(box(w - 6, 3, 2, 0, 57, -d / 2 + 2.5, wood)) // lower rail
  g.position.set(x, 0, z)
  g.rotation.y = (-rotDeg * Math.PI) / 180
  return g
}

function table(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const top = 3.5
  g.add(rbox(w, top, d, 1.2, 0, h - top, 0, k.q(COLORS.wood, 'wood')))
  g.add(box(w - 12, 8, d - 12, 0, h - top - 8, 0, k.q(COLORS.woodDark, 'wood'))) // apron
  for (const [sx, sz] of CORNERS) g.add(box(5, h - top, 5, sx * (w / 2 - 6), 0, sz * (d / 2 - 6), k.q(COLORS.woodDark, 'wood')))
  return g
}

function coffeeTable(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  g.add(rbox(w, 4, d, 1.5, 0, h - 4, 0, k.q(COLORS.wood, 'wood')))
  g.add(rbox(w - 10, 2, d - 10, 0.8, 0, 12, 0, k.q(COLORS.woodDark, 'wood'))) // lower shelf
  for (const [sx, sz] of CORNERS) g.add(leg(sx * (w / 2 - 5), sz * (d / 2 - 5), h - 4, k.q(COLORS.woodDark, 'wood'), 2.2, 1.6))
  // A couple of books and a bowl, so it looks lived in.
  g.add(rbox(24, 2.5, 17, 0.4, -w * 0.2, h, 0, k.q(COLORS.books[1], 'satin')))
  g.add(rbox(21, 2, 15, 0.4, -w * 0.2 + 1, h + 2.5, 0.5, k.q(COLORS.books[6], 'satin')))
  g.add(lathe([[0, 0], [5, 0], [9, 6], [9.5, 6.5], [0.1, 1.2]], w * 0.2, h, 0, k.q(COLORS.ceramic, 'ceramic')))
  return g
}

function sofa(k: Kit, w: number, d: number, h: number, seats: number) {
  const g = new THREE.Group()
  const frame = k.q(COLORS.fabric, 'fabric')
  const cushion = k.q(COLORS.fabricLight, 'fabric')
  const legH = 8
  const arm = seats === 1 ? Math.min(18, w * 0.17) : Math.min(20, w * 0.09)
  const backT = Math.min(20, d * 0.22)
  const seatTop = 44
  const inner = w - 2 * arm
  const cw = inner / seats

  g.add(rbox(inner + 2, seatTop - 12 - legH, d - backT, 2, 0, legH, backT / 2, frame)) // seat base
  g.add(rbox(w, h - legH, backT, 4, 0, legH, -d / 2 + backT / 2, frame)) // back
  for (const s of [-1, 1]) g.add(rbox(arm, h * 0.72 - legH, d, 5, s * (w / 2 - arm / 2), legH, 0, frame))
  for (let i = 0; i < seats; i++) {
    const x = -inner / 2 + cw * (i + 0.5)
    g.add(rbox(cw - 1, 13, d - backT - 1, 5, x, seatTop - 13, backT / 2, cushion))
    const back = rbox(cw - 2, (h - seatTop) * 0.95, 14, 6, x, seatTop - 1, -d / 2 + backT + 5, cushion)
    back.rotation.x = -0.12
    g.add(back)
  }
  if (seats > 1) {
    for (const s of [-1, 1]) {
      const p = rbox(36, 36, 11, 8, s * (inner / 2 - 22), seatTop - 3, -d / 2 + backT + 17, k.q(COLORS.accent, 'fabric'))
      p.rotation.set(-0.25, s * 0.25, s * 0.12)
      g.add(p)
    }
  }
  for (const [sx, sz] of CORNERS) g.add(leg(sx * (w / 2 - 6), sz * (d / 2 - 6), legH, k.q(COLORS.woodDark, 'wood'), 2, 1.5))
  return g
}

/** An L-shaped sofa: seats along the back and down the left side, arms at both open ends. */
function cornerSofa(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const frame = k.q(COLORS.fabric, 'fabric')
  const cushion = k.q(COLORS.fabricLight, 'fabric')
  const legH = 8
  const arm = Math.min(SOFA.arm, w * 0.12, d * 0.12)
  const back = Math.min(SOFA.back, d * 0.2, w * 0.2)
  const seat = Math.min(SOFA.seat, d * 0.6, w * 0.6)
  const seatTop = 44
  const L = -w / 2
  const T = -d / 2
  // Backs along the top and down the left.
  g.add(rbox(w, h - legH, back, 4, 0, legH, T + back / 2, frame))
  g.add(rbox(back, h - legH, d - back, 4, L + back / 2, legH, T + back + (d - back) / 2, frame))
  // Seat bases.
  const runX = w - back - arm
  const runY = d - seat - arm
  g.add(rbox(runX + 2, seatTop - 12 - legH, seat - back, 2, L + back + runX / 2, legH, T + back + (seat - back) / 2, frame))
  g.add(rbox(seat - back, seatTop - 12 - legH, runY + 2, 2, L + back + (seat - back) / 2, legH, T + seat + runY / 2, frame))
  // Arms at the two open ends.
  g.add(rbox(arm, h * 0.72 - legH, seat, 5, w / 2 - arm / 2, legH, T + seat / 2, frame))
  g.add(rbox(seat, h * 0.72 - legH, arm, 5, L + seat / 2, legH, d / 2 - arm / 2, frame))
  // Seat and back cushions: along the top run (including the corner), then down the side.
  const nx = seatsAlong(runX)
  const cx = runX / nx
  for (let i = 0; i < nx; i++) {
    const x = L + back + cx * (i + 0.5)
    g.add(rbox(cx - 1, 13, seat - back - 1, 5, x, seatTop - 13, T + back + (seat - back) / 2, cushion))
    const b = rbox(cx - 2, (h - seatTop) * 0.95, 14, 6, x, seatTop - 1, T + back + 5, cushion)
    b.rotation.x = -0.12
    g.add(b)
  }
  const ny = seatsAlong(runY)
  const cy = runY / ny
  for (let i = 0; i < ny; i++) {
    const z = T + seat + cy * (i + 0.5)
    g.add(rbox(seat - back - 1, 13, cy - 1, 5, L + back + (seat - back) / 2, seatTop - 13, z, cushion))
    const b = rbox(14, (h - seatTop) * 0.95, cy - 2, 6, L + back + 5, seatTop - 1, z, cushion)
    b.rotation.z = 0.12
    g.add(b)
  }
  // Two cushions in the corner.
  for (const [x, z, ry] of [
    [L + back + 22, T + back + 16, 0.6],
    [w / 2 - arm - 22, T + back + 16, -0.25],
  ] as const) {
    const p = rbox(36, 36, 11, 8, x, seatTop - 3, z, k.q(COLORS.accent, 'fabric'))
    p.rotation.set(-0.25, ry, 0)
    g.add(p)
  }
  const legs: [number, number][] = [
    [L + 6, T + 6],
    [w / 2 - 6, T + 6],
    [w / 2 - 6, T + seat - 6],
    [L + seat - 6, T + seat - 6],
    [L + seat - 6, d / 2 - 6],
    [L + 6, d / 2 - 6],
  ]
  for (const [x, z] of legs) g.add(leg(x, z, legH, k.q(COLORS.woodDark, 'wood'), 2, 1.5))
  return g
}

function bed(k: Kit, w: number, d: number, h: number, pillows: number) {
  const g = new THREE.Group()
  const legH = 8
  const frameTop = Math.max(legH + 14, h - 20)
  g.add(rbox(w, frameTop - legH, d, 2, 0, legH, 0, k.q(COLORS.woodDark, 'wood'))) // frame
  for (const [sx, sz] of CORNERS) g.add(box(5, legH, 5, sx * (w / 2 - 5), 0, sz * (d / 2 - 5), k.q(COLORS.woodDark, 'wood')))
  g.add(rbox(w - 6, h - frameTop + 2, d - 8, 6, 0, frameTop - 2, 1, k.q(COLORS.white, 'fabric'))) // mattress
  const duvetD = Math.max(d * 0.5, d - 60)
  const duvetZ = d / 2 - duvetD / 2 + 1
  g.add(rbox(w - 2, 10, duvetD + 2, 4, 0, h - 6, duvetZ, k.q(COLORS.sheet, 'fabric'))) // duvet, draping over the sides
  g.add(rbox(w - 1.5, 10.5, 14, 4, 0, h - 6, duvetZ - duvetD / 2 + 6, k.q(COLORS.linen, 'fabric'))) // folded-back sheet
  g.add(rbox(w - 1, 11, 32, 4, 0, h - 6, d / 2 - 20, k.q(COLORS.accent2, 'fabric'))) // throw at the foot
  const pw = (w - 16) / pillows
  for (let i = 0; i < pillows; i++) {
    const p = rbox(pw - 6, 13, 40, 6.5, -w / 2 + 8 + pw * (i + 0.5), h - 1, -d / 2 + 30, k.q(COLORS.white, 'fabric'))
    p.rotation.x = 0.22
    g.add(p)
  }
  g.add(rbox(w + 6, 110, 9, 4, 0, 0, -d / 2 + 4.5, k.q(COLORS.headboard, 'fabric'))) // upholstered headboard
  return g
}

/** A cabinet front with a handle; `pull` is 'bar' (horizontal), 'post' (vertical) or 'knob'. */
function front(k: Kit, g: THREE.Group, w: number, h: number, x: number, y: number, z: number, color: string, pull: 'bar' | 'post' | 'knob', pullAt: 'top' | 'middle' | 'side' = 'top', side = 1) {
  g.add(rbox(w, h, 1.8, 0.5, x, y, z, k.q(color, 'satin')))
  const hz = z + 1.6
  const metal = k.q(COLORS.chrome, 'chrome')
  if (pull === 'knob') g.add(mesh(new THREE.SphereGeometry(1.4, 12, 8), metal).translateX(x).translateY(y + h / 2).translateZ(hz))
  else if (pull === 'bar') g.add(box(Math.min(w * 0.5, 30), 1.2, 1.4, x, pullAt === 'top' ? y + h - 7 : y + h / 2, hz, metal))
  else g.add(box(1.2, Math.min(h * 0.4, 34), 1.4, pullAt === 'side' ? x + side * (w / 2 - 5) : x, y + h / 2 - Math.min(h * 0.2, 17), hz, metal))
}

function nightstand(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const legH = 7
  g.add(rbox(w, h - legH - 2.5, d - 1, 1, 0, legH, -0.5, k.q(COLORS.wood, 'wood')))
  g.add(rbox(w + 1, 2.5, d + 0.5, 1, 0, h - 2.5, 0, k.q(COLORS.woodDark, 'wood')))
  for (const [sx, sz] of CORNERS) g.add(leg(sx * (w / 2 - 4), sz * (d / 2 - 4), legH, k.q(COLORS.woodDark, 'wood'), 1.5, 1))
  const dh = (h - legH - 2.5 - 3) / 2
  for (let i = 0; i < 2; i++) front(k, g, w - 3, dh - 1, 0, legH + 1 + i * dh, d / 2 - 0.4, COLORS.woodLight, 'knob')
  return g
}

function wardrobe(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const plinth = 8
  g.add(box(w - 4, plinth, d - 6, 0, 0, -2, k.q(COLORS.dark, 'satin')))
  g.add(rbox(w, h - plinth, d - 2, 0.8, 0, plinth, -1, k.q(COLORS.wood, 'wood')))
  const n = Math.max(2, Math.round(w / 55))
  const dw = w / n
  for (let i = 0; i < n; i++) {
    // Handles meet at the middle of each pair of doors.
    const side = i % 2 === 0 ? 1 : -1
    front(k, g, dw - 0.6, h - plinth - 3, -w / 2 + dw * (i + 0.5), plinth + 1.5, d / 2 - 1.2, COLORS.woodLight, 'post', 'side', side)
  }
  return g
}

function bookshelf(k: Kit, sym: PlanSymbol, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const wood = k.q(COLORS.wood, 'wood')
  const t = 2
  for (const s of [-1, 1]) g.add(box(t, h, d, s * (w / 2 - t / 2), 0, 0, wood))
  g.add(box(w - 2 * t, 6, d - 2, 0, 0, 1, k.q(COLORS.woodDark, 'wood'))) // plinth
  g.add(box(w, t, d, 0, h - t, 0, wood))
  g.add(box(w - 2 * t, h - t, 1, 0, 0, -d / 2 + 0.5, k.q(COLORS.woodDark, 'wood'))) // back
  const shelves = Math.max(2, Math.round((h - 8) / 36))
  const gap = (h - 6 - t) / shelves
  const rand = random(sym.id)
  for (let s = 0; s < shelves; s++) {
    const y = 6 + s * gap
    if (s > 0) g.add(box(w - 2 * t, t, d - 1.5, 0, y - t, 0.75, wood))
    // Books, with the odd gap and a leaning one now and then.
    let x = -w / 2 + t + 1
    const end = w / 2 - t - 1 - rand() * w * 0.25
    while (x < end - 3) {
      const bw = 2.2 + rand() * 3.5
      const bh = Math.min(gap - 4, gap * (0.55 + rand() * 0.33))
      const bd = d * (0.62 + rand() * 0.2)
      const b = box(bw, bh, bd, x + bw / 2, y, -d / 2 + 1 + bd / 2, k.q(COLORS.books[Math.floor(rand() * COLORS.books.length)], 'satin'))
      if (rand() < 0.06 && x + bw + 6 < end) {
        b.rotation.z = -0.28
        b.position.x += 2
        x += 4
      }
      g.add(b)
      x += bw + (rand() < 0.08 ? 6 + rand() * 10 : 0.2)
    }
  }
  return g
}

/** A flat TV, on the wall (with a bracket behind it) or, when it sits low, on its own feet. */
function tv(k: Kit, w: number, d: number, h: number, elevation: number) {
  const g = new THREE.Group()
  const z = d / 2 - 2
  g.add(rbox(w, h, 3, 0.6, 0, 0, z, k.q(COLORS.black, 'satin')))
  g.add(box(w - 2, h - 2, 0.3, 0, 1, z + 1.5, k.q(COLORS.screen, 'gloss')))
  if (elevation > 20) {
    g.add(box(Math.min(40, w * 0.4), Math.min(30, h * 0.5), d - 4, 0, h * 0.3, -1, k.q(COLORS.dark, 'metal'))) // wall bracket
  } else {
    for (const s of [-1, 1]) g.add(box(3, 1.5, 18, s * w * 0.36, -1.5, z, k.q(COLORS.dark, 'metal')))
  }
  return g
}

function tvUnit(k: Kit, w: number, d: number, h: number, withTv = true) {
  const g = new THREE.Group()
  const legH = 10
  for (const [sx, sz] of CORNERS) g.add(leg(sx * (w / 2 - 6), sz * (d / 2 - 5), legH, k.q(COLORS.dark, 'metal'), 1.4, 1.1))
  g.add(rbox(w, h - legH, d - 1, 1, 0, legH, -0.5, k.q(COLORS.woodDark, 'wood')))
  const n = Math.max(2, Math.round(w / 60))
  const fw = w / n
  for (let i = 0; i < n; i++) front(k, g, fw - 0.8, h - legH - 3, -w / 2 + fw * (i + 0.5), legH + 1.5, d / 2 - 0.6, COLORS.woodLight, 'bar')
  if (!withTv) return g
  // Television on its feet.
  const tw = Math.min(w * 0.72, 165)
  const th = tw * 0.5625
  const z = -d / 2 + 10
  for (const s of [-1, 1]) g.add(box(3, 5, 16, s * tw * 0.36, h, z, k.q(COLORS.dark, 'metal')))
  g.add(rbox(tw, th, 3, 0.6, 0, h + 5, z, k.q(COLORS.black, 'satin')))
  g.add(box(tw - 2, th - 2, 0.3, 0, h + 6, z + 1.5, k.q(COLORS.screen, 'gloss')))
  // A soundbar under it.
  g.add(rbox(Math.min(tw * 0.6, 90), 6, 8, 2.5, 0, h, z + 12, k.q(COLORS.dark, 'fabric')))
  return g
}

function desk(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const top = 3
  g.add(rbox(w, top, d, 1, 0, h - top, 0, k.q(COLORS.wood, 'wood')))
  // Drawers on the right, metal legs on the left.
  const pw = Math.min(42, w * 0.32)
  const px = w / 2 - pw / 2 - 1
  g.add(rbox(pw, h - top, d - 4, 0.8, px, 0, -2, k.q(COLORS.white, 'satin')))
  const dh = (h - top - 4) / 3
  for (let i = 0; i < 3; i++) front(k, g, pw - 2, dh - 1, px, 2 + i * dh, d / 2 - 3.1, COLORS.white, 'bar', 'middle')
  for (const sz of [-1, 1]) g.add(box(4, h - top, 4, -w / 2 + 4, 0, sz * (d / 2 - 4), k.q(COLORS.dark, 'metal')))
  g.add(box(3, 3, d - 10, -w / 2 + 4, 8, 0, k.q(COLORS.dark, 'metal')))
  // Monitor, keyboard and mouse.
  const z = -d / 2 + 14
  g.add(rbox(20, 1.5, 14, 0.7, 0, h, z, k.q(COLORS.dark, 'metal')))
  g.add(box(3, 16, 2, 0, h + 1.5, z - 2, k.q(COLORS.dark, 'metal')))
  g.add(rbox(56, 33, 2.5, 0.6, 0, h + 12, z, k.q(COLORS.black, 'satin')))
  g.add(box(54, 31, 0.3, 0, h + 13, z + 1.3, k.q(COLORS.screen, 'gloss')))
  g.add(rbox(42, 1.6, 13, 0.6, -4, h, z + 26, k.q(COLORS.fabric2, 'satin')))
  g.add(rbox(6, 2.4, 10, 1.2, 24, h, z + 27, k.q(COLORS.fabric2, 'satin')))
  g.add(chair(k, -6, d / 2 + 8, 180))
  return g
}

interface KitchenOpts {
  sink?: boolean
  stove?: boolean
}

function kitchen(k: Kit, w: number, d: number, h: number, opts: KitchenOpts) {
  const g = new THREE.Group()
  const toe = 10
  const top = 4
  const white = COLORS.white
  g.add(box(w - 2, toe, d - 10, 0, 0, -5, k.q(COLORS.dark, 'satin'))) // recessed plinth
  g.add(box(w, h - top - toe, d - 4, 0, toe, -2, k.q(white, 'satin'))) // carcass
  const fz = d / 2 - 3.1
  const fh = h - top - toe - 1
  if (opts.stove) {
    // Oven with a window, knobs above it.
    front(k, g, w - 2, fh - 12, 0, toe + 0.5, fz, COLORS.black, 'bar')
    g.add(box((w - 2) * 0.72, fh * 0.34, 0.3, 0, toe + fh * 0.2, fz + 1.05, k.q(COLORS.screen, 'gloss')))
    g.add(box(w - 2, 10.5, 1.8, 0, h - top - 11, fz, k.q(COLORS.metal, 'metal')))
    for (let i = 0; i < 4; i++) {
      const knob = cylinder(1.8, 1.6, -w * 0.3 + i * w * 0.2, 0, 0, k.q(COLORS.dark, 'metal'))
      knob.rotation.x = Math.PI / 2
      knob.position.set(-w * 0.3 + i * w * 0.2, h - top - 5.5, fz + 1.6)
      g.add(knob)
    }
  } else {
    const n = Math.max(1, Math.round(w / 60))
    const fw = w / n
    for (let i = 0; i < n; i++) front(k, g, fw - 0.6, fh, -w / 2 + fw * (i + 0.5), toe + 0.5, fz, white, 'bar')
  }

  const stone = k.q(COLORS.stone, 'satin')
  if (opts.sink) {
    // Worktop around an undermounted steel sink.
    const bw = Math.min(w - 20, 72)
    const bd = Math.min(d - 20, 42)
    const bz = 2
    const side = (w - bw) / 2
    for (const s of [-1, 1]) g.add(box(side, top, d, s * (w / 2 - side / 2), h - top, 0, stone))
    g.add(box(bw, top, d / 2 - bz - bd / 2, 0, h - top, bz + bd / 2 + (d / 2 - bz - bd / 2) / 2, stone))
    g.add(box(bw, top, d / 2 + bz - bd / 2, 0, h - top, -d / 2 + (d / 2 + bz - bd / 2) / 2, stone))
    const steel = k.q(COLORS.metal, 'metal')
    const depth = 20
    g.add(box(bw, 1, bd, 0, h - depth, bz, steel))
    for (const s of [-1, 1]) {
      g.add(box(bw, depth, 0.8, 0, h - depth, bz + s * (bd / 2 - 0.4), steel))
      g.add(box(0.8, depth, bd, s * (bw / 2 - 0.4), h - depth, bz, steel))
    }
    g.add(cylinder(3, 0.3, 0, h - depth + 1, bz, k.q(COLORS.dark, 'metal'))) // drain
    // Gooseneck tap.
    const chrome = k.q(COLORS.chrome, 'chrome')
    const tz = bz - bd / 2 - 5
    g.add(cylinder(2.4, 3, 0, h, tz, chrome))
    g.add(cylinder(1.3, 24, 0, h + 3, tz, chrome, 1, 1.3, 16))
    const arc = mesh(new THREE.TorusGeometry(9, 1.3, 10, 24, Math.PI), chrome)
    arc.rotation.y = Math.PI / 2
    arc.position.set(0, h + 27, tz + 9)
    g.add(arc)
    g.add(cylinder(1.5, 4, 0, h + 23, tz + 18, chrome, 1, 1.5, 16))
    g.add(box(1.2, 1.2, 8, 3.5, h + 10, tz + 2, chrome)) // lever
  } else {
    g.add(rbox(w, top, d, 0.6, 0, h - top, 0, stone))
  }
  if (opts.stove) {
    g.add(rbox(w - 6, 0.8, d - 10, 0.3, 0, h, 0, k.q(COLORS.black, 'gloss'))) // glass cooktop
    for (const [sx, sz, r] of [
      [-1, -1, 8],
      [1, -1, 6.5],
      [-1, 1, 6.5],
      [1, 1, 8],
    ]) {
      const ring = mesh(new THREE.TorusGeometry(r, 0.35, 6, 32), k.q(COLORS.dark, 'satin'))
      ring.rotation.x = Math.PI / 2
      ring.position.set(sx * w * 0.22, h + 0.85, sz * d * 0.2)
      g.add(ring)
    }
  }
  return g
}

function fridge(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const body = k.q(COLORS.metal, 'metal')
  for (const sx of [-1, 1]) g.add(box(4, 2, 4, sx * (w / 2 - 5), 0, d / 2 - 6, k.q(COLORS.dark, 'satin')))
  g.add(rbox(w, h - 2, d - 3, 1.5, 0, 2, -1.5, body))
  const split = (h - 2) * 0.36
  g.add(rbox(w - 0.6, split - 0.8, 3, 1.2, 0, 2, d / 2 - 1.5, body))
  g.add(rbox(w - 0.6, h - 2 - split - 0.8, 3, 1.2, 0, 2 + split + 0.4, d / 2 - 1.5, body))
  const chrome = k.q(COLORS.chrome, 'chrome')
  g.add(box(2, 30, 2.4, w / 2 - 6, split - 34, d / 2 + 1, chrome))
  g.add(box(2, 40, 2.4, w / 2 - 6, split + 8, d / 2 + 1, chrome))
  return g
}

function toilet(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const white = k.q(COLORS.ceramic, 'gloss')
  const tankD = Math.min(20, d * 0.3)
  const zb = -d / 2 + tankD + (d - tankD) * 0.42
  const s = (d - tankD) / w // bowl stretch front to back
  g.add(cylinder(w * 0.2, 26, 0, 0, zb - 2, white, s, w * 0.24)) // pedestal
  const bowl = mesh(new THREE.SphereGeometry(w * 0.46, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), white)
  bowl.rotation.x = Math.PI // upside-down dome
  bowl.scale.set(1, 0.6, s * 0.95)
  bowl.position.set(0, 41, zb)
  g.add(bowl)
  const seat = mesh(new THREE.TorusGeometry(w * 0.33, 2.4, 10, 32), k.q(COLORS.white, 'satin'))
  seat.rotation.x = Math.PI / 2
  seat.scale.set(1, s * 1.05, 0.7)
  seat.position.set(0, 42.5, zb + 1)
  g.add(seat)
  g.add(cylinder(w * 0.42, 2, 0, 43.5, zb + 1, k.q(COLORS.white, 'satin'), s * 1.05)) // closed lid
  const tankTop = Math.max(70, h)
  g.add(rbox(w * 0.92, tankTop - 36, tankD, 3, 0, 36, -d / 2 + tankD / 2, white))
  g.add(cylinder(2.6, 0.8, 0, tankTop, -d / 2 + tankD / 2, k.q(COLORS.chrome, 'chrome')))
  return g
}

function washbasin(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  // Wall-hung vanity with a stone top, a bowl basin, a tall tap and a mirror.
  const bottom = 32
  const top = 3
  g.add(rbox(w, h - top - bottom, d - 2, 1, 0, bottom, -1, k.q(COLORS.woodDark, 'wood')))
  const n = w >= 80 ? 2 : 1
  const fw = w / n
  for (let i = 0; i < n; i++) {
    front(k, g, fw - 0.8, h - top - bottom - 2, -w / 2 + fw * (i + 0.5), bottom + 1, d / 2 - 2.1, COLORS.wood, 'post', 'side', n === 2 ? (i === 0 ? 1 : -1) : 1)
  }
  g.add(rbox(w, top, d, 0.6, 0, h - top, 0, k.q(COLORS.stone, 'satin')))
  const r = Math.min(w, d) * 0.38
  g.add(lathe([[0.1, 0.5], [r * 0.45, 0], [r * 0.9, 5], [r, 12], [r - 1.2, 12], [r * 0.82, 6], [r * 0.38, 1.6], [0.1, 1.6]], 0, h, 2, k.q(COLORS.ceramic, 'ceramic')))
  const chrome = k.q(COLORS.chrome, 'chrome')
  const tz = 2 - r - 4
  g.add(cylinder(1.8, 26, 0, h, tz, chrome, 1, 2.2, 16))
  g.add(box(2.4, 2.4, 13, 0, h + 23, tz + 6, chrome))
  g.add(box(1, 1, 7, 2.6, h + 24, tz + 2, chrome)) // lever
  g.add(rbox(Math.min(w, 90), 75, 2, 1, 0, h + 30, -d / 2 + 1, k.q(COLORS.mirror, 'gloss')))
  return g
}

function bathtub(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const white = k.q(COLORS.ceramic, 'gloss')
  const t = 8
  for (const s of [-1, 1]) {
    g.add(rbox(w, h, t, 3, 0, 0, s * (d / 2 - t / 2), white)) // long sides
    g.add(rbox(t * 1.4, h, d, 3, s * (w / 2 - t * 0.7), 0, 0, white)) // ends
  }
  g.add(box(w - 2 * t, h - 16, d - 2 * t, 0, 0, 0, white)) // basin floor (inside at h - 16)
  g.add(cylinder(2.5, 0.3, -w / 2 + t * 1.4 + 8, h - 16, 0, k.q(COLORS.chrome, 'chrome'))) // drain
  const chrome = k.q(COLORS.chrome, 'chrome')
  g.add(cylinder(1.8, 8, -w / 2 + t * 0.7, h, 0, chrome, 1, 2.2, 16))
  g.add(box(10, 2.2, 2.4, -w / 2 + t * 0.7 + 5, h + 6, 0, chrome)) // spout
  for (const s of [-1, 1]) g.add(cylinder(1.6, 3, -w / 2 + t * 0.7, h, s * 8, chrome, 1, 1.6, 12))
  return g
}

function shower(k: Kit, w: number, d: number, h: number, glass: Mat) {
  const g = new THREE.Group()
  const tray = 5
  g.add(rbox(w, tray, d, 1.5, 0, 0, 0, k.q(COLORS.ceramic, 'gloss')))
  g.add(cylinder(4, 0.3, 0, tray, 0, k.q(COLORS.metal, 'metal')))
  const metal = k.q(COLORS.metal, 'metal')
  // Glass on the open front and side, in slim frames.
  g.add(box(w, h - tray, 0.8, 0, tray, d / 2 - 1, glass))
  g.add(box(0.8, h - tray, d, w / 2 - 1, tray, 0, glass))
  g.add(box(w, 2, 2, 0, h - 2, d / 2 - 1, metal))
  g.add(box(2, 2, d, w / 2 - 1, h - 2, 0, metal))
  g.add(box(2, h - tray, 2, w / 2 - 1, tray, d / 2 - 1, metal))
  g.add(box(1.2, 30, 2.5, -w / 2 + w * 0.35, 90, d / 2 + 1, k.q(COLORS.chrome, 'chrome'))) // door pull
  // Rain head on an arm from the back wall, and a mixer.
  const chrome = k.q(COLORS.chrome, 'chrome')
  const arm = cylinder(1.1, 25, 0, 0, 0, chrome, 1, 1.1, 12)
  arm.rotation.x = Math.PI / 2
  arm.position.set(0, h - 10, -d / 2 + 12.5)
  g.add(arm)
  g.add(cylinder(11, 1.6, 0, h - 12, -d / 2 + 25, chrome))
  g.add(rbox(14, 8, 4, 2, 0, 105, -d / 2 + 2, chrome))
  return g
}

function plant(k: Kit, sym: PlanSymbol, w: number, h: number) {
  const g = new THREE.Group()
  const rand = random(sym.id)
  const pr = w * 0.28
  const potH = Math.min(38, Math.max(18, h * 0.3))
  g.add(lathe([[0.1, 0], [pr * 0.75, 0], [pr, potH * 0.92], [pr * 1.1, potH], [pr * 0.96, potH], [pr * 0.9, potH - 1], [0.1, potH - 1]], 0, 0, 0, k.q(COLORS.pot, 'satin')))
  g.add(cylinder(pr * 0.9, 0.5, 0, potH - 2.5, 0, k.q(COLORS.soil, 'fabric')))
  const leaf = () => k.q(COLORS.leaves[Math.floor(rand() * COLORS.leaves.length)], 'leaf')
  if (h > 110) {
    // Small tree: a trunk and a crown of leaf clusters.
    const crown = h * 0.72
    g.add(cylinder(1.6, crown - potH, 0, potH - 2, 0, k.q(COLORS.woodDark, 'wood'), 1, 2.2, 8))
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2
      const r = w * (0.08 + rand() * 0.22)
      g.add(blob(w * (0.2 + rand() * 0.14), Math.cos(a) * r, crown + (rand() - 0.3) * (h - crown) * 0.9, Math.sin(a) * r, leaf(), 1.15))
    }
  } else {
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2
      const r = w * (0.05 + rand() * 0.2)
      const top = Math.max(potH + 8, h - w * 0.2)
      g.add(blob(w * (0.16 + rand() * 0.12), Math.cos(a) * r, potH + 4 + rand() * (top - potH - 4), Math.sin(a) * r, leaf(), 1.2))
    }
  }
  return g
}

function stairs(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const steps = Math.max(2, Math.round(d / 28))
  const rise = h / steps
  const run = d / steps
  const tread = 4
  for (let i = 0; i < steps; i++) {
    const z = d / 2 - (i + 0.5) * run
    g.add(box(w, rise * (i + 1) - tread, run, 0, 0, z, k.q(COLORS.white, 'satin'))) // riser and body
    g.add(rbox(w, tread, run + 3, 1, 0, rise * (i + 1) - tread, z + 1.5, k.q(COLORS.wood, 'wood'))) // tread with nosing
  }
  // Handrail on the +X side, on a post at every other step.
  const x = w / 2 - 4
  const railH = 90
  const metal = k.q(COLORS.dark, 'metal')
  for (let i = 0; i < steps; i += 2) g.add(cylinder(1.2, railH, x, rise * (i + 1), d / 2 - (i + 0.5) * run, metal, 1, 1.2, 10))
  const y0 = rise + railH
  const y1 = h + railH
  const z0 = d / 2 - run / 2
  const z1 = -d / 2 + run / 2
  const len = Math.hypot(y1 - y0, z0 - z1)
  const rail = rbox(5, 4, len + 6, 1.8, 0, -2, 0, k.q(COLORS.wood, 'wood'))
  const holder = new THREE.Group()
  holder.add(rail)
  holder.position.set(x, (y0 + y1) / 2, (z0 + z1) / 2)
  holder.rotation.x = Math.atan2(y1 - y0, z0 - z1)
  g.add(holder)
  return g
}

// ---------- doors and windows ----------

function doorFrame(k: Kit, g: THREE.Group, w: number, h: number, wallT: number) {
  const frame = k.q(COLORS.frame, 'satin')
  const jamb = 3
  const arch = 7
  for (const s of [-1, 1]) {
    g.add(box(jamb, h, wallT + 0.4, s * (w / 2 - jamb / 2), 0, 0, frame))
    for (const face of [-1, 1]) g.add(box(arch, h + arch - 1, 1.5, s * (w / 2 + arch / 2 - 1), 0, face * (wallT / 2 + 0.75), frame))
  }
  g.add(box(w, jamb, wallT + 0.4, 0, h - jamb, 0, frame))
  for (const face of [-1, 1]) g.add(box(w + 2 * arch - 2, arch, 1.5, 0, h - 1, face * (wallT / 2 + 0.75), frame))
}

/**
 * A leaf opened 90° into the room, hinged at `hx`; `side` = +1 when it extends toward +X from the hinge.
 * It turns shut into the frame at the room-side face of the wall.
 */
function doorLeaf(k: Kit, g: THREE.Group, hx: number, leaf: number, side: number, h: number, wallT: number) {
  g.add(hinged(hx, wallT / 2, (side * Math.PI) / 2, (p) => woodLeaf(k, p, hx, leaf, side, h, wallT)))
}

function woodLeaf(k: Kit, g: THREE.Group, hx: number, leaf: number, side: number, h: number, wallT: number) {
  const x = hx + side * 2
  const z0 = wallT / 2
  g.add(rbox(4, h - 4, leaf, 0.6, x, 1, z0 + leaf / 2, k.q(COLORS.door, 'satin')))
  // Two raised panels on each face.
  const panel = k.q(COLORS.door, 'wood')
  for (const face of [-1, 1]) {
    g.add(box(0.6, (h - 4) * 0.42, leaf * 0.64, x + face * 2.2, (h - 4) * 0.52, z0 + leaf / 2, panel))
    g.add(box(0.6, (h - 4) * 0.3, leaf * 0.64, x + face * 2.2, 12, z0 + leaf / 2, panel))
  }
  // Lever handles near the free edge.
  const chrome = k.q(COLORS.chrome, 'chrome')
  const hz = z0 + leaf - 7
  for (const face of [-1, 1]) {
    const rose = cylinder(2.6, 1, 0, 0, 0, chrome)
    rose.rotation.z = Math.PI / 2
    rose.position.set(x + face * 2.5, 100, hz)
    g.add(rose)
    g.add(box(1.6, 1.8, 12, x + face * 4.2, 99, hz - 5, chrome))
  }
}

/**
 * A barn-style sliding door: a wooden panel hung from a steel rail on the room side of the wall,
 * sliding to the left to open.
 */
function barnDoor(k: Kit, w: number, h: number, wallT: number) {
  const g = new THREE.Group()
  const pw = w + 10
  const ph = h + 4
  const pt = 4
  const z = wallT / 2 + 2.5 + pt / 2
  const x = 0
  const wood = k.q(COLORS.barn, 'wood')
  const groove = k.q(COLORS.barnDark, 'wood')
  const steel = k.q(COLORS.metal, 'metal')
  // The panel with its hangers and handles moves; the rail stays.
  const panel = sliding(-(w / 2 + pw / 2 + 2), () => {})
  g.add(panel)
  panel.add(rbox(pw, ph, pt, 0.6, x, 1, z, wood))
  // Boards: a few horizontal joints across both faces.
  for (const f of [0.28, 0.52, 0.76]) {
    for (const face of [-1, 1]) panel.add(box(pw - 1, 0.7, 0.3, x, 1 + ph * f, z + face * (pt / 2 + 0.05), groove))
  }
  // Rail: long enough for the door to open fully to the left, on brackets from the wall.
  const railY = 1 + ph + 12
  const x0 = -w / 2 - pw - 5
  const x1 = w / 2 + 12
  const rail = cylinder(1.3, x1 - x0, 0, 0, 0, steel, 1, 1.3, 16)
  rail.rotation.z = Math.PI / 2
  rail.position.set((x0 + x1) / 2, railY, z)
  g.add(rail)
  for (const bx of [x0 + 4, (x0 + x1) / 2, x1 - 4]) {
    const bracket = cylinder(1, z - wallT / 2, 0, 0, 0, steel, 1, 1, 10)
    bracket.rotation.x = Math.PI / 2
    bracket.position.set(bx, railY, wallT / 2 + (z - wallT / 2) / 2)
    g.add(bracket)
  }
  for (const sx of [x0 + 1, x1 - 1]) {
    const stop = cylinder(2.2, 3, 0, 0, 0, steel, 1, 2.2, 14)
    stop.rotation.z = Math.PI / 2
    stop.position.set(sx, railY, z)
    g.add(stop)
  }
  // Hangers: straps bolted to the top of the panel, each with a wheel riding on the rail.
  for (const s of [-1, 1]) {
    const hx = x + s * pw * 0.3
    for (const face of [-1, 1]) panel.add(box(4, 20, 0.8, hx, 1 + ph - 8, z + face * (pt / 2 + 0.4), steel))
    const wheel = cylinder(4.5, 2.2, 0, 0, 0, steel, 1, 4.5, 20)
    wheel.rotation.x = Math.PI / 2
    wheel.position.set(hx, railY + 3.2, z)
    panel.add(wheel)
  }
  // A bar handle on each face, at the edge that closes the opening.
  const hx = x + pw / 2 - 9
  for (const face of [-1, 1]) {
    panel.add(cylinder(1.1, 32, hx, 86, z + face * (pt / 2 + 3.2), steel, 1, 1.1, 12))
    for (const y of [89, 113]) {
      const post = cylinder(0.7, 3, 0, 0, 0, steel, 1, 0.7, 8)
      post.rotation.x = Math.PI / 2
      post.position.set(hx, y, z + face * (pt / 2 + 1.6))
      panel.add(post)
    }
  }
  return g
}

function slidingDoor(k: Kit, w: number, h: number, wallT: number, glass: Mat) {
  const g = new THREE.Group()
  const alu = k.q(COLORS.dark, 'metal')
  g.add(box(w, 5, wallT * 0.7, 0, h - 5, 0, alu))
  g.add(box(w, 2, wallT * 0.7, 0, 0, 0, alu))
  const pw = w * 0.55
  for (const [s, z] of [
    [-1, -2.2],
    [1, 2.2],
  ]) {
    const x = s * (w / 2 - pw / 2)
    // The room-side panel slides over the other one to open.
    const p = s === 1 ? sliding(-(w - pw), () => {}) : g
    if (p !== g) g.add(p)
    p.add(box(pw - 8, h - 15, 1, x, 7, z, glass))
    for (const e of [-1, 1]) p.add(box(4, h - 7, 3, x + e * (pw / 2 - 2), 2, z, alu))
    for (const y of [2, h - 9]) p.add(box(pw, 4, 3, x, y, z, alu))
    p.add(box(1.4, 40, 2, x - s * (pw / 2 - 8), 85, z + s * 2.5, k.q(COLORS.chrome, 'chrome')))
  }
  return g
}

/** An aluminium door frame set in the middle of the wall. */
function aluFrame(g: THREE.Group, w: number, h: number, wallT: number, alu: Mat) {
  const fd = Math.min(wallT, 8)
  for (const s of [-1, 1]) g.add(box(5, h, fd, s * (w / 2 - 2.5), 0, 0, alu))
  g.add(box(w, 5, fd, 0, h - 5, 0, alu))
}

/** A glazed aluminium leaf, hinged at `hx` like `doorLeaf`: slim frame, kick rail, a middle rail, glass above and below. */
function aluLeaf(k: Kit, g: THREE.Group, hx: number, leaf: number, side: number, h: number, wallT: number, alu: Mat, glass: Mat) {
  const z0 = wallT / 2
  g.add(
    hinged(hx, z0, (side * Math.PI) / 2, (p) => {
      const x = hx + side * 2.25
      const t = 4.5
      const st = 6
      const zc = z0 + leaf / 2
      const inner = leaf - 2 * st
      for (const z of [z0 + st / 2, z0 + leaf - st / 2]) p.add(box(t, h, st, x, 0, z, alu))
      p.add(box(t, 14, inner, x, 0, zc, alu))
      p.add(box(t, 6, inner, x, 95, zc, alu))
      p.add(box(t, 6, inner, x, h - 6, zc, alu))
      p.add(box(0.8, 95 - 14, inner, x, 14, zc, glass))
      p.add(box(0.8, h - 6 - 101, inner, x, 101, zc, glass))
      // Lever handles near the free edge.
      const chrome = k.q(COLORS.chrome, 'chrome')
      const hz = z0 + leaf - 3
      for (const face of [-1, 1]) {
        p.add(box(1.2, 16, 3, x + face * 2.8, 92, hz, alu))
        p.add(box(1.6, 1.8, 12, x + face * 4.4, 99, hz - 6, chrome))
      }
    }),
  )
}

/** Two glazed aluminium panels on two tracks; the room-side one slides over the other to open. */
function aluSliding(k: Kit, w: number, h: number, wallT: number, alu: Mat, glass: Mat) {
  const g = new THREE.Group()
  const fd = Math.min(wallT, 9)
  for (const s of [-1, 1]) g.add(box(4, h, fd, s * (w / 2 - 2), 0, 0, alu))
  g.add(box(w, 6, fd, 0, h - 6, 0, alu))
  g.add(box(w, 2.5, fd, 0, 0, 0, alu))
  const span = w - 8
  const pw = span / 2 + 4
  const y0 = 2.5
  const ph = h - 6 - y0 - 0.5
  const panel = (p: THREE.Group, x: number, z: number, handleSide: number) => {
    const t = 3.2
    for (const e of [-1, 1]) p.add(box(6, ph, t, x + e * (pw / 2 - 3), y0, z, alu))
    p.add(box(pw - 12, 9, t, x, y0, z, alu))
    p.add(box(pw - 12, 6, t, x, y0 + ph - 6, z, alu))
    p.add(box(pw - 12, ph - 15, 0.8, x, y0 + 9, z, glass))
    // A slim pull on the outer stile.
    p.add(box(1.2, 30, 2, x + handleSide * (pw / 2 - 3), 85, z + Math.sign(z) * 2.4, k.q(COLORS.chrome, 'chrome')))
  }
  const xL = -span / 2 + pw / 2
  const xR = span / 2 - pw / 2
  panel(g, xL, -2, -1)
  g.add(sliding(xL - xR, (p) => panel(p, xR, 2, 1)))
  return g
}

function windowUnit(k: Kit, w: number, h: number, wallT: number, glass: Mat, wide: boolean) {
  const g = new THREE.Group()
  const frame = k.q(COLORS.frame, 'satin')
  const f = 6
  const fd = 7
  for (const s of [-1, 1]) g.add(box(f, h, fd, s * (w / 2 - f / 2), 0, 0, frame))
  g.add(box(w, f, fd, 0, 0, 0, frame))
  g.add(box(w, f, fd, 0, h - f, 0, frame))
  const sashes = wide || w >= 110 ? 2 : 1
  if (sashes === 2) g.add(box(f, h, fd, 0, 0, 0, frame))
  const inner = (w - f * (sashes + 1)) / sashes
  for (let i = 0; i < sashes; i++) {
    const x = -w / 2 + f + inner / 2 + i * (inner + f)
    // Sash frame around the glass.
    for (const s of [-1, 1]) g.add(box(3.5, h - 2 * f, 4.5, x + s * (inner / 2 - 1.75), f, 1, frame))
    for (const y of [f, h - f - 3.5]) g.add(box(inner, 3.5, 4.5, x, y, 1, frame))
    g.add(box(inner - 7, h - 2 * f - 7, 0.8, x, f + 3.5, 1, glass))
    // Handle on the inside, by the middle post.
    const hx = sashes === 2 ? (i === 0 ? x + inner / 2 - 4 : x - inner / 2 + 4) : x + inner / 2 - 4
    g.add(box(1.4, 11, 1.6, hx, h / 2 - 6, 4.2, k.q(COLORS.chrome, 'chrome')))
  }
  g.add(rbox(w + 8, 3, wallT / 2 + 4, 0.8, 0, -3, wallT / 4 + 2, k.q(COLORS.white, 'satin'))) // inside sill
  g.add(box(w + 4, 3, wallT / 2 + 4, 0, -4, -(wallT / 4 + 2), k.q(COLORS.stone, 'satin'))) // outside sill
  return g
}

// ---------- balconies ----------

/**
 * A balcony's railing along the given runs (its open edges), in world position. Glass panels on a
 * metal shoe, metal balusters, or a solid parapet with a coping stone.
 */
export function railingModel(room: Room, runs: { a: Point; b: Point }[], mats: Materials, hl: boolean, base: number): THREE.Group {
  const g = new THREE.Group()
  const style = room.railing?.style ?? 'glass'
  if (style === 'none') return g
  const h = room.railing?.height ?? 105
  const t = room.wallThickness
  const sa = signedArea(room.points)
  const q = (color: string, finish?: Finish) => mats.get(color, hl, finish)
  for (const { a, b } of runs) {
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    if (L < 2) continue
    // Centered on the railing band, which lies just outside the balcony's edge.
    const n = inwardNormal(a, b, sa)
    const seg = new THREE.Group()
    seg.position.set((a.x + b.x) / 2 - (n.x * t) / 2, base, (a.y + b.y) / 2 - (n.y * t) / 2)
    seg.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x)
    if (style === 'glass') {
      seg.add(box(L, 8, t, 0, 0, 0, q(COLORS.dark, 'metal')))
      seg.add(box(L - 0.5, h - 13, 1.2, 0, 8, 0, mats.glass()))
      seg.add(rbox(L, 4.5, t + 1, 1.8, 0, h - 5, 0, q(COLORS.chrome, 'chrome')))
    } else if (style === 'metal') {
      const metal = q(COLORS.dark, 'metal')
      seg.add(rbox(L, 4, t + 1, 1.5, 0, h - 4, 0, metal))
      seg.add(box(L, 3, 3, 0, 8, 0, metal))
      for (const e of [-1, 1]) seg.add(box(4, h - 4, 4, e * (L / 2 - 2), 0, 0, metal))
      const count = Math.max(1, Math.round(L / 12))
      for (let i = 1; i < count; i++) seg.add(box(1.6, h - 15, 1.6, -L / 2 + (i * L) / count, 11, 0, metal))
    } else {
      seg.add(box(L, h - 5, t, 0, 0, 0, q(COLORS.wall)))
      seg.add(rbox(L + 1, 5, t + 5, 1, 0, h - 5, 0, q(COLORS.stone, 'satin')))
    }
    g.add(seg)
  }
  return g.children.length ? compact(g) : g
}

// ---------------------------------------------------------------------------

/** The 3D model for a symbol (not light fixtures), in its local frame. Empty for symbols without one. */
export function symbolModel(sym: PlanSymbol, mats: Materials, hl: boolean, wallT: number, floorH: number, hasDef: boolean): THREE.Group {
  const k: Kit = { q: (color, finish) => mats.get(color, hl, finish), glass: () => mats.glass() }
  const w = sym.width
  const d = sym.depth
  const h = sym.height
  let g = new THREE.Group()

  switch (sym.type) {
    case 'door':
      doorFrame(k, g, w, h, wallT)
      doorLeaf(k, g, -w / 2 + 3, w - 6, 1, h - 3, wallT)
      break
    case 'door-double':
      doorFrame(k, g, w, h, wallT)
      doorLeaf(k, g, -w / 2 + 3, w / 2 - 3, 1, h - 3, wallT)
      doorLeaf(k, g, w / 2 - 3, w / 2 - 3, -1, h - 3, wallT)
      break
    case 'door-sliding':
      g = slidingDoor(k, w, h, wallT, k.glass())
      break
    case 'door-barn':
      g = barnDoor(k, w, h, wallT)
      break
    case 'door-alu':
    case 'door-alu-double':
    case 'door-alu-sliding': {
      const fr = frameOf(sym)!
      const alu = k.q(fr.hex, fr.metal ? 'metal' : 'satin')
      if (sym.type === 'door-alu-sliding') {
        g = aluSliding(k, w, h, wallT, alu, k.glass())
        break
      }
      aluFrame(g, w, h, wallT, alu)
      if (sym.type === 'door-alu') aluLeaf(k, g, -w / 2 + 5, w - 10, 1, h - 5, wallT, alu, k.glass())
      else {
        aluLeaf(k, g, -w / 2 + 5, w / 2 - 5, 1, h - 5, wallT, alu, k.glass())
        aluLeaf(k, g, w / 2 - 5, w / 2 - 5, -1, h - 5, wallT, alu, k.glass())
      }
      break
    }
    case 'window':
    case 'window-wide':
      g = windowUnit(k, w, h, wallT, k.glass(), sym.type === 'window-wide')
      break
    case 'sofa':
      // Longer sofas get more seats; arms and back keep their size.
      g = sofa(k, w, d, h, seatsAlong(w - 2 * Math.min(SOFA.arm, w * 0.09)))
      break
    case 'sofa-corner':
      g = cornerSofa(k, w, d, h)
      break
    case 'armchair':
      g = sofa(k, w, d, h, 1)
      break
    case 'coffee-table':
      g = coffeeTable(k, w, d, h)
      break
    case 'desk':
      g = desk(k, w, d, h)
      break
    case 'dining-table': {
      g = table(k, w, d, h)
      const n = chairsAlong(w)
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (w * (i + 0.5)) / n
        g.add(chair(k, x, -d / 2 - 10, 0), chair(k, x, d / 2 + 10, 180))
      }
      break
    }
    case 'round-table': {
      g.add(cylinder(w / 2, 3.5, 0, h - 3.5, 0, k.q(COLORS.wood, 'wood'), d / w, w / 2 - 0.8, 48))
      const base = Math.min(28, w * 0.3)
      g.add(lathe([[0.1, 0], [base, 0], [base, 1.5], [base * 0.5, 4], [4.5, 10], [3.5, h - 12], [9, h - 4], [0.1, h - 4]], 0, 0, 0, k.q(COLORS.woodDark, 'wood')))
      g.add(chair(k, 0, -d / 2 - 8, 0), chair(k, 0, d / 2 + 8, 180))
      g.add(chair(k, -w / 2 - 8, 0, -90), chair(k, w / 2 + 8, 0, 90))
      break
    }
    case 'chair':
      g.add(chair(k, 0, 0, 0, w, d))
      break
    case 'plant':
      g = plant(k, sym, w, h)
      break
    case 'bed-double':
      g = bed(k, w, d, h, 2)
      break
    case 'bed-single':
      g = bed(k, w, d, h, 1)
      break
    case 'bathtub':
      g = bathtub(k, w, d, h)
      break
    case 'shower':
      g = shower(k, w, d, h, k.glass())
      break
    case 'toilet':
      g = toilet(k, w, d, h)
      break
    case 'washbasin':
      g = washbasin(k, w, d, h)
      break
    case 'counter':
      g = kitchen(k, w, d, h, {})
      break
    case 'kitchen-sink':
      g = kitchen(k, w, d, h, { sink: true })
      break
    case 'stove':
      g = kitchen(k, w, d, h, { stove: true })
      break
    case 'fridge':
      g = fridge(k, w, d, h)
      break
    case 'tv-unit':
      g = tvUnit(k, w, d, h)
      break
    case 'tv-stand':
      g = tvUnit(k, w, d, h, false)
      break
    case 'tv':
      g = tv(k, w, d, h, sym.elevation ?? 100)
      break
    case 'wardrobe':
      g = wardrobe(k, w, d, h)
      break
    case 'bookshelf':
      g = bookshelf(k, sym, w, d, h)
      break
    case 'nightstand':
      g = nightstand(k, w, d, h)
      break
    case 'stairs':
      g = stairs(k, w, d, h)
      break
    case 'column':
      g.add(rbox(w, floorH, d, 1, 0, 0, 0, k.q(COLORS.wall)))
      break
    case 'outlet': {
      // Plate on the wall behind the symbol, at its mounting height.
      const y = h || 30
      g.add(rbox(8.5, 8.5, 1, 0.5, 0, y - 4.25, -d / 2 + 0.5, k.q(COLORS.white, 'satin')))
      for (const s of [-1, 1]) g.add(box(0.8, 0.8, 0.4, s * 1.6, y - 0.4, -d / 2 + 1.1, k.q(COLORS.dark)))
      break
    }
    case 'light':
      g.add(cylinder(w / 2, 3, 0, floorH - 3, 0, mats.emissive(COLORS.light)))
      break
    case 'opening':
    case 'label':
    case 'switch':
      break
    default:
      if (hasDef) g.add(rbox(w, h || 50, d, 2, 0, 0, 0, k.q(COLORS.fabric2)))
  }
  return g.children.length ? compactModel(g) : g
}
