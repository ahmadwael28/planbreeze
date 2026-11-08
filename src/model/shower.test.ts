import { describe, expect, it } from 'vitest'
import { headInModel, headOf, headPoint } from './shower'
import type { PlanSymbol } from './types'

/** A shower `w` × `d` cm, its head as given. */
const shower = (w: number, d: number, more: Partial<PlanSymbol> = {}): PlanSymbol => ({ id: 's', type: 'shower', x: 0, y: 0, width: w, depth: d, height: 200, rotation: 0, flipX: false, flipY: false, ...more })

/** Where its head is from the ceiling, in cm from its middle (x right, y toward the front), as the 3D model puts it. */
const spot = (sym: PlanSymbol, glass: ('front' | 'back' | 'left' | 'right')[] = ['front']) => {
  const p = headPoint(headInModel(sym, headOf(sym, glass)), sym.width, sym.depth)
  return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }
}

describe('a rain shower’s head', () => {
  it('hangs over the middle until it’s moved', () => {
    expect(spot(shower(100, 80, { showerHead: { side: 'ceiling' } }))).toEqual({ x: 0, y: 0 })
  })

  it('goes where it’s put over the shower', () => {
    // A quarter of the way across from the left, three quarters of the way to the front.
    expect(spot(shower(100, 80, { showerHead: { side: 'ceiling', x: 0.25, y: 0.75 } }))).toEqual({ x: -25, y: 20 })
  })

  it('keeps its face clear of the shower’s sides', () => {
    // Round: 17 cm in. Rectangular (along the width): 25 cm in across, 16 back to front.
    expect(spot(shower(100, 80, { showerHead: { side: 'ceiling', x: 0, y: 1 } }))).toEqual({ x: -33, y: 23 })
    expect(spot(shower(100, 80, { headShape: 'rectangle', showerHead: { side: 'ceiling', x: 1, y: 0 } }))).toEqual({ x: 25, y: -24 })
    // A shower too small for that: over the middle.
    expect(spot(shower(30, 30, { showerHead: { side: 'ceiling', x: 0, y: 0 } }))).toEqual({ x: 0, y: 0 })
  })

  it('is mirrored with the shower', () => {
    // Put on the left of a shower that's flipped: on the plan it's on the left, in its own frame on the right.
    expect(spot(shower(100, 80, { flipX: true, showerHead: { side: 'ceiling', x: 0.25, y: 0.5 } }))).toEqual({ x: 25, y: 0 })
  })

  it('stays inside a curved corner shower’s glass', () => {
    const q = (more: Partial<PlanSymbol>) => shower(90, 90, { type: 'shower-quadrant', ...more })
    // Over the middle of its box, which is inside the curve: left there.
    expect(spot(q({ showerHead: { side: 'ceiling' } }))).toEqual({ x: 0, y: 0 })
    // Out at the far corner, past the glass: brought in along the way from the corner its walls meet in.
    const far = spot(q({ showerHead: { side: 'ceiling', x: 1, y: 1 } }))
    const fromCorner = Math.hypot((far.x + 45) / 90, (far.y + 45) / 90)
    expect(fromCorner).toBeLessThanOrEqual(1 - 17 / 90 + 1e-3)
    expect(far.x).toBeCloseTo(far.y)
  })

  it('on a wall, is where it was', () => {
    expect(headOf(shower(100, 80, { showerHead: { side: 'back', at: 0.25 } }), ['front'])).toEqual({ side: 'back', at: 0.25 })
  })
})
