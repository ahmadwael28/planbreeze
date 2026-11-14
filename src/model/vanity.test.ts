import { describe, expect, it } from 'vitest'
import { newSymbol } from './project'
import { vanityMirrors } from './symbols'
import type { PlanSymbol } from './types'
import { tiledBasin, vanityBasin, wallSpout } from './vanity'

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
