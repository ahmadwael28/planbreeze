/**
 * Rooms open to each other: one space divided by an invisible line into rooms with their own floors, ceilings and
 * lights (a reception and its corridor, a living room and its dining area), with no wall between them. A room's
 * open walls (Room.openEdges) always lie along open walls of the rooms across: see healOpenings.
 */
import polygonClipping from 'polygon-clipping'
import { add, dist, dot, inwardNormal, mul, normalize, pointInPolygon, projectOnSegment, signedArea, sub } from './geometry'
import { isOpen, isOutdoor } from './project'
import type { Floor, Point, Room } from './types'

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x

/**
 * The stretch two walls share, lying along each other facing opposite ways (as the walls of two rooms either side of
 * one line do), within 1 cm: from s1 to s2 along a→b. Null if they don't share one at least `min` long.
 */
export function sharedStretch(a: Point, b: Point, sa: number, c: Point, d: Point, sc: number, min = 1): { s1: number; s2: number } | null {
  const L = dist(a, b)
  if (L < min || dist(c, d) < min) return null
  const dir = normalize(sub(b, a))
  const off = (p: Point) => Math.abs(cross(dir, sub(p, a)))
  if (off(c) > 1 || off(d) > 1) return null
  if (dot(inwardNormal(a, b, sa), inwardNormal(c, d, sc)) > -0.99) return null
  const t1 = dot(sub(c, a), dir)
  const t2 = dot(sub(d, a), dir)
  const s1 = Math.max(0, Math.min(t1, t2))
  const s2 = Math.min(L, Math.max(t1, t2))
  return s2 - s1 >= min ? { s1, s2 } : null
}

/** The rooms a room is open to: for each of its open walls, the walls of rooms across that lie along it. */
export function openNeighbors(room: Room, rooms: Room[]): { room: Room; edge: number; other: number }[] {
  const out: { room: Room; edge: number; other: number }[] = []
  const pts = room.points
  const sa = signedArea(pts)
  for (const i of room.openEdges ?? []) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    if (!a || !b) continue
    for (const r of rooms) {
      if (r.id === room.id || r.points.length < 3) continue
      const sr = signedArea(r.points)
      r.points.forEach((c, j) => {
        if (sharedStretch(a, b, sa, c, r.points[(j + 1) % r.points.length], sr, 5)) out.push({ room: r, edge: i, other: j })
      })
    }
  }
  return out
}

/** A room and every room it's open to, and the ones those are open to, and so on: the whole space. */
export function connectedRooms(room: Room, rooms: Room[]): Room[] {
  const seen = new Map<string, Room>([[room.id, room]])
  const queue = [room]
  while (queue.length) {
    const r = queue.shift()!
    for (const n of openNeighbors(r, rooms)) {
      if (seen.has(n.room.id)) continue
      seen.set(n.room.id, n.room)
      queue.push(n.room)
    }
  }
  return [...seen.values()]
}

/** Where a room's floor pattern starts: the corner of the whole space it's part of, so tiles run on across. */
export function floorOrigin(room: Room, rooms: Room[]): Point {
  const all = room.openEdges?.length ? connectedRooms(room, rooms) : [room]
  const pts = all.flatMap((r) => r.points)
  return { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) }
}

