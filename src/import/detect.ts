/**
 * On-device room detection for floor-plan drawings (scans, photos, hand sketches).
 *
 * Pipeline: adaptive threshold → drop specks → bridge door gaps by extending straight
 * wall ends until they hit another wall → label enclosed background regions → trace,
 * simplify and straighten their outlines. Rooms are returned in working-image pixels.
 */
import { area, bbox, labelPoint, offsetPolygon, pointInPolygon } from '@/model/geometry'
import type { Point } from '@/model/types'

export interface DetectParams {
  /** Largest gap (door opening) to close, as a fraction of the image's long side. */
  gap: number
  /** 0..1 — higher picks up fainter lines. */
  sensitivity: number
}

export const DEFAULT_DETECT: DetectParams = { gap: 0.12, sensitivity: 0.5 }

// 8-neighborhood, clockwise starting West (y points down).
export const DX = [-1, -1, 0, 1, 1, 1, 0, -1]
export const DY = [0, -1, -1, -1, 0, 1, 1, 1]

export function grayscale(img: ImageData): Uint8Array {
  const { data, width, height } = img
  const g = new Uint8Array(width * height)
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    const a = data[j + 3] / 255
    // Transparent pixels count as white paper.
    const v = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]
    g[i] = Math.round(v * a + 255 * (1 - a))
  }
  return g
}

/** Ink mask from a local-mean threshold, so shadows and uneven lighting in photos don't matter. */
function threshold(g: Uint8Array, W: number, H: number, sensitivity: number): Uint8Array {
  const integral = new Float64Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) {
    let row = 0
    for (let x = 0; x < W; x++) {
      row += g[y * W + x]
      integral[(y + 1) * (W + 1) + x + 1] = integral[y * (W + 1) + x + 1] + row
    }
  }
  const half = Math.max(7, Math.round(Math.max(W, H) / 50))
  const k = 0.06 + 0.2 * (1 - sensitivity)
  const mask = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - half)
    const y1 = Math.min(H, y + half + 1)
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - half)
      const x1 = Math.min(W, x + half + 1)
      const sum =
        integral[y1 * (W + 1) + x1] - integral[y0 * (W + 1) + x1] - integral[y1 * (W + 1) + x0] + integral[y0 * (W + 1) + x0]
      const mean = sum / ((x1 - x0) * (y1 - y0))
      const v = g[y * W + x]
      if (v < mean * (1 - k) || v < 70) mask[y * W + x] = 1
    }
  }
  return mask
}

export interface Components {
  labels: Int32Array
  sizes: number[]
  boxes: { minX: number; minY: number; maxX: number; maxY: number }[]
  first: number[]
  touchesBorder: boolean[]
}

/** Connected components of pixels where mask === value. */
export function components(mask: Uint8Array, W: number, H: number, value: number, eight: boolean): Components {
  const labels = new Int32Array(W * H).fill(-1)
  const sizes: number[] = []
  const boxes: Components['boxes'] = []
  const first: number[] = []
  const touchesBorder: boolean[] = []
  const queue = new Int32Array(W * H)
  const nx = eight ? DX : [-1, 0, 1, 0]
  const ny = eight ? DY : [0, -1, 0, 1]
  for (let start = 0; start < W * H; start++) {
    if (mask[start] !== value || labels[start] !== -1) continue
    const id = sizes.length
    let head = 0
    let tail = 0
    queue[tail++] = start
    labels[start] = id
    let size = 0
    let border = false
    let minX = W
    let minY = H
    let maxX = 0
    let maxY = 0
    while (head < tail) {
      const i = queue[head++]
      const x = i % W
      const y = (i - x) / W
      size++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true
      for (let d = 0; d < nx.length; d++) {
        const xx = x + nx[d]
        const yy = y + ny[d]
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
        const j = yy * W + xx
        if (mask[j] === value && labels[j] === -1) {
          labels[j] = id
          queue[tail++] = j
        }
      }
    }
    sizes.push(size)
    boxes.push({ minX, minY, maxX, maxY })
    first.push(start)
    touchesBorder.push(border)
  }
  return { labels, sizes, boxes, first, touchesBorder }
}

function dilate(mask: Uint8Array, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) out[yy * W + xx] = 1
        }
      }
    }
  }
  return out
}

