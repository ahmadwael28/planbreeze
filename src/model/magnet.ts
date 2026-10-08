/**
 * Lining things up against the walls: a piece dragged close to a wall is pulled flush against it (beds, sofas,
 * cabinets and the like turn to stand with their back to it), sticks midway between two walls near the middle,
 * and lines up with the pieces around it, side by side or with their edges or middles in line.
 */
import { dot, inwardNormal, normalize, pointInPolygon, signedArea, snapTo, sub } from './geometry'
import type { BBox } from './geometry'
import { boxGaps } from './guides'
import type { Side } from './guides'
import type { Floor, PlanSymbol, Point, Room } from './types'

/** Something lined up, shown while dragging: a side against a wall, or edges in line with another piece. */
export interface SnapMark {
  a: Point
  b: Point
  kind: 'wall' | 'align'
}

export interface Magnetized {
  x: number
  y: number
  rotation: number
  marks: SnapMark[]
}

/** Pieces that stand with their back to a wall: brought up to one, they turn to face the room. */
export const BACK_TO_WALL = new Set([
  'sofa',
  'tv-unit',
  'tv-stand',
  'display-cabinet',
  'sideboard',
  'coffee-corner',
  'bookshelf',
  'bed-double',
  'bed-single',
  'wardrobe',
  'dressing-table',
  'nightstand',
  'desk',
  'counter',
  'kitchen-sink',
  'stove',
  'dishwasher',
  'oven-tower',
  'washing-machine',
  'fridge',
  'toilet',
  'washbasin',
  'bathtub',
  'ac-floor',
])

/** Left where they're put: they settle onto seats, or are only notes. */
const LOOSE = new Set(['person', 'label'])

export interface MagnetOptions {
  /** How close (cm) a side has to come to a wall to be pulled against it. */
  reach: number
  /** How close to the middle between two walls it sticks there. */
  middle: number
  /** How close edges have to come to line up with another piece's. */
  align: number
  /** Turn pieces that go against a wall to stand with their back to it. */
  turn?: boolean
  /** The way it faced when the drag started, which it goes back to away from the walls. */
  rotation0?: number
  /** Rounded to this grid first (0: not). */
  grid?: number
  /** Hung on a wall already: it only slides along it. */
  mounted?: boolean
  /** Pulled against the walls (not ceiling lights: they only line up). */
  walls?: boolean
}

interface Wall {
  a: Point
  /** Along the wall, and into the room. */
  t: Point
  n: Point
  len: number
}

interface Hit {
  gap: number
  wall: Wall
}

function wallsOf(room: Room): Wall[] {
  const pts = room.points
  const sa = signedArea(pts)
  const out: Wall[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len > 1) out.push({ a, t: normalize(sub(b, a)), n: inwardNormal(a, b, sa), len })
  }
  return out
}

const axes = (rotation: number) => {
  const r = (rotation * Math.PI) / 180
  return { u: { x: Math.cos(r), y: Math.sin(r) }, v: { x: -Math.sin(r), y: Math.cos(r) } }
}

/** Which way a piece faces (degrees) to look along `n`. */
const facing = (n: Point) => {
  const deg = (Math.atan2(-n.x, n.y) * 180) / Math.PI
  return Math.round((((deg % 360) + 360) % 360) * 100) / 100
}

/**
 * The nearest wall straight out from each side of a box (centered at `c`, turned `rotation`, half sizes hw × hd)
 * that's parallel to that side and runs alongside it, and how far the side is from it (negative: into it).
 */
function sideHits(c: Point, rotation: number, hw: number, hd: number, walls: Wall[]): Partial<Record<Side, Hit>> {
  const { u, v } = axes(rotation)
  const sides: [Side, Point, number, number][] = [
    ['right', u, hw, hd],
    ['left', { x: -u.x, y: -u.y }, hw, hd],
    ['front', v, hd, hw],
    ['back', { x: -v.x, y: -v.y }, hd, hw],
  ]
  const out: Partial<Record<Side, Hit>> = {}
  for (const [side, dir, ext, along] of sides) {
    let best: Wall | null = null
    let bestH = Infinity
    for (const w of walls) {
      // Facing it squarely (within a few degrees)…
      if (dot(dir, w.n) > -0.998) continue
      const h = dot(sub(c, w.a), w.n)
      const s = dot(sub(c, w.a), w.t)
      // …in front of it, and alongside it.
      if (h <= 0 || s + along <= 0.5 || s - along >= w.len - 0.5) continue
      if (h < bestH) {
        bestH = h
        best = w
      }
    }
    if (best) out[side] = { gap: bestH - ext, wall: best }
  }
  return out
}

const roomOf = (floor: Floor, p: Point) => floor.rooms.find((r) => r.points.length >= 3 && pointInPolygon(p, r.points))

/**
 * Where a piece being dragged to `at` settles: against a wall it's close to (turned to it, if it stands that way),
 * midway between two walls, or in line with the pieces around it. With `mounted`, it's on a wall already and only
 * lines up along it.
 */
