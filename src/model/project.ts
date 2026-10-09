import polygonClipping from 'polygon-clipping'
import {
  add,
  area,
  dist,
  dot,
  inwardNormal,
  labelPoint,
  mul,
  normalize,
  offsetPolygon,
  perimeter,
  pointInPolygon,
  projectOnSegment,
  signedArea,
  sub,
} from './geometry'
import { SYMBOL_MAP } from './symbols'
import { t } from '@/i18n'
import type { Dimension, Floor, OutdoorKind, PlanSymbol, Point, Pose, Project, Railing, Room, WallAttachment } from './types'

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export const ROOM_COLORS = [
  '#fef3c7',
  '#dbeafe',
  '#dcfce7',
  '#fce7f3',
  '#ede9fe',
  '#ffedd5',
  '#e0f2fe',
  '#f1f5f9',
]

export function newFloor(name: string): Floor {
  return { id: uid(), name, height: 250, rooms: [], symbols: [] }
}

export function newProject(name = 'Untitled plan'): Project {
  const now = Date.now()
  return {
    id: uid(),
    name,
    units: 'metric',
    defaultWallThickness: 10,
    floors: [newFloor(t('Ground floor'))],
    createdAt: now,
    updatedAt: now,
  }
}

export function newRoom(floor: Floor, points: Point[], wallThickness: number): Room {
  const n = floor.rooms.length
  return {
    id: uid(),
    name: t('Room {n}', { n: n + 1 }),
    points,
    wallThickness,
    color: ROOM_COLORS[n % ROOM_COLORS.length],
  }
}

export const DEFAULT_RAILING: Railing = { style: 'glass', height: 105 }
/** How thick a balcony's railing is drawn. */
export const RAILING_THICKNESS = 5

export const OUTDOOR: Record<OutdoorKind, { name: string; color: string; railing: Railing }> = {
  balcony: { name: 'Balcony', color: '#f1f5f9', railing: DEFAULT_RAILING },
  // At ground level: usually open, no railing.
  terrace: { name: 'Terrace', color: '#ffedd5', railing: { style: 'none', height: 105 } },
}

/** Balconies and terraces: outdoor spaces with railings (or nothing) instead of walls. */
export function isOutdoor(room: Room) {
  return room.kind === 'balcony' || room.kind === 'terrace'
}

export function newOutdoor(floor: Floor, points: Point[], kind: OutdoorKind): Room {
  const n = floor.rooms.filter((r) => r.kind === kind).length
  const d = OUTDOOR[kind]
  return {
    id: uid(),
    name: n ? `${t(d.name)} ${n + 1}` : t(d.name),
    points,
    wallThickness: RAILING_THICKNESS,
    color: d.color,
    kind,
    railing: { ...d.railing },
  }
}

/**
 * The parts of a balcony's edges that get a railing: everything except where it runs along a
 * wall of the building (another room that isn't a balcony).
 */
export function railingRuns(room: Room, rooms: Room[]): { a: Point; b: Point; edge: number }[] {
  const out: { a: Point; b: Point; edge: number }[] = []
  const others = rooms.filter((r) => r.id !== room.id && !isOutdoor(r) && r.points.length >= 3)
  const pts = room.points
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const L = dist(a, b)
    if (L < 1) continue
    const dir = normalize(sub(b, a))
    const covered: [number, number][] = []
    for (const o of others) {
      const tol = o.wallThickness + room.wallThickness + 3
      for (let j = 0; j < o.points.length; j++) {
        const c = o.points[j]
        const d = o.points[(j + 1) % o.points.length]
        const od = sub(d, c)
        const ol = Math.hypot(od.x, od.y)
        if (ol < 1 || Math.abs(dir.x * od.y - dir.y * od.x) / ol > 0.02) continue
        if (Math.abs(dir.x * (c.y - a.y) - dir.y * (c.x - a.x)) > tol) continue
        const s1 = dot(sub(c, a), dir)
        const s2 = dot(sub(d, a), dir)
        const lo = Math.max(0, Math.min(s1, s2))
        const hi = Math.min(L, Math.max(s1, s2))
        if (hi - lo > 1) covered.push([lo, hi])
      }
    }
    covered.sort((p, q) => p[0] - q[0])
    const at = (s: number) => add(a, mul(dir, s))
    let cur = 0
    for (const [lo, hi] of covered) {
      if (lo > cur + 1) out.push({ a: at(cur), b: at(lo), edge: i })
      cur = Math.max(cur, hi)
    }
    if (L > cur + 1) out.push({ a: at(cur), b: b, edge: i })
  }
  return out
}

export function rectPoints(x: number, y: number, w: number, h: number): Point[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}