/** The outline with `p` made a corner of it (if it's on it), and which corner it is. */
function withCorner(pts: Point[], p: Point): { pts: Point[]; k: number } | null {
  let best = -1
  let bestD = 1
  pts.forEach((a, i) => {
    const d = projectOnSegment(p, a, pts[(i + 1) % pts.length]).dist
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  if (best < 0) return null
  const j = (best + 1) % pts.length
  if (dist(p, pts[best]) < 1) return { pts, k: best }
  if (dist(p, pts[j]) < 1) return { pts, k: j }
  const out = [...pts]
  out.splice(best + 1, 0, { x: p.x, y: p.y })
  return { pts: out, k: best + 1 }
}

/** Whether segments p–q and r–s cross (touching at an end doesn't count). */
function crosses(p: Point, q: Point, r: Point, s: Point) {
  const d1 = cross(sub(q, p), sub(r, p))
  const d2 = cross(sub(q, p), sub(s, p))
  const d3 = cross(sub(s, r), sub(p, r))
  const d4 = cross(sub(s, r), sub(q, r))
  return d1 * d2 < -1e-6 && d3 * d4 < -1e-6
}

/**
 * A room's outline divided along the line a–b (both on the outline, the line crossing the room): the two outlines,
 * each with the dividing line as its last edge. Null if the line doesn't cut the room in two.
 */
export function dividePoints(pts: Point[], a: Point, b: Point): [Point[], Point[]] | null {
  if (dist(a, b) < 10) return null
  const wa = withCorner(pts, a)
  if (!wa) return null
  const wb = withCorner(wa.pts, b)
  if (!wb) return null
  const ring = wb.pts
  const ka = wb.k <= wa.k && ring.length > wa.pts.length ? wa.k + 1 : wa.k
  const kb = wb.k
  if (ka === kb) return null
  const A = ring[ka]
  const B = ring[kb]
  // Through the room: its middle inside, crossing no wall on the way.
  if (!pointInPolygon(mul(add(A, B), 0.5), ring)) return null
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    if (crosses(A, B, p, q)) return null
  }
  const n = ring.length
  const walk = (from: number, to: number) => {
    const out: Point[] = []
    for (let i = from; ; i = (i + 1) % n) {
      out.push(ring[i])
      if (i === to) break
    }
    return out
  }
  const one = walk(ka, kb)
  const two = walk(kb, ka)
  if (one.length < 3 || two.length < 3 || Math.abs(signedArea(one)) < 100 || Math.abs(signedArea(two)) < 100) return null
  return [one, two]
}

/** Where a line from `from` (on the room's outline) going `dir` meets the outline next (null if it leaves the room). */
export function acrossRoom(pts: Point[], from: Point, dir: Point): Point | null {
  let best = Infinity
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const e = sub(pts[(i + 1) % pts.length], a)
    const den = cross(dir, e)
    if (Math.abs(den) < 1e-9) continue
    const ao = sub(a, from)
    const t = cross(ao, e) / den
    const s = cross(ao, dir) / den
    if (t > 1 && s >= -1e-6 && s <= 1 + 1e-6 && t < best) best = t
  }
  if (!isFinite(best)) return null
  const hit = add(from, mul(dir, best))
  return pointInPolygon(add(from, mul(dir, best / 2)), pts) ? hit : null
}

/**
 * The line between two rooms open to each other (a–b, `out` toward the other room) moved `amount` toward the other,
 * across the space they make together (`union`): its ends where they're still on the outline, else straight on from
 * its middle to the far walls. Null if it's moved out of the space.
 */
export function movedLine(union: Point[], a: Point, b: Point, out: Point, amount: number): [Point, Point] | null {
  const dir = normalize(sub(b, a))
  const a2 = add(a, mul(out, amount))
  const b2 = add(b, mul(out, amount))
  const m = mul(add(a2, b2), 0.5)
  if (!pointInPolygon(m, union)) return null
  const onOutline = (p: Point) => union.some((q, i) => projectOnSegment(p, q, union[(i + 1) % union.length]).dist < 0.5)
  const from = onOutline(a2) ? a2 : acrossRoom(union, m, mul(dir, -1))
  const to = onOutline(b2) ? b2 : acrossRoom(union, m, dir)
  return from && to ? [from, to] : null
}

/**
 * Two rooms' outlines joined into one, in the first's direction, without the corners left in the middle of a straight
 * wall where the line between them met it. Null if they don't make one piece.
 */