/** Zhang–Suen thinning to a 1-pixel skeleton. */
function thin(mask: Uint8Array, W: number, H: number): Uint8Array {
  const s = mask.slice()
  for (let x = 0; x < W; x++) s[x] = s[(H - 1) * W + x] = 0
  for (let y = 0; y < H; y++) s[y * W] = s[y * W + W - 1] = 0
  const del: number[] = []
  let changed = true
  while (changed) {
    changed = false
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x
          if (!s[i]) continue
          const p2 = s[i - W], p3 = s[i - W + 1], p4 = s[i + 1], p5 = s[i + W + 1]
          const p6 = s[i + W], p7 = s[i + W - 1], p8 = s[i - 1], p9 = s[i - W - 1]
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (b < 2 || b > 6) continue
          const a =
            +(!p2 && !!p3) + +(!p3 && !!p4) + +(!p4 && !!p5) + +(!p5 && !!p6) +
            +(!p6 && !!p7) + +(!p7 && !!p8) + +(!p8 && !!p9) + +(!p9 && !!p2)
          if (a !== 1) continue
          if (pass === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue
          del.push(i)
        }
      }
      for (const i of del) s[i] = 0
      if (del.length) changed = true
    }
  }
  return s
}

function drawLine(mask: Uint8Array, W: number, H: number, a: Point, b: Point) {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const steps = Math.ceil(len * 2) + 1
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(a.x + ((b.x - a.x) * s) / steps)
    const y = Math.round(a.y + ((b.y - a.y) * s) / steps)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx
        const yy = y + dy
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) mask[yy * W + xx] = 1
      }
    }
  }
}

/**
 * Close door gaps: from each end of a long, straight, axis-aligned stroke, cast a ray
 * forward; if it meets another long stroke within `maxGap`, draw the missing wall.
 */
function bridgeGaps(ink: Uint8Array, W: number, H: number, maxGap: number): [Point, Point][] {
  const inkComps = components(ink, W, H, 1, true)
  const long = Math.max(W, H) * 0.1
  const isLong = (c: number) => {
    const b = inkComps.boxes[c]
    return Math.max(b.maxX - b.minX, b.maxY - b.minY) >= long
  }
  const skel = thin(ink, W, H)
  const neighbors = (i: number) => {
    const out: number[] = []
    const x = i % W
    const y = (i - x) / W
    for (let d = 0; d < 8; d++) {
      const xx = x + DX[d]
      const yy = y + DY[d]
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && skel[yy * W + xx]) out.push(yy * W + xx)
    }
    return out
  }
  const walk = 20
  const cos20 = Math.cos((20 * Math.PI) / 180)
  const bridges: [Point, Point][] = []

  for (let i = 0; i < W * H; i++) {
    if (!skel[i] || neighbors(i).length !== 1) continue
    const comp = inkComps.labels[i]
    if (comp < 0 || !isLong(comp)) continue
    // Walk back along the stroke to estimate its direction.
    let prev = -1
    let cur = i
    let steps = 0
    for (; steps < walk; steps++) {
      const next = neighbors(cur).filter((j) => j !== prev)
      if (next.length !== 1) break
      prev = cur
      cur = next[0]
    }
    if (steps < 8) continue
    const ex = i % W
    const ey = (i - ex) / W
    const cx = cur % W
    const cy = (cur - cx) / W
    const len = Math.hypot(ex - cx, ey - cy)
    if (len < steps * 0.85) continue // curved: probably handwriting, not a wall
    // Follow the stroke's own direction (photos are rarely perfectly square to the paper),
    // but only for walls that run roughly horizontally or vertically.
    const dx = (ex - cx) / len
    const dy = (ey - cy) / len
    if (Math.abs(dx) < cos20 && Math.abs(dy) < cos20) continue
    // Step out of the stroke's own rounded tip first, then look for the wall across the gap.
    // The ray is a few pixels wide so hand-drawn wobble doesn't make it miss.
    let clear = 0
    for (let s = 1; s <= maxGap; s++) {
      const x = ex + dx * s
      const y = ey + dy * s
      if (x < 0 || y < 0 || x >= W || y >= H) break
      let hitAt = -1
      for (const o of [0, -1, 1, -2, 2]) {
        const px = Math.round(x - dy * o)
        const py = Math.round(y + dx * o)
        if (px >= 0 && py >= 0 && px < W && py < H && ink[py * W + px]) {
          hitAt = py * W + px
          break
        }
      }
      if (hitAt < 0) {
        clear++
        continue
      }
      if (clear < 2) continue
      if (isLong(inkComps.labels[hitAt])) bridges.push([{ x: ex, y: ey }, { x: hitAt % W, y: Math.floor(hitAt / W) }])
      break
    }
  }
  for (const [a, b] of bridges) drawLine(ink, W, H, a, b)
  return bridges
}

