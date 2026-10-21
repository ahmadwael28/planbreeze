import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { add, bbox, dist, dot, inwardNormal, labelPoint, mul, normalize, pointInPolygon, projectOnSegment, signedArea, sub } from '@/model/geometry'
import { isSelected } from '@/model/items'
import { isOpen, isOutdoor, railingRuns, roomOuter, symbolPose, wallEnds } from '@/model/project'
import { floorOrigin } from '@/model/divide'
import { CEILING_AC, LEDGE_HEIGHT, NICHES, partitionTop, styleOf, SYMBOL_MAP, tankBoxDepth } from '@/model/symbols'
import type { PlanTheme } from '@/model/theme'
import type { Floor, PlanSymbol, Point, Project, Room, Selection, Surface } from '@/model/types'
import { startsAtFloor, wallBands, wallSurfaceAt } from '@/model/finishes'
import { cutsFor, nicheDepth, roomFaces, wallBehind, wallOpenings, wallPatches } from '@/model/walls'
import { roomUVs } from './worktops'
import type { Opening } from '@/model/walls'
import { readyImage } from '@/lib/images'
import { BENCH_TOP, cabinetLeds, COLORS, FLOATING_BENCH, Materials, personModel, railingModel, symbolModel } from './furniture'
import { personSupport } from '@/model/people'
import type { CurtainWash } from './furniture'
import { ceilingHeightAt, ceilingLight, ceilingRoom, coveRuns, lightHex, pocketWidth } from '@/model/lighting'
import { floorMaterial, wallMaterial } from './finishTextures'
import type { Photos } from './finishTextures'
import { hasMix, tileGrid } from '@/model/tiles'
import { aroundColumns, columnFaces, developed, wallColumns, wallSign } from '@/model/developed'
import type { WallColumn } from '@/model/developed'
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
  const ends = wallEnds(room)
  const sa = signedArea(pts)
  const geos: THREE.BufferGeometry[] = []

  for (let i = 0; i < n; i++) {
    if (isOpen(room, i)) continue // open to the next room
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const L = dist(a, b)
    if (L < 0.5) continue
    const dir = normalize(sub(b, a))
    const out = mul(inwardNormal(a, b, sa), -1)
    const cuts = cutsFor(openings, a, dir, out, t, L)

    const inner = (s: number) => add(a, mul(dir, s))
    const outerAt = (s: number) => (s <= 0 ? ends[i][0] : s >= L ? ends[i][1] : add(inner(s), mul(out, t)))
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
      // A niche goes only part way in: the rest of the wall stays, behind it (or in front, for the neighbor's wall).
      if (c.recess && c.s2 - s1 >= 0.5 && Math.min(c.top, height) - c.bottom >= 0.5) {
        const r = c.recess
        const quad =
          c.side === 'inner'
            ? [add(inner(s1), mul(out, r)), add(inner(c.s2), mul(out, r)), outerAt(c.s2), outerAt(s1)]
            : [inner(s1), inner(c.s2), sub(outerAt(c.s2), mul(out, r)), sub(outerAt(s1), mul(out, r))]
        geos.push(prism(quad, c.bottom, Math.min(c.top, height), base))
      }
      cur = Math.max(cur, c.s2)
    }
    piece(cur, L, 0, height)
  }
  return geos
}

/**
 * How far an item's back is from the wall behind it (less than 0: into the wall), if there's one within reach; else
 * nothing (0).
 */
function gapToWall(sym: PlanSymbol, pose: { x: number; y: number; rotation: number }, rooms: Room[]) {
  const at = wallBehind(pose, sym.depth, rooms)
  if (!at) return 0
  const pts = at.room.points
  const a = pts[at.edge]
  const b = pts[(at.edge + 1) % pts.length]
  const n = inwardNormal(a, b, signedArea(pts))
  const r = (pose.rotation * Math.PI) / 180
  const f = sym.flipY ? -1 : 1
  const back = { x: pose.x + Math.sin(r) * f * (sym.depth / 2), y: pose.y - Math.cos(r) * f * (sym.depth / 2) }
  const gap = dot(sub(back, a), n)
  return Math.abs(gap) < 30 ? gap : 0
}

