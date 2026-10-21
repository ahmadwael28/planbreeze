/**
 * Where a shower's head is: on one of its walls, some way along it, or from the ceiling (a rain shower).
 */
import { LEDGE_SHELF, ledgeHeight, partitionCrown, tankBoxDepth } from './symbols'
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
export function headPoint(place: HeadPlace, w: number, d: number, columns: ColumnBox[] = []): { x: number; y: number; nx: number; ny: number } {
  const clear = (len: number) => Math.min(0.5, 12 / Math.max(len, 1))
  const along = (len: number) => -len / 2 + len * Math.min(1 - clear(len), Math.max(clear(len), place.at))
  const p =
    place.side === 'back'
      ? { x: along(w), y: -d / 2, nx: 0, ny: 1 }
      : place.side === 'front'
        ? { x: along(w), y: d / 2, nx: 0, ny: -1 }
        : place.side === 'left'
          ? { x: -w / 2, y: along(d), nx: 1, ny: 0 }
          : place.side === 'right'
            ? { x: w / 2, y: along(d), nx: -1, ny: 0 }
            : null
  if (!p) return { x: 0, y: 0, nx: 0, ny: 0 }
  // Where a column stands on that wall, on the column's face (out from the wall as far as it is).
  for (const c of columns) {
    if (c.top !== undefined) continue
    if (p.x < c.x0 || p.x > c.x1 || p.y < c.y0 || p.y > c.y1) continue
    if (p.ny > 0) p.y = Math.max(p.y, c.y1)
    else if (p.ny < 0) p.y = Math.min(p.y, c.y0)
    else if (p.nx > 0) p.x = Math.max(p.x, c.x1)
    else p.x = Math.min(p.x, c.x0)
  }
  return p
}

/** A walk-in shower's glass panel along its way in (`len` long): what's left beside it, 50 to 70 cm, is the way in. */
export function walkInPanel(len: number) {
  const open = Math.min(70, Math.max(50, len * 0.4))
  return len - open >= 25 ? len - open : len * 0.5
}

/**
 * A stretch of a straight shower's glass, in its own frame: along `side`, from u0 to u1 (from -len/2: left to right
 * along the back or front, back to front along the left or right).
 */
export interface GlassRun {
  side: ShowerSide
  u0: number
  u1: number
  /** On a half wall or a toilet's tank box: how high its bottom is (cm), sitting on it. On the floor if left out. */
  base?: number
  /** How far in from its side it stands (cm; less than 0: out of the shower): on a half wall, along its middle. 1 if left out. */
  inset?: number
}

/** Columns, free-standing or in a wall, that a shower's glass stops at. */
const COLUMNS = new Set(['column', 'wall-post'])

/**
 * What a shower's glass stops at or sits on: columns (free-standing or in a wall), walls standing on their own (full
 * height or half walls), and the boxes wall-hung toilets' tanks are concealed in.
 */
export const inShowersWay = (s: PlanSymbol) =>
  COLUMNS.has(s.type) || s.type === 'partition' || (s.type === 'toilet' && s.mount === 'wall' && s.tankBox !== 'none')

/**
 * Something in a shower's glass's way (see inShowersWay), as a box in the shower's own frame (x across, y from its
 * back to its front), a touch bigger.
 */
export interface ColumnBox {
  x0: number
  x1: number
  y0: number
  y1: number
  /** Lower than the glass (a half wall, a toilet's box with a shelf): how high it comes up (cm). Up to the ceiling if left out. */
  top?: number
}

/**
 * What's in a shower's glass's way on a floor (columns, walls on their own, toilets' tank boxes), as boxes in the
 * shower's own frame, before its flips.
 */