export function newSymbol(type: string, x: number, y: number): PlanSymbol {
  const def = SYMBOL_MAP.get(type)
  const sym: PlanSymbol = {
    id: uid(),
    type,
    x,
    y,
    width: def?.width ?? 60,
    depth: def?.depth ?? 60,
    height: def?.height ?? 80,
    rotation: 0,
    flipX: false,
    flipY: false,
    label: type === 'label' ? 'Label' : undefined,
  }
  if (def?.elevation !== undefined) sym.elevation = def.elevation
  if (def?.fixture === 'switch') sym.controls = []
  else if (def?.fixture) sym.light = { color: 'warm', brightness: 1 }
  if (def?.fixture === 'track') {
    sym.modules = [
      { id: uid(), kind: 'spot', offset: sym.width * 0.2 },
      { id: uid(), kind: 'linear', offset: sym.width * 0.5 },
      { id: uid(), kind: 'spot', offset: sym.width * 0.8 },
    ]
  }
  return sym
}

/** End points of a dimension's measuring line (offset from the measured points). */
export function dimensionPoints(d: Dimension): [Point, Point] {
  const dx = d.b.x - d.a.x
  const dy = d.b.y - d.a.y
  const l = Math.hypot(dx, dy) || 1
  // Left normal in screen coordinates (y down).
  const n = { x: dy / l, y: -dx / l }
  return [add(d.a, mul(n, d.offset)), add(d.b, mul(n, d.offset))]
}

export interface ResolvedPose extends Pose {
  /** Thickness of the wall the symbol sits in, if attached. */
  wallThickness?: number
}

/** World position/rotation of a symbol, following its wall if attached. */
export function symbolPose(sym: PlanSymbol, rooms: Room[]): ResolvedPose {
  // Room-bound items (cove lights) sit at their room's label point.
  if (sym.room) {
    const room = rooms.find((r) => r.id === sym.room)
    if (room) {
      const c = labelPoint(room.points)
      return { x: c.x, y: c.y, rotation: 0 }
    }
  }
  const att = sym.wall
  const room = att && rooms.find((r) => r.id === att.roomId)
  if (!att || !room || att.edge >= room.points.length) {
    return { x: sym.x, y: sym.y, rotation: sym.rotation }
  }
  const pts = room.points
  const a = pts[att.edge]
  const b = pts[(att.edge + 1) % pts.length]
  const L = dist(a, b)
  const offset = L < sym.width ? L / 2 : Math.min(Math.max(att.offset, sym.width / 2), L - sym.width / 2)
  const dir = normalize(sub(b, a))
  const sa = signedArea(pts)
  const inward = inwardNormal(a, b, sa)
  const onEdge = add(a, mul(dir, offset))
  const center = sub(onEdge, mul(inward, room.wallThickness / 2))
  const rotation = (Math.atan2(dir.y, dir.x) * 180) / Math.PI + (sa < 0 ? 180 : 0)
  return { x: center.x, y: center.y, rotation, wallThickness: room.wallThickness }
}

/** Find the nearest wall to point `p` within `maxDist` (measured from the wall's center line). */
export function findWallSnap(p: Point, rooms: Room[], maxDist: number): WallAttachment | null {
  let best: WallAttachment | null = null
  let bestD = maxDist
  for (const room of rooms) {
    const pts = room.points
    const sa = signedArea(pts)
    for (let i = 0; i < pts.length; i++) {
      if (isOpen(room, i)) continue // no wall to go in
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      // Shift the edge to the wall center line.
      const shift = mul(inwardNormal(a, b, sa), -room.wallThickness / 2)
      const pr = projectOnSegment(p, add(a, shift), add(b, shift))
      if (pr.dist < bestD) {
        bestD = pr.dist
        best = { roomId: room.id, edge: i, offset: pr.t * dist(a, b) }
      }
    }
  }
  return best
}

/**
 * A free-standing column built into the nearest wall of its room: against the wall's inside face, as wide as the
 * column is along the wall, and standing out of it as far as it reaches into the room (all of it, if it's clear of
 * the wall). Null when no wall is within `reach` (cm) of it.
 */
