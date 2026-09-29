/**
 * Room detection for printed and digital floor plans (CAD exports, estate-agent plans, scans and
 * photos of them), where walls are drawn thicker than everything else.
 *
 * 1. Ink: dark, uncolored pixels (one threshold for clean images, a local one for photos).
 * 2. Straighten a photographed plan that sits at a slight angle.
 * 3. Outlined or hatched walls, and window symbols: fill between long parallel lines spaced like a wall.
 * 4. Walls: a morphological opening removes everything thinner than a wall (furniture, text, door
 *    swings, dimension lines, floor patterns); small leftovers are dropped.
 * 5. Doorways: gaps between two wall ends that line up are closed and kept as openings.
 * 6. Rooms: the enclosed spaces between walls, traced and squared up.
 *
 * Everything is in pixels of the input image, in its straightened frame (see `angle`).
 */
import { area, labelPoint, pointInPolygon } from '@/model/geometry'
import type { Point } from '@/model/types'
import { components, grayscale, orthogonalize, rectangleIfClose, simplifyClosed, trace } from './detect'

export interface PlanParams {
  /** Largest doorway to close, as a fraction of the image's long side. */
  gap: number
  /** 0..1: higher picks up fainter walls. */
  sensitivity: number
}

export interface PlanDetection {
  rooms: Point[][]
  /** Doorways and passages: segments along the wall across the gap. */
  doors: [Point, Point][]
  windows: [Point, Point][]
  /** Thickness of the thinner (interior) walls, in px. */
  wallThickness: number
  /** The drawing's tilt in degrees; results are in the frame rotated by -angle about the image center. */
  angle: number
  style: 'solid' | 'outlined'
}

const INF = 1e20

/** Distance from every pixel to the nearest pixel where `seed` is set (exact Euclidean, Felzenszwalb). */
export function distanceTo(seed: Uint8Array, W: number, H: number): Float32Array {
  const n = Math.max(W, H)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  const out = new Float32Array(W * H)
  const pass = (len: number) => {
    let k = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) {
        k--
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      }
      k++
      v[k] = q
      z[k] = s
      z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
    }
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = seed[y * W + x] ? 0 : INF
    pass(H)
    for (let y = 0; y < H; y++) out[y * W + x] = d[y]
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = out[y * W + x]
    pass(W)
    for (let x = 0; x < W; x++) out[y * W + x] = Math.sqrt(d[x])
  }
  return out
}

function otsu(g: Uint8Array): number {
  const hist = new Float64Array(256)
  for (let i = 0; i < g.length; i++) hist[g[i]]++
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0
  let wB = 0
  let best = 0
  let at = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = g.length - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      at = t
    }
  }
  return at
}

/**
 * Dark, uncolored pixels. Clean digital images get one threshold; photos (uneven light) a local one.
 * `faint` also keeps light gray pixels, so thin antialiased lines (window symbols, outlined walls)
 * survive for the parallel-line filling.
 */
