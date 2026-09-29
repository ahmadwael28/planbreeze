import { renderToStaticMarkup } from 'react-dom/server'
import { PlanLayers } from '@/components/PlanLayers'
import { bbox } from '@/model/geometry'
import { floorBounds, uid } from '@/model/project'
import { LIGHT_THEME } from '@/model/theme'
import type { Floor, Project, Units } from '@/model/types'

interface ExportOptions {
  units: Units
  showWallLengths: boolean
  showAreas: boolean
  title?: string
}

/** Render a floor to a standalone SVG document. `pxPerCm` sets the pixel size of the output. */
export function floorToSvg(floor: Floor, pxPerCm: number, opts: ExportOptions) {
  const pts = floorBounds(floor)
  if (!pts.length) throw new Error('This floor is empty — nothing to export.')
  const b = bbox(pts)
  const plan = Math.max(b.maxX - b.minX, b.maxY - b.minY)
  const margin = plan * 0.06 + 30
  const titleSpace = opts.title ? plan * 0.06 : 0
  const x = b.minX - margin
  const y = b.minY - margin - titleSpace
  const w = b.maxX - b.minX + margin * 2
  const h = b.maxY - b.minY + margin * 2 + titleSpace
  // Size labels relative to the plan so they read well at any output size.
  const textScale = 12 / (plan * 0.018)
  const markup = renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={Math.round(w * pxPerCm)}
      height={Math.round(h * pxPerCm)}
      viewBox={`${x} ${y} ${w} ${h}`}
    >
      <rect x={x} y={y} width={w} height={h} fill="#ffffff" />
      {opts.title && (
        <text
          x={x + margin}
          y={y + margin * 0.6 + titleSpace * 0.5}
          fontSize={titleSpace * 0.6}
          fontWeight={600}
          fontFamily="system-ui, sans-serif"
          fill="#111827"
        >
          {opts.title}
        </text>
      )}
      <PlanLayers
        floor={floor}
        units={opts.units}
        theme={LIGHT_THEME}
        scale={textScale}
        showWallLengths={opts.showWallLengths}
        showAreas={opts.showAreas}
      />
    </svg>,
  )
  return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`, width: w * pxPerCm, height: h * pxPerCm }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'floorplan'

export function exportSvg(project: Project, floor: Floor, opts: ExportOptions) {
  const { svg } = floorToSvg(floor, 1, opts)
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${safeName(project.name)}-${safeName(floor.name)}.svg`)
}

export async function exportPng(project: Project, floor: Floor, opts: ExportOptions, longSide = 2400) {
  const b = bbox(floorBounds(floor))
  const plan = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1)
  const { svg, width, height } = floorToSvg(floor, longSide / (plan * 1.2), opts)
  const img = new Image()
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not render image'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width)
    canvas.height = Math.round(height)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error('Could not encode PNG')
    downloadBlob(blob, `${safeName(project.name)}-${safeName(floor.name)}.png`)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function exportJson(project: Project) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `${safeName(project.name)}.floorplan.json`)
}

export async function importJson(file: File): Promise<Project> {
  const data = JSON.parse(await file.text()) as Project
  if (!data || !Array.isArray(data.floors) || !data.floors.length) {
    throw new Error('Not a valid floor plan file.')
  }
  for (const f of data.floors) {
    if (!Array.isArray(f.rooms) || !Array.isArray(f.symbols)) throw new Error('Not a valid floor plan file.')
  }
  const now = Date.now()
  return {
    ...data,
    id: uid(), // import as a new project so nothing is overwritten
    units: data.units === 'imperial' ? 'imperial' : 'metric',
    defaultWallThickness: data.defaultWallThickness || 10,
    createdAt: now,
    updatedAt: now,
  }
}
