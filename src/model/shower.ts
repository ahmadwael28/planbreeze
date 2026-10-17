/**
 * Where a shower's head is: on one of its walls, some way along it, or from the ceiling (a rain shower).
 */
import type { PlanSymbol } from './types'

export type ShowerSide = 'front' | 'back' | 'left' | 'right'

/** A curved corner shower's open sides in its own frame: its walls are at the back and on the left. */
const QUADRANT_GLASS: ShowerSide[] = ['front', 'right']

/** A side as seen on the plan, from the shower's own frame (or back: flipping twice is no flip). */
export function seen(sym: PlanSymbol, s: ShowerSide): ShowerSide {
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

/**
 * A stretch of a straight shower's glass, in its own frame: along `side`, from u0 to u1 (from -len/2: left to right
 * along the back or front, back to front along the left or right).
 */
export interface GlassRun {
  side: ShowerSide
  u0: number
  u1: number
}

/** Columns, free-standing or in a wall, that a shower's glass stops at. */
const COLUMNS = new Set(['column', 'wall-post'])

/**
 * Where a straight shower's glass goes, in its own frame (`sides`: its glass sides, in that frame): along each side,
 * but not through a column standing on its line (or against it: there the column is the wall), each stretch at least
 * a hand's width.
 */
export function glassRuns(sym: PlanSymbol, sides: ShowerSide[], others: PlanSymbol[]): GlassRun[] {
  const w = sym.width
  const d = sym.depth
  // A plan point in the shower's frame: x across it, y from its back to its front, before its flips.
  const r = (-sym.rotation * Math.PI) / 180
  const local = (x: number, y: number) => {
    const dx = x - sym.x
    const dy = y - sym.y
    const lx = dx * Math.cos(r) - dy * Math.sin(r)
    const ly = dx * Math.sin(r) + dy * Math.cos(r)
    return { x: sym.flipX ? -lx : lx, y: sym.flipY ? -ly : ly }
  }
  const TOUCH = 1.5
  const boxes = others
    .filter((c) => COLUMNS.has(c.type) && c.id !== sym.id)
    .map((c) => {
      const a = (c.rotation * Math.PI) / 180
      const pts = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([sx, sy]) => {
        const px = (sx * c.width) / 2
        const py = (sy * c.depth) / 2
        return local(c.x + px * Math.cos(a) - py * Math.sin(a), c.y + px * Math.sin(a) + py * Math.cos(a))
      })
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      return { x0: Math.min(...xs) - TOUCH, x1: Math.max(...xs) + TOUCH, y0: Math.min(...ys) - TOUCH, y1: Math.max(...ys) + TOUCH }
    })
  const out: GlassRun[] = []
  for (const side of sides) {
    const across = side === 'front' || side === 'back'
    const len = across ? w : d
    const at = side === 'front' ? d / 2 : side === 'back' ? -d / 2 : side === 'right' ? w / 2 : -w / 2
    // What the columns on its line cover, along it.
    const cover = boxes
      .filter((b) => (across ? b.y0 <= at && at <= b.y1 : b.x0 <= at && at <= b.x1))
      .map((b) => (across ? [b.x0, b.x1] : [b.y0, b.y1]))
      .sort((p, q) => p[0] - q[0])
    let u = -len / 2
    for (const [c0, c1] of cover) {
      if (c0 > u) out.push({ side, u0: u, u1: Math.min(c0, len / 2) })
      u = Math.max(u, c1)
    }
    if (u < len / 2) out.push({ side, u0: u, u1: len / 2 })
  }
  return out.filter((g) => g.u1 - g.u0 >= 8)
}

/** Where a straight shower's door is: the first side with room for one (front, right, left, back), its longest stretch. */
export function doorRun(runs: GlassRun[]): GlassRun | undefined {
  const long = (g: GlassRun) => g.u1 - g.u0
  for (const min of [50, 0]) {
    for (const side of ['front', 'right', 'left', 'back'] as const) {
      const on = runs.filter((g) => g.side === side && long(g) >= min)
      if (on.length) return on.reduce((a, b) => (long(b) > long(a) ? b : a))
    }
  }
  return undefined
}

/** A straight shower's glass, in its own frame: on its glass sides as seen on the plan (`seenSides`), round columns. */
export function showerRuns(sym: PlanSymbol, seenSides: ShowerSide[], others: PlanSymbol[]): GlassRun[] {
  return glassRuns(
    sym,
    seenSides.map((s) => seen(sym, s)),
    others,
  )
}