export function joinPoints(a: Room, b: Room): Point[] | null {
  const ring = (pts: Point[]) => [pts.map((p) => [p.x, p.y] as [number, number])]
  let res: [number, number][][][]
  try {
    res = polygonClipping.union(ring(a.points), ring(b.points))
  } catch {
    return null
  }
  if (res.length !== 1 || res[0].length !== 1) return null
  let pts = res[0][0].slice(0, -1).map(([x, y]) => ({ x, y }))
  if (Math.sign(signedArea(pts)) !== Math.sign(signedArea(a.points))) pts = pts.reverse()
  // The ends of the line between them.
  const seam = [a, b].flatMap((r) => (r.openEdges ?? []).flatMap((i) => [r.points[i], r.points[(i + 1) % r.points.length]]).filter(Boolean))
  const straight = (i: number) => {
    const p = pts[(i - 1 + pts.length) % pts.length]
    const q = pts[(i + 1) % pts.length]
    const u = sub(pts[i], p)
    const v = sub(q, pts[i])
    return Math.abs(cross(u, v)) < 1e-3 * Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y) && dot(u, v) > 0
  }
  for (let i = pts.length - 1; i >= 0 && pts.length > 3; i--) {
    if (straight(i) && seam.some((s) => dist(s, pts[i]) < 1)) pts.splice(i, 1)
  }
  return pts.length >= 3 ? pts : null
}

/**
 * A room drawn next to this one with a wall between them: its wall facing wall i of this one, the gap between the
 * two rooms (the wall's thickness) and the stretch they face each other along (s1…s2 along wall i).
 */
export function wallAcross(room: Room, i: number, rooms: Room[]): { room: Room; edge: number; gap: number; s1: number; s2: number } | null {
  const pts = room.points
  const a = pts[i]
  const b = pts[(i + 1) % pts.length]
  if (!a || !b || isOpen(room, i) || isOutdoor(room)) return null
  const L = dist(a, b)
  const dir = normalize(sub(b, a))
  const out = mul(inwardNormal(a, b, signedArea(pts)), -1)
  let best: { room: Room; edge: number; gap: number; s1: number; s2: number } | null = null
  for (const r of rooms) {
    if (r.id === room.id || r.points.length < 3 || isOutdoor(r)) continue
    const sr = signedArea(r.points)
    r.points.forEach((c, j) => {
      const d = r.points[(j + 1) % r.points.length]
      if (isOpen(r, j) || Math.abs(cross(dir, normalize(sub(d, c)))) > 0.01) return
      if (dot(inwardNormal(c, d, sr), out) < 0.99) return
      const gap = dot(sub(c, a), out)
      if (gap < 0.5 || gap > Math.max(room.wallThickness, r.wallThickness) + 2) return
      const t1 = dot(sub(c, a), dir)
      const t2 = dot(sub(d, a), dir)
      const s1 = Math.max(0, Math.min(t1, t2))
      const s2 = Math.min(L, Math.max(t1, t2))
      if (s2 - s1 >= 20 && (!best || s2 - s1 > best.s2 - best.s1)) best = { room: r, edge: j, gap, s1, s2 }
    })
  }
  return best
}

/** Two lines' meeting point (null if they run in line). */
function meet(p: Point, u: Point, q: Point, v: Point): Point | null {
  const den = cross(u, v)
  if (Math.abs(den) < 1e-9 * Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)) return null
  return add(p, mul(u, cross(sub(q, p), v) / den))
}

/**
 * Opening up the wall between this room's wall i and the room across (see wallAcross): this room reaches over to the
 * other along the stretch they share (with a step where that's only part of the wall). Its new outline, starting at
 * the start of what was wall i, and its open wall; the room across opens along it when healed (see healOpenings).
 */
