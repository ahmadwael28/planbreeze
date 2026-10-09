/**
 * Distance guides while moving or resizing a symbol: from each side of it to the nearest wall face,
 * or for a door or window, along its wall to either end.
 */
import { dist, inwardNormal, normalize, signedArea, sub } from './geometry'
import type { BBox } from './geometry'
import { isOpen, symbolPose } from './project'
import type { PlanSymbol, Point, Room } from './types'

export interface Guide {
  a: Point
  b: Point
  length: number
  /** Draw it shifted this way (into the room, for guides along a wall). */
  shift?: Point
  /** For furniture: which side of it the guide leaves from (right/left across its width, front/back). */
  side?: Side
}

export type Side = 'right' | 'left' | 'front' | 'back'

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x

/** Distance along a ray to the nearest wall face (room edge), or null if nothing is hit. */
export function castToWall(o: Point, d: Point, rooms: Room[], max = 3000): number | null {
  let best = Infinity
  for (const room of rooms) {
    const pts = room.points
    for (let i = 0; i < pts.length; i++) {
      if (isOpen(room, i)) continue // on into the room next door
      const a = pts[i]
      const e = sub(pts[(i + 1) % pts.length], a)
      const den = cross(d, e)
      if (Math.abs(den) < 1e-9) continue
      const ao = sub(a, o)
      const t = cross(ao, e) / den
      const s = cross(ao, d) / den
      if (t > 0.5 && s >= 0 && s <= 1 && t < best) best = t
    }
  }
  return best <= max ? best : null
}

export function clearanceGuides(sym: PlanSymbol, rooms: Room[]): Guide[] {
  const pose = symbolPose(sym, rooms)
  const out: Guide[] = []
  if (sym.wall) {
    const room = rooms.find((r) => r.id === sym.wall!.roomId)
    if (!room) return out
    const pts = room.points
    const a = pts[sym.wall.edge]
    const b = pts[(sym.wall.edge + 1) % pts.length]
    if (!a || !b) return out
    const L = dist(a, b)
    const dir = normalize(sub(b, a))
    const off = L < sym.width ? L / 2 : Math.min(Math.max(sym.wall.offset, sym.width / 2), L - sym.width / 2)
    const at = (s: number) => ({ x: a.x + dir.x * s, y: a.y + dir.y * s })
    const shift = inwardNormal(a, b, signedArea(pts))
    if (off - sym.width / 2 > 1) out.push({ a, b: at(off - sym.width / 2), length: off - sym.width / 2, shift })
    if (L - off - sym.width / 2 > 1) out.push({ a: at(off + sym.width / 2), b, length: L - off - sym.width / 2, shift })
    return out
  }
  for (const { side, dir, ext } of sidesOf(sym, pose.rotation)) {
    const hit = castToWall(pose, dir, rooms)
    if (hit === null || hit - ext <= 1) continue
    const start = { x: pose.x + dir.x * ext, y: pose.y + dir.y * ext }
    out.push({ a: start, b: { x: pose.x + dir.x * hit, y: pose.y + dir.y * hit }, length: hit - ext, side })
  }
  return out
}

/** The four sides of a piece of furniture: outward direction and distance from its center. */
function sidesOf(sym: PlanSymbol, rotation: number): { side: Side; dir: Point; ext: number }[] {
  const r = (rotation * Math.PI) / 180
  const u = { x: Math.cos(r), y: Math.sin(r) }
  const v = { x: -Math.sin(r), y: Math.cos(r) }
  return [
    { side: 'right', dir: u, ext: sym.width / 2 },
    { side: 'left', dir: { x: -u.x, y: -u.y }, ext: sym.width / 2 },
    { side: 'front', dir: v, ext: sym.depth / 2 },
    { side: 'back', dir: { x: -v.x, y: -v.y }, ext: sym.depth / 2 },
  ]
}

/**
 * How far each side of a free-standing piece is from the nearest wall (sides with no wall ahead are left out).
 * Measured from its middle, so these are the walls of the room it's in; negative where it pokes through one.
 */
export function wallGaps(sym: PlanSymbol, rooms: Room[]): Partial<Record<Side, number>> {
  const out: Partial<Record<Side, number>> = {}
  for (const { side, dir, ext } of sidesOf(sym, sym.rotation)) {
    const t = castToWall(sym, dir, rooms)
    if (t !== null) out[side] = t - ext
  }
  return out
}

