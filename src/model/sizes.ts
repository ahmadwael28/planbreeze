/**
 * Realistic sizes for library items: some sizes can't change at all (a magnetic track's profile), others only within
 * sensible limits, and round items keep their width and depth equal. Items and sizes not listed can be any size.
 */
import { uid } from './project'
import { SYMBOL_MAP } from './symbols'
import type { PlanSymbol, Project, TrackModule } from './types'

export type Dim = 'width' | 'depth' | 'height'
type Rule = 'fixed' | [min: number, max: number]
type Rules = Partial<Record<Dim, Rule>> & { round?: boolean }

const DOOR_HEIGHT: Rule = [180, 300]

/** In cm. For doors and windows the depth is the wall's thickness, so it isn't listed. */
const RULES: Record<string, Rules> = {
  // Doors & windows
  door: { width: [50, 150], height: DOOR_HEIGHT },
  'door-double': { width: [100, 250], height: DOOR_HEIGHT },
  'door-sliding': { width: [100, 600], height: DOOR_HEIGHT },
  'door-barn': { width: [60, 200], height: DOOR_HEIGHT },
  'door-alu': { width: [50, 150], height: DOOR_HEIGHT },
  'door-alu-double': { width: [100, 250], height: DOOR_HEIGHT },
  'door-alu-sliding': { width: [100, 600], height: DOOR_HEIGHT },
  opening: { width: [30, 1000], height: [100, 400] },
  window: { width: [30, 600], height: [30, 300] },
  'window-wide': { width: [60, 600], height: [30, 300] },
  curtain: { width: [40, 1000], depth: [8, 30] },
  blind: { width: [30, 400], depth: [5, 15], height: [40, 300] },
  // Living
  sofa: { width: [120, 400], depth: [70, 120], height: [60, 110] },
  'sofa-corner': { width: [180, 450], depth: [150, 400], height: [60, 110] },
  armchair: { width: [50, 130], depth: [60, 130], height: [60, 120] },
  'coffee-table': { width: [40, 200], depth: [40, 150], height: [25, 60] },
  'sofa-table': { width: [60, 300], depth: [20, 50], height: [55, 90] },
  'tv-unit': { width: [80, 400], depth: [25, 70], height: [30, 90] },
  'tv-stand': { width: [60, 400], depth: [25, 70], height: [30, 90] },
  'display-cabinet': { width: [60, 300], depth: [30, 60], height: [120, 260] },
  sideboard: { width: [80, 300], depth: [35, 60], height: [60, 100] },
  'coffee-corner': { width: [60, 240], depth: [40, 70], height: [150, 260] },
  tv: { width: [50, 250], depth: [3, 15], height: [30, 150] },
  'dining-table': { width: [60, 400], depth: [60, 150], height: [65, 110] },
  'round-table': { width: [50, 200], height: [45, 110], round: true },
  chair: { width: [35, 70], depth: [35, 70], height: [70, 120] },
  bookshelf: { width: [30, 400], depth: [20, 60], height: [50, 300] },
  plant: { width: [15, 200], depth: [15, 200], height: [20, 300] },
  // Bedroom
  'bed-double': { width: [120, 220], depth: [180, 230], height: [25, 70] },
  'bed-single': { width: [70, 140], depth: [180, 220], height: [25, 70] },
  wardrobe: { width: [40, 600], depth: [40, 80], height: [150, 300] },
  'wardrobe-corner': { width: [100, 500], depth: [100, 500], height: [150, 300] },
  nightstand: { width: [30, 80], depth: [25, 60], height: [35, 80] },
  'dressing-table': { width: [70, 180], depth: [35, 60], height: [70, 82] },
  desk: { width: [60, 300], depth: [40, 100], height: [65, 110] },
  // Kitchen
  counter: { width: [30, 1000], depth: [30, 150], height: [70, 110] },
  'kitchen-sink': { width: [40, 200], depth: [40, 120], height: [70, 110] },
  stove: { width: [45, 120], depth: [50, 70], height: [80, 100] },
  fridge: { width: [50, 120], depth: [55, 90], height: [80, 220] },
  // Air conditioning
  'ac-split': { width: [60, 130], depth: [17, 32], height: [24, 36] },
  'ac-cassette': { width: [55, 100], depth: [55, 100], height: [20, 35] },
  'ac-slot': { width: [40, 400], depth: [6, 30] },
  'ac-floor': { width: [35, 65], depth: [22, 45], height: [140, 200] },
  'ac-outdoor': { width: [60, 110], depth: [25, 45], height: [45, 110] },
  // Bathroom
  'bath-vanity': { width: [40, 200], depth: [35, 60], height: [75, 95] },
  'shower-niche': { width: [15, 150], height: [20, 150] },
  'towel-rail': { width: [30, 120], depth: [6, 15], height: [3, 10] },
  'towel-radiator': { width: [35, 80], depth: [6, 15], height: [50, 180] },
  'wall-cabinet': { width: [30, 150], depth: [25, 45], height: [30, 110] },
  dishwasher: { width: [45, 60], depth: [55, 65], height: [80, 95] },
  'kitchen-corner': { width: [80, 130], depth: [80, 130], height: [85, 95] },
  'washing-machine': { width: [55, 70], depth: [45, 70], height: [80, 200] },
  'oven-tower': { width: [60, 90], depth: [55, 65], height: [180, 260] },
  'kitchen-island': { width: [100, 360], depth: [70, 140], height: [85, 110] },
  'range-hood': { width: [50, 150], depth: [30, 70], height: [5, 90] },
  toilet: { width: [35, 50], depth: [45, 75], height: [35, 110] },
  washbasin: { width: [30, 200], depth: [30, 60], height: [60, 100] },
  bathtub: { width: [120, 200], depth: [60, 100], height: [40, 70] },
  shower: { width: [70, 200], depth: [70, 200], height: [180, 250] },
  'shower-quadrant': { width: [70, 120], depth: [70, 120], height: [180, 250] },
  // Electrical and lighting (a switch's or outlet's height is how high it's mounted)
  outlet: { width: 'fixed', depth: 'fixed', height: [10, 200] },
  switch: { width: 'fixed', depth: 'fixed', height: [20, 200] },
  light: { width: [15, 100], height: [3, 30], round: true },
  spot: { width: [6, 30], height: 'fixed', round: true },
  'led-profile': { width: [20, 1000], depth: [2, 12], height: 'fixed' },
  track: { width: [30, 1200], depth: 'fixed', height: 'fixed' },
  pendant: { width: [10, 120], height: [10, 100], round: true },
  'linear-pendant': { width: [40, 300], depth: [4, 30], height: [3, 20] },
  chandelier: { width: [30, 200], height: [30, 150], round: true },
  'wall-light': { width: [8, 80], depth: [5, 30], height: [8, 60] },
  // Ceilings and other
  'gypsum-box': { height: [5, 100] },
  stairs: { width: [60, 300], depth: [150, 800], height: [150, 500] },
  column: { width: [10, 200], depth: [10, 200] },
  beam: { width: [40, 2000], depth: [10, 120], height: [10, 150] },
  'wall-post': { width: [10, 200], depth: [5, 100] },
}

