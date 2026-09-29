export interface LoadedImage {
  name: string
  /** JPEG data URL, long side ≤ STORE_MAX px (kept as the tracing background). */
  url: string
  width: number
  height: number
  /** Smaller copy for room detection. */
  work: ImageData
  /** Image px per working px. */
  workScale: number
}

const STORE_MAX = 1600
const WORK_MAX = 900
const AI_MAX = 1568

function canvasFor(src: CanvasImageSource, w: number, h: number, maxSide: number) {
  const s = Math.min(1, maxSide / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * s))
  canvas.height = Math.max(1, Math.round(h * s))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#ffffff' // flatten transparency onto white paper
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
  return { canvas, ctx }
}

async function decode(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch {
    throw new Error('This image format could not be read. Try a JPEG or PNG (iPhone HEIC photos may need converting).')
  }
  if (!img.naturalWidth) throw new Error('The image appears to be empty.')
  return img
}

export async function loadImage(source: Blob | string, name: string): Promise<LoadedImage> {
  const objectUrl = typeof source === 'string' ? source : URL.createObjectURL(source)
  try {
    const img = await decode(objectUrl)
    // SVGs without explicit size report 0 × 0 in some browsers; give them a sensible default.
    const w = img.naturalWidth || 1000
    const h = img.naturalHeight || 1000
    const stored = canvasFor(img, w, h, STORE_MAX)
    const work = canvasFor(stored.canvas, stored.canvas.width, stored.canvas.height, WORK_MAX)
    return {
      name,
      url: stored.canvas.toDataURL('image/jpeg', 0.85),
      width: stored.canvas.width,
      height: stored.canvas.height,
      work: work.ctx.getImageData(0, 0, work.canvas.width, work.canvas.height),
      workScale: stored.canvas.width / work.canvas.width,
    }
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(objectUrl)
  }
}

/** Base64 JPEG sized for the vision model. */
export async function imageForAi(img: LoadedImage): Promise<{ data: string; mediaType: 'image/jpeg' }> {
  const el = await decode(img.url)
  const { canvas } = canvasFor(el, el.naturalWidth, el.naturalHeight, AI_MAX)
  return { data: canvas.toDataURL('image/jpeg', 0.9).split(',')[1], mediaType: 'image/jpeg' }
}
