import type { Point } from './types'

export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
export const mul = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s })
export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
export const len = (a: Point) => Math.hypot(a.x, a.y)
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

export function normalize(a: Point): Point {
  const l = len(a)
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}

export function rotate(p: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }
}

/** Signed area; positive when the polygon is clockwise on screen (y down). */
export function signedArea(pts: Point[]) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

export const area = (pts: Point[]) => Math.abs(signedArea(pts))

export function perimeter(pts: Point[]) {
  let p = 0
  for (let i = 0; i < pts.length; i++) p += dist(pts[i], pts[(i + 1) % pts.length])
  return p
}

export function centroid(pts: Point[]): Point {
  const a = signedArea(pts)
  if (Math.abs(a) < 1e-6) {
    const s = pts.reduce((acc, p) => add(acc, p), { x: 0, y: 0 })
    return mul(s, 1 / Math.max(pts.length, 1))
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    const f = p.x * q.y - q.x * p.y
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

export function pointInPolygon(p: Point, pts: Point[]) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/** A point guaranteed-ish to be inside the polygon, for placing labels. */
export function labelPoint(pts: Point[]): Point {
  const c = centroid(pts)
  if (pointInPolygon(c, pts)) return c
  // Fall back to the midpoint of the widest horizontal span through the bbox center.
  const b = bbox(pts)
  const y = (b.minY + b.maxY) / 2
  const xs: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const q = pts[(i + 1) % pts.length]
    if (a.y > y !== q.y > y) xs.push(a.x + ((y - a.y) * (q.x - a.x)) / (q.y - a.y))
  }
  xs.sort((m, n) => m - n)
  let best = c
  let bestW = -1
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > bestW) {
      bestW = xs[i + 1] - xs[i]
      best = { x: (xs[i] + xs[i + 1]) / 2, y }
    }
  }
  return best
}

export function projectOnSegment(p: Point, a: Point, b: Point) {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2))
  const point = add(a, mul(ab, t))
  return { t, point, dist: dist(p, point) }
}

/** Unit normal of edge a->b pointing into the polygon with the given signed area. */
export function inwardNormal(a: Point, b: Point, polygonSignedArea: number): Point {
  const d = normalize(sub(b, a))
  return polygonSignedArea >= 0 ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x }
}

/** Offset a polygon outward by `t` using mitered corners. */
export function offsetPolygon(pts: Point[], t: number): Point[] {
  const n = pts.length
  if (n < 3 || t === 0) return pts
  const sa = signedArea(pts)
  return pts.map((p, i) => {
    const prev = pts[(i - 1 + n) % n]
    const next = pts[(i + 1) % n]
    const n1 = mul(inwardNormal(prev, p, sa), -1)
    const n2 = mul(inwardNormal(p, next, sa), -1)
    const denom = Math.max(1 + dot(n1, n2), 0.15) // limit very sharp miters
    return add(p, mul(add(n1, n2), t / denom))
  })
}

/**
 * Move each edge i along its outward normal by d[i] (negative moves it inward) and rebuild the
 * corners where neighboring edges meet. Edges without an entry stay put.
 */
export function offsetEdges(pts: Point[], d: (number | undefined)[]): Point[] {
  const n = pts.length
  if (n < 3) return pts
  const sa = signedArea(pts)
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n]
    return { p: add(a, mul(inwardNormal(a, b, sa), -(d[i] ?? 0))), dir: sub(b, a) }
  })
  return pts.map((_, i) => {
    const L1 = lines[(i - 1 + n) % n]
    const L2 = lines[i]
    const den = L1.dir.x * L2.dir.y - L1.dir.y * L2.dir.x
    if (Math.abs(den) < 1e-9) return L2.p
    const t = ((L2.p.x - L1.p.x) * L2.dir.y - (L2.p.y - L1.p.y) * L2.dir.x) / den
    return add(L1.p, mul(L1.dir, t))
  })
}

/**
 * Like offsetEdges, but where two neighbouring edges run in line and move by different amounts, a step joins them
 * (so there may be more corners than before).
 */
export function offsetEdgesStepped(pts: Point[], d: (number | undefined)[]): Point[] {
  const n = pts.length
  if (n < 3) return pts
  const sa = signedArea(pts)
  const out: Point[] = []
  const at = offsetEdges(pts, d)
  pts.forEach((v, i) => {
    const prev = (i - 1 + n) % n
    const u = sub(v, pts[prev])
    const w = sub(pts[(i + 1) % n], v)
    const inLine = Math.abs(u.x * w.y - u.y * w.x) < 1e-6 * Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y) && dot(u, w) > 0
    if (inLine && (d[prev] ?? 0) !== (d[i] ?? 0)) {
      out.push(add(v, mul(inwardNormal(pts[prev], v, sa), -(d[prev] ?? 0))), add(v, mul(inwardNormal(v, pts[(i + 1) % n], sa), -(d[i] ?? 0))))
    } else out.push(at[i])
  })
  return out
}

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function bbox(pts: Point[]): BBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY }
}

export const snapTo = (v: number, step: number) => Math.round(v / step) * step

/** Snap the direction of `p` relative to `origin` to multiples of 45° when close. */
export function snapAngle(origin: Point, p: Point, toleranceDeg = 7): Point {
  const d = sub(p, origin)
  const l = len(d)
  if (l === 0) return p
  const ang = (Math.atan2(d.y, d.x) * 180) / Math.PI
  const snapped = Math.round(ang / 45) * 45
  if (Math.abs(ang - snapped) > toleranceDeg) return p
  const r = (snapped * Math.PI) / 180
  return { x: origin.x + Math.cos(r) * l, y: origin.y + Math.sin(r) * l }
}

export const polygonPath = (pts: Point[]) =>
  pts.length ? `M${pts.map((p) => `${p.x},${p.y}`).join('L')}Z` : ''
