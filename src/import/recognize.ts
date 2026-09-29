/**
 * On-device room recognition: printed and digital plans (walls drawn thicker than everything
 * else) go to the plan detector; hand sketches (every line about as thin) to the sketch detector.
 * Pure computation, so it can run in a worker.
 */
import type { Point } from '@/model/types'
import { detectRooms } from './detect'
import { planRooms, planWalls } from './plan'
import type { PlanWalls } from './plan'

export type DrawingKind = 'auto' | 'plan' | 'sketch'

export interface RecognizeParams {
  /** Largest doorway to close, as a fraction of the image's long side. */
  gap: number
  /** 0..1: higher picks up fainter lines. */
  sensitivity: number
  kind: DrawingKind
}

export const DEFAULT_RECOGNIZE: RecognizeParams = { gap: 0.12, sensitivity: 0.5, kind: 'auto' }

export interface Recognition {
  /** Which detector read the drawing. */
  kind: 'plan' | 'sketch'
  /** For plans: solid (filled or hatched-and-filled) or outlined walls. */
  style?: 'solid' | 'outlined'
  /** Room outlines in image px, in the straightened frame. */
  rooms: Point[][]
  doors: [Point, Point][]
  windows: [Point, Point][]
  /** Thickness of interior walls in px, when the drawing shows it. */
  wallThickness?: number
  /** Degrees the drawing was tilted; results are in the frame rotated by -angle about the image center. */
  angle: number
}

/** Box-filter downscale so the long side is at most `max` px. */
function downscale(img: ImageData, max: number): ImageData {
  const k = Math.max(img.width, img.height) / max
  if (k <= 1) return img
  const W = Math.max(1, Math.round(img.width / k))
  const H = Math.max(1, Math.round(img.height / k))
  const out = new Uint8ClampedArray(W * H * 4)
  const src = img.data
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y * k)
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * k)))
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x * k)
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * k)))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const j = (yy * img.width + xx) * 4
          r += src[j]
          g += src[j + 1]
          b += src[j + 2]
          a += src[j + 3]
        }
      }
      const n = (y1 - y0) * (x1 - x0)
      const o = (y * W + x) * 4
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = b / n
      out[o + 3] = a / n
    }
  }
  return { data: out, width: W, height: H, colorSpace: 'srgb' } as ImageData
}

/** Recognizes rooms in one image, caching the slow wall analysis between runs. */
export class Recognizer {
  private img: ImageData | null = null
  private walls = new Map<number, PlanWalls | null>()
  private sketchImg: ImageData | null = null

  setImage(img: ImageData) {
    this.img = img
    this.walls.clear()
    this.sketchImg = null
  }

  run(params: RecognizeParams): Recognition {
    const img = this.img
    if (!img) return { kind: 'sketch', rooms: [], doors: [], windows: [], angle: 0 }
    if (params.kind !== 'sketch') {
      if (!this.walls.has(params.sensitivity)) this.walls.set(params.sensitivity, planWalls(img, params.sensitivity))
      const pw = this.walls.get(params.sensitivity)
      if (pw) {
        const det = planRooms(pw, params.gap)
        return { kind: 'plan', ...det }
      }
      if (params.kind === 'plan') return { kind: 'plan', rooms: [], doors: [], windows: [], angle: 0 }
    }
    // The sketch detector is tuned for images up to 900 px.
    this.sketchImg ??= downscale(img, 900)
    const small = this.sketchImg
    const k = img.width / small.width
    const up = (p: Point) => ({ x: p.x * k, y: p.y * k })
    const det = detectRooms(small, { gap: params.gap, sensitivity: params.sensitivity })
    return {
      kind: 'sketch',
      rooms: det.rooms.map((r) => r.map(up)),
      doors: det.doors.map(([a, b]) => [up(a), up(b)] as [Point, Point]),
      windows: [],
      angle: 0,
    }
  }
}