function inkMask(img: ImageData, g: Uint8Array, sensitivity: number): { ink: Uint8Array; faint: Uint8Array; photo: boolean } {
  const { data, width: W, height: H } = img
  const N = W * H
  // Colored fills and annotations aren't walls.
  const colored = new Uint8Array(N)
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    const mx = Math.max(data[j], data[j + 1], data[j + 2])
    const mn = Math.min(data[j], data[j + 1], data[j + 2])
    if (mx > 0 && (mx - mn) / mx > 0.35 && g[i] > 70) colored[i] = 1
  }
  // Is the paper evenly lit? Compare the brightness of the paper across blocks.
  const B = Math.max(16, Math.round(Math.max(W, H) / 24))
  let lo = 255
  let hi = 0
  for (let by = 0; by < H; by += B) {
    for (let bx = 0; bx < W; bx += B) {
      const hist = new Uint32Array(32)
      let n = 0
      for (let y = by; y < Math.min(H, by + B); y += 2) {
        for (let x = bx; x < Math.min(W, bx + B); x += 2) {
          hist[g[y * W + x] >> 3]++
          n++
        }
      }
      let acc = 0
      let p90 = 0
      for (let b = 0; b < 32; b++) {
        acc += hist[b]
        if (acc >= n * 0.9) {
          p90 = b * 8 + 4
          break
        }
      }
      if (p90 > 110) {
        lo = Math.min(lo, p90)
        hi = Math.max(hi, p90)
      }
    }
  }
  const ink = new Uint8Array(N)
  const shift = (sensitivity - 0.5) * 50
  if (hi - lo < 28) {
    const T = Math.min(185, Math.max(80, otsu(g) + shift))
    const TF = Math.max(T, Math.min(225, lo - 30))
    const faint = new Uint8Array(N)
    for (let i = 0; i < N; i++) {
      if (colored[i]) continue
      if (g[i] < T) ink[i] = 1
      if (g[i] < TF) faint[i] = 1
    }
    return { ink, faint, photo: false }
  }
  // Local threshold for photos.
  const integral = new Float64Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) {
    let row = 0
    for (let x = 0; x < W; x++) {
      row += g[y * W + x]
      integral[(y + 1) * (W + 1) + x + 1] = integral[y * (W + 1) + x + 1] + row
    }
  }
  const half = Math.max(10, Math.round(Math.max(W, H) / 28))
  const k = 0.2 - sensitivity * 0.12
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - half)
    const y1 = Math.min(H, y + half + 1)
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - half)
      const x1 = Math.min(W, x + half + 1)
      const mean =
        (integral[y1 * (W + 1) + x1] - integral[y0 * (W + 1) + x1] - integral[y1 * (W + 1) + x0] + integral[y0 * (W + 1) + x0]) /
        ((x1 - x0) * (y1 - y0))
      const v = g[y * W + x]
      if ((v < mean * (1 - k) && v < mean - 18) || v < 55) ink[y * W + x] = colored[y * W + x] ? 0 : 1
    }
  }
  return { ink, faint: ink, photo: true }
}

/** Tilt of the drawing in degrees: the rotation that makes its lines line up best with the axes. */
function skewAngle(ink: Uint8Array, W: number, H: number): number {
  const xs: number[] = []
  const ys: number[] = []
  let count = 0
  for (let i = 0; i < ink.length; i++) if (ink[i]) count++
  const step = Math.max(1, Math.round(count / 60000))
  for (let i = 0, c = 0; i < ink.length; i++) {
    if (!ink[i] || c++ % step) continue
    xs.push((i % W) - W / 2)
    ys.push(Math.floor(i / W) - H / 2)
  }
  const n = Math.ceil(Math.hypot(W, H)) + 2
  const hx = new Float64Array(n)
  const hy = new Float64Array(n)
  const sharp = (deg: number) => {
    const a = (deg * Math.PI) / 180
    const c = Math.cos(a)
    const s = Math.sin(a)
    hx.fill(0)
    hy.fill(0)
    for (let i = 0; i < xs.length; i++) {
      hx[Math.round(c * xs[i] + s * ys[i] + n / 2)]++
      hy[Math.round(-s * xs[i] + c * ys[i] + n / 2)]++
    }
    let v = 0
    for (let i = 0; i < n; i++) v += hx[i] * hx[i] + hy[i] * hy[i]
    return v
  }
  let best = 0
  let bestV = sharp(0)
  const base = bestV
  for (let d = -12; d <= 12; d += 0.5) {
    const v = sharp(d)
    if (v > bestV) {
      bestV = v
      best = d
    }
  }
  for (let d = best - 0.4; d <= best + 0.4; d += 0.1) {
    const v = sharp(d)
    if (v > bestV) {
      bestV = v
      best = d
    }
  }
  // Only straighten when it clearly helps (a square drawing stays untouched).
  return Math.abs(best) >= 0.3 && bestV > base * 1.05 ? Math.round(best * 10) / 10 : 0
}

/** Rotate a mask by -deg about the center (nearest neighbor), squaring up a drawing tilted by deg. */
function straighten(mask: Uint8Array, W: number, H: number, deg: number): Uint8Array {
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const out = new Uint8Array(W * H)
  const cx = W / 2
  const cy = H / 2
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx
      const dy = y - cy
      const sx = Math.round(cx + c * dx - s * dy)
      const sy = Math.round(cy + s * dx + c * dy)
      if (sx >= 0 && sy >= 0 && sx < W && sy < H) out[y * W + x] = mask[sy * W + sx]
    }
  }
  return out
}

