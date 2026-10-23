/**
 * What's built against a wall and finished like it (tiles, paint…): a wall-hung toilet's tank box, a shower bench, an
 * alcove filled in round its niches, a vanity built in and tiled. The 3D view clads them (see buildScene) and the
 * takeoff counts their faces (see takeoff), from the same boxes.
 */
import { openSides } from './guides'
import { ownWalls, showerRuns, stretchBox } from './shower'
import { alcoveOpenings, alcoveSolids, ledgeHeight, stoneSill, styleOf, tankBoxDepth } from './symbols'
import type { Floor, PlanSymbol } from './types'

/** A shower bench's stone top (cm), and how thick a floating one is under it. */
export const BENCH_TOP = 3
export const FLOATING_BENCH = 9

/** A vanity's top (cm); and a built-in, tiled one hung on the wall: how deep a box it is under its top. */
export const VANITY_TOP = 3
export const TILED_VANITY = 35

/** The box of what's built against a wall, in the item's frame (see builtBox). */
export interface BuiltBox {
  /** How far out from the wall it comes. */
  depth: number
  /** From and to what heights (cm up from the floor). */
  y0: number
  y1: number
  /** Across a corner (its front the diagonal). */
  corner: boolean
  /** Its underside shows. */
  under: boolean
  /** Built in stretches (from and to), not all of y0 to y1: round niches, their sills (up) and tops (down) showing. */
  spans?: [number, number][]
  caps?: { y: number; up: boolean }[]
}

/**
 * The box of what's built against a wall and finished like it, in the item's frame (under a ceiling `ceilingH` high):
 * how far out from the wall, from and to what heights, whether it's across a corner (its front the diagonal) and
 * whether its underside shows. A wall-hung toilet's tank box (to its shelf or the ceiling), a shower bench (to its
 * stone top), an alcove's niches built round, a vanity built in and tiled (to its top). None for anything else.
 */
export function builtBox(sym: PlanSymbol, ceilingH: number): BuiltBox | null {
  if (sym.type === 'alcove-niche') {
    const spans = alcoveSolids(sym, ceilingH)
    if (!spans.length) return null
    // The tops and undersides of what's built that show (not at the floor or the ceiling); a niche's sill not, under
    // a stone one.
    const sills = new Set(alcoveOpenings(sym, ceilingH).map(([a]) => a))
    const caps = spans.flatMap(([y0, y1]) => [
      ...(y0 > 0.5 ? [{ y: y0, up: false }] : []),
      ...(y1 < ceilingH - 0.5 && !(stoneSill(sym) && sills.has(y1)) ? [{ y: y1, up: true }] : []),
    ])
    return { depth: sym.depth, y0: spans[0][0], y1: spans[spans.length - 1][1], corner: false, under: false, spans, caps }
  }
  if (sym.type === 'toilet' && sym.mount === 'wall' && sym.tankBox !== 'none') {
    return { depth: tankBoxDepth(sym), y0: 0, y1: sym.tankBox === 'full' ? ceilingH : Math.min(ledgeHeight(sym), ceilingH), corner: false, under: false }
  }
  if (sym.type === 'shower-bench') {
    const style = styleOf(sym)
    if (style === 'fold-down') return null
    const y1 = sym.height - BENCH_TOP
    return { depth: sym.depth, y0: sym.floating ? y1 - FLOATING_BENCH : 0, y1, corner: style === 'corner', under: !!sym.floating }
  }
  if (sym.type === 'bath-vanity' && styleOf(sym) === 'tiled') {
    const y1 = sym.height - VANITY_TOP
    return { depth: sym.depth, y0: sym.onFloor ? 0 : Math.max(0, y1 - TILED_VANITY), y1, corner: false, under: !sym.onFloor }
  }
  return null
}

/**
 * The half wall a shower's fixed glass stands on (see PlanSymbol.halfWall): the boxes it's built of, `halfWall` high,
 * in the shower's frame as it's placed (x across, z from its back to its front; its flips applied).
 */
export function halfWallBoxes(sym: PlanSymbol, floor: Floor): { x0: number; x1: number; z0: number; z1: number }[] {
  if (sym.type !== 'shower' || !sym.halfWall) return []
  const fx = sym.flipX ? -1 : 1
  const fz = sym.flipY ? -1 : 1
  const runs = showerRuns(sym, sym.screens ?? openSides(sym, floor.rooms), floor.symbols)
  return ownWalls(sym, runs).map((st) => {
    const b = stretchBox(st, sym.width, sym.depth)
    const [x0, x1] = [fx * b.x0, fx * b.x1].sort((p, q) => p - q)
    const [z0, z1] = [fz * b.y0, fz * b.y1].sort((p, q) => p - q)
    return { x0, x1, z0, z1 }
  })
}
