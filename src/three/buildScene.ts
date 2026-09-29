import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { add, dist, dot, inwardNormal, mul, normalize, offsetPolygon, signedArea, sub } from '@/model/geometry'
import { roomOuter, symbolPose } from '@/model/project'
import { SYMBOL_MAP } from '@/model/symbols'
import type { SymbolDef } from '@/model/symbols'
import type { PlanTheme } from '@/model/theme'
import type { Floor, PlanSymbol, Point, Project, Room, Selection } from '@/model/types'
import { buildCeilings, buildFixture } from './lighting3d'
import type { LightHandle, SwitchHandle } from './lighting3d'

/*
 * Coordinate mapping: plan (x, y) in cm, y pointing down  →  three.js (X = x, Y = up, Z = y).
 * A plan rotation of θ degrees (clockwise on screen) is a rotation of -θ around the Y axis.
 */

export const SLAB = 15

export interface PickInfo {
  floorId: string
  kind: 'room' | 'symbol'
  id: string
}

export type FloorFilter = 'upToCurrent' | 'all' | 'current'

const COLORS = {
  wall: '#f4f4f5',
  slab: '#a8a29e',
  wood: '#b08968',
  woodDark: '#7f5539',
  fabric: '#94a3b8',
  fabric2: '#cbd5e1',
  white: '#fafaf9',
  metal: '#a1a1aa',
  dark: '#3f3f46',
  sheet: '#e0e7ff',
  pot: '#9a3412',
  leaf: '#4d7c0f',
  counter: '#e7e5e4',
  glass: '#bae6fd',
  door: '#d6c3a5',
  light: '#fef9c3',
}

/** Caches materials per color so the scene uses as few as possible. */
class Materials {
  private cache = new Map<string, THREE.Material>()

  get(color: string, highlight = false): THREE.MeshStandardMaterial {
    const key = `${color}|${highlight}`
    let m = this.cache.get(key) as THREE.MeshStandardMaterial | undefined
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 })
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

/** Extrude a plan polygon vertically between heights z0 and z1 (relative to `base`). */
function prism(poly: Point[], z0: number, z1: number, base: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)))
  const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false })
  g.rotateX(Math.PI / 2) // (x, y, z) → (x, -z, y)
  g.translate(0, base + z1, 0)
  return g
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pick?: PickInfo) {
  const m = new THREE.Mesh(geo, mat)
  m.castShadow = true
  m.receiveShadow = true
  if (pick) m.userData.pick = pick
  return m
}

/** Box whose bottom sits at `y`, centered on (x, z) in the symbol's local frame. */
function box(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y + h / 2, z)
  return m
}

function cylinder(r: number, h: number, x: number, y: number, z: number, mat: THREE.Material, scaleZ = 1) {
  const m = mesh(new THREE.CylinderGeometry(r, r, h, 32), mat)
  m.position.set(x, y + h / 2, z)
  m.scale.z = scaleZ
  return m
}

// ---------------------------------------------------------------------------
// Walls with openings

interface Opening {
  center: Point
  dir: Point
  width: number
  bottom: number
  top: number
}

function wallOpenings(floor: Floor): Opening[] {
  const out: Opening[] = []
  for (const sym of floor.symbols) {
    const def = SYMBOL_MAP.get(sym.type)
    if (!def?.wall) continue
    const pose = symbolPose(sym, floor.rooms)
    const r = (pose.rotation * Math.PI) / 180
    const bottom = sym.elevation ?? def.sill ?? 0
    out.push({
      center: { x: pose.x, y: pose.y },
      dir: { x: Math.cos(r), y: Math.sin(r) },
      width: sym.width,
      bottom,
      top: bottom + sym.height,
    })
  }
  return out
}

