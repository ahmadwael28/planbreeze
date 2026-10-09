/** Structural beams: hung from the ceiling slab, running from wall to wall. */
import { castToWall } from './guides'
import type { Floor, Point, Room } from './types'

const r1 = (v: number) => Math.round(v * 10) / 10

/**
 * A beam through `p` running wall to wall: turned `rotation`, or (if not given) the short way across the room, the
 * way beams usually span. Its middle, turn and length; null if there's no wall to reach that way.
 */
export function beamSpan(p: Point, rooms: Room[], rotation?: number): { x: number; y: number; rotation: number; width: number } | null {
  const along = (rot: number) => {
    const r = (rot * Math.PI) / 180
    const u = { x: Math.cos(r), y: Math.sin(r) }
    const ahead = castToWall(p, u, rooms)
    const behind = castToWall(p, { x: -u.x, y: -u.y }, rooms)
    if (ahead === null || behind === null || ahead + behind < 30) return null
    const shift = (ahead - behind) / 2
    return { x: r1(p.x + u.x * shift), y: r1(p.y + u.y * shift), rotation: rot, width: r1(ahead + behind) }
  }
  if (rotation !== undefined) return along(rotation)
  const ways = [along(0), along(90)].filter((w) => w !== null)
  return ways.sort((a, b) => a.width - b.width)[0] ?? null
}

/** Whether `p` is under a beam, or within `margin` cm of one. */
export function underBeam(floor: Floor, p: Point, margin = 0): boolean {
  return floor.symbols.some((s) => {
    if (s.type !== 'beam') return false
    const r = (-s.rotation * Math.PI) / 180
    const dx = p.x - s.x
    const dy = p.y - s.y
    const lx = dx * Math.cos(r) - dy * Math.sin(r)
    const ly = dx * Math.sin(r) + dy * Math.cos(r)
    return Math.abs(lx) <= s.width / 2 + margin && Math.abs(ly) <= s.depth / 2 + margin
  })
}
