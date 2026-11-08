import { describe, expect, it } from 'vitest'
import { fittingSpots, headInModel, headOf, headPoint, rainDrop, showerFittings } from './shower'
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

  it('hangs just under the top of the glass until it’s set, then as far down as it’s set', () => {
    // A 200 cm shower under a 280 cm ceiling: its 1.6 cm face 12 cm under the glass's top, at 188, on a 90.4 cm arm.
    expect(rainDrop(shower(90, 90), 280)).toBe(90.4)
    expect(rainDrop(shower(90, 90, { headDrop: 30 }), 280)).toBe(30)
    // Flush with the ceiling, and no lower than its face 170 cm off the floor.
    expect(rainDrop(shower(90, 90, { headDrop: -5 }), 280)).toBe(0)
    expect(rainDrop(shower(90, 90, { headDrop: 150 }), 280)).toBe(108.4)
    // Under a low ceiling, as low as it goes even as usual.
    expect(rainDrop(shower(90, 90, { height: 160 }), 220)).toBe(48.4)
  })

  it('on a wall, is where it was', () => {
    expect(headOf(shower(100, 80, { showerHead: { side: 'back', at: 0.25 } }), ['front'])).toEqual({ side: 'back', at: 0.25 })
  })
})

describe('a shower’s body jets and hand shower', () => {
  // Where they are, in cm from the shower's middle (x right, y toward the front), its glass at the front.
  const where = (sym: PlanSymbol) => {
    const f = showerFittings(sym, ['front'])
    return { jets: f.jets.map((p) => [p.x, p.y]), hand: f.hand && [f.hand.x, f.hand.y] }
  }

  it('are beside the mixer until they’re moved', () => {
    // The head (and its mixer) in the middle of the back wall, 40 cm back: three jets 24 cm to its left, the hand shower
    // 26 cm to its right; six jets either side of it, the hand shower past them.
    expect(where(shower(100, 80, { jets: 3, handShower: 'rail' }))).toEqual({ jets: [[-24, -40]], hand: [26, -40] })
    expect(where(shower(100, 80, { jets: 6, handShower: 'rail' }))).toEqual({ jets: [[-24, -40], [24, -40]], hand: [38, -40] })
    // A rain shower's mixer is on its first wall, in the middle: they're beside it there.
    expect(where(shower(100, 80, { jets: 3, handShower: 'holder', showerHead: { side: 'ceiling', x: 0.2, y: 0.7 } }))).toEqual({ jets: [[-24, -40]], hand: [26, -40] })
  })

  it('go on the wall they’re put on', () => {
    // A quarter of the way along the left wall (80 cm): 20 cm back from its middle, on the wall 50 cm left.
    expect(where(shower(100, 80, { jets: 3, jetsAt: { side: 'left', at: 0.25 } })).jets).toEqual([[-50, -20]])
    // Six: 24 cm either side, kept 8 cm clear of the corners, so their middle no more than 8 cm from the wall's.
    expect(where(shower(100, 80, { jets: 6, jetsAt: { side: 'left', at: 0.25 } })).jets).toEqual([[-50, -32], [-50, 16]])
    expect(where(shower(100, 80, { handShower: 'rail', handAt: { side: 'right', at: 0.5 } })).hand).toEqual([50, 0])
    // Each where it's put, the other by the mixer.
    expect(where(shower(100, 80, { jets: 3, handShower: 'rail', handAt: { side: 'left', at: 0.5 } }))).toEqual({ jets: [[-24, -40]], hand: [-50, 0] })
  })

  it('stay by the mixer if put on a side that’s glass', () => {
    expect(where(shower(100, 80, { jets: 3, jetsAt: { side: 'front', at: 0.25 } })).jets).toEqual([[-24, -40]])
  })

  it('are mirrored with the shower', () => {
    // Put on the left wall of a shower that's flipped: on the plan they're on the left, in its own frame on the right.
    expect(where(shower(100, 80, { flipX: true, jets: 3, jetsAt: { side: 'left', at: 0.25 } })).jets).toEqual([[50, -20]])
  })

  it('in a curved corner shower, go by its mixer near the corner, or on either of its walls', () => {
    const q = (more: Partial<PlanSymbol>) => showerFittings(shower(90, 90, { type: 'shower-quadrant', jets: 3, handShower: 'holder', ...more }), ['front', 'right'])
    // Its mixer on the back wall, a third of the way from the corner (16.2 cm left of the middle): the jets 24 cm further
    // left, stopped 8 cm short of the corner; the hand shower 26 cm right of it.
    const rain = q({ showerHead: { side: 'ceiling' } })
    expect([rain.mixer?.x, rain.mixer?.y]).toEqual([-16.2, -45])
    expect(rain.jets.map((p) => [p.x, p.y])).toEqual([[-37, -45]])
    expect([rain.hand?.x, rain.hand?.y]).toEqual([expect.closeTo(9.8), -45])
    expect(q({ jetsAt: { side: 'left', at: 0.5 } }).jets.map((p) => [p.x, p.y])).toEqual([[-45, 0]])
  })

  it('follow the mixer when it’s moved', () => {
    // The mixer a quarter of the way along the left wall (80 cm), 20 cm back from its middle: the jets 24 cm further
    // back, stopped 8 cm short of the corner (32 cm back); the hand shower 26 cm toward the front of it.
    expect(where(shower(100, 80, { jets: 3, handShower: 'rail', mixerAt: { side: 'left', at: 0.25 } }))).toEqual({ jets: [[-50, -32]], hand: [-50, 6] })
  })

  it('sit on the face of a column on the wall', () => {
    // A column on the back wall from 10 to 40 cm right, its face 25 cm back: the hand shower on it, the jets on the wall.
    const mixer = { x: 0, y: -40, nx: 0, ny: 1 }
    const spots = fittingSpots({ jets: 3, handShower: 'rail' }, mixer, 100, 80, {}, [{ x0: 10, x1: 40, y0: -41.5, y1: -25 }])
    expect(spots.jets.map((p) => [p.x, p.y])).toEqual([[-24, -40]])
    expect([spots.hand?.x, spots.hand?.y]).toEqual([26, -25])
  })
})