function roomWalls(room: Room, openings: Opening[], height: number, base: number): THREE.BufferGeometry[] {
  const pts = room.points
  const n = pts.length
  const t = room.wallThickness
  const outer = offsetPolygon(pts, t)
  const sa = signedArea(pts)
  const geos: THREE.BufferGeometry[] = []

  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const L = dist(a, b)
    if (L < 0.5) continue
    const dir = normalize(sub(b, a))
    const out = mul(inwardNormal(a, b, sa), -1)
    const centerLine = add(a, mul(out, t / 2))

    // Openings lying in this wall (including ones attached to an overlapping wall of a neighbor room).
    const cuts = openings
      .filter((o) => Math.abs(o.dir.x * dir.y - o.dir.y * dir.x) < 0.02)
      .filter((o) => Math.abs(dot(sub(o.center, centerLine), out)) < t / 2 + 1)
      .map((o) => {
        const s = dot(sub(o.center, a), dir)
        return { s1: Math.max(0, s - o.width / 2), s2: Math.min(L, s + o.width / 2), bottom: o.bottom, top: o.top }
      })
      .filter((c) => c.s2 - c.s1 > 0.5)
      .sort((p, q) => p.s1 - q.s1)

    const inner = (s: number) => add(a, mul(dir, s))
    const outerAt = (s: number) => (s <= 0 ? outer[i] : s >= L ? outer[(i + 1) % n] : add(inner(s), mul(out, t)))
    const piece = (s1: number, s2: number, z0: number, z1: number) => {
      if (s2 - s1 < 0.5 || z1 - z0 < 0.5) return
      geos.push(prism([inner(s1), inner(s2), outerAt(s2), outerAt(s1)], z0, z1, base))
    }

    let cur = 0
    for (const c of cuts) {
      if (c.s1 > cur) piece(cur, c.s1, 0, height)
      const s1 = Math.max(c.s1, cur)
      piece(s1, c.s2, 0, Math.min(c.bottom, height))
      piece(s1, c.s2, Math.min(c.top, height), height)
      cur = Math.max(cur, c.s2)
    }
    piece(cur, L, 0, height)
  }
  return geos
}

// ---------------------------------------------------------------------------
// Symbols

