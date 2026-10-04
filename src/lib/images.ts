import type { ProjectImage } from '@/model/types'

/** Photos decoded for drawing (by image id), and ones that failed to load. */
const decoded = new Map<string, HTMLImageElement>()
const failed = new Set<string>()
const loading = new Map<string, Promise<void>>()

/** A project image ready to draw, if it's been decoded. */
export function readyImage(img: ProjectImage | undefined): HTMLImageElement | undefined {
  return img ? decoded.get(img.id) : undefined
}

function decode(img: ProjectImage): Promise<void> {
  let p = loading.get(img.id)
  if (!p) {
    p = new Promise<void>((resolve) => {
      const el = new Image()
      el.onload = () => {
        decoded.set(img.id, el)
        resolve()
      }
      el.onerror = () => {
        failed.add(img.id)
        resolve()
      }
      el.src = img.src
    })
    loading.set(img.id, p)
  }
  return p
}

/** Decode these images; null when they all are already (or can't be). */
export function loadImages(images: ProjectImage[] | undefined): Promise<void> | null {
  const missing = (images ?? []).filter((i) => !decoded.has(i.id) && !failed.has(i.id))
  return missing.length ? Promise.all(missing.map(decode)).then(() => undefined) : null
}

/** The longest side photos are kept at: sharp enough up close, small enough to save with the plan. */
const MAX_SIDE = 900

/** Read a photo the user picked, scaled down to a JPEG, with its average color. */
export async function readPhoto(file: File, id: string): Promise<ProjectImage> {
  const url = URL.createObjectURL(file)
  try {
    const el = new Image()
    await new Promise((resolve, reject) => {
      el.onload = resolve
      el.onerror = reject
      el.src = url
    })
    const k = Math.min(1, MAX_SIDE / Math.max(el.naturalWidth, el.naturalHeight))
    const w = Math.max(1, Math.round(el.naturalWidth * k))
    const h = Math.max(1, Math.round(el.naturalHeight * k))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(el, 0, 0, w, h)
    const src = canvas.toDataURL('image/jpeg', 0.85)
    // Its average color, from a small copy.
    const n = 24
    const small = document.createElement('canvas')
    small.width = small.height = n
    const sctx = small.getContext('2d')!
    sctx.drawImage(canvas, 0, 0, n, n)
    const px = sctx.getImageData(0, 0, n, n).data
    const sum = [0, 0, 0]
    for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += px[i + c]
    const tone = `#${sum.map((v) => Math.round(v / (n * n)).toString(16).padStart(2, '0')).join('')}`
    const name = file.name.replace(/\.[^.]+$/, '') || 'Photo'
    const img: ProjectImage = { id, name, src, w, h, tone }
    await decode(img)
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}
