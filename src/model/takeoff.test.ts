/**
 * The takeoff against numbers worked out by hand: plain rooms, what's cut into their walls, what stands in them, stairs
 * through the floor above; and every kind of item in the library accounted for.
 */
import { describe, expect, it } from 'vitest'
import { newFloor, newRoom, newSymbol, rectPoints, SLAB } from './project'
import { roomSurfaces, skirting, takeoff, unaccounted } from './takeoff'
import type { Floor, PlanSymbol, Point, Room } from './types'

/** cm² in m², to the nearest cm² as the takeoff's own rounding would show it. */
const m2 = (cm2: number) => Math.round(cm2) / 10000

/** A floor 250 cm high with these rooms (walls 10 cm thick). */
function floorOf(...rooms: Point[][]): Floor {
  const f = newFloor('Ground floor')
  f.height = 250
  for (const pts of rooms) f.rooms.push(newRoom(f, pts, 10))
  return f
}

/** An item on a room's wall: `offset` from the wall's start to its middle. */
function onWall(type: string, room: Room, edge: number, offset: number): PlanSymbol {
  return { ...newSymbol(type, 0, 0), wall: { roomId: room.id, edge, offset } }
}

/** A room's floor, walls and ceiling in m². */
function surfaces(floor: Floor, room = floor.rooms[0], below?: Floor, above = false) {
  const s = roomSurfaces(takeoff(floor, below, above), room.id)
  return { floor: m2(s.floor), walls: m2(s.walls), ceiling: m2(s.ceiling) }
}