export function columnIntoWall(sym: PlanSymbol, rooms: Room[], reach = 150): Pick<PlanSymbol, 'x' | 'y' | 'width' | 'depth' | 'rotation'> | null {
  const c = { x: sym.x, y: sym.y }
  const indoor = rooms.filter((r) => !isOutdoor(r) && r.points.length >= 3)
  const inside = indoor.filter((r) => pointInPolygon(c, r.points))
  const r0 = (sym.rotation * Math.PI) / 180
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => {
    const lx = (sx * sym.width) / 2
    const ly = (sy * sym.depth) / 2
    return { x: c.x + lx * Math.cos(r0) - ly * Math.sin(r0), y: c.y + lx * Math.sin(r0) + ly * Math.cos(r0) }
  })
  // The nearest wall: of the room it stands in, if it's in one.
  let best: { a: Point; dir: Point; inn: Point; flip: boolean } | null = null
  let bestD = reach + Math.max(sym.width, sym.depth) / 2
  for (const room of inside.length ? inside : indoor) {
    const pts = room.points
    const sa = signedArea(pts)
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length]
      if (dist(a, b) < 1 || isOpen(room, i)) return
      const d = projectOnSegment(c, a, b).dist
      if (d < bestD) {
        bestD = d
        best = { a, dir: normalize(sub(b, a)), inn: inwardNormal(a, b, sa), flip: sa < 0 }
      }
    })
  }
  if (!best) return null
  const w = best as { a: Point; dir: Point; inn: Point; flip: boolean }
  const along = corners.map((p) => dot(sub(p, w.a), w.dir))
  const out = corners.map((p) => dot(sub(p, w.a), w.inn))
  const s0 = Math.min(...along)
  const s1 = Math.max(...along)
  const n0 = Math.min(...out)
  const n1 = Math.max(...out)
  const round = (v: number) => Math.round(v * 10) / 10
  // Overlapping the wall: what stands out of it. Clear of it: all of it, moved up against the wall.
  const depth = round(Math.min(100, Math.max(5, n0 < 0 ? n1 : n1 - n0)))
  const width = round(Math.min(200, Math.max(10, s1 - s0)))
  const center = add(add(w.a, mul(w.dir, (s0 + s1) / 2)), mul(w.inn, depth / 2))
  const rotation = (((Math.atan2(w.dir.y, w.dir.x) * 180) / Math.PI + (w.flip ? 180 : 0)) % 360 + 360) % 360
  return { x: round(center.x), y: round(center.y), width, depth, rotation: round(rotation) }
}

/** Pose flat against the inside face of the nearest wall (switches, wall lights). */
export function wallMountPose(p: Point, rooms: Room[], maxDist: number, depth: number): Pose | null {
  let best: Pose | null = null
  let bestD = maxDist
  for (const room of rooms) {
    const pts = room.points
    const sa = signedArea(pts)
    for (let i = 0; i < pts.length; i++) {
      if (isOpen(room, i)) continue
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      const pr = projectOnSegment(p, a, b)
      if (pr.dist >= bestD) continue
      bestD = pr.dist
      const dir = normalize(sub(b, a))
      const c = add(pr.point, mul(inwardNormal(a, b, sa), depth / 2))
      best = { x: c.x, y: c.y, rotation: (Math.atan2(dir.y, dir.x) * 180) / Math.PI + (sa < 0 ? 180 : 0) }
    }
  }
  return best
}

/**
 * After a room's shape changed, re-attach its doors/windows to the closest edge of the new shape,
 * keeping them where they were in the world as closely as possible.
 */
export function reattachSymbols(floor: Floor, oldRoom: Room, newRoom: Room) {
  for (const sym of floor.symbols) {
    if (sym.wall?.roomId !== oldRoom.id) continue
    const pose = symbolPose(sym, [oldRoom])
    const snap = findWallSnap(pose, [newRoom], Infinity)
    if (snap) sym.wall = snap
  }
}

/** Set the length of wall `edge`, pushing the following wall so its direction is kept. */
export function setWallLength(points: Point[], edge: number, newLen: number): Point[] {
  const n = points.length
  const a = points[edge]
  const b = points[(edge + 1) % n]
  const cur = dist(a, b)
  if (cur === 0 || newLen <= 0) return points
  const delta = mul(normalize(sub(b, a)), newLen - cur)
  const out = points.map((p) => ({ ...p }))
  const i1 = (edge + 1) % n
  out[i1] = add(out[i1], delta)
  if (n > 3) {
    const i2 = (edge + 2) % n
    if (i2 !== edge) out[i2] = add(out[i2], delta)
  }
  return out
}

/** Move wall `edge` perpendicular to itself by `amount` (positive = outward). */
export function moveWall(points: Point[], edge: number, amount: number): Point[] {
  const n = points.length
  const a = points[edge]
  const b = points[(edge + 1) % n]
  const nrm = mul(inwardNormal(a, b, signedArea(points)), -amount)
  return points.map((p, i) => (i === edge || i === (edge + 1) % n ? add(p, nrm) : p))
}

/** Whether a room's wall `i` isn't there: the room is open to the next one along it (see Room.openEdges). */
export const isOpen = (room: Room, i: number) => !!room.openEdges?.includes(i)

/**
 * Where each of a room's walls ends on the outside: the outer face's corners at the start and end of edge i. An open
 * edge has no wall (its "outer face" is the edge itself), and a wall meeting one ends square on its line.
 */
