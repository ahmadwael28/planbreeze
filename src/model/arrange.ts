/**
 * Laying several pieces out in rows: lining them up, spacing them evenly, or spreading them over the room
 * (the usual layout for ceiling lights: equal spacing, with half a space between the end ones and the walls).
 * Works on the pieces' centers; rotations are left as they are.
 */
import { pointInPolygon } from './geometry'
import { castToWall } from './guides'
import type { Floor, ItemRef, PlanSymbol, Point, Room } from './types'

export type Arrangement = 'line' | 'even' | 'fill' | { spacing: number }

export interface Layout {
  /** The way the rows run (unit vector), and across them. */
  dir: Point
  across: Point
  /** The pieces of each row in order along it; rows in order across. */
  rows: PlanSymbol[][]
}

/** Pieces closer than this across the rows (from one to the next) count as one row. */
const ROW_TOLERANCE = 40

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length
const round = (v: number) => Math.round(v * 10) / 10

/** The selected pieces that can be laid out: free-standing ones (not doors and windows, or a room's cove lights). */
export function arrangeable(floor: Floor, refs: ItemRef[]): PlanSymbol[] {
  const ids = new Set(refs.filter((r) => r.kind === 'symbol').map((r) => r.id))
  return floor.symbols.filter((s) => ids.has(s.id) && !s.wall && !s.room)
}

function rowsAlong(syms: PlanSymbol[], dir: Point): PlanSymbol[][] {
  const across = { x: -dir.y, y: dir.x }
  const rows: PlanSymbol[][] = []
  let prev = -Infinity
  for (const s of [...syms].sort((a, b) => dot(a, across) - dot(b, across))) {
    const v = dot(s, across)
    if (!rows.length || v - prev > ROW_TOLERANCE) rows.push([])
    rows[rows.length - 1].push(s)
    prev = v
  }
  return rows.map((r) => r.sort((a, b) => dot(a, dir) - dot(b, dir)))
}

/** The direction the pieces are most spread out in. */
function principal(syms: PlanSymbol[]): Point {
  const mx = mean(syms.map((s) => s.x))
  const my = mean(syms.map((s) => s.y))
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const s of syms) {
    sxx += (s.x - mx) ** 2
    syy += (s.y - my) ** 2
    sxy += (s.x - mx) * (s.y - my)
  }
  const a = Math.atan2(2 * sxy, sxx - syy) / 2
  const d = { x: Math.cos(a), y: Math.sin(a) }
  return d.x < -1e-9 || (Math.abs(d.x) <= 1e-9 && d.y < 0) ? { x: -d.x, y: -d.y } : d
}

/**
 * How the pieces sit in rows: along the plan's axes, whichever gives the fewest rows (so a grid runs the long way),
 * or along a slanted line when they're all in one.
 */
export function layoutOf(syms: PlanSymbol[]): Layout {
  const spread = (d: Point) => {
    const v = syms.map((s) => dot(s, d))
    return Math.max(...v) - Math.min(...v)
  }
  const [best] = [{ x: 1, y: 0 }, { x: 0, y: 1 }]
    .map((dir) => ({ dir, rows: rowsAlong(syms, dir) }))
    .sort((a, b) => a.rows.length - b.rows.length || spread(b.dir) - spread(a.dir))
  let { dir, rows } = best
  if (rows.length > 1 && syms.length > 1) {
    const p = principal(syms)
    const slanted = rowsAlong(syms, p)
    if (slanted.length === 1) {
      dir = p
      rows = slanted
    }
  }
  return { dir, across: { x: -dir.y, y: dir.x }, rows }
}

/** Distances from `p` to the walls behind and ahead of it along `d`, or null if it isn't between walls. */
function span(p: Point, d: Point, rooms: Room[]): [number, number] | null {
  const back = castToWall(p, { x: -d.x, y: -d.y }, rooms)
  const ahead = castToWall(p, d, rooms)
  return back === null || ahead === null ? null : [back, ahead]
}

/** New centers for the pieces, or null if it can't be done (spreading over a room needs them inside one). */
export function arrange(syms: PlanSymbol[], rooms: Room[], how: Arrangement): Map<string, Point> | null {
  if (syms.length < 2) return null
  const { dir, across, rows } = layoutOf(syms)
  const U = (s: Point) => dot(s, dir)
  const V = (s: Point) => dot(s, across)
  const at = (u: number, v: number): Point => ({ x: dir.x * u + across.x * v, y: dir.y * u + across.y * v })
  const all = rows.flat()
  const out = new Map<string, Point>()
  const put = (s: PlanSymbol, u: number, v: number) => {
    const p = at(u, v)
    out.set(s.id, { x: round(p.x), y: round(p.y) })
  }

  if (how === 'line') {
    for (const row of rows) {
      const v = mean(row.map(V))
      for (const s of row) put(s, U(s), v)
    }
  } else if (how === 'even') {
    // Between the pieces furthest apart, the same for every row, so a grid's columns line up too.
    const u0 = Math.min(...all.map(U))
    const u1 = Math.max(...all.map(U))
    for (const row of rows) row.forEach((s, i) => put(s, row.length === 1 ? U(s) : u0 + ((u1 - u0) * i) / (row.length - 1), V(s)))
  } else if (how === 'fill') {
    const c = { x: mean(all.map((s) => s.x)), y: mean(all.map((s) => s.y)) }
    if (!rooms.some((r) => pointInPolygon(c, r.points))) return null
    // Rows across the room, then the pieces along each row: equal spaces, half a space at the walls.
    const sv = span(c, across, rooms)
    if (!sv) return null
    const v0 = V(c) - sv[0]
    const width = sv[0] + sv[1]
    for (const [i, row] of rows.entries()) {
      const v = v0 + (width * (i + 0.5)) / rows.length
      const uMid = mean(row.map(U))
      const su = span(at(uMid, v), dir, rooms)
      if (!su) return null
      const u0 = uMid - su[0]
      const length = su[0] + su[1]
      row.forEach((s, j) => put(s, u0 + (length * (j + 0.5)) / row.length, v))
    }
  } else {
    // A set spacing, around the middle of them all.
    const mid = mean(all.map(U))
    for (const row of rows) row.forEach((s, i) => put(s, mid + (i - (row.length - 1) / 2) * how.spacing, V(s)))
  }
  return out
}

/** Whether laying them out this way would move anything. */
export function wouldMove(syms: PlanSymbol[], rooms: Room[], how: Arrangement): boolean {
  const m = arrange(syms, rooms, how)
  return !!m && syms.some((s) => {
    const p = m.get(s.id)
    return !!p && Math.hypot(p.x - s.x, p.y - s.y) > 0.2
  })
}

/** The spacing between neighbours in the rows (center to center): smallest, largest and average; null with no row of two. */
export function spacingOf(layout: Layout): { min: number; max: number; avg: number } | null {
  const gaps = layout.rows.flatMap((row) => row.slice(1).map((s, i) => dot(s, layout.dir) - dot(row[i], layout.dir)))
  return gaps.length ? { min: Math.min(...gaps), max: Math.max(...gaps), avg: mean(gaps) } : null
}
