/**
 * A wall laid out flat with the columns that stand on it, its "developed" elevation: along the wall as seen from the
 * room (left to right), then round each column (out along its left side, across its front, back along its right side)
 * and on along the wall. Tiles run on round a column's corners as they're laid, and each of its faces has tiles of
 * its own; the plan, the 3D view and the tile layout editor all measure along a wall this way.
 */
import { add, dist, dot, inwardNormal, mul, normalize, pointInPolygon, projectOnSegment, signedArea, sub } from './geometry'
import { isOpen, isOutdoor, symbolPose } from './project'
import type { Floor, Point, Room } from './types'
import { wallBehind } from './walls'

/** A column standing on a wall: where its front is along the wall (left to right, as seen from the room), how deep. */
export interface WallColumn {
  id: string
  uL: number
  uR: number
  depth: number
}

/**
 * Which way a room's wall runs as seen from the room: 1 if from its start corner to its end (left to right), -1 if
 * the other way. Along the wall (u) is then this times the distance from its start corner.
 */
export function wallSign(room: Room, edge: number): 1 | -1 {
  const a = room.points[edge]
  const b = room.points[(edge + 1) % room.points.length]
  const dir = normalize(sub(b, a))
  const inward = inwardNormal(a, b, signedArea(room.points))
  return dir.x * inward.y - dir.y * inward.x > 0 ? 1 : -1
}

/** The columns ("Column in a wall") standing on a room's wall, left to right. */
export function wallColumns(floor: Floor, room: Room, edge: number): WallColumn[] {
  const a = room.points[edge]
  const b = room.points[(edge + 1) % room.points.length]
  if (!a || !b) return []
  const dir = normalize(sub(b, a))
  const sign = wallSign(room, edge)
  const out: WallColumn[] = []
  for (const sym of floor.symbols) {
    if (sym.type !== 'wall-post') continue
    const pose = symbolPose(sym, floor.rooms)
    const at = wallBehind(pose, sym.depth, floor.rooms)
    if (!at || at.room.id !== room.id || at.edge !== edge) continue
    const u = sign * dot(sub(pose, a), dir)
    out.push({ id: sym.id, uL: u - sym.width / 2, uR: u + sym.width / 2, depth: sym.depth })
  }
  return out.sort((p, q) => p.uL - q.uL)
}

/**
 * The space on a wall beside a column built into it, up to the next column or the wall's end (its corner), round a
 * point near the wall (within a metre and a half): where a piece goes to fill it, its back to the wall and as wide as
 * the space, as deep as the column (the deeper of two). None without a column beside it.
 */
export function alcoveFit(floor: Floor, p: Point): { x: number; y: number; rotation: number; width: number; depth: number } | null {
  const room = floor.rooms.find((r) => !isOutdoor(r) && r.points.length >= 3 && pointInPolygon(p, r.points))
  if (!room) return null
  // The nearest wall of the room it's in.
  let edge = -1
  let near = 150
  room.points.forEach((a, i) => {
    if (isOpen(room, i)) return
    const d = projectOnSegment(p, a, room.points[(i + 1) % room.points.length]).dist
    if (d < near) {
      near = d
      edge = i
    }
  })
  if (edge < 0) return null
  const a = room.points[edge]
  const b = room.points[(edge + 1) % room.points.length]
  const dir = normalize(sub(b, a))
  const len = dist(a, b)
  const sign = wallSign(room, edge)
  const u = sign * dot(sub(p, a), dir)
  const cols = wallColumns(floor, room, edge)
  const left = cols.filter((c) => c.uR <= u + 1).sort((x, y) => y.uR - x.uR)[0]
  const right = cols.filter((c) => c.uL >= u - 1).sort((x, y) => x.uL - y.uL)[0]
  if (!left && !right) return null
  const uL = left ? left.uR : sign > 0 ? 0 : -len
  const uR = right ? right.uL : sign > 0 ? len : 0
  if (uR - uL < 5 || uR - uL > 300) return null
  const depth = Math.max(left?.depth ?? 0, right?.depth ?? 0)
  const n = inwardNormal(a, b, signedArea(room.points))
  const c = add(add(a, mul(dir, ((uL + uR) / 2) * sign)), mul(n, depth / 2))
  const r1 = (v: number) => Math.round(v * 10) / 10
  return { x: r1(c.x), y: r1(c.y), rotation: Math.round((Math.atan2(-n.x, n.y) * 180) / Math.PI), width: r1(uR - uL), depth: r1(depth) }
}

/** A point on the wall (u along it) on the developed wall: on by the sides of the columns to its left. */
export function developed(cols: WallColumn[], u: number): number {
  let shift = 0
  for (const c of cols) {
    if (u >= c.uR - 1e-6) shift += 2 * c.depth
    else if (u > c.uL + 1e-6) return u + shift + c.depth // behind a column (out of sight)
  }
  return u + shift
}

/** A column's faces on the developed wall, from and to: its left side (from the wall out), front, and right side. */
export function columnFaces(cols: WallColumn[], c: WallColumn) {
  const start = developed(cols, c.uL)
  const w = c.uR - c.uL
  return {
    left: [start, start + c.depth] as [number, number],
    front: [start + c.depth, start + c.depth + w] as [number, number],
    right: [start + c.depth + w, start + 2 * c.depth + w] as [number, number],
  }
}

/** The stretches of a wall from u0 to u1 that show, between the columns standing on it (what's behind them doesn't). */
export function aroundColumns(cols: WallColumn[], u0: number, u1: number): [number, number][] {
  const out: [number, number][] = []
  let cur = u0
  for (const c of cols) {
    if (c.uR <= cur || c.uL >= u1) continue
    if (c.uL > cur) out.push([cur, c.uL])
    cur = Math.max(cur, c.uR)
  }
  if (u1 > cur) out.push([cur, u1])
  return out.filter(([a, b]) => b - a > 0.05)
}