/** Moore-neighbor tracing of the outer boundary of region `id`, starting at its raster-first pixel. */
export function trace(labels: Int32Array, W: number, H: number, id: number, start: number): Point[] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && labels[y * W + x] === id
  const sx = start % W
  const sy = (start - sx) / W
  const out: Point[] = [{ x: sx, y: sy }]
  let x = sx
  let y = sy
  let dir = 0 // the pixel to the west of the start is outside the region
  const limit = 4 * (W + H) * 8
  for (let n = 0; n < limit; n++) {
    let found = false
    for (let k = 1; k <= 8; k++) {
      const d = (dir + k) % 8
      const nx = x + DX[d]
      const ny = y + DY[d]
      if (!inside(nx, ny)) continue
      // New backtrack = the last outside neighbor we checked, expressed relative to the new pixel.
      const bd = (d + 7) % 8
      const bx = x + DX[bd] - nx
      const by = y + DY[bd] - ny
      dir = DX.findIndex((v, idx) => v === bx && DY[idx] === by)
      x = nx
      y = ny
      found = true
      break
    }
    if (!found || (x === sx && y === sy)) break
    out.push({ x, y })
  }
  return out
}

function perpDist(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l = Math.hypot(dx, dy)
  if (l === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / l
}

function douglasPeucker(pts: Point[], eps: number): Point[] {
  if (pts.length < 3) return pts
  let idx = 0
  let max = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1])
    if (d > max) {
      max = d
      idx = i
    }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]]
  const left = douglasPeucker(pts.slice(0, idx + 1), eps)
  return [...left.slice(0, -1), ...douglasPeucker(pts.slice(idx), eps)]
}

export function simplifyClosed(pts: Point[], eps: number): Point[] {
  if (pts.length < 4) return pts
  let far = 0
  let max = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y)
    if (d > max) {
      max = d
      far = i
    }
  }
  const a = douglasPeucker(pts.slice(0, far + 1), eps)
  const b = douglasPeucker([...pts.slice(far), pts[0]], eps)
  return [...a.slice(0, -1), ...b.slice(0, -1)]
}

type EdgeKind = 'h' | 'v' | 'd'
const TAN15 = Math.tan((15 * Math.PI) / 180)

function kindOf(a: Point, b: Point): EdgeKind {
  const dx = Math.abs(b.x - a.x)
  const dy = Math.abs(b.y - a.y)
  if (dy <= TAN15 * dx) return 'h'
  if (dx <= TAN15 * dy) return 'v'
  return 'd'
}

/** Drop tiny zig-zags and snap near-horizontal/vertical walls to exact right angles. */
export function orthogonalize(poly: Point[], minEdge: number): Point[] {
  let pts = poly.map((p) => ({ ...p }))
  // 1. Collapse edges shorter than minEdge.
  let changed = true
  while (changed && pts.length > 4) {
    changed = false
    for (let i = 0; i < pts.length && pts.length > 4; i++) {
      const j = (i + 1) % pts.length
      if (Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y) < minEdge) {
        const m = { x: (pts[i].x + pts[j].x) / 2, y: (pts[i].y + pts[j].y) / 2 }
        pts.splice(i, 1, m)
        pts.splice(j > i ? j : 0, 1)
        changed = true
      }
    }
  }
  // 2. Merge consecutive edges of the same orientation.
  changed = true
  while (changed && pts.length > 3) {
    changed = false
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const p = pts[(i - 1 + pts.length) % pts.length]
      const c = pts[i]
      const n = pts[(i + 1) % pts.length]
      const k1 = kindOf(p, c)
      if (k1 !== 'd' && k1 === kindOf(c, n)) {
        pts.splice(i, 1)
        changed = true
      }
    }
  }
  if (pts.length < 3) return poly
  // 3. Rebuild corners as intersections of the straightened edge lines.
  const n = pts.length
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n]
    const k = kindOf(a, b)
    return { k, a, b, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  })
  const out: Point[] = []
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i - 1 + n) % n]
    const L2 = lines[i]
    if (L1.k === 'h' && L2.k === 'v') out.push({ x: L2.x, y: L1.y })
    else if (L1.k === 'v' && L2.k === 'h') out.push({ x: L1.x, y: L2.y })
    else {
      // General line intersection (falls back to the original corner when parallel).
      const p1 = L1.k === 'h' ? { x: L1.a.x, y: L1.y } : L1.k === 'v' ? { x: L1.x, y: L1.a.y } : L1.a
      const d1 = L1.k === 'h' ? { x: 1, y: 0 } : L1.k === 'v' ? { x: 0, y: 1 } : { x: L1.b.x - L1.a.x, y: L1.b.y - L1.a.y }
      const p2 = L2.k === 'h' ? { x: L2.a.x, y: L2.y } : L2.k === 'v' ? { x: L2.x, y: L2.a.y } : L2.a
      const d2 = L2.k === 'h' ? { x: 1, y: 0 } : L2.k === 'v' ? { x: 0, y: 1 } : { x: L2.b.x - L2.a.x, y: L2.b.y - L2.a.y }
      const den = d1.x * d2.y - d1.y * d2.x
      if (Math.abs(den) < 1e-9) out.push(pts[i])
      else {
        const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den
        out.push({ x: p1.x + d1.x * t, y: p1.y + d1.y * t })
      }
    }
  }
  return out
}

