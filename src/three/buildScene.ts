import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { add, bbox, dist, dot, inwardNormal, labelPoint, mul, normalize, offsetPolygon, signedArea, sub } from '@/model/geometry'
import { isSelected } from '@/model/items'
import { isOutdoor, railingRuns, roomOuter, symbolPose } from '@/model/project'
import { SYMBOL_MAP } from '@/model/symbols'
import type { PlanTheme } from '@/model/theme'
import type { Floor, Point, Project, Room, Selection } from '@/model/types'
import { COLORS, Materials, railingModel, symbolModel } from './furniture'
import { bakeGlows, buildCeilings, buildFixture } from './lighting3d'
import type { LightHandle, SwitchHandle } from './lighting3d'
import type { PoolRoom } from './lightPool'

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

/** Openings lying in the wall along a→b (including ones attached to an overlapping wall of a neighbor room). */
function cutsFor(openings: Opening[], a: Point, dir: Point, out: Point, t: number, L: number) {
  const centerLine = add(a, mul(out, t / 2))
  return openings
    .filter((o) => Math.abs(o.dir.x * dir.y - o.dir.y * dir.x) < 0.02)
    .filter((o) => Math.abs(dot(sub(o.center, centerLine), out)) < t / 2 + 1)
    .map((o) => {
      const s = dot(sub(o.center, a), dir)
      return { s1: Math.max(0, s - o.width / 2), s2: Math.min(L, s + o.width / 2), bottom: o.bottom, top: o.top }
    })
    .filter((c) => c.s2 - c.s1 > 0.5)
    .sort((p, q) => p.s1 - q.s1)
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
    const cuts = cutsFor(openings, a, dir, out, t, L)

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

/** Skirting boards along the inside of a room's walls, broken at doorways. */
function skirting(room: Room, openings: Opening[], base: number): THREE.BufferGeometry[] {
  const pts = room.points
  const n = pts.length
  const sa = signedArea(pts)
  const H = 8
  const T = 1.2
  const geos: THREE.BufferGeometry[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const L = dist(a, b)
    if (L < 5) continue
    const dir = normalize(sub(b, a))
    const inn = inwardNormal(a, b, sa)
    const piece = (s1: number, s2: number) => {
      if (s2 - s1 < 2) return
      const p1 = add(a, mul(dir, s1))
      const p2 = add(a, mul(dir, s2))
      geos.push(prism([p1, p2, add(p2, mul(inn, T)), add(p1, mul(inn, T))], 0, H, base))
    }
    let cur = 0
    for (const c of cutsFor(openings, a, dir, mul(inn, -1), room.wallThickness, L)) {
      if (c.bottom > 1) continue // windows don't reach the floor
      piece(cur, c.s1)
      cur = Math.max(cur, c.s2)
    }
    piece(cur, L)
  }
  return geos
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
  const poolRooms: PoolRoom[] = []
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
      const hl = isSelected(sel, 'room', room.id)
      const mat = mats.get(room.color, hl).clone()
      mat.side = THREE.DoubleSide
      group.add(mesh(geo, mat, { floorId: floor.id, kind: 'room', id: room.id }))
    }

    // Where each room's fill light goes, if it needs one (see lightPool): its middle, near the ceiling.
    for (const room of floor.rooms) {
      if (room.points.length < 3 || isOutdoor(room)) continue
      const c = labelPoint(room.points)
      const b = bbox(room.points)
      const anchor = new THREE.Object3D()
      anchor.position.set(c.x, floorBase + floor.height * 0.8, c.y)
      group.add(anchor)
      poolRooms.push({ id: room.id, anchor, reach: Math.hypot(b.maxX - b.minX, b.maxY - b.minY) * 0.8 })
    }

    // Walls (merged per room so each room stays pickable), with skirting boards.
    const openings = wallOpenings(floor)
    const skirts = floor.rooms.filter((r) => r.points.length >= 3 && !isOutdoor(r)).flatMap((r) => skirting(r, openings, floorBase))
    if (skirts.length) {
      const merged = mergeGeometries(skirts)
      skirts.forEach((g) => g.dispose())
      if (merged) group.add(mesh(merged, mats.get(COLORS.white, false, 'satin')))
    }
    for (const room of floor.rooms) {
      if (room.points.length < 3) continue
      if (isOutdoor(room)) {
        // A railing instead of walls, left off where the balcony meets the building.
        const hl = isSelected(sel, 'room', room.id)
        const railing = railingModel(room, railingRuns(room, floor.rooms), mats, hl, floorBase)
        const pick: PickInfo = { floorId: floor.id, kind: 'room', id: room.id }
        railing.traverse((o) => {
          o.userData.pick = pick
          if (o instanceof THREE.Mesh) walls.push(o)
        })
        group.add(railing)
        continue
      }
      const geos = roomWalls(room, openings, floor.height, floorBase)
      if (!geos.length) continue
      const merged = mergeGeometries(geos)
      geos.forEach((g) => g.dispose())
      const hl = isSelected(sel, 'room', room.id)
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
      const hl = isSelected(sel, 'symbol', sym.id)
      const obj = symbolModel(sym, mats, hl, pose.wallThickness ?? sym.depth, floor.height, !!def)
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

  bakeGlows(root, handles.lights)
  const details: THREE.Object3D[] = []
  root.traverse((o) => {
    if (o.userData.details) details.push(o)
  })
  root.userData.walls = walls
  /** Fixtures whose small parts only show near the camera (see DETAIL_DISTANCE). */
  root.userData.detailed = details
  root.userData.lightHandles = handles.lights
  root.userData.switchHandles = handles.switches
  root.userData.poolRooms = poolRooms
  root.userData.dispose = () => {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        const m = o.material as THREE.Material | THREE.Material[]
        if (Array.isArray(m)) m.forEach((x) => x.dispose())
        else m.dispose()
      } else if (o instanceof THREE.Points) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    })
  }
  return root
}
