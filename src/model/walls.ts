/** Doors, windows and niches in walls, and the finishes on the walls around them. */
import polygonClipping from 'polygon-clipping'
import { add, area, bbox, dist, dot, inwardNormal, mul, normalize, pointInPolygon, projectOnSegment, signedArea, sub } from './geometry'
import { wallBands, wallSurfaceAt } from './finishes'
import { isOpen, isOutdoor, roomOuter, symbolPose } from './project'
import { SYMBOL_MAP } from './symbols'
import type { Floor, Point, Room, WallSurface } from './types'

export interface Opening {
  center: Point
  dir: Point
  width: number
  bottom: number
  top: number
  /** A niche: only this deep (cm), from the face of the wall toward `facing` (the room it's in). */
  recess?: number
  facing?: Point
}

/** How deep shower niches are recessed into their wall (cm), less in a thin wall. */
export const NICHE_DEPTH = 9
export const nicheDepth = (wallThickness: number) => Math.max(2, Math.min(NICHE_DEPTH, wallThickness - 3))

/**
 * The wall something stands against (a column in a wall): the room, and the edge nearest its back (the middle of its
 * back side, `depth` behind its center in the plan).
 */
export function wallBehind(pose: { x: number; y: number; rotation: number }, depth: number, rooms: Room[]): { room: Room; edge: number } | null {
  const r = (pose.rotation * Math.PI) / 180
  const back = { x: pose.x + (depth / 2) * Math.sin(r), y: pose.y - (depth / 2) * Math.cos(r) }
  let best: { room: Room; edge: number } | null = null
  let bestD = Math.max(15, depth)
  const inside = rooms.filter((room) => !isOutdoor(room) && pointInPolygon(pose, room.points))
  for (const room of inside.length ? inside : rooms) {
    room.points.forEach((a, i) => {
      if (isOpen(room, i)) return
      const b = room.points[(i + 1) % room.points.length]
      const d = projectOnSegment(back, a, b).dist
      if (d < bestD) {
        bestD = d
        best = { room, edge: i }
      }
    })
  }
  return best
}

/** Every door and window on the floor, as a hole in its wall. */
export function wallOpenings(floor: Floor): Opening[] {
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
      ...(sym.type === 'shower-niche' && {
        recess: nicheDepth(pose.wallThickness ?? sym.depth),
        facing: { x: -Math.sin(r) * (sym.flipY ? -1 : 1), y: Math.cos(r) * (sym.flipY ? -1 : 1) },
      }),
    })
  }
  return out
}

export interface Cut {
  s1: number
  s2: number
  bottom: number
  top: number
  /** A niche this deep: in the wall's inner face (the room's side), or its outer face (the neighbor's). */
  recess?: number
  side?: 'inner' | 'outer'
}

/** Openings lying in the wall along a→b (including ones attached to an overlapping wall of a neighbor room). */
export function cutsFor(openings: Opening[], a: Point, dir: Point, out: Point, t: number, L: number): Cut[] {
  const centerLine = add(a, mul(out, t / 2))
  return openings
    .filter((o) => Math.abs(o.dir.x * dir.y - o.dir.y * dir.x) < 0.02)
    .filter((o) => Math.abs(dot(sub(o.center, centerLine), out)) < t / 2 + 1)
    .map((o) => {
      const s = dot(sub(o.center, a), dir)
      const cut: Cut = { s1: Math.max(0, s - o.width / 2), s2: Math.min(L, s + o.width / 2), bottom: o.bottom, top: o.top }
      if (o.recess) Object.assign(cut, { recess: o.recess, side: dot(o.facing!, out) < 0 ? 'inner' : 'outer' })
      return cut
    })
    .filter((c) => c.s2 - c.s1 > 0.5)
    .sort((p, q) => p.s1 - q.s1)
}

/** The parts of a stretch of wall (`from`…L along, z0…z1 up) left around its openings, as [s1, s2, z0, z1]. */
export function aroundCuts(cuts: Cut[], L: number, z0: number, z1: number, from = 0): [number, number, number, number][] {
  const out: [number, number, number, number][] = []
  const piece = (s1: number, s2: number, a: number, b: number) => {
    if (s2 - s1 >= 0.5 && b - a >= 0.5) out.push([s1, s2, a, b])
  }
  let cur = from
  for (const c of cuts) {
    if (c.s1 > cur) piece(cur, c.s1, z0, z1)
    const s1 = Math.max(c.s1, cur)
    piece(s1, c.s2, z0, Math.min(c.bottom, z1))
    piece(s1, c.s2, Math.max(c.top, z0), z1)
    cur = Math.max(cur, c.s2)
  }
  piece(cur, L, z0, z1)
  return out
}

/**
 * A stretch of wall seen from inside a room: part of the room's own wall, or of another room's wall standing into it
 * (thicker than the gap between the rooms, rooms drawn touching or overlapping, a closet built in the room).
 */
export interface WallFace {
  /** The room's wall it is, or stands in front of or nearest to: whose finish it takes. */
  edge: number
  /** It runs from s1 to s2 (cm) along `dir` from `a`, facing `inward`, into the room. */
  a: Point
  dir: Point
  inward: Point
  s1: number
  s2: number
  /** How thick the wall it's the face of is. */
  t: number
}

/** How far in front of a room's wall another's can stand and still be finished like it, lined up with it (cm). */
const IN_FRONT = 60