/** Length of the horizontal (or vertical) run of set pixels each pixel belongs to. */
function runLengths(mask: Uint8Array, W: number, H: number, horizontal: boolean): Uint16Array {
  const out = new Uint16Array(W * H)
  const [outer, inner] = horizontal ? [H, W] : [W, H]
  const at = horizontal ? (o: number, i: number) => o * W + i : (o: number, i: number) => i * W + o
  for (let o = 0; o < outer; o++) {
    let i = 0
    while (i < inner) {
      if (!mask[at(o, i)]) {
        i++
        continue
      }
      const start = i
      while (i < inner && mask[at(o, i)]) i++
      const len = Math.min(65535, i - start)
      for (let j = start; j < i; j++) out[at(o, j)] = len
    }
  }
  return out
}

/**
 * Fill between long parallel lines that are spaced like a wall: outlined and hatched walls become
 * solid, and so do window symbols (thin lines across a wall opening). Returns the added pixels.
 */
function fillParallel(ink: Uint8Array, W: number, H: number, minLen: number, maxGap: number, onlyBelow?: number): Uint8Array {
  const added = new Uint8Array(W * H)
  const hist = new Float64Array(maxGap + 2)
  const gaps: number[] = [] // [horizontal?, line, from, to] flattened
  for (const horizontal of [true, false]) {
    const run = runLengths(ink, W, H, horizontal)
    // Scan across the lines: columns for horizontal lines, rows for vertical ones.
    const [outer, inner] = horizontal ? [W, H] : [H, W]
    const at = horizontal ? (o: number, i: number) => i * W + o : (o: number, i: number) => o * W + i
    for (let o = 0; o < outer; o++) {
      let prevEnd = -1
      let i = 0
      while (i < inner) {
        if (run[at(o, i)] < minLen) {
          i++
          continue
        }
        const start = i
        while (i < inner && run[at(o, i)] >= minLen) i++
        if (prevEnd >= 0) {
          const g = start - prevEnd - 1
          if (g >= 1 && g <= maxGap) {
            hist[g]++
            gaps.push(horizontal ? 1 : 0, o, prevEnd + 1, start - 1)
          }
        }
        prevEnd = i - 1
      }
    }
  }
  // Wall-like spacings are the ones that occur along a lot of length.
  const smooth = (g: number) => (hist[g - 1] ?? 0) * 0.5 + hist[g] + (hist[g + 1] ?? 0) * 0.5
  let top = 0
  for (let g = 1; g <= maxGap; g++) top = Math.max(top, smooth(g))
  const ok = new Uint8Array(maxGap + 2)
  const floor = Math.max(top * 0.2, Math.max(W, H) * 0.08)
  for (let g = 1; g <= maxGap; g++) {
    const v = smooth(g)
    if (v < floor || v < smooth(g - 1) || v < smooth(g + 1)) continue
    for (let h = Math.max(1, Math.floor(g * 0.78)); h <= Math.min(maxGap, Math.ceil(g * 1.22)); h++) ok[h] = 1
  }
  for (let k = 0; k < gaps.length; k += 4) {
    const g = gaps[k + 3] - gaps[k + 2] + 1
    if (!ok[g] || (onlyBelow !== undefined && g > onlyBelow)) continue
    for (let i = gaps[k + 2]; i <= gaps[k + 3]; i++) {
      const p = gaps[k] ? i * W + gaps[k + 1] : gaps[k + 1] * W + i
      if (!ink[p]) added[p] = 1
    }
  }
  return added
}

/** Morphological opening with a disk of radius r: removes everything thinner than 2r. */
function open(mask: Uint8Array, dt: Float32Array, W: number, H: number, r: number): Uint8Array {
  const keep = new Uint8Array(W * H)
  for (let i = 0; i < keep.length; i++) if (dt[i] >= r) keep[i] = 1
  const grow = distanceTo(keep, W, H)
  const out = new Uint8Array(W * H)
  for (let i = 0; i < out.length; i++) if (mask[i] && grow[i] <= r + 0.5) out[i] = 1
  return out
}

