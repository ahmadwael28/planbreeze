/**
 * What's drawn over what in the plan. Seen from above, what reaches higher hides what's under it: a wall TV over the
 * TV unit below it, the upper of two switches over the lower one, a person over the sofa they sit on.
 */
import { personSupport } from './people'
import { alcoveSolids, CEILING_AC, LEDGE_SHELF, ledgeHeight, partitionCrown, styleOf, SYMBOL_MAP, vanityMirror, vanityMirrors } from './symbols'
import type { Floor, PlanSymbol } from './types'

/** Items hung from the ceiling wherever they're placed. */
const HUNG = new Set(['curtain', 'blind', ...CEILING_AC])

/** How high an item reaches above its floor, and how high its bottom is (cm). */
export function heightsOf(sym: PlanSymbol, floor: Floor): { top: number; bottom: number } {
  const def = SYMBOL_MAP.get(sym.type)
  const bottom = sym.elevation ?? (def?.wall ? def.sill : def?.elevation) ?? 0
  if (def?.fixture === 'switch') {
    // A switch's height is the middle of its plate.
    const mid = sym.height || 110
    return { top: mid + 6, bottom: mid - 6 }
  }
  if (def?.fixture === 'wall') return { top: bottom + sym.height, bottom }
  // Ceiling lights; pendants hang down to their height.
  if (def?.fixture) return { top: floor.height, bottom: def.elevation !== undefined ? bottom : floor.height - sym.height }
  // Seen from above, a shower is its tray (its glass only round its edges): what stands in it is over it.
  if (sym.type === 'shower' || sym.type === 'shower-quadrant') return { top: 5, bottom }
  // Labels are read over everything.
  if (sym.type === 'label') return { top: 1e6, bottom: 1e6 }
  if (HUNG.has(sym.type)) return { top: floor.height, bottom: floor.height - sym.height }
  // A wall-hung toilet: its box up to the ceiling, or up to its shelf; in the wall, its seat.
  if (sym.type === 'toilet' && sym.mount === 'wall') {
    const box = sym.tankBox ?? 'ledge'
    return { top: box === 'full' ? floor.height : box === 'ledge' ? ledgeHeight(sym) + LEDGE_SHELF : 42, bottom: 0 }
  }
  // A wall standing on its own: up to the ceiling (or its glass is), or as high as it's made (with its shelf).
  if (sym.type === 'partition') return { top: sym.glassTop ? floor.height : partitionCrown(sym, floor.height), bottom: 0 }
  // Niches in an alcove: built up from the floor to the ceiling round them, or just round the niches.
  if (sym.type === 'alcove-niche') {
    const solids = alcoveSolids(sym, floor.height)
    return { top: solids.length ? solids[solids.length - 1][1] : floor.height, bottom: solids.length ? solids[0][0] : 0 }
  }
  // A range hood's chimney goes up to the ceiling.
  if (sym.type === 'range-hood' && styleOf(sym) !== 'built-in') return { top: floor.height, bottom }
  if (sym.type === 'person') {
    const on = personSupport(sym, floor.symbols)
    const seat = on?.height ?? 0
    const pose = sym.pose ?? 'stand'
    const top = seat + (pose === 'stand' ? sym.height : pose === 'sit' ? sym.height * 0.52 : sym.width * 0.45)
    // Always over what they sit or lie on (a bed's headboard may stand higher than someone lying in it).
    return { top: on ? Math.max(top, heightsOf(on.item, floor).top + 0.5) : top, bottom: seat }
  }
  let top = bottom + sym.height
  // What stands above a vanity or dressing table: its mirror cabinet or mirror.
  if (sym.type === 'bath-vanity') top = Math.max(top, ...vanityMirrors(sym).map((m) => m.y + m.h))
  if (sym.type === 'dressing-table') {
    const m = vanityMirror(sym)
    top += m.bottom + m.h
  }
  return { top, bottom }
}

/** Items in the order to draw them in the plan: the lowest first, so the higher ones are drawn over them. */
export function bottomUp(symbols: PlanSymbol[], floor: Floor): PlanSymbol[] {
  const at = new Map(symbols.map((s) => [s.id, heightsOf(s, floor)]))
  return [...symbols].sort((a, b) => {
    const p = at.get(a.id)!
    const q = at.get(b.id)!
    return p.top - q.top || p.bottom - q.bottom
  })
}
