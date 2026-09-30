/**
 * Laying several pieces out in rows: lining them up, spacing them evenly, or spreading them over the room
 * (the usual layout for ceiling lights: equal spacing, with half a space between the end ones and the walls).
 * Works on the pieces' centers; rotations are left as they are. A group moves as one piece.
 */
import { bbox, pointInPolygon } from './geometry'
import { castToWall } from './guides'
import { clipFootprint, copyItems, groupOf } from './items'
import type { Floor, ItemRef, Point, Room } from './types'

/** Something to lay out: a single piece, or a group moving as one. Its center, and what it's made of. */
export interface Unit extends Point {
  id: string
  refs: ItemRef[]
  group: boolean
}

export type Arrangement = 'line' | 'even' | 'fill' | { spacing: number }

export interface Layout {
  /** The way the rows run (unit vector), and across them. */
  dir: Point
  across: Point
  /** The pieces of each row in order along it; rows in order across. */
  rows: Unit[][]
}

/**
 * Pieces closer than this across the rows (from one to the next) count as one row: up to 40 cm off, but less when
 * the pieces are close together (twin spots 40 cm apart are two rows).
 */
function rowTolerance(syms: Unit[]) {
  const nearest = syms.map((a) => Math.min(...syms.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.y - b.y))))
  nearest.sort((a, b) => a - b)
  return Math.min(40, 0.4 * nearest[Math.floor(nearest.length / 2)])
}

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length
const round = (v: number) => Math.round(v * 10) / 10

const free = (floor: Floor, r: ItemRef) => r.kind === 'symbol' && floor.symbols.some((s) => s.id === r.id && !s.wall && !s.room)

/**
 * What in the selection can be laid out: free-standing pieces (not doors and windows, or a room's cove lights),
 * each group as one piece, or, when a single group is selected, the pieces in it.
 */
export function arrangeable(floor: Floor, refs: ItemRef[]): Unit[] {
  const groups = new Set(refs.map((r) => groupOf(floor, r)))
  const oneGroup = groups.size === 1 && !groups.has(undefined)
  const units = new Map<string, ItemRef[]>()
  for (const r of refs) {
    const g = oneGroup ? undefined : groupOf(floor, r)
    if (g) units.set(`group:${g}`, [...(units.get(`group:${g}`) ?? []), r])
    else if (free(floor, r)) units.set(r.id, [r])
  }
  return [...units].flatMap(([id, refs]) => {
    // A group counts if there's a piece of furniture or a light in it.
    if (!refs.some((r) => free(floor, r))) return []
    const b = bbox(clipFootprint(copyItems(floor, refs)))
    return [{ id, x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, refs, group: refs.length > 1 }]
  })
}

function rowsAlong(syms: Unit[], dir: Point, tolerance: number): Unit[][] {
  const across = { x: -dir.y, y: dir.x }
  const rows: Unit[][] = []
  let prev = -Infinity
  for (const s of [...syms].sort((a, b) => dot(a, across) - dot(b, across))) {
    const v = dot(s, across)
    if (!rows.length || v - prev > tolerance) rows.push([])
    rows[rows.length - 1].push(s)
    prev = v
  }
  return rows.map((r) => r.sort((a, b) => dot(a, dir) - dot(b, dir)))
}

/** The direction the pieces are most spread out in. */
function principal(syms: Unit[]): Point {
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
export function layoutOf(syms: Unit[]): Layout {
  const tol = rowTolerance(syms)
  const spread = (d: Point) => {
    const v = syms.map((s) => dot(s, d))
    return Math.max(...v) - Math.min(...v)
  }
  const [best] = [{ x: 1, y: 0 }, { x: 0, y: 1 }]
    .map((dir) => ({ dir, rows: rowsAlong(syms, dir, tol) }))
    .sort((a, b) => a.rows.length - b.rows.length || spread(b.dir) - spread(a.dir))
  let { dir, rows } = best
  if (rows.length > 1 && syms.length > 1) {
    const p = principal(syms)
    const slanted = rowsAlong(syms, p, tol)
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
export function arrange(syms: Unit[], rooms: Room[], how: Arrangement): Map<string, Point> | null {
  if (syms.length < 2) return null
  const { dir, across, rows } = layoutOf(syms)
  const U = (s: Point) => dot(s, dir)
  const V = (s: Point) => dot(s, across)
  const at = (u: number, v: number): Point => ({ x: dir.x * u + across.x * v, y: dir.y * u + across.y * v })
  const all = rows.flat()
  const out = new Map<string, Point>()
  const put = (s: Unit, u: number, v: number) => {
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
export function wouldMove(syms: Unit[], rooms: Room[], how: Arrangement): boolean {
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
