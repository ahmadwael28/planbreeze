/** Geometry for laying out rooms: footprints as turned boxes with a height range, and the tests between them. */
import { pointInPolygon } from '../geometry'
import type { Point } from '../types'

/**
 * An item's footprint: its middle, its size along its own x (width) and y (depth, back to front), turned `rot`
 * degrees, and the heights it takes up (cm above the floor). Things only collide where their heights overlap: a
 * wall cabinet over the counter, a TV over its unit.
 */
export interface Box {
  x: number
  y: number
  w: number
  d: number
  rot: number
  z0: number
  z1: number
}

const RAD = Math.PI / 180

/** The plan direction of a box's local x (along its width) and y (toward its front). */
export function axes(rot: number) {
  const r = rot * RAD
  return { u: { x: Math.cos(r), y: Math.sin(r) }, v: { x: -Math.sin(r), y: Math.cos(r) } }
}

/** A point in a box's own frame (x across, y toward the front) placed in the plan. */
export function local(b: Pick<Box, 'x' | 'y' | 'rot'>, lx: number, ly: number): Point {
  const { u, v } = axes(b.rot)
  return { x: b.x + u.x * lx + v.x * ly, y: b.y + u.y * lx + v.y * ly }
}

/** A plan point in a box's own frame. */
export function toLocal(b: Pick<Box, 'x' | 'y' | 'rot'>, p: Point): Point {
  const { u, v } = axes(b.rot)
  const dx = p.x - b.x
  const dy = p.y - b.y
  return { x: dx * u.x + dy * u.y, y: dx * v.x + dy * v.y }
}

export function corners(b: Box, grow = 0): Point[] {
  const hw = b.w / 2 + grow
  const hd = b.d / 2 + grow
  return [local(b, -hw, -hd), local(b, hw, -hd), local(b, hw, hd), local(b, -hw, hd)]
}

/** The rotation (degrees) that turns an item's front toward `n`: its back is then against a wall facing that way. */
export function facing(n: Point) {
  const deg = Math.round((Math.atan2(-n.x, n.y) / RAD) * 1000) / 1000
  return ((deg % 360) + 360) % 360
}

/** A box, its back at `p` on a wall facing `n` (into the room), `gap` off it. */
export function againstWall(p: Point, n: Point, w: number, d: number, z0: number, z1: number, gap = 0): Box {
  return { x: p.x + n.x * (d / 2 + gap), y: p.y + n.y * (d / 2 + gap), w, d, rot: facing(n), z0, z1 }
}

const project = (pts: Point[], ax: Point) => {
  let lo = Infinity
  let hi = -Infinity
  for (const p of pts) {
    const t = p.x * ax.x + p.y * ax.y
    lo = Math.min(lo, t)
    hi = Math.max(hi, t)
  }
  return [lo, hi]
}

/** Whether two boxes overlap (by more than `tol` cm), in plan and in height. */
export function overlaps(a: Box, b: Box, tol = 0.5): boolean {
  if (Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) <= 0) return false
  const pa = corners(a, -tol)
  const pb = corners(b, -tol)
  for (const ax of [axes(a.rot).u, axes(a.rot).v, axes(b.rot).u, axes(b.rot).v]) {
    const [a0, a1] = project(pa, ax)
    const [b0, b1] = project(pb, ax)
    if (a1 <= b0 || b1 <= a0) return false
  }
  return true
}

function segmentsCross(p1: Point, p2: Point, q1: Point, q2: Point) {
  const d = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const d1 = d(q1, q2, p1)
  const d2 = d(q1, q2, p2)
  const d3 = d(p1, p2, q1)
  const d4 = d(p1, p2, q2)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** Whether a box lies inside an outline (touching its edges is fine). */
export function inside(b: Box, poly: Point[], tol = 1): boolean {
  const c = corners(b, -tol)
  if (!c.every((p) => pointInPolygon(p, poly))) return false
  for (let i = 0; i < 4; i++) {
    const p1 = c[i]
    const p2 = c[(i + 1) % 4]
    for (let j = 0; j < poly.length; j++) {
      if (segmentsCross(p1, p2, poly[j], poly[(j + 1) % poly.length])) return false
    }
  }
  return true
}

/** Distance from a point to a box's outline (0 inside it). */
export function distToBox(p: Point, b: Box): number {
  const l = toLocal(b, p)
  const dx = Math.max(0, Math.abs(l.x) - b.w / 2)
  const dy = Math.max(0, Math.abs(l.y) - b.d / 2)
  return Math.hypot(dx, dy)
}

/** A small seeded random generator, so a design comes out the same each time for the same choices. */
export function seeded(seed: string) {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
