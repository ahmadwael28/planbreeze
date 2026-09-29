import { dist, inwardNormal, signedArea } from '@/model/geometry'
import { findWallSnap, newSymbol, ROOM_COLORS, uid } from '@/model/project'
import type { PlanSymbol, Point, Room } from '@/model/types'

export interface ImportRoom {
  name: string
  /** Interior outline in cm. */
  points: Point[]
}

export interface ImportOpening {
  kind: 'door' | 'window' | 'opening'
  /** Segment along the wall, in cm. */
  a: Point
  b: Point
}

export interface ImportResult {
  rooms: ImportRoom[]
  openings: ImportOpening[]
}

interface EdgeRef {
  room: number
  edge: number
  axis: 'x' | 'y'
  pos: number
  lo: number
  hi: number
  /** +1 when the wall's outside faces the positive axis direction. */
  out: 1 | -1
  len: number
}

function axisEdges(rooms: Point[][]): EdgeRef[] {
  const edges: EdgeRef[] = []
  rooms.forEach((pts, r) => {
    const sa = signedArea(pts)
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length]
      const n = inwardNormal(a, b, sa)
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5) {
        edges.push({ room: r, edge: i, axis: 'x', pos: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), out: n.x > 0 ? -1 : 1, len: Math.abs(a.y - b.y) })
      } else if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5) {
        edges.push({ room: r, edge: i, axis: 'y', pos: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), out: n.y > 0 ? -1 : 1, len: Math.abs(a.x - b.x) })
      }
    })
  })
  return edges
}

function applyEdges(rooms: Point[][], edges: EdgeRef[]) {
  for (const e of edges) {
    const pts = rooms[e.room]
    const a = pts[e.edge]
    const b = pts[(e.edge + 1) % pts.length]
    a[e.axis] = e.pos
    b[e.axis] = e.pos
  }
}

/** Remove duplicate and collinear corners. */
function cleanPolygon(pts: Point[]): Point[] {
  let out = pts.filter((p, i) => dist(p, pts[(i + 1) % pts.length]) > 0.5)
  let changed = true
  while (changed && out.length > 3) {
    changed = false
    for (let i = 0; i < out.length; i++) {
      const p = out[(i - 1 + out.length) % out.length]
      const c = out[i]
      const n = out[(i + 1) % out.length]
      const cross = (c.x - p.x) * (n.y - c.y) - (c.y - p.y) * (n.x - c.x)
      if (Math.abs(cross) < 1e-6 * Math.max(1, dist(p, c) * dist(c, n))) {
        out = out.filter((_, j) => j !== i)
        changed = true
        break
      }
    }
  }
  return out
}

/**
 * Make detected rooms fit together: align walls that are nearly in line, and turn the gap
 * between two neighboring rooms into exactly one wall of the given thickness.
 */
export function tidyRooms(input: Point[][], wall: number, alignTol = 12, maxGap = 40): Point[][] {
  const rooms = input.map((pts) => pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })))

  // A. Align edges facing the same way that are almost in line (e.g. the tops of neighboring rooms).
  let edges = axisEdges(rooms)
  for (const axis of ['x', 'y'] as const) {
    for (const out of [1, -1] as const) {
      const group = edges.filter((e) => e.axis === axis && e.out === out).sort((a, b) => a.pos - b.pos)
      let start = 0
      for (let i = 1; i <= group.length; i++) {
        if (i === group.length || group[i].pos - group[start].pos > alignTol) {
          const cluster = group.slice(start, i)
          const w = cluster.reduce((s, e) => s + e.len, 0)
          const mean = cluster.reduce((s, e) => s + e.pos * e.len, 0) / w
          cluster.forEach((e) => (e.pos = Math.round(mean)))
          start = i
        }
      }
    }
  }
  applyEdges(rooms, edges)

  // B. Facing walls of neighboring rooms: center one wall of thickness `wall` between them.
  edges = axisEdges(rooms)
  const targets = new Map<EdgeRef, number[]>()
  for (const a of edges) {
    if (a.out !== 1) continue
    for (const b of edges) {
      if (b.out !== -1 || b.axis !== a.axis || b.room === a.room) continue
      const gap = b.pos - a.pos
      const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo)
      if (gap < -15 || gap > maxGap || overlap < 20) continue
      const mid = (a.pos + b.pos) / 2
      if (!targets.has(a)) targets.set(a, [])
      if (!targets.has(b)) targets.set(b, [])
      targets.get(a)!.push(mid - wall / 2)
      targets.get(b)!.push(mid + wall / 2)
    }
  }
  for (const [e, t] of targets) e.pos = Math.round(t.reduce((s, v) => s + v, 0) / t.length)
  applyEdges(rooms, edges)

  // Same length and order as the input, so callers can keep names aligned.
  return rooms.map(cleanPolygon)
}

const SIZES = { door: [60, 200], window: [40, 400], opening: [50, 400] } as const

/** Turn an import result into rooms and wall-attached doors/windows. */
export function buildFloorContent(result: ImportResult, wall: number): { rooms: Room[]; symbols: PlanSymbol[] } {
  const rooms: Room[] = result.rooms.map((r, i) => ({
    id: uid(),
    name: r.name || `Room ${i + 1}`,
    points: r.points,
    wallThickness: wall,
    color: ROOM_COLORS[i % ROOM_COLORS.length],
  }))
  const symbols: PlanSymbol[] = []
  for (const o of result.openings) {
    const [min, max] = SIZES[o.kind]
    const width = Math.min(max, Math.max(min, Math.round(dist(o.a, o.b))))
    const center = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 }
    const att = findWallSnap(center, rooms, 60)
    if (!att) continue
    const type =
      o.kind === 'door' ? (width > 140 ? 'door-double' : 'door') : o.kind === 'window' ? (width >= 160 ? 'window-wide' : 'window') : 'opening'
    symbols.push({ ...newSymbol(type, center.x, center.y), width, depth: wall, wall: att })
  }
  return { rooms, symbols }
}