export function magnetize(sym: PlanSymbol, at: Point & { rotation: number }, floor: Floor, o: MagnetOptions): Magnetized {
  let c: Point = o.grid && !o.mounted ? { x: snapTo(at.x, o.grid), y: snapTo(at.y, o.grid) } : { x: at.x, y: at.y }
  let rot = at.rotation
  const room = LOOSE.has(sym.type) ? undefined : roomOf(floor, at)
  if (!room) return { ...c, rotation: o.mounted ? rot : (o.rotation0 ?? rot), marks: [] }
  const walls = wallsOf(room)
  const hw = sym.width / 2
  const hd = sym.depth / 2

  // Brought up to a wall, it turns to stand with its back to it; it keeps the way it's turned while it's there.
  let backed = false
  const walled = o.walls !== false
  if (walled && o.turn && !o.mounted && BACK_TO_WALL.has(sym.type)) {
    const behind = (r: number) => {
      const g = sideHits(c, r, hw, hd, walls).back?.gap
      return g !== undefined && g <= o.reach
    }
    if (behind(rot)) backed = true
    else if (o.rotation0 !== undefined && behind(o.rotation0)) {
      rot = o.rotation0
      backed = true
    } else {
      let bestH = Infinity
      let face: number | null = null
      for (const w of walls) {
        const h = dot(sub(c, w.a), w.n)
        const s = dot(sub(c, w.a), w.t)
        if (h <= 0 || h - hd > o.reach || s < 0 || s > w.len) continue
        if (h < bestH) {
          bestH = h
          face = facing(w.n)
        }
      }
      if (face !== null) {
        rot = face
        backed = true
      } else rot = o.rotation0 ?? rot
    }
  }

  const { u, v } = axes(rot)
  const move = (d: Point, s: number) => {
    c = { x: c.x + d.x * s, y: c.y + d.y * s }
  }
  const flush: Side[] = []
  const lined: { axis: 'u' | 'v'; at: number; other: PlanSymbol }[] = []

  // Each way in turn (front to back first, where it was turned to a wall): against the nearer wall within reach,
  // else midway between them when it's close to the middle.
  for (const axis of o.mounted ? (['u'] as const) : (['v', 'u'] as const)) {
    const hits = sideHits(c, rot, hw, hd, walls)
    const [plus, minus] = axis === 'u' ? [hits.right, hits.left] : [hits.front, hits.back]
    const d = axis === 'u' ? u : v
    const near = (h?: Hit) => !!h && h.gap <= o.reach && h.gap >= -2 * o.reach
    // Turned to the wall behind it: right up against it, however far it went in.
    const toBack = axis === 'v' && backed && minus && minus.gap <= o.reach
    if (walled && (toBack || near(minus) || near(plus))) {
      const useMinus = toBack || !near(plus) || (near(minus) && Math.abs(minus!.gap) <= Math.abs(plus!.gap))
      if (useMinus) move(d, -minus!.gap)
      else move(d, plus!.gap)
      flush.push(axis === 'u' ? (useMinus ? 'left' : 'right') : useMinus ? 'back' : 'front')
      continue
    }
    if (plus && minus && Math.abs(plus.gap - minus.gap) / 2 < o.middle) {
      move(d, (plus.gap - minus.gap) / 2)
      continue
    }
    // In line with another piece in the room: side by side, or edges or middles in line.
    let best: { shift: number; at: number; other: PlanSymbol } | null = null
    for (const s of floor.symbols) {
      if (s.id === sym.id || s.wall || s.room || LOOSE.has(s.type)) continue
      const dr = (((s.rotation - rot) % 90) + 90) % 90
      if (dr > 0.5 && dr < 89.5) continue
      if (!pointInPolygon(s, room.points)) continue
      const quarter = Math.abs(Math.round((s.rotation - rot) / 90)) % 2 === 1
      const [ow, od] = quarter ? [s.depth / 2, s.width / 2] : [s.width / 2, s.depth / 2]
      const rel = sub(s, c)
      const [along, across, oa, ob, mine, cross] =
        axis === 'u' ? [dot(rel, u), dot(rel, v), ow, od, hw, hd] : [dot(rel, v), dot(rel, u), od, ow, hd, hw]
      const beside = Math.abs(across) < ob + cross - 0.5
      // How far to move, and where (from the middle, after moving) the line it makes is.
      const options: [number, number][] = [
        [along - oa + mine, -mine],
        [along + oa - mine, mine],
        [along, 0],
      ]
      if (beside) options.push([along - oa - mine, mine], [along + oa + mine, -mine])
      for (const [shift, line] of options) {
        if (Math.abs(shift) < o.align && (!best || Math.abs(shift) < Math.abs(best.shift) - 0.01)) best = { shift, at: line, other: s }
      }
    }
    if (best) {
      move(d, best.shift)
      lined.push({ axis, at: best.at, other: best.other })
    }
  }

  // What lines up, where it ended up.
  const marks: SnapMark[] = []
  const pt = (a: number, b: number) => ({ x: c.x + u.x * a + v.x * b, y: c.y + u.y * a + v.y * b })
  for (const side of flush) {
    if (side === 'back' || side === 'front') {
      const b = side === 'back' ? -hd : hd
      marks.push({ a: pt(-hw, b), b: pt(hw, b), kind: 'wall' })
    } else {
      const a = side === 'left' ? -hw : hw
      marks.push({ a: pt(a, -hd), b: pt(a, hd), kind: 'wall' })
    }
  }
  for (const l of lined) {
    const quarter = Math.abs(Math.round((l.other.rotation - rot) / 90)) % 2 === 1
    const [ow, od] = quarter ? [l.other.depth / 2, l.other.width / 2] : [l.other.width / 2, l.other.depth / 2]
    const rel = sub(l.other, c)
    if (l.axis === 'u') {
      const ov = dot(rel, v)
      marks.push({ a: pt(l.at, Math.min(-hd, ov - od)), b: pt(l.at, Math.max(hd, ov + od)), kind: 'align' })
    } else {
      const ou = dot(rel, u)
      marks.push({ a: pt(Math.min(-hw, ou - ow), l.at), b: pt(Math.max(hw, ou + ow), l.at), kind: 'align' })
    }
  }
  const r1 = (n: number) => Math.round(n * 100) / 100
  return { x: r1(c.x), y: r1(c.y), rotation: rot, marks }
}

