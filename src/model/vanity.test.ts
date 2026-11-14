import { describe, expect, it } from 'vitest'
import { newFloor, newRoom, newSymbol, rectPoints } from './project'
import { vanityCeiling } from './stacking'
import { vanityLight, vanityMirrors } from './symbols'
import type { PlanSymbol } from './types'
import { chooseBasin, tiledBasin, vanityBasin, wallSpout } from './vanity'

/** A vanity 100 cm wide, 48 deep and 85 high. */
const vanity = (more: Partial<PlanSymbol> = {}): PlanSymbol => ({ ...newSymbol('bath-vanity', 0, 0), width: 100, depth: 48, height: 85, ...more })

describe('a vanity’s basins', () => {
  it('are built into its top unless chosen; a tiled one’s, bowls on its stone top', () => {
    expect(vanityBasin(vanity())).toBe('integrated')
    expect(vanityBasin(vanity({ style: 'tiled' }))).toBe('vessel')
    expect(vanityBasin(vanity({ basin: 'undermount' }))).toBe('undermount')
  })

  it('are of its tiles only when it’s built in and tiled', () => {
    expect(vanityBasin(vanity({ style: 'tiled', basin: 'tiled' }))).toBe('tiled')
    expect(vanityBasin(vanity({ style: 'drawers', basin: 'tiled' }))).toBe('integrated')
  })

  it('of its tiles: one faucet’s up to 60 cm where its sink is, two faucets’ a trough 12 cm in from its ends', () => {
    // 26 cm front to back (48 − 22), starting 12 cm out from its back (at −24).
    expect(tiledBasin(vanity())).toEqual({ x0: -30, x1: 30, z0: -12, z1: 14, depth: 12, faucets: [0] })
    // To the left: as far as it goes, 12 cm in from the end: −50 + 12 = −38 to 22.
    expect(tiledBasin(vanity({ sinkAt: 'left' }))).toMatchObject({ x0: -38, x1: 22, faucets: [-8] })
    // 100 − 24 = 76 wide, a faucet over the middle of each half.
    expect(tiledBasin(vanity({ faucets: 2 }))).toMatchObject({ x0: -38, x1: 38, faucets: [-19, 19] })
  })
})

describe('choosing a vanity’s basin', () => {
  it('of its tiles makes it built in and tiled, and another takes it back to the cabinet it was', () => {
    const v = vanity({ style: 'fluted' })
    chooseBasin(v, 'tiled')
    expect([v.style, v.basin, vanityBasin(v)]).toEqual(['tiled', 'tiled', 'tiled'])
    chooseBasin(v, 'undermount')
    expect([v.style, v.basin, v.styleBefore]).toEqual(['fluted', 'undermount', undefined])
    // The usual cabinet, it had none chosen.
    const plain = vanity()
    chooseBasin(plain, 'tiled')
    chooseBasin(plain, 'integrated')
    expect([plain.style, plain.basin, vanityBasin(plain)]).toEqual([undefined, undefined, 'integrated'])
  })

  it('on a vanity chosen to be built in and tiled, keeps it so; built into a ceramic top, a cabinet under it', () => {
    const v = vanity({ style: 'tiled' })
    chooseBasin(v, 'undermount')
    expect([v.style, v.basin]).toEqual(['tiled', 'undermount'])
    chooseBasin(v, 'vessel')
    expect([v.style, v.basin, vanityBasin(v)]).toEqual(['tiled', undefined, 'vessel'])
    chooseBasin(v, 'integrated')
    expect([v.style, vanityBasin(v)]).toEqual([undefined, 'integrated'])
  })
})

describe('a vanity’s mirror up to the ceiling', () => {
  it('comes down as a tall one does, goes up to the ceiling and is as wide as the vanity', () => {
    // From 15 cm over its top (100) to just under a 250 cm ceiling: 149.5 high, 100 − 2 = 98 wide.
    const m = vanityMirrors(vanity({ mirror: 'plain', mirrorSize: 'ceiling' }), 250)
    expect(m).toEqual([{ x: 0, y: 100, w: 98, h: 149.5, shape: 'rect' }])
    // Under a gypsum ceiling 20 cm lower.
    expect(vanityMirrors(vanity({ mirror: 'plain', mirrorSize: 'ceiling' }), 230)[0].h).toBe(129.5)
  })

  it('stops under a gypsum ceiling lowered along the wall behind it, though not over the vanity', () => {
    // A 300 × 200 cm bathroom 250 cm high, its tray ceiling 25 cm down in a 20 cm band along the walls.
    const floor = newFloor('Ground floor')
    floor.height = 250
    const room = newRoom(floor, rectPoints(0, 0, 300, 200), 10)
    room.ceiling = { style: 'tray', drop: 25, band: 20 }
    floor.rooms.push(room)
    // Its back on the wall at y = 0: its middle (24 cm out) is under the slab, the wall behind it under the band.
    const v = vanity({ x: 150, y: 24, mirror: 'plain', mirrorSize: 'ceiling' })
    expect(vanityCeiling(v, floor)).toBe(225)
    // From 100 cm up to just under it: 225 − 0.5 − 100.
    expect(vanityMirrors(v, vanityCeiling(v, floor))[0].h).toBe(124.5)
    // Flipped, against the wall at y = 200; 5 cm out from it, all the same.
    expect(vanityCeiling({ ...v, y: 176, flipY: true }, floor)).toBe(225)
    expect(vanityCeiling({ ...v, y: 29 }, floor, 5)).toBe(225)
    // With no gypsum ceiling, the room's.
    delete room.ceiling
    expect(vanityCeiling(v, floor)).toBe(250)
  })

  it('keeps any mirror under a low ceiling', () => {
    // A tall one would go up to 215 cm: under a 200 cm ceiling, 99.5 high from 100.
    expect(vanityMirrors(vanity({ mirror: 'plain', mirrorSize: 'tall' }), 200)[0].h).toBe(99.5)
    expect(vanityMirrors(vanity({ mirror: 'plain', mirrorSize: 'tall' }))[0].h).toBe(115)
  })

  it('has no bar light over it: lit from behind instead', () => {
    expect(vanityLight(vanity({ mirror: 'plain', mirrorSize: 'ceiling', led: true, mirrorLight: 'bar' }))).toBe('back')
    expect(vanityLight(vanity({ mirror: 'plain', led: true, mirrorLight: 'bar' }))).toBe('bar')
  })
})

describe('a vanity’s faucets built into the wall', () => {
  it('have their spouts clear of a bowl standing on the top', () => {
    expect(wallSpout(vanity())).toBe(14)
    expect(wallSpout(vanity({ basin: 'vessel' }))).toBe(20)
  })

  it('keep a mirror coming down low above them', () => {
    // A tall mirror comes down to 15 cm over the top (100); over a faucet in the wall, to 7 cm over its spout.
    const tall = { mirror: 'plain' as const, mirrorSize: 'tall' as const }
    expect(vanityMirrors(vanity(tall))[0].y).toBe(100)
    expect(vanityMirrors(vanity({ ...tall, faucetOn: 'wall' }))[0].y).toBe(85 + 14 + 7)
    expect(vanityMirrors(vanity({ ...tall, faucetOn: 'wall', basin: 'vessel' }))[0].y).toBe(85 + 20 + 7)
    // A mirror cabinet, 30 cm over the top, is clear of them already.
    expect(vanityMirrors(vanity({ faucetOn: 'wall' }))[0].y).toBe(115)
  })
})
