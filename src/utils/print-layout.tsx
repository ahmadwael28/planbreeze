/** Page layout for printing to scale, shared by the print preview and the PDF writer. */
import { PlanLayers } from '@/components/PlanLayers'
import { bbox } from '@/model/geometry'
import { floorBounds } from '@/model/project'
import { SYMBOL_MAP } from '@/model/symbols'
import { LIGHT_THEME } from '@/model/theme'
import type { PlanTheme } from '@/model/theme'
import type { Floor, PlanLayer, Units } from '@/model/types'

export const PAPERS = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  Letter: [215.9, 279.4],
  Tabloid: [279.4, 431.8],
} as const
export type Paper = keyof typeof PAPERS

export const METRIC_SCALES = [20, 25, 50, 75, 100, 150, 200, 250, 500]
export const IMPERIAL_SCALES = [24, 48, 96, 192, 384]
export const scaleLabel = (n: number, units: Units) => {
  // Plain quote marks: the PDF's built-in fonts have no prime symbols.
  const imperial: Record<number, string> = {
    24: `1/2" = 1'`,
    48: `1/4" = 1'`,
    96: `1/8" = 1'`,
    192: `1/16" = 1'`,
    384: `1/32" = 1'`,
  }
  return units === 'imperial' && imperial[n] ? `${imperial[n]} (1:${n})` : `1:${n}`
}

export interface PrintOptions {
  paper: Paper
  orientation: 'portrait' | 'landscape'
  /** 1:N, or 'fit' to pick the largest standard scale that fits. */
  scale: number | 'fit'
  layer: PlanLayer
  floors: 'current' | 'all'
  showDimensions: boolean
  showAreas: boolean
  showWallLengths: boolean
  showFurniture: boolean
  color: boolean
}

export const MARGIN = 10
export const TITLE_H = 20

export interface PageLayout {
  pageW: number
  pageH: number
  /** Drawing area on the page (mm). */
  area: { x: number; y: number; w: number; h: number }
  /** The scale actually used (1:N). */
  scale: number
  /** Smallest scale that would fit. */
  fitScale: number
  fits: boolean
  /** Visible part of the plan (cm). */
  viewBox: { x: number; y: number; w: number; h: number }
  empty: boolean
}

export function layoutPage(floor: Floor, opts: Pick<PrintOptions, 'paper' | 'orientation' | 'scale'>, units: Units): PageLayout {
  const [a, b] = PAPERS[opts.paper]
  const [pageW, pageH] = opts.orientation === 'portrait' ? [a, b] : [b, a]
  const area = { x: MARGIN, y: MARGIN, w: pageW - MARGIN * 2, h: pageH - MARGIN * 2 - TITLE_H }
  const pts = floorBounds(floor)
  const bb = pts.length ? bbox(pts) : { minX: 0, minY: 0, maxX: 500, maxY: 400 }
  const pad = 40
  const bw = bb.maxX - bb.minX + pad * 2
  const bh = bb.maxY - bb.minY + pad * 2
  // cm → mm at 1:N is ×10/N, so the plan fits when N ≥ size_cm × 10 / area_mm.
  const need = Math.max((bw * 10) / area.w, (bh * 10) / area.h)
  const list = units === 'imperial' ? IMPERIAL_SCALES : METRIC_SCALES
  const fitScale = list.find((n) => n >= need) ?? Math.ceil(need / 100) * 100
  const scale = opts.scale === 'fit' ? fitScale : opts.scale
  const vw = (area.w * scale) / 10
  const vh = (area.h * scale) / 10
  const cx = (bb.minX + bb.maxX) / 2
  const cy = (bb.minY + bb.maxY) / 2
  return {
    pageW,
    pageH,
    area,
    scale,
    fitScale,
    fits: scale >= need * 0.999,
    viewBox: { x: cx - vw / 2, y: cy - vh / 2, w: vw, h: vh },
    empty: !pts.length,
  }
}

/** Crisper, print-friendly colors; optionally grayscale. */
export function printTheme(color: boolean): PlanTheme {
  return {
    ...LIGHT_THEME,
    paper: '#ffffff',
    wall: '#1f1f1f',
    ink: '#1f1f1f',
    opening: '#ffffff',
    tint: color ? LIGHT_THEME.tint : () => '#f4f4f5',
  }
}

/** The floor as it should appear on paper (optionally without furniture). */
export function printableFloor(floor: Floor, opts: Pick<PrintOptions, 'showFurniture'>): Floor {
  if (opts.showFurniture) return floor
  return {
    ...floor,
    symbols: floor.symbols.filter((s) => {
      const def = SYMBOL_MAP.get(s.type)
      return s.wall || def?.fixture || def?.category === 'Ceilings' || s.type === 'label'
    }),
  }
}

/** Label size on paper: ~2.6 mm. PlanLayers sizes labels as 12 / scale (in cm). */
export const labelScale = (n: number) => (12 * 10) / (2.6 * n)

export function PrintPlan({ floor, units, layout, opts }: { floor: Floor; units: Units; layout: PageLayout; opts: PrintOptions }) {
  return (
    <PlanLayers
      floor={printableFloor(floor, opts)}
      units={units}
      theme={printTheme(opts.color)}
      scale={labelScale(layout.scale)}
      layer={opts.layer}
      showDimensions={opts.showDimensions}
      showAreas={opts.showAreas}
      showWallLengths={opts.showWallLengths}
      forPrint
    />
  )
}

/** Scale bar: largest round length that stays under ~60 mm on paper. */
export function scaleBar(n: number, units: Units) {
  const steps = units === 'imperial' ? [1, 2, 5, 10, 20, 50, 100] : [0.5, 1, 2, 5, 10, 20, 50]
  const unitMm = units === 'imperial' ? 304.8 : 1000 // one foot / one meter in real mm
  let len = steps[0]
  for (const s of steps) if ((s * unitMm) / n <= 60) len = s
  return { length: len, mm: (len * unitMm) / n, label: units === 'imperial' ? `${len} ft` : `${len} m` }
}