/** The limits on one size of an item (fixed: always its standard size), or null if it can be anything. */
export function sizeRule(type: string, dim: Dim): { min: number; max: number; fixed: boolean } | null {
  const r = RULES[type]?.[dim]
  if (!r) return null
  if (r === 'fixed') {
    const v = SYMBOL_MAP.get(type)?.[dim] ?? 0
    return { min: v, max: v, fixed: true }
  }
  return { min: r[0], max: r[1], fixed: false }
}

/** Round items (spots, round tables…): width and depth are one diameter. */
export const isRound = (type: string) => !!RULES[type]?.round

/** Whether this size can be changed at all. */
export const canResize = (type: string, dim: Dim) => !sizeRule(type, dim)?.fixed

const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * A piece's new size, kept realistic: limits applied, round pieces kept round (following whichever of width and depth
 * changed more), and a magnetic track's modules spread over its new length.
 */
export function resized(sym: PlanSymbol, size: Partial<Record<Dim, number>>): Pick<PlanSymbol, Dim | 'modules'> {
  let { width = sym.width, depth = sym.depth } = size
  const { height = sym.height } = size
  if (isRound(sym.type)) {
    const d = Math.abs(width - sym.width) >= Math.abs(depth - sym.depth) ? width : depth
    width = depth = d
  }
  const fit = (dim: Dim, v: number) => {
    const r = sizeRule(sym.type, dim)
    return r ? Math.min(r.max, Math.max(r.min, v)) : v
  }
  width = fit('width', width)
  depth = isRound(sym.type) ? width : fit('depth', depth)
  const out: Pick<PlanSymbol, Dim | 'modules'> = { width, depth, height: fit('height', height) }
  if (sym.modules) out.modules = SYMBOL_MAP.get(sym.type)?.fixture === 'track' ? spreadModules(sym.modules, sym.width, width) : sym.modules
  return out
}

/**
 * Modules on a track whose length changed from `from` to `to`: as many as fit at the same spacing, evenly spread.
 * New ones carry on the pattern (spot, linear, spot becomes spot, linear, spot, linear, spot). With the same number,
 * they just keep their places relative to the track's length.
 */
export function spreadModules(mods: TrackModule[], from: number, to: number): TrackModule[] {
  if (!mods.length || !from || Math.abs(to - from) < 0.05) return mods
  const sorted = [...mods].sort((a, b) => a.offset - b.offset)
  const n = Math.max(1, Math.round(to / (from / sorted.length)))
  if (n === sorted.length) return sorted.map((m) => ({ ...m, offset: round1((m.offset * to) / from) }))
  const kinds = sorted.map((m) => m.kind)
  // A pattern that starts and ends alike repeats without its last one.
  const period = kinds.length >= 2 && kinds[0] === kinds[kinds.length - 1] ? kinds.slice(0, -1) : kinds
  return Array.from({ length: n }, (_, i) => ({
    id: sorted[i]?.id ?? uid(),
    kind: sorted[i]?.kind ?? period[i % period.length],
    offset: round1(((i + 0.5) * to) / n),
  }))
}

/** Put sizes that can't change back to their standard values and round pieces back to round (older plans). */
export function fixSizes(p: Project): Project {
  let changed = false
  const floors = p.floors.map((f) => {
    const symbols = f.symbols.map((s) => {
      const r = RULES[s.type]
      if (!r) return s
      const fix: Partial<PlanSymbol> = {}
      for (const dim of ['width', 'depth', 'height'] as const) {
        const v = sizeRule(s.type, dim)
        if (v?.fixed && s[dim] !== v.min && !(dim === 'depth' && s.wall)) fix[dim] = v.min
      }
      if (r.round && s.depth !== (fix.width ?? s.width)) fix.depth = fix.width ?? s.width
      if (!Object.keys(fix).length) return s
      changed = true
      return { ...s, ...fix }
    })
    return symbols.some((s, i) => s !== f.symbols[i]) ? { ...f, symbols } : f
  })
  return changed ? { ...p, floors } : p
}
