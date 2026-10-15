/**
 * Where a shower's head is: on one of its walls, some way along it, or from the ceiling (a rain shower).
 */
import type { PlanSymbol } from './types'

export type ShowerSide = 'front' | 'back' | 'left' | 'right'

/** A curved corner shower's open sides in its own frame: its walls are at the back and on the left. */
const QUADRANT_GLASS: ShowerSide[] = ['front', 'right']

/** A side as seen on the plan, from the shower's own frame (or back: flipping twice is no flip). */
function seen(sym: PlanSymbol, s: ShowerSide): ShowerSide {
  if (sym.flipX && (s === 'left' || s === 'right')) return s === 'left' ? 'right' : 'left'
  if (sym.flipY && (s === 'front' || s === 'back')) return s === 'front' ? 'back' : 'front'
  return s
}

/** A shower's glass sides as seen on the plan: chosen (or `auto`, the ones not against a wall); a curved one's are fixed. */
export function showerGlass(sym: PlanSymbol, auto: () => ShowerSide[]): ShowerSide[] {
  if (sym.type === 'shower-quadrant') return QUADRANT_GLASS.map((s) => seen(sym, s))
  return sym.screens ?? auto()
}

/** The order a head looks for a wall to go on, when it hasn't been placed. */
const ORDER: ShowerSide[] = ['back', 'left', 'right', 'front']

export interface HeadPlace {
  side: ShowerSide | 'ceiling'
  /** How far along the side (0 … 1): left to right along the back or front, back to front along a side. */
  at: number
}

/**
 * Where the head is, as seen on the plan (before the shower's own flips). `glass`: the sides with glass; the head goes
 * on a wall, the one picked or else the first there is, in its middle. With glass all round, it hangs from the middle.
 */
export function headPlace(sym: PlanSymbol, glass: ShowerSide[]): HeadPlace {
  const h = sym.showerHead
  if (h?.side === 'ceiling') return { side: 'ceiling', at: 0.5 }
  if (h && !glass.includes(h.side)) return { side: h.side, at: Math.min(1, Math.max(0, h.at ?? 0.5)) }
  const wall = ORDER.find((s) => !glass.includes(s))
  return wall ? { side: wall, at: 0.5 } : { side: 'ceiling', at: 0.5 }
}

/** A shower's head as seen on the plan: a curved corner shower's sits near the corner unless it's been placed. */
export function headOf(sym: PlanSymbol, glass: ShowerSide[]): HeadPlace {
  if (sym.type === 'shower-quadrant' && !sym.showerHead) return headInModel(sym, { side: 'back', at: 0.32 })
  return headPlace(sym, glass)
}

/** The same in the shower's own frame, which its flips then mirror (see the 3D model and the plan symbol). */
export function headInModel(sym: PlanSymbol, place: HeadPlace): HeadPlace {
  let { side, at } = place
  if (side === 'ceiling') return place
  if (sym.flipX) {
    if (side === 'left' || side === 'right') side = side === 'left' ? 'right' : 'left'
    else at = 1 - at
  }
  if (sym.flipY) {
    if (side === 'front' || side === 'back') side = side === 'front' ? 'back' : 'front'
    else at = 1 - at
  }
  return { side, at }
}

/**
 * The head's spot on its wall, in a w × d shower's frame (x right, y toward the front, from its middle), kept clear
 * of the corners, and the way into the shower from there. The middle for a ceiling head.
 */
export function headPoint(place: HeadPlace, w: number, d: number): { x: number; y: number; nx: number; ny: number } {
  const clear = (len: number) => Math.min(0.5, 12 / Math.max(len, 1))
  const along = (len: number) => -len / 2 + len * Math.min(1 - clear(len), Math.max(clear(len), place.at))
  switch (place.side) {
    case 'back':
      return { x: along(w), y: -d / 2, nx: 0, ny: 1 }
    case 'front':
      return { x: along(w), y: d / 2, nx: 0, ny: -1 }
    case 'left':
      return { x: -w / 2, y: along(d), nx: 1, ny: 0 }
    case 'right':
      return { x: w / 2, y: along(d), nx: -1, ny: 0 }
  }
  return { x: 0, y: 0, nx: 0, ny: 0 }
}