/** The sides of a piece that aren't against a wall (within `near` cm of one), e.g. where a shower needs glass. */
export function openSides(sym: PlanSymbol, rooms: Room[], near = 8): Side[] {
  const gaps = wallGaps(sym, rooms)
  return (['front', 'back', 'left', 'right'] as const).filter((s) => gaps[s] === undefined || gaps[s]! > near)
}

/**
 * Where a free-standing piece's center goes to sit midway between the walls on either side:
 * side to side (across its width), front to back, or both.
 */
export function centeredPosition(sym: PlanSymbol, rooms: Room[], axis: 'across' | 'depth' | 'both'): Point {
  const r = (sym.rotation * Math.PI) / 180
  const u = { x: Math.cos(r), y: Math.sin(r) }
  const v = { x: -Math.sin(r), y: Math.cos(r) }
  let { x, y } = sym
  // Measure again after each step, in case the move brings other walls into play.
  for (let i = 0; i < 4; i++) {
    const g = wallGaps({ ...sym, x, y }, rooms)
    const su = axis !== 'depth' && g.left !== undefined && g.right !== undefined ? (g.right - g.left) / 2 : 0
    const sv = axis !== 'across' && g.front !== undefined && g.back !== undefined ? (g.front - g.back) / 2 : 0
    if (Math.abs(su) < 0.05 && Math.abs(sv) < 0.05) break
    x += u.x * su + v.x * sv
    y += u.y * su + v.y * sv
  }
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
}

/** Gaps from the sides of a box (a group's extent) to the nearest walls: left/right along x, back (up)/front (down) along y. */
export function boxGaps(box: BBox, rooms: Room[]): Partial<Record<Side, number>> {
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2
  const out: Partial<Record<Side, number>> = {}
  const hw = (box.maxX - box.minX) / 2
  const hh = (box.maxY - box.minY) / 2
  const probes: [Side, Point, number][] = [
    ['right', { x: 1, y: 0 }, hw],
    ['left', { x: -1, y: 0 }, hw],
    ['front', { x: 0, y: 1 }, hh],
    ['back', { x: 0, y: -1 }, hh],
  ]
  // From the middle, like a single piece: negative where the box pokes through a wall.
  for (const [side, d, ext] of probes) {
    const t = castToWall({ x: cx, y: cy }, d, rooms)
    if (t !== null) out[side] = t - ext
  }
  return out
}

/** Distance guides from the sides of a box to the walls. */
export function boxGuides(box: BBox, rooms: Room[]): Guide[] {
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2
  const g = boxGaps(box, rooms)
  const out: Guide[] = []
  const add = (side: Side, a: Point, b: Point) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    // Only in front of the box: none where it pokes through a wall.
    if (len > 1 && (b.x - a.x) * (a.x - cx) + (b.y - a.y) * (a.y - cy) >= 0) out.push({ a, b, length: len, side })
  }
  if (g.right !== undefined) add('right', { x: box.maxX, y: cy }, { x: box.maxX + g.right, y: cy })
  if (g.left !== undefined) add('left', { x: box.minX, y: cy }, { x: box.minX - g.left, y: cy })
  if (g.front !== undefined) add('front', { x: cx, y: box.maxY }, { x: cx, y: box.maxY + g.front })
  if (g.back !== undefined) add('back', { x: cx, y: box.minY }, { x: cx, y: box.minY - g.back })
  return out
}

/** How far to move a box so it sits midway between the walls: side to side, top to bottom, or both. */
export function boxCenterShift(box: BBox, rooms: Room[], axis: 'across' | 'depth' | 'both'): Point {
  let dx = 0
  let dy = 0
  // Measure again after each step, as for a single piece.
  for (let i = 0; i < 4; i++) {
    const g = boxGaps({ minX: box.minX + dx, maxX: box.maxX + dx, minY: box.minY + dy, maxY: box.maxY + dy }, rooms)
    const sx = axis !== 'depth' && g.left !== undefined && g.right !== undefined ? (g.right - g.left) / 2 : 0
    const sy = axis !== 'across' && g.front !== undefined && g.back !== undefined ? (g.front - g.back) / 2 : 0
    if (Math.abs(sx) < 0.05 && Math.abs(sy) < 0.05) break
    dx += sx
    dy += sy
  }
  return { x: Math.round(dx * 10) / 10, y: Math.round(dy * 10) / 10 }
}