/** Morphological closing with a disk of radius c: fills holes and notches narrower than 2c. */
function close(mask: Uint8Array, W: number, H: number, c: number): Uint8Array {
  const near = distanceTo(mask, W, H)
  const outside = new Uint8Array(W * H)
  for (let i = 0; i < outside.length; i++) outside[i] = near[i] <= c ? 0 : 1
  const far = distanceTo(outside, W, H)
  const out = new Uint8Array(W * H)
  for (let i = 0; i < out.length; i++) if (mask[i] || far[i] > c) out[i] = 1
  return out
}

/**
 * Thickness of the long straight structures in a mask, from run lengths: for pixels on long
 * horizontal runs the vertical run is the line's thickness, and vice versa.
 * Returns the thinnest common wall thickness (≥ 3 px) and how much wall there is (length / image size).
 */
function analyze(mask: Uint8Array, W: number, H: number): { t: number; amount: number } {
  const long = Math.max(W, H)
  const minLen = long * 0.04
  const h = runLengths(mask, W, H, true)
  const v = runLengths(mask, W, H, false)
  const maxT = Math.round(long * 0.05)
  const len = new Float64Array(maxT + 2)
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    if (h[i] >= minLen && v[i] <= maxT && h[i] >= v[i] * 3) len[v[i]] += 1 / v[i]
    else if (v[i] >= minLen && h[i] <= maxT && v[i] >= h[i] * 3) len[h[i]] += 1 / h[i]
  }
  const smooth = (t: number) => (len[t - 1] ?? 0) * 0.5 + len[t] + (len[t + 1] ?? 0) * 0.5
  let top = 0
  let amount = 0
  for (let t = 3; t <= maxT; t++) {
    top = Math.max(top, smooth(t))
    amount += len[t]
  }
  let t = 0
  for (let k = 3; k <= maxT && !t; k++) {
    const s = smooth(k)
    if (s >= top * 0.15 && s >= smooth(k - 1) && s >= smooth(k + 1) && s >= long * 0.05) t = k
  }
  return { t, amount: amount / long }
}

/**
 * Close doorways: in each row, a short gap between two pieces of horizontal wall (and likewise
 * for columns). Returns the pixels added.
 */
function closeDoorways(walls: Uint8Array, W: number, H: number, maxGap: number, minRun: number): Uint8Array {
  const added = new Uint8Array(W * H)
  const hRun = runLengths(walls, W, H, true)
  const vRun = runLengths(walls, W, H, false)
  for (const horizontal of [true, false]) {
    const along = horizontal ? hRun : vRun
    const across = horizontal ? vRun : hRun
    // A pixel of a wall running this way: long along, and longer along than across.
    const isWall = (p: number) => walls[p] === 1 && along[p] >= minRun && along[p] >= 2 * across[p]
    const [outer, inner] = horizontal ? [H, W] : [W, H]
    const at = horizontal ? (o: number, i: number) => o * W + i : (o: number, i: number) => i * W + o
    for (let o = 0; o < outer; o++) {
      let i = 0
      while (i < inner) {
        if (walls[at(o, i)]) {
          i++
          continue
        }
        const start = i
        while (i < inner && !walls[at(o, i)]) i++
        const len = i - start
        if (start === 0 || i >= inner || len > maxGap) continue
        if (!isWall(at(o, start - 1)) || !isWall(at(o, i))) continue
        for (let j = start; j < i; j++) added[at(o, j)] = 1
      }
    }
  }
  return added
}

/**
 * Openings from filled pixels: one segment along the wall per opening. Patches that lie side by
 * side in the same wall (e.g. the panes of a window symbol) are merged first.
 */
