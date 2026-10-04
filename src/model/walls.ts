/** Doors and windows in walls, and the finishes on the walls around them. */
import { add, dist, dot, inwardNormal, mul, normalize, signedArea, sub } from './geometry'
import { wallBands, wallSurfaceAt } from './finishes'
import { isOutdoor, symbolPose } from './project'
import { SYMBOL_MAP } from './symbols'
import type { Floor, Point, Room, WallSurface } from './types'

export interface Opening {
  center: Point
  dir: Point
  width: number
  bottom: number
  top: number
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
    })
  }
  return out
}

export interface Cut {
  s1: number
  s2: number
  bottom: number
  top: number
}

/** Openings lying in the wall along a→b (including ones attached to an overlapping wall of a neighbor room). */
export function cutsFor(openings: Opening[], a: Point, dir: Point, out: Point, t: number, L: number): Cut[] {
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

/** The parts of a stretch of wall (0…L along, z0…z1 up) left around its openings, as [s1, s2, z0, z1]. */
export function aroundCuts(cuts: Cut[], L: number, z0: number, z1: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = []
  const piece = (s1: number, s2: number, a: number, b: number) => {
    if (s2 - s1 >= 0.5 && b - a >= 0.5) out.push([s1, s2, a, b])
  }
  let cur = 0
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
    const pts = room.points
    const sa = signedArea(pts)
    pts.forEach((a, i) => {
      const s = wallSurfaceAt(room, i)
      if (!s) return
      const b = pts[(i + 1) % pts.length]
      const L = dist(a, b)
      if (L < 1) return
      const dir = normalize(sub(b, a))
      const inward = inwardNormal(a, b, sa)
      const cuts = cutsFor(openings, a, dir, mul(inward, -1), room.wallThickness, L)
      for (const band of wallBands(s, top(room))) {
        const parts = aroundCuts(cuts, L, band.z0, band.z1)
        if (parts.length) out.push({ room, edge: i, surface: band.surface, a, dir, inward, parts })
      }
    })
  }
  return out
}
