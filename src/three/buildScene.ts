import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { add, bbox, dist, inwardNormal, labelPoint, mul, normalize, offsetPolygon, pointInPolygon, projectOnSegment, signedArea, sub } from '@/model/geometry'
import { isSelected } from '@/model/items'
import { isOutdoor, railingRuns, roomOuter, symbolPose } from '@/model/project'
import { SYMBOL_MAP } from '@/model/symbols'
import type { PlanTheme } from '@/model/theme'
import type { Floor, Point, Project, Room, Selection, Surface } from '@/model/types'
import { FINISHES, startsAtFloor, wallSurfaceAt } from '@/model/finishes'
import { cutsFor, wallOpenings, wallPatches } from '@/model/walls'
import type { Opening } from '@/model/walls'
import { readyImage } from '@/lib/images'
import { cabinetLeds, COLORS, Materials, railingModel, symbolModel } from './furniture'
import type { CurtainWash } from './furniture'
import { ceilingHeightAt, ceilingLight, ceilingRoom, coveRuns, lightHex, pocketWidth } from '@/model/lighting'
import { floorMaterial, wallMaterial } from './finishTextures'
import type { Photo } from './finishTextures'
import { bakeGlows, buildCeilings, buildFixture, cabinetLights } from './lighting3d'
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
    if (L < 5 || startsAtFloor(wallSurfaceAt(room, i))) continue // tiles and slats come down to the floor
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

/** How far inside the walls their finishes sit (cm). */
const FINISH_INSET = 0.3

/**
 * The finishes on the walls (paint, wallpaper, tiles…) just inside them, around their doors and windows: one mesh per
 * room and finish, picked as the room. Texture coordinates run along the wall (left to right, seen from the room) and
 * up it, in cm.
 */