function chair(mats: Materials, x: number, z: number, rotDeg: number, w = 42, d = 42) {
  const g = new THREE.Group()
  const wood = mats.get(COLORS.wood)
  g.add(box(w, 5, d, 0, 42, 0, mats.get(COLORS.fabric2)))
  for (const [lx, lz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    g.add(box(3, 42, 3, (lx * (w - 6)) / 2, 0, (lz * (d - 6)) / 2, wood))
  }
  g.add(box(w, 45, 4, 0, 47, -d / 2 + 2, wood))
  g.position.set(x, 0, z)
  g.rotation.y = (-rotDeg * Math.PI) / 180
  return g
}

function table(mats: Materials, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const wood = mats.get(COLORS.wood)
  g.add(box(w, 4, d, 0, h - 4, 0, wood))
  for (const [lx, lz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    g.add(box(5, h - 4, 5, lx * (w / 2 - 6), 0, lz * (d / 2 - 6), mats.get(COLORS.woodDark)))
  }
  return g
}

function symbolObject(sym: PlanSymbol, def: SymbolDef | undefined, mats: Materials, hl: boolean, wallT: number, floorH: number) {
  const g = new THREE.Group()
  const w = sym.width
  const d = sym.depth
  const h = sym.height
  const c = (color: string) => mats.get(color, hl)

  switch (sym.type) {
    case 'door':
    case 'door-double': {
      const leaves = sym.type === 'door' ? [[-w / 2, w, 1]] : [[-w / 2, w / 2, 1], [w / 2, w / 2, -1]]
      for (const [hx, leaf, side] of leaves) {
        // Leaf opened 90° into the room, like the 2D swing symbol.
        g.add(box(4, h, leaf, hx + side * 2, 0, wallT / 2 + leaf / 2, c(COLORS.door)))
      }
      break
    }
    case 'door-sliding':
      g.add(box(w * 0.55, h, 3, -w / 2 + (w * 0.55) / 2, 0, -wallT / 4, mats.glass()))
      g.add(box(w * 0.55, h, 3, w / 2 - (w * 0.55) / 2, 0, wallT / 4, mats.glass()))
      break
    case 'window':
    case 'window-wide':
      g.add(box(w, h, 2, 0, 0, 0, mats.glass()))
      g.add(box(w, 4, wallT + 4, 0, -4, 0, c(COLORS.white))) // sill
      if (sym.type === 'window-wide') g.add(box(4, h, 4, 0, 0, 0, c(COLORS.white)))
      break
    case 'opening':
      break
    case 'sofa':
    case 'armchair': {
      const arm = sym.type === 'sofa' ? w * 0.1 : w * 0.18
      g.add(box(w - arm * 2, h * 0.5, d * 0.75, 0, 0, d * 0.125, c(COLORS.fabric)))
      g.add(box(w, h, d * 0.25, 0, 0, -d / 2 + d * 0.125, c(COLORS.fabric)))
      g.add(box(arm, h * 0.7, d, -w / 2 + arm / 2, 0, 0, c(COLORS.fabric)))
      g.add(box(arm, h * 0.7, d, w / 2 - arm / 2, 0, 0, c(COLORS.fabric)))
      break
    }
    case 'coffee-table':
    case 'desk':
      g.add(table(mats, w, d, h))
      if (sym.type === 'desk') g.add(chair(mats, 0, d / 2 + 5, 180))
      break
    case 'dining-table':
      g.add(table(mats, w, d, h))
      g.add(chair(mats, -w / 4, -d / 2 - 10, 0), chair(mats, w / 4, -d / 2 - 10, 0))
      g.add(chair(mats, -w / 4, d / 2 + 10, 180), chair(mats, w / 4, d / 2 + 10, 180))
      break
    case 'round-table':
      g.add(cylinder(w / 2, 4, 0, h - 4, 0, c(COLORS.wood), d / w))
      g.add(cylinder(6, h - 4, 0, 0, 0, c(COLORS.woodDark)))
      g.add(chair(mats, 0, -d / 2 - 8, 0), chair(mats, 0, d / 2 + 8, 180))
      g.add(chair(mats, -w / 2 - 8, 0, -90), chair(mats, w / 2 + 8, 0, 90))
      break
    case 'chair':
      g.add(chair(mats, 0, 0, 0, w, d))
      break
    case 'plant':
      g.add(cylinder(w * 0.28, 35, 0, 0, 0, c(COLORS.pot)))
      {
        const leaves = mesh(new THREE.SphereGeometry(w / 2, 24, 16), c(COLORS.leaf))
        leaves.position.set(0, 35 + w * 0.4, 0)
        leaves.scale.y = Math.max(1, (h - 35) / w)
        g.add(leaves)
      }
      break
    case 'bed-double':
    case 'bed-single': {
      g.add(box(w, h * 0.55, d, 0, 0, 0, c(COLORS.woodDark)))
      g.add(box(w - 4, h * 0.45, d - 4, 0, h * 0.55, 0, c(COLORS.white)))
      g.add(box(w, 3, d * 0.7, 0, h, d * 0.15, c(COLORS.sheet))) // blanket
      g.add(box(w, 100, 6, 0, 0, -d / 2 + 3, c(COLORS.woodDark))) // headboard
      const pillows = sym.type === 'bed-double' ? [-w / 4, w / 4] : [0]
      for (const px of pillows) g.add(box(w / pillows.length - 20, 12, d * 0.14, px, h, -d / 2 + 8 + d * 0.07, c(COLORS.white)))
      break
    }
    case 'bathtub':
      g.add(box(w, h, d, 0, 0, 0, c(COLORS.white)))
      g.add(box(w - 16, 2, d - 16, 0, h - 1, 0, mats.get(COLORS.glass)))
      break
    case 'shower':
      g.add(box(w, 6, d, 0, 0, 0, c(COLORS.white)))
      g.add(box(w, h, 1, 0, 0, d / 2, mats.glass()))
      g.add(box(1, h, d, w / 2, 0, 0, mats.glass()))
      break
    case 'toilet':
      g.add(box(w, 75, d * 0.3, 0, 0, -d / 2 + d * 0.15, c(COLORS.white)))
      g.add(cylinder(w * 0.42, 40, 0, 0, d * 0.12, c(COLORS.white), (d * 0.36) / (w * 0.42)))
      break
    case 'washbasin':
      g.add(box(w, h - 15, d, 0, 0, 0, c(COLORS.woodDark)))
      g.add(box(w, 15, d, 0, h - 15, 0, c(COLORS.white)))
      break
    case 'counter':
    case 'stove':
    case 'kitchen-sink':
      g.add(box(w, h - 4, d - 4, 0, 0, -2, c(COLORS.white)))
      g.add(box(w, 4, d, 0, h - 4, 0, c(sym.type === 'stove' ? COLORS.dark : COLORS.counter)))
      break
    case 'fridge':
      g.add(box(w, h, d, 0, 0, 0, c(COLORS.metal)))
      break
    case 'tv-unit':
      g.add(box(w, h, d, 0, 0, 0, c(COLORS.woodDark)))
      g.add(box(w * 0.7, w * 0.4, 4, 0, h, -d / 2 + 8, c(COLORS.dark)))
      break
    case 'wardrobe':
    case 'bookshelf':
    case 'nightstand':
      g.add(box(w, h, d, 0, 0, 0, c(COLORS.wood)))
      break
    case 'stairs': {
      const steps = Math.max(2, Math.round(d / 28))
      const rise = h / steps
      const run = d / steps
      for (let i = 0; i < steps; i++) {
        g.add(box(w, rise * (i + 1), run, 0, 0, d / 2 - (i + 0.5) * run, c(COLORS.wood)))
      }
      break
    }
    case 'column':
      g.add(box(w, floorH, d, 0, 0, 0, c(COLORS.wall)))
      break
    case 'light':
      g.add(cylinder(w / 2, 3, 0, floorH - 3, 0, mats.emissive(COLORS.light)))
      break
    case 'label':
    case 'outlet':
    case 'switch':
      break
    default:
      if (def) g.add(box(w, h || 50, d, 0, 0, 0, c(COLORS.fabric2)))
  }
  return g
}

// ---------------------------------------------------------------------------

export interface BuildOptions {
  floorId: string
  filter: FloorFilter
  selection: Selection | null
  theme: PlanTheme
  showCeilings: boolean
}

/** Build a three.js group for the visible floors of the project. */
export function buildProjectGroup(project: Project, opts: BuildOptions): THREE.Group {
  const root = new THREE.Group()
  const mats = new Materials()
  const handles: { lights: LightHandle[]; switches: SwitchHandle[] } = { lights: [], switches: [] }
  const walls: THREE.Mesh[] = []
  const currentIdx = Math.max(
    0,
    project.floors.findIndex((f) => f.id === opts.floorId),
  )

  let base = 0
  project.floors.forEach((floor, idx) => {
    const visible =
      opts.filter === 'all' ||
      (opts.filter === 'upToCurrent' && idx <= currentIdx) ||
      (opts.filter === 'current' && idx === currentIdx)
    const floorBase = base
    base += floor.height + SLAB
    if (!visible) return

    const isCurrent = floor.id === opts.floorId
    const sel = isCurrent ? opts.selection : null
    const group = new THREE.Group()
    group.name = floor.name

    // Slab under every room (outer outline) and colored floor surfaces.
    const slabGeos = floor.rooms.filter((r) => r.points.length >= 3).map((r) => prism(roomOuter(r), -SLAB, 0, floorBase))
    if (slabGeos.length) {
      const merged = mergeGeometries(slabGeos)
      slabGeos.forEach((g) => g.dispose())
      if (merged) group.add(mesh(merged, mats.get(COLORS.slab)))
    }
    for (const room of floor.rooms) {
      if (room.points.length < 3) continue
      const shape = new THREE.Shape(room.points.map((p) => new THREE.Vector2(p.x, p.y)))
      const geo = new THREE.ShapeGeometry(shape)
      geo.rotateX(Math.PI / 2)
      geo.translate(0, floorBase + 0.3, 0)
      const hl = sel?.kind === 'room' && sel.id === room.id
      const mat = mats.get(room.color, hl).clone()
      mat.side = THREE.DoubleSide
      group.add(mesh(geo, mat, { floorId: floor.id, kind: 'room', id: room.id }))
    }

    // Walls (merged per room so each room stays pickable).
    const openings = wallOpenings(floor)
    for (const room of floor.rooms) {
      if (room.points.length < 3) continue
      const geos = roomWalls(room, openings, floor.height, floorBase)
      if (!geos.length) continue
      const merged = mergeGeometries(geos)
      geos.forEach((g) => g.dispose())
      const hl = sel?.kind === 'room' && sel.id === room.id
      if (merged) {
        const w = mesh(merged, mats.get(COLORS.wall, hl), { floorId: floor.id, kind: 'room', id: room.id })
        walls.push(w) // the walk-through camera collides with these
        group.add(w)
      }
    }

    // Gypsum ceilings (seen from inside the rooms).
    if (opts.showCeilings) {
      for (const obj of buildCeilings(floor, floorBase)) group.add(obj)
    }

    // Doors, windows, furniture and light fixtures.
    for (const sym of floor.symbols) {
      const def = SYMBOL_MAP.get(sym.type)
      if (def?.fixture) {
        const obj = buildFixture(sym, def.fixture, floor, floorBase, handles)
        if (obj) group.add(obj)
        continue
      }
      if (sym.type === 'gypsum-box' || def?.ceilingStyle) continue
      const pose = symbolPose(sym, floor.rooms)
      const hl = sel?.kind === 'symbol' && sel.id === sym.id
      const obj = symbolObject(sym, def, mats, hl, pose.wallThickness ?? sym.depth, floor.height)
      if (!obj.children.length) continue
      const elevation = def?.wall ? (sym.elevation ?? def.sill ?? 0) : (sym.elevation ?? 0)
      obj.position.set(pose.x, floorBase + elevation, pose.y)
      obj.rotation.y = (-pose.rotation * Math.PI) / 180
      obj.scale.set(sym.flipX ? -1 : 1, 1, sym.flipY ? -1 : 1)
      const pick: PickInfo = { floorId: floor.id, kind: 'symbol', id: sym.id }
      obj.traverse((o) => (o.userData.pick = pick))
      group.add(obj)
    }

    root.add(group)
  })

  root.userData.walls = walls
  root.userData.lightHandles = handles.lights
  root.userData.switchHandles = handles.switches
  root.userData.dispose = () => {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        const m = o.material as THREE.Material | THREE.Material[]
        if (Array.isArray(m)) m.forEach((x) => x.dispose())
        else m.dispose()
      }
    })
  }
  return root
}