function segments(added: Uint8Array, W: number, H: number, minLen: number, t: number): [Point, Point][] {
  const comps = components(added, W, H, 1, true)
  type Box = { minX: number; minY: number; maxX: number; maxY: number }
  const boxes: Box[] = comps.boxes.filter((b) => Math.max(b.maxX - b.minX, b.maxY - b.minY) >= 2).map((b) => ({ ...b }))
  const horiz = (b: Box) => b.maxX - b.minX >= b.maxY - b.minY
  let merged = true
  while (merged) {
    merged = false
    for (let i = 0; i < boxes.length && !merged; i++) {
      for (let j = i + 1; j < boxes.length && !merged; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const gapX = Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX)
        const gapY = Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY)
        if (gapX <= t && gapY <= t) {
          boxes[i] = { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }
          boxes.splice(j, 1)
          merged = true
        }
      }
    }
  }
  const out: [Point, Point][] = []
  for (const b of boxes) {
    if (Math.max(b.maxX - b.minX, b.maxY - b.minY) + 1 < minLen) continue
    // Real openings go through the whole wall; thin slivers along a wall are leftovers.
    if (Math.min(b.maxX - b.minX, b.maxY - b.minY) + 1 < t * 0.5) continue
    if (horiz(b)) out.push([{ x: b.minX, y: (b.minY + b.maxY + 1) / 2 }, { x: b.maxX + 1, y: (b.minY + b.maxY + 1) / 2 }])
    else out.push([{ x: (b.minX + b.maxX + 1) / 2, y: b.minY }, { x: (b.minX + b.maxX + 1) / 2, y: b.maxY + 1 }])
  }
  return out
}

/** The walls found in a floor-plan image (the slow part, independent of the doorway size). */
export interface PlanWalls {
  W: number
  H: number
  walls: Uint8Array
  windowPixels: Uint8Array | null
  t: number
  angle: number
  style: PlanDetection['style']
}