describe('takeoff', () => {
  it('measures a plain 300 × 200 cm room with 250 cm walls', () => {
    expect(surfaces(floorOf(rectPoints(0, 0, 300, 200)))).toEqual({ floor: 6, walls: 25, ceiling: 6 })
  })

  it('measures an L-shaped room', () => {
    // 500 × 200 and 250 × 200 under it: 15 m², 18 m round.
    const L = [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 200 },
      { x: 250, y: 200 },
      { x: 250, y: 400 },
      { x: 0, y: 400 },
    ]
    expect(surfaces(floorOf(L))).toEqual({ floor: 15, walls: 45, ceiling: 15 })
  })

  it('takes a door off the walls', () => {
    const f = floorOf(rectPoints(0, 0, 300, 200))
    f.symbols.push(onWall('door', f.rooms[0], 0, 150))
    // 90 × 210 cm.
    expect(surfaces(f).walls).toBe(25 - 1.89)
  })

  it('takes a window off the walls and adds its reveals', () => {
    const f = floorOf(rectPoints(0, 0, 300, 200))
    f.symbols.push(onWall('window', f.rooms[0], 0, 150))
    // 120 × 120 cm off; its sides and head half the wall's 10 cm deep: 2 × 5 × 120 + 120 × 5 = 1800 cm².
    expect(surfaces(f).walls).toBe(25 - 1.44 + 0.18)
  })

  it('takes a door off the walls of both rooms it joins', () => {
    const f = floorOf(rectPoints(0, 0, 300, 200), rectPoints(310, 0, 300, 200))
    f.symbols.push(onWall('door', f.rooms[0], 1, 100))
    expect(surfaces(f, f.rooms[0]).walls).toBe(23.11)
    expect(surfaces(f, f.rooms[1]).walls).toBe(23.11)
  })

  it('counts a column standing in a room', () => {
    const f = floorOf(rectPoints(0, 0, 300, 200))
    f.symbols.push(newSymbol('column', 150, 100))
    // 30 × 30 cm, floor to ceiling: off the floor and the ceiling, its four sides finished like the walls.
    expect(surfaces(f)).toEqual({ floor: 5.91, walls: 25 + 3, ceiling: 5.91 })
  })

  describe('stairs', () => {
    /** A ground floor with stairs `high` cm high in a 300 × 400 room, and a first floor the same over it. */
    function twoFloors(high: number) {
      const ground = floorOf(rectPoints(0, 0, 300, 400))
      ground.symbols.push({ ...newSymbol('stairs', 60, 150), height: high })
      return { ground, first: floorOf(rectPoints(0, 0, 300, 400)) }
    }

    it('cut their footprint out of the floor above and the ceiling below', () => {
      const { ground, first } = twoFloors(250 + SLAB)
      // 100 × 280 cm.
      expect(surfaces(first, first.rooms[0], ground).floor).toBe(12 - 2.8)
      expect(surfaces(ground, ground.rooms[0], undefined, true).ceiling).toBe(12 - 2.8)
    })

    it("cut nothing when they're a few steps", () => {
      const { ground, first } = twoFloors(100)
      expect(surfaces(first, first.rooms[0], ground).floor).toBe(12)
      expect(surfaces(ground, ground.rooms[0], undefined, true).ceiling).toBe(12)
    })
  })

  it('runs skirting round the walls but in doorways', () => {
    const f = floorOf(rectPoints(0, 0, 300, 200))
    expect(skirting(f).get(f.rooms[0].id)).toBe(1000)
    const g = floorOf(rectPoints(0, 0, 300, 200))
    g.symbols.push(onWall('door', g.rooms[0], 0, 150))
    expect(skirting(g).get(g.rooms[0].id)).toBe(1000 - 90)
  })

  describe('a vanity built in and tiled', () => {
    /**
     * A 300 × 200 cm room tiled in porcelain to the ceiling, and a vanity 100 cm wide, 48 deep and 85 high hung on its
     * back wall, built in and tiled like it.
     */
    function tiledVanity(more: Partial<PlanSymbol> = {}) {
      const f = floorOf(rectPoints(0, 0, 300, 200))
      f.rooms[0].walls = { finish: 'porcelain' }
      f.symbols.push({ ...newSymbol('bath-vanity', 150, 24), width: 100, depth: 48, height: 85, style: 'tiled', ...more })
      const parts = takeoff(f)
      return { walls: surfaces(f).walls, stone: parts.filter((p) => p.place === 'stone').map((p) => [p.what, m2(p.area)]) }
    }

    it('on a stone top: its front, sides and underside tiled, the wall behind it not', () => {
      // A 35 cm box under the 3 cm top: its front and both sides 100 + 2 × 48 = 196 cm round × 35 = 6860 cm²; its
      // underside 100 × 48 = 4800; less the wall behind it, 100 × 35 = 3500. The top 100 × 48 in stone.
      expect(tiledVanity()).toEqual({ walls: 25.816, stone: [['Vanity tops', 0.48]] })
    })

    it('with its top tiled too, a basin of the same tiles sunk into it, and no stone', () => {
      // The box 35 cm high up to the top (85): 196 × 35 = 6860, its underside 4800, less 3500 behind it. The basin 60
      // wide (one faucet), 26 front to back, 12 deep: its opening 1560 off the top (4800 − 1560 = 3240), its sides
      // 2 × (60 + 26) × 12 = 2064 and its bottom 1560 lined. 6860 + 4800 − 3500 + 3240 + 2064 + 1560 = 15024 cm².
      expect(tiledVanity({ basin: 'tiled' })).toEqual({ walls: 26.5024, stone: [] })
    })

    it('with two faucets, a trough across it, 12 cm in from its ends', () => {
      // 76 wide: its opening 1976 (top 2824), its sides 2 × (76 + 26) × 12 = 2448, its bottom 1976.
      // 6860 + 4800 − 3500 + 2824 + 2448 + 1976 = 15408 cm².
      expect(tiledVanity({ basin: 'tiled', faucets: 2 })).toEqual({ walls: 26.5408, stone: [] })
    })
  })

  it('has a rule for every kind of item in the library (or knows it does nothing to the surfaces)', () => {
    expect(unaccounted()).toEqual([])
  })
})