/**
 * The box of what's built against a wall and finished like it, in the item's frame: how far out from the wall, from
 * and to what heights, whether it's across a corner (its front the diagonal) and whether its underside shows. A
 * wall-hung toilet's tank box (to its shelf or the ceiling) and a shower bench (to its stone top).
 */
function builtBox(sym: PlanSymbol, ceilingH: number) {
  if (sym.type === 'toilet' && sym.mount === 'wall' && sym.tankBox !== 'none') {
    return { depth: tankBoxDepth(sym), y0: 0, y1: sym.tankBox === 'full' ? ceilingH : Math.min(LEDGE_HEIGHT, ceilingH), corner: false, under: false }
  }
  if (sym.type === 'shower-bench') {
    const style = styleOf(sym)
    if (style === 'fold-down') return null
    const y1 = sym.height - BENCH_TOP
    return { depth: sym.depth, y0: sym.floating ? y1 - FLOATING_BENCH : 0, y1, corner: style === 'corner', under: !!sym.floating }
  }
  return null
}

/**
 * A rectangle from corner o along u (lu long) and up v (lv), unit vectors in cm, facing u × v, with texture
 * coordinates in cm from (u0, v0): for wall finishes on columns and in niches.
 */
function rectGeo(o: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, lu: number, lv: number, u0 = 0, v0 = 0) {
  const p = [o, o.clone().addScaledVector(u, lu), o.clone().addScaledVector(u, lu).addScaledVector(v, lv), o.clone().addScaledVector(v, lv)]
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p.flatMap((q) => [q.x, q.y, q.z]), 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u0 + lu, v0, u0 + lu, v0 + lv, u0, v0 + lv], 2))
  geo.setIndex([0, 1, 2, 0, 2, 3])
  geo.computeVertexNormals()
  return geo
}

/** A triangle facing down (an underside), with texture coordinates in cm across it from (u0, 0). */
function undersideTri(ps: THREE.Vector3[], u0: number) {
  const [a, b, c] = ps
  const up = b.clone().sub(a).cross(c.clone().sub(a)).y > 0
  const pts = up ? [a, c, b] : [a, b, c]
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(pts.flatMap((p) => [u0 + p.x, p.z]), 2))
  geo.computeVertexNormals()
  return geo
}

/** Skirting boards along the inside of a room's walls (and any other's standing into it), broken at doorways. */
function skirting(room: Room, rooms: Room[], openings: Opening[], base: number): THREE.BufferGeometry[] {
  const H = 8
  const T = 1.2
  const geos: THREE.BufferGeometry[] = []
  for (const f of roomFaces(room, rooms)) {
    if (f.s2 - f.s1 < 5 || startsAtFloor(wallSurfaceAt(room, f.edge))) continue // tiles and slats come down to the floor
    const piece = (s1: number, s2: number) => {
      if (s2 - s1 < 2) return
      const p1 = add(f.a, mul(f.dir, s1))
      const p2 = add(f.a, mul(f.dir, s2))
      geos.push(prism([p1, p2, add(p2, mul(f.inward, T)), add(p1, mul(f.inward, T))], 0, H, base))
    }
    let cur = f.s1
    for (const c of cutsFor(openings, f.a, f.dir, mul(f.inward, -1), f.t, f.s2)) {
      if (c.bottom > 1) continue // windows don't reach the floor
      piece(cur, c.s1)
      cur = Math.max(cur, c.s2)
    }
    piece(cur, f.s2)
  }
  return geos
}

/** How far inside the walls their finishes sit (cm). */
const FINISH_INSET = 0.3

type Extent = { u0: number; u1: number; z0: number; z1: number }