/** Find the walls in a floor-plan image, or null when it doesn't look like one (no drawn walls). */
export function planWalls(img: ImageData, sensitivity: number, debug?: Record<string, unknown>): PlanWalls | null {
  const W = img.width
  const H = img.height
  const N = W * H
  const long = Math.max(W, H)

  // 1. Ink, minus specks.
  const masks = inkMask(img, grayscale(img), sensitivity)
  let ink = masks.ink
  let faint = masks.faint
  const specks = components(ink, W, H, 1, true)
  const minInk = Math.max(4, N * 0.000002)
  // In a photo, the table or floor around the paper shows up as a big dark band along the edges.
  const surround = (id: number) => masks.photo && specks.touchesBorder[id] && specks.sizes[id] > N * 0.01
  for (let i = 0; i < N; i++) if (ink[i] && (specks.sizes[specks.labels[i]] < minInk || surround(specks.labels[i]))) ink[i] = 0

  // 2. Straighten.
  const angle = skewAngle(ink, W, H)
  if (angle) {
    ink = straighten(ink, W, H, angle)
    faint = faint === masks.ink ? ink : straighten(faint, W, H, angle)
  }

  // 3–4. Walls: the drawing as-is (solid walls), or with parallel lines filled in (outlined walls).
  const minLine = Math.max(10, long * 0.025)
  const maxWall = Math.max(6, Math.round(long * 0.03))
  const openWalls = (base: Uint8Array, t: number) => {
    const bg = new Uint8Array(N)
    for (let i = 0; i < N; i++) bg[i] = base[i] ? 0 : 1
    // Just below half the thinnest wall: everything thinner goes, the walls stay.
    const r = Math.max(1.5, Math.min(t / 2 - 0.6, t * 0.35 + 0.8))
    return open(base, distanceTo(bg, W, H), W, H, r)
  }
  const enough = 1.5
  // Thinner than this is pen or pencil, not a drawn wall: leave it to the sketch detector.
  const minT = Math.max(4, long * 0.003)
  let style: PlanDetection['style']
  let walls: Uint8Array
  let windowPixels: Uint8Array | null = null
  let t: number
  const solid = analyze(ink, W, H)
  if (solid.t >= minT && solid.amount >= enough) {
    style = 'solid'
    t = solid.t
    walls = openWalls(ink, t)
    // Window symbols: thin lines across a wall opening, spaced within the wall's thickness. A real
    // window continues a wall at one of its ends; bands of floor pattern don't, so they're skipped.
    const narrow = fillParallel(faint, W, H, minLine, maxWall, Math.ceil(t * 1.6))
    const hRun = runLengths(walls, W, H, true)
    const vRun = runLengths(walls, W, H, false)
    const lineUp = (x: number, y: number, horizontal: boolean) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false
      const p = y * W + x
      return walls[p] === 1 && (horizontal ? hRun[p] >= t * 1.8 && hRun[p] >= vRun[p] : vRun[p] >= t * 1.8 && vRun[p] >= hRun[p])
    }
    const bands = components(narrow, W, H, 1, true)
    type Box = { minX: number; minY: number; maxX: number; maxY: number }
    const pieces: Box[] = bands.boxes.filter((_, i) => bands.sizes[i] >= 4).map((b) => ({ ...b }))
    const along = (b: Box) => (b.maxX - b.minX >= b.maxY - b.minY ? 'h' : 'v')
    for (let merged = true; merged; ) {
      merged = false
      for (let i = 0; i < pieces.length && !merged; i++) {
        for (let j = i + 1; j < pieces.length && !merged; j++) {
          const a = pieces[i]
          const b = pieces[j]
          const gx = Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX)
          const gy = Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY)
          // Pieces of the same line (a broken line in a photo), or the panes between neighboring lines.
          const h = along(a) === 'h' && along(b) === 'h'
          const v = along(a) === 'v' && along(b) === 'v'
          const same = (h && gy <= t * 0.5 && gx <= t * 3) || (v && gx <= t * 0.5 && gy <= t * 3)
          if (!same) continue
          const box = { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }
          // No thicker than a wall can be (a bed or bath pushed against the window isn't part of it).
          if ((h ? box.maxY - box.minY : box.maxX - box.minX) + 1 > t * 3) continue
          pieces[i] = box
          pieces.splice(j, 1)
          merged = true
        }
      }
    }
    const reach = Math.ceil(t * 0.6) + 1
    const isWindow = pieces.map((b) => {
      const horizontal = b.maxX - b.minX >= b.maxY - b.minY
      const [lo, hi] = horizontal ? [b.minY, b.maxY] : [b.minX, b.maxX]
      const ends = horizontal ? [b.minX - reach, b.maxX + reach] : [b.minY - reach, b.maxY + reach]
      return ends.some((e) => {
        let n = 0
        for (let k = lo; k <= hi; k++) if (horizontal ? lineUp(e, k, true) : lineUp(k, e, false)) n++
        return n >= (hi - lo + 1) * 0.5
      })
    })
    const win = new Uint8Array(N)
    windowPixels = win
    pieces.forEach((b, i) => {
      if (!isWindow[i]) return
      // The whole window, lines included, becomes wall.
      for (let y = Math.max(0, b.minY - 1); y <= Math.min(H - 1, b.maxY + 1); y++) {
        for (let x = Math.max(0, b.minX - 1); x <= Math.min(W - 1, b.maxX + 1); x++) {
          win[y * W + x] = 1
          walls[y * W + x] = 1
        }
      }
    })
  } else {
    // Only dark lines pair up into walls: faint ones include ruled or grid paper.
    const filled = fillParallel(ink, W, H, minLine, maxWall)
    const inkFilled = ink.slice()
    for (let i = 0; i < N; i++) if (filled[i]) inkFilled[i] = 1
    const outlined = analyze(inkFilled, W, H)
    if (outlined.t < minT || outlined.amount < enough) return null
    // In an outlined plan most of each wall is the space between its two lines. When the fill adds
    // little (just the odd double line, like a sketched window), the lines themselves are the walls:
    // a sketch, better read by the sketch detector.
    let added = 0
    let lines = 0
    for (let i = 0; i < N; i++) {
      if (filled[i]) added++
      else if (ink[i]) lines++
    }
    if (added < lines * 0.6) return null
    style = 'outlined'
    t = outlined.t
    // Where one wall meets another, the other's line is missing, so the fill leaves a hole the
    // width of the joining wall. Close those before thin lines are removed.
    walls = openWalls(close(inkFilled, W, H, Math.ceil(t / 2) + 1), t)
  }

  // Drop what's left of text and symbols: small, compact pieces.
  const wc = components(walls, W, H, 1, true)
  const keepComp = wc.boxes.map((b, id) => {
    const len = Math.max(b.maxX - b.minX, b.maxY - b.minY) + 1
    return len >= long * 0.05 || (len >= long * 0.025 && wc.sizes[id] >= len * 3)
  })
  for (let i = 0; i < N; i++) if (walls[i] && !keepComp[wc.labels[i]]) walls[i] = 0

  if (debug) Object.assign(debug, { ink, walls: walls.slice(), windowPixels, W, H })
  return { W, H, walls, windowPixels, t, angle, style }
}

