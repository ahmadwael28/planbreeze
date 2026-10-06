/**
 * What's drawn over what in the plan. Seen from above, what reaches higher hides what's under it: a wall TV over the
 * TV unit below it, the upper of two switches over the lower one, a person over the sofa they sit on.
 */
import { personSupport } from './people'
import { styleOf, SYMBOL_MAP, vanityMirror } from './symbols'
import type { Floor, PlanSymbol } from './types'

/** Items hung from the ceiling wherever they're placed. */
const HUNG = new Set(['curtain', 'blind', 'ac-cassette', 'ac-slot'])

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
  // Labels are read over everything.
  if (sym.type === 'label') return { top: 1e6, bottom: 1e6 }
  if (HUNG.has(sym.type)) return { top: floor.height, bottom: floor.height - sym.height }
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
  if (sym.type === 'bath-vanity' && sym.mirror !== 'none') top += sym.mirror === 'plain' ? 108 : 100
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