/** Where a free-standing piece goes to be right up against the wall on one side (null: there's none that way). */
export function pushedTo(sym: PlanSymbol, floor: Floor, side: Side): Point | null {
  const room = roomOf(floor, sym)
  if (!room) return null
  const hit = sideHits(sym, sym.rotation, sym.width / 2, sym.depth / 2, wallsOf(room))[side]
  if (!hit) return null
  const { u, v } = axes(sym.rotation)
  const d = side === 'right' ? u : side === 'left' ? { x: -u.x, y: -u.y } : side === 'front' ? v : { x: -v.x, y: -v.y }
  return { x: Math.round((sym.x + d.x * hit.gap) * 10) / 10, y: Math.round((sym.y + d.y * hit.gap) * 10) / 10 }
}

/** How far each side of a free-standing piece is from the wall it faces squarely (sides with none are left out). */
export function sideGaps(sym: PlanSymbol, floor: Floor): Partial<Record<Side, number>> {
  const room = roomOf(floor, sym)
  if (!room) return {}
  const hits = sideHits(sym, sym.rotation, sym.width / 2, sym.depth / 2, wallsOf(room))
  return Object.fromEntries(Object.entries(hits).map(([k, h]) => [k, h.gap]))
}

/** A piece turned to stand with its back against the nearest wall of its room, and moved up to it (and along it, to fit). */
export function backToNearestWall(sym: PlanSymbol, floor: Floor): Magnetized | null {
  const room = roomOf(floor, sym)
  if (!room) return null
  // The one it needs moving least to stand against (and if it's against one already, that one).
  let best: { cost: number; s: number; w: Wall } | null = null
  for (const w of wallsOf(room)) {
    const h = dot(sub(sym, w.a), w.n)
    const s = dot(sub(sym, w.a), w.t)
    if (h <= 0 || s < 0 || s > w.len) continue
    const turn = Math.abs((((facing(w.n) - sym.rotation) % 360) + 540) % 360 - 180)
    const cost = Math.abs(h - sym.depth / 2) + turn / 9
    if (!best || cost < best.cost) best = { cost, s, w }
  }
  if (!best) return null
  const { w } = best
  const hw = sym.width / 2
  const s = Math.min(Math.max(best.s, Math.min(hw, w.len / 2)), Math.max(w.len - hw, w.len / 2))
  const x = w.a.x + w.t.x * s + w.n.x * (sym.depth / 2)
  const y = w.a.y + w.t.y * s + w.n.y * (sym.depth / 2)
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, rotation: facing(w.n), marks: [] }
}

/**
 * Several pieces moved together, against the walls around them: how much further to move them (their extent's
 * nearer side within reach on each axis), and the sides that end up against a wall.
 */
export function boxMagnet(box: BBox, rooms: Room[], reach: number): { dx: number; dy: number; marks: SnapMark[] } {
  const g = boxGaps(box, rooms)
  const near = (n?: number) => n !== undefined && n <= reach && n >= -2 * reach
  const left = near(g.left) && (!near(g.right) || Math.abs(g.left!) <= Math.abs(g.right!))
  const right = !left && near(g.right)
  const back = near(g.back) && (!near(g.front) || Math.abs(g.back!) <= Math.abs(g.front!))
  const front = !back && near(g.front)
  const dx = left ? -g.left! : right ? g.right! : 0
  const dy = back ? -g.back! : front ? g.front! : 0
  const b = { minX: box.minX + dx, maxX: box.maxX + dx, minY: box.minY + dy, maxY: box.maxY + dy }
  const marks: SnapMark[] = []
  if (left || right) {
    const x = left ? b.minX : b.maxX
    marks.push({ a: { x, y: b.minY }, b: { x, y: b.maxY }, kind: 'wall' })
  }
  if (back || front) {
    const y = back ? b.minY : b.maxY
    marks.push({ a: { x: b.minX, y }, b: { x: b.maxX, y }, kind: 'wall' })
  }
  return { dx, dy, marks }
}
