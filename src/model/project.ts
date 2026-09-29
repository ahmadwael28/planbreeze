import polygonClipping from 'polygon-clipping'
import {
  add,
  area,
  dist,
  inwardNormal,
  labelPoint,
  mul,
  normalize,
  offsetPolygon,
  perimeter,
  projectOnSegment,
  signedArea,
  sub,
} from './geometry'
import { SYMBOL_MAP } from './symbols'
import type { Dimension, Floor, PlanSymbol, Point, Pose, Project, Room, WallAttachment } from './types'

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
    floors: [newFloor('Ground floor')],
    createdAt: now,
    updatedAt: now,
  }
}

export function newRoom(floor: Floor, points: Point[], wallThickness: number): Room {
  const n = floor.rooms.length
  return {
    id: uid(),
    name: `Room ${n + 1}`,
    points,
    wallThickness,
    color: ROOM_COLORS[n % ROOM_COLORS.length],
  }
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

/** Pose flat against the inside face of the nearest wall (switches, wall lights). */
export function wallMountPose(p: Point, rooms: Room[], maxDist: number, depth: number): Pose | null {
  let best: Pose | null = null
  let bestD = maxDist
  for (const room of rooms) {
    const pts = room.points
    const sa = signedArea(pts)
    for (let i = 0; i < pts.length; i++) {
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

export function roomOuter(room: Room) {
  return offsetPolygon(room.points, room.wallThickness)
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
  rooms: { id: string; name: string; area: number; perimeter: number }[]
  interiorArea: number
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
  }))
  const interiorArea = rooms.reduce((s, r) => s + r.area, 0)
  let levelArea = 0
  if (floor.rooms.length) {
    const polys = floor.rooms
      .filter((r) => r.points.length >= 3)
      .map((r) => [roomOuter(r).map((p) => [p.x, p.y] as [number, number])])
    try {
      const [first, ...rest] = polys
      levelArea = first ? multiPolygonArea(polygonClipping.union(first, ...rest) as Ring[][]) : 0
    } catch {
      levelArea = floor.rooms.reduce((s, r) => s + area(roomOuter(r)), 0)
    }
  }
  const counts = new Map<string, number>()
  for (const s of floor.symbols) counts.set(s.type, (counts.get(s.type) ?? 0) + 1)
  return {
    rooms,
    interiorArea,
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