export function columnBoxes(sym: PlanSymbol, others: PlanSymbol[]): ColumnBox[] {
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
  // A stretch of another piece, y0 to y1 from its back to its front (x across it, all of it), as a box in the shower's
  // frame: turned and mirrored as that piece is.
  const boxOf = (c: PlanSymbol, y0: number, y1: number, top?: number): ColumnBox => {
    const a = (c.rotation * Math.PI) / 180
    const pts = [
      [-c.width / 2, y0],
      [c.width / 2, y0],
      [c.width / 2, y1],
      [-c.width / 2, y1],
    ].map(([x, y]) => {
      const px = c.flipX ? -x : x
      const py = c.flipY ? -y : y
      return local(c.x + px * Math.cos(a) - py * Math.sin(a), c.y + px * Math.sin(a) + py * Math.cos(a))
    })
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const b: ColumnBox = { x0: Math.min(...xs) - TOUCH, x1: Math.max(...xs) + TOUCH, y0: Math.min(...ys) - TOUCH, y1: Math.max(...ys) + TOUCH }
    if (top !== undefined) b.top = top
    return b
  }
  return others
    .filter((c) => c.id !== sym.id && inShowersWay(c))
    .map((c) => {
      // A toilet's box along its back: as high as its shelf, or up to the ceiling.
      if (c.type === 'toilet') return boxOf(c, -c.depth / 2, -c.depth / 2 + tankBoxDepth(c), c.tankBox === 'full' ? undefined : ledgeHeight(c) + LEDGE_SHELF)
      // A half wall with nothing over it, as high as it comes; a wall up to the ceiling, or one with glass over it.
      const low = c.type === 'partition' && c.partial && !c.glassTop
      return boxOf(c, -c.depth / 2, c.depth / 2, low ? partitionCrown(c, Infinity) : undefined)
    })
}

/**
 * Where a straight shower's glass goes, in its own frame (`sides`: its glass sides, in that frame): along each side,
 * but not through a column or a wall standing on its line (or against it: there it's the wall), and sitting on a half
 * wall or a toilet's tank box there (along the middle of a half wall it runs along), each stretch at least a hand's
 * width.
 */

export function glassRuns(sym: PlanSymbol, sides: ShowerSide[], others: PlanSymbol[]): GlassRun[] {
  const w = sym.width
  const d = sym.depth
  const boxes = columnBoxes(sym, others)
  // What comes up nearly as high as the glass does is as good as a wall: no glass on it.
  const wallHigh = (b: ColumnBox) => b.top === undefined || b.top > sym.height - 20
  const out: GlassRun[] = []
  for (const side of sides) {
    const across = side === 'front' || side === 'back'
    const len = across ? w : d
    const at = side === 'front' ? d / 2 : side === 'back' ? -d / 2 : side === 'right' ? w / 2 : -w / 2
    // Which way is into the shower, across this side.
    const inward = side === 'front' || side === 'right' ? -1 : 1
    // What stands on its line, where along it.
    const on = boxes
      .filter((b) => (across ? b.y0 <= at && at <= b.y1 : b.x0 <= at && at <= b.x1))
      .map((b) => ({ b, lo: across ? b.x0 : b.y0, hi: across ? b.x1 : b.y1 }))
    // Between the ends of those: no glass where one's as high as it, on the highest lower one there, else on the floor.
    const cuts = [...new Set([-len / 2, len / 2, ...on.flatMap((o) => [o.lo, o.hi])])].filter((u) => u >= -len / 2 && u <= len / 2).sort((p, q) => p - q)
    for (let i = 0; i + 1 < cuts.length; i++) {
      const u0 = cuts[i]
      const u1 = cuts[i + 1]
      const here = on.filter((o) => o.lo <= (u0 + u1) / 2 && (u0 + u1) / 2 <= o.hi).map((o) => o.b)
      if (here.some(wallHigh)) continue
      const piece: GlassRun = { side, u0, u1 }
      const under = here.reduce<ColumnBox | undefined>((a, b) => (!a || b.top! > a.top! ? b : a), undefined)
      if (under) {
        piece.base = under.top
        // Along a half wall's middle, where it runs along the side (over the end of one across it, on the side's line).
        const [c0, c1] = across ? [under.y0, under.y1] : [under.x0, under.x1]
        if (c1 - c0 < 45) piece.inset = Math.round(((c0 + c1) / 2 - at) * inward * 10) / 10
      }
      const last = out[out.length - 1]
      if (last && last.side === side && last.u1 === u0 && last.base === piece.base && last.inset === piece.inset) last.u1 = u1
      else out.push(piece)
    }
  }
  return out.filter((g) => g.u1 - g.u0 >= 8)
}

/**
 * Where a straight shower's door is: the first side with room for one (front, right, left, back), its longest stretch
 * down to the floor (not glass sitting on a half wall).
 */
export function doorRun(runs: GlassRun[]): GlassRun | undefined {
  const long = (g: GlassRun) => g.u1 - g.u0
  for (const min of [50, 0]) {
    for (const side of ['front', 'right', 'left', 'back'] as const) {
      const on = runs.filter((g) => g.side === side && g.base === undefined && long(g) >= min)
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