/** Rooms that are nearly their bounding box (e.g. a notch cut by a door swing) become rectangles. */
export function rectangleIfClose(poly: Point[], ratio = 0.86): Point[] {
  const b = bbox(poly)
  const boxArea = (b.maxX - b.minX) * (b.maxY - b.minY)
  if (boxArea <= 0 || area(poly) < boxArea * ratio) return poly
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ]
}

/** Intermediate results, for tuning and troubleshooting. */
export interface DetectDebug {
  bridges?: [Point, Point][]
  regions?: { size: number; border: boolean }[]
  candidates?: number
  mask?: Uint8Array
}

export interface Detection {
  /** Room outlines. */
  rooms: Point[][]
  /** Doorways: gaps in a wall that were closed from both sides. */
  doors: [Point, Point][]
}

/**
 * A doorway is a gap bridged from both ends (two walls pointing at each other). A single
 * bridge is usually a window stroke or a wall stopping short of another, so it isn't a door.
 */
function doorways(bridges: [Point, Point][], tol: number): [Point, Point][] {
  const near = (p: Point, q: Point) => Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol
  const doors: [Point, Point][] = []
  const used = new Set<number>()
  bridges.forEach(([a, b], i) => {
    if (used.has(i)) return
    const j = bridges.findIndex(([c, d], k) => k !== i && !used.has(k) && near(a, d) && near(b, c))
    if (j < 0) return
    used.add(i).add(j)
    doors.push([a, bridges[j][0]])
  })
  return doors
}

/** Detect enclosed rooms and doorways, in the image's pixel coordinates. */
export function detectRooms(img: ImageData, params: DetectParams = DEFAULT_DETECT, debug?: DetectDebug): Detection {
  const W = img.width
  const H = img.height
  const N = W * H
  const long = Math.max(W, H)

  // 1. Ink, minus specks (paper texture, sensor noise).
  let ink = threshold(grayscale(img), W, H, params.sensitivity)
  const specks = components(ink, W, H, 1, true)
  const minInk = Math.max(12, N * 0.00003)
  for (let i = 0; i < N; i++) if (ink[i] && specks.sizes[specks.labels[i]] < minInk) ink[i] = 0
  ink = dilate(ink, W, H)

  // 2. Close door openings so each room becomes an enclosed region.
  const bridges = bridgeGaps(ink, W, H, Math.round(long * params.gap))
  if (debug) {
    debug.bridges = bridges
    debug.mask = ink
  }

  // 3. Enclosed background regions are room candidates.
  const regions = components(ink, W, H, 0, false)
  if (debug) debug.regions = regions.sizes.map((size, i) => ({ size, border: regions.touchesBorder[i] })).filter((r) => r.size > 200)
  const eps = Math.max(1.5, long * 0.006)
  const minEdge = long * 0.025
  const candidates: { raw: Point[]; poly: Point[]; fill: number }[] = []
  regions.sizes.forEach((size, id) => {
    if (regions.touchesBorder[id] || size < N * 0.002) return
    const contour = trace(regions.labels, W, H, id, regions.first[id])
    if (contour.length < 8) return
    const raw = simplifyClosed(contour, eps)
    if (raw.length < 3) return
    const rawArea = area(raw)
    if (rawArea <= 0) return
    const poly = rectangleIfClose(orthogonalize(raw, minEdge))
    // Grow back by the 1px dilation so the outline sits on the inner face of the drawn wall.
    candidates.push({ raw, poly: offsetPolygon(poly, 1.5), fill: size / rawArea })
  })

  // 4. Regions inside another region are furniture/fixtures/text — unless the outer one is
  //    mostly empty (a frame around the drawing), in which case the outer one is dropped.
  const drop = new Set<number>()
  candidates.forEach((outer, i) => {
    const nested = candidates
      .map((inner, j) => (j !== i && pointInPolygon(labelPoint(inner.raw), outer.raw) ? j : -1))
      .filter((j) => j >= 0)
    if (!nested.length) return
    if (outer.fill < 0.6) drop.add(i)
    else nested.forEach((j) => drop.add(j))
  })
  return {
    rooms: candidates.filter((_, i) => !drop.has(i)).map((c) => c.poly),
    doors: doorways(bridges, Math.max(6, long * 0.015)),
  }
}