/** The faces of the walls around a room, seen from inside it. */
export function roomFaces(room: Room, rooms: Room[]): WallFace[] {
  const pts = room.points
  const sa = signedArea(pts)
  const edges = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length]
    return { a, b, L: dist(a, b), dir: normalize(sub(b, a)), inward: inwardNormal(a, b, sa) }
  })
  // No wall along an open edge: the room runs on into the next one there.
  const own = () =>
    edges.flatMap((e, i): WallFace[] =>
      e.L < 0.5 || isOpen(room, i) ? [] : [{ edge: i, a: e.a, dir: e.dir, inward: e.inward, s1: 0, s2: e.L, t: room.wallThickness }],
    )
  const onOpen = (p: Point, q: Point) =>
    (room.openEdges ?? []).some((i) => {
      const e = edges[i]
      return !!e && projectOnSegment(p, e.a, e.b).dist < 0.5 && projectOnSegment(q, e.a, e.b).dist < 0.5
    })
  // What stands in the room: other rooms' walls, and smaller rooms themselves where they overlap it.
  const box = bbox(pts)
  const others = rooms
    .filter((r) => r !== room && r.points.length >= 3 && !isOutdoor(r))
    .map((r) => ({ r, outer: roomOuter(r) }))
    .filter(({ outer }) => {
      const b = bbox(outer)
      return b.minX < box.maxX && b.maxX > box.minX && b.minY < box.maxY && b.maxY > box.minY
    })
  if (!others.length) return own()
  const ring = (p: Point[]) => p.map((q) => [q.x, q.y] as [number, number])
  const mine = area(pts)
  let free: [number, number][][][]
  try {
    free = polygonClipping.difference(
      [ring(pts)],
      ...others.map(({ r, outer }) => (area(r.points) < mine ? [ring(outer)] : [ring(outer), ring(r.points)])),
    )
  } catch {
    return own()
  }
  const rings = free.flatMap((poly) => poly.map((r, k) => ({ pts: r.slice(0, -1).map(([x, y]) => ({ x, y })), hole: k > 0 })))
  const left = rings.reduce((s, r) => s + (r.hole ? -1 : 1) * area(r.pts), 0)
  if (mine - left < 1) return own()

  // The thickness of the wall right behind a face.
  const behind = (p: Point) => others.find(({ outer }) => pointInPolygon(p, outer))?.r.wallThickness ?? room.wallThickness
  const faces: WallFace[] = []
  for (const r of rings) {
    // The room is inside the outlines left, outside the holes in them.
    const sr = signedArea(r.pts) * (r.hole ? -1 : 1)
    r.pts.forEach((p, j) => {
      const q = r.pts[(j + 1) % r.pts.length]
      if (dist(p, q) < 0.5 || onOpen(p, q)) return
      const dir = normalize(sub(q, p))
      const inward = inwardNormal(p, q, sr)
      const m = mul(add(p, q), 0.5)
      // Along one of the room's walls or in front of it, facing the same way: measured along that wall, so tiles line up.
      let best: { i: number; off: number } | null = null
      edges.forEach((e, i) => {
        if (e.L < 0.5 || dot(inward, e.inward) < 0.999) return
        const off = dot(sub(m, e.a), e.inward)
        const s = dot(sub(m, e.a), e.dir)
        if (off < -0.5 || off > IN_FRONT || s < -0.5 || s > e.L + 0.5) return
        if (!best || off < best.off) best = { i, off }
      })
      const t = behind(sub(m, mul(inward, 0.5)))
      if (best) {
        const { i, off } = best as { i: number; off: number }
        const e = edges[i]
        const a = off < 0.5 ? e.a : add(e.a, mul(e.inward, off))
        const s1 = dot(sub(p, a), e.dir)
        const s2 = dot(sub(q, a), e.dir)
        faces.push({ edge: i, a, dir: e.dir, inward: e.inward, s1: Math.min(s1, s2), s2: Math.max(s1, s2), t: off < 0.5 ? room.wallThickness : t })
        return
      }
      // Any other face: finished like the room's nearest wall.
      const near = edges.reduce((b, e, i) => (projectOnSegment(m, e.a, e.b).dist < projectOnSegment(m, edges[b].a, edges[b].b).dist ? i : b), 0)
      faces.push({ edge: near, a: p, dir, inward, s1: 0, s2: dist(p, q), t })
    })
  }
  return faces
}

/** One finished stretch of a room's wall: the finish, and the parts of it around doors and windows. */
export interface WallPatch {
  room: Room
  edge: number
  surface: WallSurface
  /** Where the wall runs, and the way into the room. */
  a: Point
  dir: Point
  inward: Point
  parts: [number, number, number, number][]
}

/** The finished parts of the walls of the rooms on a floor, up to `top(room)` (the ceiling). */
export function wallPatches(floor: Floor, top: (room: Room) => number, openings = wallOpenings(floor)): WallPatch[] {
  const out: WallPatch[] = []
  for (const room of floor.rooms) {
    if (room.points.length < 3 || isOutdoor(room) || (!room.walls && !room.wallFinishes)) continue
    for (const f of roomFaces(room, floor.rooms)) {
      const s = wallSurfaceAt(room, f.edge)
      if (!s || f.s2 - f.s1 < 1) continue
      // A niche in the neighbor's side of the wall leaves this side whole.
      const cuts = cutsFor(openings, f.a, f.dir, mul(f.inward, -1), f.t, f.s2).filter((c) => c.side !== 'outer')
      for (const band of wallBands(s, top(room))) {
        const parts = aroundCuts(cuts, f.s2, band.z0, band.z1, f.s1)
        if (parts.length) out.push({ room, edge: f.edge, surface: band.surface, a: f.a, dir: f.dir, inward: f.inward, parts })
      }
    }
  }
  return out
}