function wallFinishMeshes(floor: Floor, openings: Opening[], base: number, material: (s: Surface) => THREE.Material, pick: (room: Room) => PickInfo) {
  const groups = new Map<string, { room: Room; s: Surface; pos: number[]; uv: number[]; idx: number[] }>()
  for (const p of wallPatches(floor, () => floor.height, openings)) {
    const key = `${p.room.id}|${JSON.stringify(p.surface)}`
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { room: p.room, s: p.surface, pos: [], uv: [], idx: [] }))
    // Seen from the room, does the wall run left to right? If not, flip the quads and their texture.
    const facing = p.dir.x * p.inward.y - p.dir.y * p.inward.x > 0
    const sign = facing ? 1 : -1
    for (const [s1, s2, z0, z1] of p.parts) {
      const at = (d: number) => add(add(p.a, mul(p.dir, d)), mul(p.inward, FINISH_INSET))
      const A = at(s1)
      const B = at(s2)
      const i0 = g.pos.length / 3
      g.pos.push(A.x, base + z0, A.y, B.x, base + z0, B.y, B.x, base + z1, B.y, A.x, base + z1, A.y)
      g.uv.push(sign * s1, z0, sign * s2, z0, sign * s2, z1, sign * s1, z1)
      if (facing) g.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3)
      else g.idx.push(i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2)
    }
  }
  return [...groups.values()].map((g) => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2))
    geo.setIndex(g.idx)
    geo.computeVertexNormals()
    const m = mesh(geo, material(g.s), pick(g.room))
    m.castShadow = false
    return m
  })
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
  const curtainWashes: { floorId: string; lightId: string; m: THREE.MeshStandardMaterial; base: number }[] = []
  // Photos of real tiles and wallpapers (decoded beforehand; see loadImages), and a material per wall finish.
  const images = new Map((project.images ?? []).map((i) => [i.id, i]))
  const photoOf = (s: Surface): Photo => (s.image ? readyImage(images.get(s.image)) : undefined)
  const wallMats = new Map<string, THREE.Material>()
  const wallMat = (s: Surface) => {
    const key = JSON.stringify(s)
    let m = wallMats.get(key)
    if (!m) wallMats.set(key, (m = wallMaterial(s, photoOf(s))))
    return m
  }
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
      // Facing up: the outline mirrored (plan y runs down the screen, three.js z toward the viewer), laid flat. Its
      // texture coordinates are then the plan's x and -y, in cm.
      const shape = new THREE.Shape(room.points.map((p) => new THREE.Vector2(p.x, -p.y)))
      const geo = new THREE.ShapeGeometry(shape)
      geo.rotateX(-Math.PI / 2)
      geo.translate(0, floorBase + 0.3, 0)
      const hl = isSelected(sel, 'room', room.id)
      // Its finish (tiles, planks…), or plain in the room's color.
      const mat = room.floor ? floorMaterial(room, photoOf(room.floor)) : mats.get(room.color, hl, 'satin').clone()
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

    // Paint, wallpaper and tiles on the walls.
    for (const m of wallFinishMeshes(floor, openings, floorBase, wallMat, (room) => ({ floorId: floor.id, kind: 'room', id: room.id }))) group.add(m)

    // Gypsum ceilings (seen from inside the rooms).
    if (opts.showCeilings) {
      for (const obj of buildCeilings(floor, floorBase)) group.add(obj)
    }

    // Curtains hang under lit curtain pockets: where each pocket light runs.
    const pocketRuns = floor.symbols
      .filter((s) => s.type === 'pocket-light' && s.room)
      .flatMap((s) => {
        const plain = floor.rooms.find((r) => r.id === s.room)
        if (!plain) return []
        const room = ceilingRoom(plain, floor)
        return coveRuns(room, ceilingLight(s, room)).runs.map((r) => ({ light: s, room, ...r }))
      })
    const washFor = (at: Point): CurtainWash | undefined => {
      const run = pocketRuns.find((r) => projectOnSegment(at, r.a, r.b).dist < pocketWidth(r.room) + 6 && pointInPolygon(at, r.room.points))
      if (!run) return undefined
      return {
        color: new THREE.Color(lightHex(run.light.light)),
        add: (m) => curtainWashes.push({ floorId: floor.id, lightId: run.light.id, m, base: 0.55 * (run.light.light?.brightness ?? 1) }),
      }
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
      // Curtains and blinds hang from the ceiling above them (up in a curtain pocket if there's one).
      const hangs = sym.type === 'curtain' || sym.type === 'blind'
      const obj = symbolModel(
        sym,
        mats,
        hl,
        pose.wallThickness ?? sym.depth,
        floor.height,
        !!def,
        floor.rooms,
        hangs ? ceilingHeightAt(floor, pose) : floor.height,
        sym.type === 'curtain' ? washFor(pose) : undefined,
      )
      if (!obj.children.length) continue
      // A column in a wall is painted like the walls of its room.
      if (sym.type === 'wall-post') {
        const near = (r: Room) => r.points.some((p, i) => projectOnSegment(pose, p, r.points[(i + 1) % r.points.length]).dist < Math.max(sym.width, sym.depth))
        const room = floor.rooms.find((r) => pointInPolygon(pose, r.points)) ?? floor.rooms.find(near)
        if (room?.walls && FINISHES[room.walls.finish].kind === 'paint') {
          const paint = wallMat({ finish: 'paint', color: room.walls.color ?? FINISHES.paint.colors[0].hex })
          obj.traverse((o) => {
            if (o instanceof THREE.Mesh) o.material = paint
          })
        }
      }
      const elevation = def?.wall ? (sym.elevation ?? def.sill ?? 0) : (sym.elevation ?? 0)
      obj.position.set(pose.x, floorBase + elevation, pose.y)
      obj.rotation.y = (-pose.rotation * Math.PI) / 180
      obj.scale.set(sym.flipX ? -1 : 1, 1, sym.flipY ? -1 : 1)
      const pick: PickInfo = { floorId: floor.id, kind: 'symbol', id: sym.id }
      obj.traverse((o) => (o.userData.pick = pick))
      group.add(obj)
      // Cabinets with LEDs inside: their lights, placed like the cabinet.
      const leds = sym.led ? cabinetLeds(sym) : null
      if (leds) {
        const lit = cabinetLights(sym, leds, floor, floor.rooms.find((r) => pointInPolygon(pose, r.points))?.id, handles)
        lit.position.copy(obj.position)
        lit.rotation.copy(obj.rotation)
        lit.scale.copy(obj.scale)
        lit.traverse((o) => (o.userData.pick = pick))
        group.add(lit)
      }
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
  root.userData.curtainWashes = curtainWashes
  root.userData.dispose = () => {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        const m = o.material as THREE.Material | THREE.Material[]
        if (Array.isArray(m)) m.forEach((x) => x.dispose())
        else {
          // A room's own copy of its floor texture.
          const map = (m as THREE.MeshStandardMaterial).map
          if (map?.userData.roomCopy) map.dispose()
          m.dispose()
        }
      } else if (o instanceof THREE.Points) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    })
  }
  return root
}
