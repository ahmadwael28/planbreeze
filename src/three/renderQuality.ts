/**
 * How a realistic render (see render.ts) is made, besides its size, and how long it should take on this device: kept
 * apart from the path tracer itself, so the render's dialog can say before it's loaded.
 */

export interface RenderTuning {
  /** How many times light's followed as it bounces. */
  bounces: number
  /**
   * At most this many pixels are traced (the picture's own, if it has fewer): the light on them, smoothed, is spread
   * to the rest, each pixel keeping its own color (see renderFilter). What a render takes goes with this, not its size.
   */
  pixels: number
  /** At most this many lights: those of the room the camera's in, and a few just outside it. */
  maxLights: number
  /** Glass as clear glass, or see-through by chance (grainy, as if frosted). */
  glass: 'clear' | 'alpha'
  /** The size every texture is packed at for the path tracer (px). */
  textureSize: number
}

export const TUNING: RenderTuning = { bounces: 4, pixels: 900_000, maxLights: 12, glass: 'clear', textureSize: 1024 }

/** The size the light's traced at, for a picture's (no bigger than it). */
export function tracedSize(width: number, height: number, pixels: number) {
  const scale = Math.min(1, Math.sqrt(pixels / (width * height)))
  return { scale, width: Math.floor(scale * width), height: Math.floor(scale * height) }
}

const KEY = 'planbreeze.renderSpeed'

/** How long a sample takes this device, per pixel traced (µs), by how many bounces: as the last render found. */
function speeds(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

export function rememberSpeed(bounces: number, perPixel: number) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...speeds(), [bounces]: perPixel }))
  } catch {
    // Not kept: the next render's time just isn't known before it starts.
  }
}

/** About how long a render would take here (ms), if a render's been made here before; or null. */
export function estimate(width: number, height: number, samples: number, tune: Partial<RenderTuning> = {}) {
  const t = { ...TUNING, ...tune }
  const known = speeds()
  // From another bounce count, a bounce more or less a quarter or so slower or quicker.
  const near = Object.keys(known)
    .map(Number)
    .sort((a, b) => Math.abs(a - t.bounces) - Math.abs(b - t.bounces))[0]
  if (near === undefined) return null
  const perPixel = known[near] * (1 + 0.25 * (t.bounces - near))
  const { width: w, height: h } = tracedSize(width, height, t.pixels)
  return (perPixel * w * h * samples) / 1000
}