/**
 * The finishes on the walls (paint, wallpaper, tiles…) just inside them, around their doors and windows and the
 * columns standing on them: one mesh per room and finish (tiles one per wall), picked as the room. Texture
 * coordinates run along the developed wall (left to right, seen from the room, on round its columns; see
 * model/developed) and up it, in cm. Also how far each tiled wall reaches, for its columns to be laid the same.
 */
function wallFinishMeshes(floor: Floor, openings: Opening[], base: number, material: (s: Surface, extent: Extent) => THREE.Material, pick: (room: Room) => PickInfo) {
  const groups = new Map<string, { room: Room; edge: number | null; s: Surface; pos: number[]; uv: number[]; idx: number[] }>()
  const columns = new Map<string, WallColumn[]>()
  for (const p of wallPatches(floor, () => floor.height, openings)) {
    // One mesh per room and finish; tiles one per wall, as each wall's are laid for its own cut tiles.
    const tiled = !!tileGrid(p.surface, 'wall')
    const key = `${p.room.id}|${tiled ? p.edge : ''}|${JSON.stringify(p.surface)}`
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { room: p.room, edge: tiled ? p.edge : null, s: p.surface, pos: [], uv: [], idx: [] }))
    const ck = `${p.room.id}|${p.edge}`
    let cols = columns.get(ck)
    if (!cols) columns.set(ck, (cols = wallColumns(floor, p.room, p.edge)))
    // Seen from the room, does the wall run left to right? If not, flip the quads and their texture.
    const facing = p.dir.x * p.inward.y - p.dir.y * p.inward.x > 0
    const sign = facing ? 1 : -1
    const at = (d: number) => add(add(p.a, mul(p.dir, d)), mul(p.inward, FINISH_INSET))
    for (const [s1, s2, z0, z1] of p.parts) {
      // The stretches that show between the columns on it, each where it is on the developed wall.
      const [w1, w2] = [sign * s1, sign * s2].sort((x, y) => x - y)
      for (const [ua, ub] of aroundColumns(cols, w1, w2)) {
        const [sa, sb] = [sign * ua, sign * ub].sort((x, y) => x - y)
        const A = at(sa)
        const B = at(sb)
        const da = developed(cols, sign * sa)
        const db = developed(cols, sign * sb)
        const i0 = g.pos.length / 3
        g.pos.push(A.x, base + z0, A.y, B.x, base + z0, B.y, B.x, base + z1, B.y, A.x, base + z1, A.y)
        g.uv.push(da, z0, db, z0, db, z1, da, z1)
        if (facing) g.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3)
        else g.idx.push(i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2)
      }
    }
  }
  const extents = new Map<string, Extent>()
  const meshes = [...groups.values()].map((g) => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2))
    geo.setIndex(g.idx)
    geo.computeVertexNormals()
    // How far its texture coordinates reach (a wall laid with several tiles is drawn over just that).
    const us = g.uv.filter((_, i) => i % 2 === 0)
    const zs = g.uv.filter((_, i) => i % 2 === 1)
    const extent = { u0: Math.min(...us), u1: Math.max(...us), z0: Math.min(...zs), z1: Math.max(...zs) }
    if (g.edge !== null) extents.set(`${g.room.id}|${g.edge}|${JSON.stringify(g.s)}`, extent)
    const m = mesh(geo, material(g.s, extent), pick(g.room))
    m.castShadow = false
    return m
  })
  return { meshes, extents }
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
  const photos: Photos = (id) => (id ? readyImage(images.get(id)) : undefined)
  const wallMats = new Map<string, THREE.Material>()
  /** A wall finish's material; laid with several tiles, its own for the stretch of wall it covers (`extent`). */
  const wallMat = (s: Surface, extent?: { u0: number; u1: number; z0: number; z1: number }) => {
    // Tiles depend on how far the wall reaches (where they're cut, the whole surface when several are laid).
    const sized = !!extent && (hasMix(s) || !!tileGrid(s, 'wall'))
    const key = JSON.stringify(s) + (sized ? JSON.stringify(extent) : '')
    let m = wallMats.get(key)
    if (!m) wallMats.set(key, (m = wallMaterial(s, photoOf(s), sized ? extent : undefined, photos)))
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
      const mat = room.floor ? floorMaterial(room, photoOf(room.floor), floorOrigin(room, floor.rooms), photos) : mats.get(room.color, hl, 'satin').clone()
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
    const skirts = floor.rooms.filter((r) => r.points.length >= 3 && !isOutdoor(r)).flatMap((r) => skirting(r, floor.rooms, openings, floorBase))
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
    const walled = wallFinishMeshes(floor, openings, floorBase, wallMat, (room) => ({ floorId: floor.id, kind: 'room', id: room.id }))
    for (const m of walled.meshes) group.add(m)

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
      if (sym.type === 'gypsum-box' || sym.type === 'beam' || def?.ceilingStyle) continue
      const pose = symbolPose(sym, floor.rooms)
      const hl = isSelected(sel, 'symbol', sym.id)
      // Curtains and blinds hang from the ceiling above them (up in a curtain pocket if there's one), air conditioning
      // is set into it, and a wall-hung toilet's tank box can go up to it.
      const hangs = ['curtain', 'blind', 'range-hood', 'toilet', 'partition'].includes(sym.type) || CEILING_AC.has(sym.type)
      // People sit or lie on whatever they're on, at its height.
      const on = sym.type === 'person' ? personSupport(sym, floor.symbols) : null
      // A vanity's mirror goes on the wall behind it, however far its back is from it.
      const wallGap = sym.type === 'bath-vanity' ? gapToWall(sym, pose, floor.rooms) : 0
      const obj =
        sym.type === 'person'
          ? personModel(sym, mats, hl, on ? { height: on.height, type: on.item.type } : undefined)
          : symbolModel(
              sym,
              mats,
              hl,
              pose.wallThickness ?? sym.depth,
              floor.height,
              !!def,
              floor.rooms,
              hangs ? ceilingHeightAt(floor, pose) : floor.height,
              sym.type === 'curtain' ? washFor(pose) : undefined,
              floor.symbols,
              wallGap,
            )
      if (!obj.children.length) continue
      const up = new THREE.Vector3(0, 1, 0)
      const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
      // A column in a wall is finished like the wall it's on (tiles to their height, paint, wallpaper…): its sides
      // and front, the finish carrying on round it as laid on the developed wall (tiles on round its corners, and its
      // own in a layout of several); no skirting where tiles come down to the floor.
      if (sym.type === 'wall-post') {
        const at = wallBehind(pose, sym.depth, floor.rooms)
        const s = at && wallSurfaceAt(at.room, at.edge)
        if (s && at) {
          const w = sym.width
          const d = sym.depth
          const cols = wallColumns(floor, at.room, at.edge)
          const col = cols.find((c) => c.id === sym.id)
          const dev = col ? columnFaces(cols, col) : { left: [0, d], front: [d, d + w], right: [d + w, 2 * d + w] }
          const faces = [
            { o: v3(-w / 2 - 0.3, 0, -d / 2), n: v3(-1, 0, 0), len: d, u0: dev.left[0] },
            { o: v3(-w / 2, 0, d / 2 + 0.3), n: v3(0, 0, 1), len: w, u0: dev.front[0] },
            { o: v3(w / 2 + 0.3, 0, d / 2), n: v3(1, 0, 0), len: d, u0: dev.right[0] },
          ]
          for (const band of wallBands(s, floor.height)) {
            // The same material as its wall's, so the tiles line up with the wall's.
            const extent = walled.extents.get(`${at.room.id}|${at.edge}|${JSON.stringify(band.surface)}`)
            for (const f of faces) {
              const geo = rectGeo(f.o.clone().setY(band.z0), up.clone().cross(f.n), up, f.len, band.z1 - band.z0, f.u0, band.z0)
              obj.add(mesh(geo, wallMat(band.surface, extent)))
            }
          }
          if (startsAtFloor(s)) obj.children.filter((o) => o.userData.skirt).forEach((o) => obj.remove(o))
        }
      }
      // What's built against a wall (a wall-hung toilet's tank box, a shower bench) is finished like the wall behind
      // it: its front lined up with the wall's tiles, which turn its corners onto its sides.
      const built = builtBox(sym, ceilingHeightAt(floor, pose))
      if (built) {
        const at = wallBehind(pose, sym.depth, floor.rooms)
        const s = at && wallSurfaceAt(at.room, at.edge)
        if (s && at) {
          const w = sym.width
          const d = sym.depth
          const a = at.room.points[at.edge]
          const b = at.room.points[(at.edge + 1) % at.room.points.length]
          const u = wallSign(at.room, at.edge) * dot(sub(pose, a), normalize(sub(b, a)))
          const uL = developed(wallColumns(floor, at.room, at.edge), u - w / 2)
          const zf = -d / 2 + built.depth
          // Its faces as seen (x across, z out from the wall), each from A to B left to right: across a corner, only
          // its front, from the side wall to the back one.
          const flip = sym.flipX ? -1 : 1
          const faces: { A: [number, number]; B: [number, number]; u0: number }[] = built.corner
            ? [{ A: [-w / 2, (flip * d) / 2], B: [w / 2, (-flip * d) / 2], u0: uL }]
            : [
                { A: [-w / 2, -d / 2], B: [-w / 2, zf], u0: uL - built.depth },
                { A: [-w / 2, zf], B: [w / 2, zf], u0: uL },
                { A: [w / 2, zf], B: [w / 2, -d / 2], u0: uL + w },
              ]
          // Laid as seen, even when it's mirrored.
          const clad = new THREE.Group()
          clad.scale.x = flip
          const bands = wallBands(s, floor.height)
          const matAt = (surface: Surface) => wallMat(surface, walled.extents.get(`${at.room.id}|${at.edge}|${JSON.stringify(surface)}`))
          for (const band of bands) {
            const z0 = Math.max(band.z0, built.y0)
            const z1 = Math.min(band.z1, built.y1)
            if (z1 - z0 < 0.5) continue
            for (const f of faces) {
              const A = v3(f.A[0], z0, f.A[1])
              const along = v3(f.B[0], z0, f.B[1]).sub(A)
              const len = along.length()
              along.normalize()
              const out = along.clone().cross(up)
              clad.add(mesh(rectGeo(A.addScaledVector(out, 0.3), along, up, len, z1 - z0, f.u0, z0), matAt(band.surface)))
            }
          }
          // A floating bench's underside, in the finish it has at its bottom (across a corner, a triangle).
          const low = built.under && (bands.find((band) => built.y0 < band.z1) ?? bands[0])
          if (low) {
            const y = built.y0 - 0.3
            const geo = built.corner
              ? undersideTri([v3((-flip * w) / 2, y, -d / 2), v3((flip * w) / 2, y, -d / 2), v3((-flip * w) / 2, y, d / 2)], uL + w / 2)
              : rectGeo(v3(-w / 2, y, -d / 2), v3(1, 0, 0), v3(0, 0, 1), w, built.depth, uL, 0)
            clad.add(mesh(geo, matAt(low.surface)))
          }
          obj.add(clad)
        }
      }
      // A wall standing on its own is finished like its room's walls (tiles to their height, paint above…) on both its
      // faces and its ends, the finish carrying on round it; unless it's painted.
      if (sym.type === 'partition' && !sym.frame) {
        const room = floor.rooms.find((r) => pointInPolygon(pose, r.points))
        const s = room?.walls
        if (s) {
          const w = sym.width
          const d = sym.depth
          const top = partitionTop(sym, floor.height)
          // Each face from A to B left to right as seen (x along it, z across), and where it starts along the finish.
          const faces: { A: [number, number]; B: [number, number]; u0: number }[] = [
            { A: [-w / 2, d / 2], B: [w / 2, d / 2], u0: 0 },
            { A: [w / 2, d / 2], B: [w / 2, -d / 2], u0: w },
            { A: [w / 2, -d / 2], B: [-w / 2, -d / 2], u0: w + d },
            { A: [-w / 2, -d / 2], B: [-w / 2, d / 2], u0: 2 * w + d },
          ]
          const clad = new THREE.Group()
          clad.scale.x = sym.flipX ? -1 : 1
          for (const band of wallBands(s, floor.height)) {
            const z1 = Math.min(band.z1, top)
            if (z1 - band.z0 < 0.5) continue
            for (const fc of faces) {
              const A = v3(fc.A[0], band.z0, fc.A[1])
              const along = v3(fc.B[0], band.z0, fc.B[1]).sub(A)
              const len = along.length()
              along.normalize()
              const out = along.clone().cross(up)
              clad.add(mesh(rectGeo(A.addScaledVector(out, 0.3), along, up, len, z1 - band.z0, fc.u0, band.z0), wallMat(band.surface)))
            }
          }
          obj.add(clad)
        }
      }
      // A shower niche is lined with the wall's finish (where the wall has one): its back, sides, top and sill.
      if (NICHES.has(sym.type) && sym.wall) {
        const room = floor.rooms.find((r) => r.id === sym.wall!.roomId)
        const s = room && wallSurfaceAt(room, sym.wall.edge)
        if (s) {
          const t = pose.wallThickness ?? sym.depth
          const r = nicheDepth(t)
          const w = sym.width
          const h = sym.height
          const sill = sym.elevation ?? def?.sill ?? 0
          const band = wallBands(s, floor.height).find((b) => sill + h / 2 <= b.z1) ?? wallBands(s, floor.height)[0]
          const mat = wallMat(band.surface)
          const zb = t / 2 - r
          const lining = [
            rectGeo(v3(-w / 2, 0, zb + 0.3), v3(1, 0, 0), up, w, h, 0, sill),
            rectGeo(v3(-w / 2, h - 0.3, zb), v3(1, 0, 0), v3(0, 0, 1), w, r),
            rectGeo(v3(-w / 2, 0.3, t / 2), v3(1, 0, 0), v3(0, 0, -1), w, r),
            rectGeo(v3(-w / 2 + 0.3, 0, t / 2), v3(0, 0, -1), up, r, h, 0, sill),
            rectGeo(v3(w / 2 - 0.3, 0, zb), v3(0, 0, 1), up, r, h, 0, sill),
          ]
          for (const geo of lining) obj.add(mesh(geo, mat))
        }
      }
      let elevation = def?.wall ? (sym.elevation ?? def.sill ?? 0) : (sym.elevation ?? 0)
      // A wall split air conditioner stays a hand's width under the ceiling there (a gypsum one may be lower).
      if (sym.type === 'ac-split') elevation = Math.max(0, Math.min(elevation, ceilingHeightAt(floor, pose) - sym.height - 10))
      // A range hood stays under the ceiling.
      if (sym.type === 'range-hood') elevation = Math.max(0, Math.min(elevation, ceilingHeightAt(floor, pose) - sym.height))
      obj.position.set(pose.x, floorBase + elevation, pose.y)
      obj.rotation.y = (-pose.rotation * Math.PI) / 180
      obj.scale.set(sym.flipX ? -1 : 1, 1, sym.flipY ? -1 : 1)
      // Worktops laid by where they are, so units side by side share one slab's veins.
      roomUVs(obj)
      const pick: PickInfo = { floorId: floor.id, kind: 'symbol', id: sym.id }
      obj.traverse((o) => (o.userData.pick = pick))
      group.add(obj)
      // Cabinets with LEDs inside: their lights, placed like the cabinet.
      const leds = sym.led ? cabinetLeds(sym, wallGap) : null
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