describe('a shower’s mixer', () => {
  // Where it is, in cm from the shower's middle (x right, y toward the front).
  const mixer = (sym: PlanSymbol, glass: ('front' | 'back' | 'left' | 'right')[] = ['front']) => {
    const m = showerFittings(sym, glass).mixer
    return m && [Math.round(m.x * 10) / 10, Math.round(m.y * 10) / 10]
  }

  it('is under the head until it’s moved', () => {
    expect(mixer(shower(100, 80))).toEqual([0, -40])
    expect(mixer(shower(100, 80, { showerHead: { side: 'left', at: 0.25 } }))).toEqual([-50, -20])
  })

  it('goes on the wall it’s put on, the head staying where it is', () => {
    const sym = shower(100, 80, { mixerAt: { side: 'right', at: 0.5 } })
    expect(mixer(sym)).toEqual([50, 0])
    expect(headOf(sym, ['front'])).toEqual({ side: 'back', at: 0.5 })
    // Kept 12 cm from the corner, as a head is: put right in it, 12 cm in from the left end of the back wall.
    expect(mixer(shower(100, 80, { mixerAt: { side: 'back', at: 0 } }))).toEqual([-38, -40])
  })

  it('stays under the head if put on a side that’s glass', () => {
    expect(mixer(shower(100, 80, { mixerAt: { side: 'front', at: 0.25 } }))).toEqual([0, -40])
  })

  it('with the head from the ceiling, is on the first wall until it’s moved', () => {
    expect(mixer(shower(100, 80, { showerHead: { side: 'ceiling' } }))).toEqual([0, -40])
    expect(mixer(shower(100, 80, { showerHead: { side: 'ceiling' }, mixerAt: { side: 'left', at: 0.25 } }))).toEqual([-50, -20])
    // Glass all round: no wall for it.
    expect(mixer(shower(100, 80, { mixerAt: { side: 'left', at: 0.25 } }), ['front', 'back', 'left', 'right'])).toBeUndefined()
  })

  it('is mirrored with the shower', () => {
    // Put on the left wall of a shower that's flipped: on the plan it's on the left, in its own frame on the right.
    expect(mixer(shower(100, 80, { flipX: true, mixerAt: { side: 'left', at: 0.25 } }))).toEqual([50, -20])
  })

  it('in a curved corner shower, goes on either of its walls', () => {
    const q = (more: Partial<PlanSymbol>) => mixer(shower(90, 90, { type: 'shower-quadrant', showerHead: { side: 'ceiling' }, ...more }), ['front', 'right'])
    // A third of the way along its back from the corner until it's moved: 16.2 cm left of the middle.
    expect(q({})).toEqual([-16.2, -45])
    expect(q({ mixerAt: { side: 'left', at: 0.5 } })).toEqual([-45, 0])
    // Its glass isn't a wall.
    expect(q({ mixerAt: { side: 'right', at: 0.5 } })).toEqual([-16.2, -45])
  })
})