/** Rooms, doorways and windows from found walls. `gap` is the largest doorway, as a fraction of the image's long side. */
export function planRooms(pw: PlanWalls, gap: number, debug?: Record<string, unknown>): PlanDetection {
  const { W, H, walls, windowPixels, t, angle, style } = pw
  const N = W * H
  const long = Math.max(W, H)

  // 5. Doorways.
  const doorsAdded = closeDoorways(walls, W, H, Math.round(long * gap), Math.max(6, t * 1.8))
  const closed = walls.slice()
  for (let i = 0; i < N; i++) if (doorsAdded[i]) closed[i] = 1
  if (debug) Object.assign(debug, { closed, doorsAdded })

  // 6. Rooms: enclosed spaces.
  const regions = components(closed, W, H, 0, false)
  const eps = Math.max(1, t * 0.3)
  const minEdge = Math.max(2, t * 1.2)
  const minSize = Math.max(N * 0.0008, (t * 4) ** 2)
  const candidates: { raw: Point[]; poly: Point[]; fill: number }[] = []
  regions.sizes.forEach((size, id) => {
    if (regions.touchesBorder[id] || size < minSize) return
    const b = regions.boxes[id]
    // Slivers (e.g. inside a wall that wasn't filled) aren't rooms.
    if (size / (Math.max(b.maxX - b.minX, b.maxY - b.minY) + 1) < t * 2) return
    const contour = trace(regions.labels, W, H, id, regions.first[id])
    if (contour.length < 8) return
    const raw = simplifyClosed(contour, eps)
    if (raw.length < 3) return
    const rawArea = area(raw)
    if (rawArea <= 0) return
    const poly = rectangleIfClose(orthogonalize(raw, minEdge), 0.9)
    // The traced outline runs through the room's edge pixels; move it onto the wall face.
    candidates.push({ raw, poly: grow(poly, 0.5), fill: size / rawArea })
  })
  const drop = new Set<number>()
  candidates.forEach((outer, i) => {
    const nested = candidates.map((inner, j) => (j !== i && pointInPolygon(labelPoint(inner.raw), outer.raw) ? j : -1)).filter((j) => j >= 0)
    if (!nested.length) return
    if (outer.fill < 0.6) drop.add(i)
    else nested.forEach((j) => drop.add(j))
  })

  return {
    rooms: candidates.filter((_, i) => !drop.has(i)).map((c) => c.poly),
    doors: segments(doorsAdded, W, H, t * 2.5, t),
    windows: windowPixels ? segments(windowPixels, W, H, t * 2, t) : [],
    wallThickness: t,
    angle,
    style,
  }
}

/** Detect rooms in a floor-plan image, or return null when it doesn't look like one. */
export function detectPlan(img: ImageData, params: PlanParams, debug?: Record<string, unknown>): PlanDetection | null {
  const pw = planWalls(img, params.sensitivity, debug)
  return pw && planRooms(pw, params.gap, debug)
}

/** Push an axis-aligned polygon's edges outward by d. */
function grow(poly: Point[], d: number): Point[] {
  const n = poly.length
  let sa = 0
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    sa += a.x * b.y - b.x * a.y
  }
  const s = sa > 0 ? 1 : -1
  return poly.map((p, i) => {
    const prev = poly[(i - 1 + n) % n]
    const next = poly[(i + 1) % n]
    const n1 = normal(prev, p, s)
    const n2 = normal(p, next, s)
    return { x: p.x + (n1.x + n2.x) * d, y: p.y + (n1.y + n2.y) * d }
  })
}

function normal(a: Point, b: Point, s: number): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l = Math.hypot(dx, dy) || 1
  // Outward for the polygon's winding (y points down).
  return { x: (s * dy) / l, y: (-s * dx) / l }
}