export function openedPoints(room: Room, i: number, across: NonNullable<ReturnType<typeof wallAcross>>): { pts: Point[]; open: number } {
  const pts = [...room.points.slice(i), ...room.points.slice(0, i)]
  const [P, Q] = pts
  const rest = pts.slice(2)
  const L = dist(P, Q)
  const dir = normalize(sub(Q, P))
  const shift = mul(inwardNormal(P, Q, signedArea(room.points)), -across.gap)
  const prev = rest[rest.length - 1] ?? P
  const next = rest[0] ?? Q
  let start: Point[]
  if (across.s1 > 1) {
    const P1 = add(P, mul(dir, across.s1))
    start = [P, P1, add(P1, shift)]
  } else {
    // Its neighbouring walls run on to meet it (or a step, if they're in line with it).
    const m = meet(prev, sub(P, prev), add(P, shift), dir)
    start = m ? [m] : [P, add(P, shift)]
  }
  let end: Point[]
  if (across.s2 < L - 1) {
    const P2 = add(P, mul(dir, across.s2))
    end = [add(P2, shift), P2, Q]
  } else {
    const m = meet(next, sub(Q, next), add(Q, shift), dir)
    end = m ? [m] : [add(Q, shift), Q]
  }
  return { pts: [...start, ...end, ...rest], open: start.length - 1 }
}

/**
 * Keep open walls matched: each open wall stays open only where a room across lies along it (split where it stops),
 * and a wall becomes open where an open wall of the room across lies along it. Rooms that change are passed, as they
 * were, to `changed` once updated (to carry their doors and per-wall settings over); true if any did.
 */
export function healOpenings(floor: Floor, changed: (old: Room) => void): boolean {
  if (!floor.rooms.some((r) => r.openEdges?.length)) return false
  const rooms = floor.rooms.filter((r) => r.points.length >= 3 && !isOutdoor(r))
  const plans: { room: Room; pts: Point[]; open: number[] }[] = []
  for (const room of rooms) {
    const pts = room.points
    const sa = signedArea(pts)
    const newPts: Point[] = []
    const open: number[] = []
    let touched = false
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length]
      const L = dist(a, b)
      const mine = isOpen(room, i)
      // Where the room across lies along it (any wall of it, if this one's open; its open walls, if not).
      const spans: [number, number][] = []
      for (const r of rooms) {
        if (r.id === room.id) continue
        const sr = signedArea(r.points)
        r.points.forEach((c, j) => {
          if (!mine && !isOpen(r, j)) return
          const s = sharedStretch(a, b, sa, c, r.points[(j + 1) % r.points.length], sr, 5)
          if (s) spans.push([s.s1, s.s2])
        })
      }
      spans.sort((p, q) => p[0] - q[0])
      const merged: [number, number][] = []
      for (const s of spans) {
        const last = merged[merged.length - 1]
        if (last && s[0] <= last[1] + 1) last[1] = Math.max(last[1], s[1])
        else merged.push([...s])
      }
      const full = merged.length === 1 && merged[0][0] <= 1 && merged[0][1] >= L - 1
      newPts.push(a)
      if (full || (!merged.length && !mine)) {
        if (full) open.push(newPts.length - 1)
        if (full !== mine) touched = true
        return
      }
      touched = true
      if (!merged.length) return // open to nothing: a wall again
      // Split where the room across starts and stops; open along it.
      const dir = normalize(sub(b, a))
      let at = 0
      for (const [s1, s2] of merged) {
        if (s1 > at + 1) newPts.push(add(a, mul(dir, s1)))
        open.push(newPts.length - 1)
        if (s2 < L - 1) newPts.push(add(a, mul(dir, s2)))
        at = s2
      }
    })
    if (touched) plans.push({ room, pts: newPts, open })
  }
  if (!plans.length) return false
  for (const { room, pts, open } of plans) {
    const r = floor.rooms.find((x) => x.id === room.id)!
    const old = { ...r, points: [...r.points] }
    r.points = pts
    changed(old)
    r.openEdges = open.length ? [...new Set(open)].sort((x, y) => x - y) : undefined
  }
  return true
}
