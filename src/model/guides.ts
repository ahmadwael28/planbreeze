/**
 * Distance guides while moving or resizing a symbol: from each side of it to the nearest wall face,
 * or for a door or window, along its wall to either end.
 */
import { dist, inwardNormal, normalize, signedArea, sub } from './geometry'
import { symbolPose } from './project'
import type { PlanSymbol, Point, Room } from './types'

export interface Guide {
  a: Point
  b: Point
  length: number
  /** Draw it shifted this way (into the room, for guides along a wall). */
  shift?: Point
}

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x

/** Distance along a ray to the nearest wall face (room edge), or null if nothing is hit. */
function castToWall(o: Point, d: Point, rooms: Room[], max = 3000): number | null {
  let best = Infinity
  for (const room of rooms) {
    const pts = room.points
    for (let i = 0; i < pts.length; i++) {
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
  const r = (pose.rotation * Math.PI) / 180
  const u = { x: Math.cos(r), y: Math.sin(r) }
  const v = { x: -Math.sin(r), y: Math.cos(r) }
  const sides: [Point, number][] = [
    [u, sym.width / 2],
    [{ x: -u.x, y: -u.y }, sym.width / 2],
    [v, sym.depth / 2],
    [{ x: -v.x, y: -v.y }, sym.depth / 2],
  ]
  for (const [d, ext] of sides) {
    const start = { x: pose.x + d.x * ext, y: pose.y + d.y * ext }
    const t = castToWall(start, d, rooms)
    if (t !== null && t > 1) out.push({ a: start, b: { x: start.x + d.x * t, y: start.y + d.y * t }, length: t })
  }
  return out
}