export function wallEnds(room: Room): [Point, Point][] {
  const pts = room.points
  const n = pts.length
  const t = room.wallThickness
  if (!room.openEdges?.length) {
    const outer = offsetPolygon(pts, t)
    return pts.map((_, i) => [outer[i], outer[(i + 1) % n]])
  }
  const sa = signedArea(pts)
  const d = pts.map((_, i) => (isOpen(room, i) ? 0 : t))
  const lines = pts.map((a, i) => {
    const out = mul(inwardNormal(a, pts[(i + 1) % n], sa), -1)
    return { p: add(a, mul(out, d[i])), dir: sub(pts[(i + 1) % n], a), out }
  })
  // The corner `c` between edge i and the next one, j, on the outside of edge `own`'s wall.
  const corner = (i: number, j: number, c: Point, own: number): Point => {
    const L1 = lines[i]
    const L2 = lines[j]
    const den = L1.dir.x * L2.dir.y - L1.dir.y * L2.dir.x
    const len = Math.hypot(L1.dir.x, L1.dir.y) * Math.hypot(L2.dir.x, L2.dir.y)
    // In line: the wall ends square.
    if (Math.abs(den) < 1e-6 * len) return add(c, mul(lines[own].out, d[own]))
    if (d[i] === d[j]) return add(c, mul(add(L1.out, L2.out), d[i] / Math.max(1 + dot(L1.out, L2.out), 0.15)))
    const s = ((L2.p.x - L1.p.x) * L2.dir.y - (L2.p.y - L1.p.y) * L2.dir.x) / den
    return add(L1.p, mul(L1.dir, s))
  }
  return pts.map((a, i) => {
    const next = (i + 1) % n
    return [corner((i - 1 + n) % n, i, a, i), corner(i, next, pts[next], i)]
  })
}

/** The outline of a room's walls on the outside (along an open edge: the edge itself). */
export function roomOuter(room: Room) {
  if (!room.openEdges?.length) return offsetPolygon(room.points, room.wallThickness)
  const ends = wallEnds(room)
  const out: Point[] = []
  ends.forEach(([start], i) => {
    const before = ends[(i - 1 + ends.length) % ends.length][1]
    out.push(before)
    if (dist(before, start) > 0.01) out.push(start)
  })
  return out
}

type Ring = [number, number][]

function multiPolygonArea(mp: Ring[][]) {
  let total = 0
  for (const poly of mp) {
    poly.forEach((ring, i) => {
      const a = area(ring.map(([x, y]) => ({ x, y })))
      total += i === 0 ? a : -a
    })
  }
  return total
}

export interface FloorStats {
  rooms: { id: string; name: string; area: number; perimeter: number; kind?: OutdoorKind }[]
  /** Indoor rooms only. */
  interiorArea: number
  /** Balconies and terraces. */
  outdoorArea: number
  levelArea: number
  wallArea: number
  symbolCounts: { type: string; count: number }[]
}

export function floorStats(floor: Floor): FloorStats {
  const rooms = floor.rooms.map((r) => ({
    id: r.id,
    name: r.name,
    area: area(r.points),
    perimeter: perimeter(r.points),
    kind: r.kind,
  }))
  const interiorArea = rooms.reduce((s, r) => s + (r.kind ? 0 : r.area), 0)
  const outdoorArea = rooms.reduce((s, r) => s + (r.kind ? r.area : 0), 0)
  let levelArea = 0
  // The level's footprint is the building: balconies and terraces are outside it.
  const indoor = floor.rooms.filter((r) => !isOutdoor(r))
  if (indoor.length) {
    const polys = indoor
      .filter((r) => r.points.length >= 3)
      .map((r) => [roomOuter(r).map((p) => [p.x, p.y] as [number, number])])
    try {
      const [first, ...rest] = polys
      levelArea = first ? multiPolygonArea(polygonClipping.union(first, ...rest) as Ring[][]) : 0
    } catch {
      levelArea = indoor.reduce((s, r) => s + area(roomOuter(r)), 0)
    }
  }
  const counts = new Map<string, number>()
  for (const s of floor.symbols) counts.set(s.type, (counts.get(s.type) ?? 0) + 1)
  return {
    rooms,
    interiorArea,
    outdoorArea,
    levelArea,
    wallArea: Math.max(0, levelArea - interiorArea),
    symbolCounts: [...counts].map(([type, count]) => ({ type, count })),
  }
}

export function floorBounds(floor: Floor) {
  const pts: Point[] = []
  for (const r of floor.rooms) pts.push(...roomOuter(r))
  for (const d of floor.dimensions ?? []) pts.push(...dimensionPoints(d))
  for (const s of floor.symbols) {
    const p = symbolPose(s, floor.rooms)
    const rad = Math.hypot(s.width, s.depth) / 2
    pts.push({ x: p.x - rad, y: p.y - rad }, { x: p.x + rad, y: p.y + rad })
  }
  return pts
}
