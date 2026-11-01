/**
 * The editor as a user drives it: opening a plan (brought up to date), dividing a room into two open to each other,
 * and the open walls between rooms kept matched as rooms change.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { area } from '@/model/geometry'
import { SCHEMA_VERSION, newProject, newRoom, newSymbol, rectPoints } from '@/model/project'
import { roomSurfaces, takeoff } from '@/model/takeoff'
import type { Point, Project, Room } from '@/model/types'
import { divideRoom, useEditor } from './editor'

const floor = () => useEditor.getState().project.floors[0]
const room = (id: string) => floor().rooms.find((r) => r.id === id)!
const m2 = (cm2: number) => Math.round(cm2) / 10000

/** A room's walls as segments, and which are open (no wall). */
const walls = (r: Room) => r.points.map((a, i) => ({ a, b: r.points[(i + 1) % r.points.length], open: !!r.openEdges?.includes(i) }))
const same = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) < 0.01
/** The wall of a room from p to q (either way round). */
const wallAt = (r: Room, p: Point, q: Point) => walls(r).find((w) => (same(w.a, p) && same(w.b, q)) || (same(w.a, q) && same(w.b, p)))

/** Open a plan with one 600 × 400 cm room: a door on its top wall, its right wall tiled. */
function openRoom(): Project {
  const p = newProject('Test')
  const f = p.floors[0]
  f.height = 250
  const r = newRoom(f, rectPoints(0, 0, 600, 400), 10)
  r.wallFinishes = [null, { finish: 'ceramic' }, null, null]
  f.rooms.push(r)
  f.symbols.push({ ...newSymbol('door', 0, 0), wall: { roomId: r.id, edge: 0, offset: 450 } })
  useEditor.getState().loadProject(p)
  return p
}

beforeEach(() => {
  useEditor.getState().loadProject(newProject())
})

describe('opening a plan', () => {
  it('brings an older plan up to date', () => {
    const p = newProject('Old')
    delete p.schemaVersion
    p.floors[0].symbols.push({ ...newSymbol('shower-bench', 100, 100), style: 'floating' })
    useEditor.getState().loadProject(p)
    const open = useEditor.getState().project
    expect(open.schemaVersion).toBe(SCHEMA_VERSION)
    expect(open.floors[0].symbols[0].floating).toBe(true)
  })
})

describe('dividing a room', () => {
  it('makes two rooms open to each other along the line', () => {
    openRoom()
    const id = floor().rooms[0].id
    const other = divideRoom(id, { x: 200, y: 0 }, { x: 200, y: 400 })
    expect(other).not.toBeNull()
    const big = room(id)
    const small = room(other!.id)
    expect(area(big.points)).toBe(400 * 400)
    expect(area(small.points)).toBe(200 * 400)
    // The line between them is open on both sides.
    const line: [Point, Point] = [{ x: 200, y: 0 }, { x: 200, y: 400 }]
    expect(wallAt(big, ...line)?.open).toBe(true)
    expect(wallAt(small, ...line)?.open).toBe(true)
    expect(walls(big).filter((w) => w.open)).toHaveLength(1)
    expect(walls(small).filter((w) => w.open)).toHaveLength(1)
  })

  it('keeps doors and per-wall finishes on the walls they were on', () => {
    openRoom()
    const id = floor().rooms[0].id
    const other = divideRoom(id, { x: 200, y: 0 }, { x: 200, y: 400 })!
    const big = room(id)
    // The door (450 cm along the top wall) is in the bigger part, on its top wall.
    const door = floor().symbols.find((s) => s.type === 'door')!
    expect(door.wall!.roomId).toBe(id)
    const top = walls(big)[door.wall!.edge]
    expect(top.a.y).toBe(0)
    expect(top.b.y).toBe(0)
    // The tiled right wall is the bigger part's (x = 600); the smaller part has no tiles.
    const tiled = big.wallFinishes?.flatMap((s, i) => (s?.finish === 'ceramic' ? [walls(big)[i]] : [])) ?? []
    expect(tiled).toHaveLength(1)
    expect(tiled[0].a.x).toBe(600)
    expect(tiled[0].b.x).toBe(600)
    expect(room(other.id).wallFinishes?.some((s) => s?.finish === 'ceramic') ?? false).toBe(false)
  })

  it("measures the same before and after, but for the open line's wall", () => {
    openRoom()
    const id = floor().rooms[0].id
    const before = roomSurfaces(takeoff(floor()), id)
    const other = divideRoom(id, { x: 200, y: 0 }, { x: 200, y: 400 })!
    const parts = takeoff(floor())
    const a = roomSurfaces(parts, id)
    const b = roomSurfaces(parts, other.id)
    expect(m2(a.floor + b.floor)).toBe(m2(before.floor))
    expect(m2(a.ceiling + b.ceiling)).toBe(m2(before.ceiling))
    // No wall along the open line: the walls are the room's, the door still off them.
    expect(m2(a.walls + b.walls)).toBe(m2(before.walls))
    expect(m2(before.walls)).toBe(50 - 1.89)
  })

  it("refuses a line that doesn't cut the room in two", () => {
    openRoom()
    const id = floor().rooms[0].id
    expect(divideRoom(id, { x: 200, y: 0 }, { x: 250, y: 0 })).toBeNull()
    expect(divideRoom(id, { x: 700, y: 0 }, { x: 700, y: 400 })).toBeNull()
    expect(floor().rooms).toHaveLength(1)
  })

  /** Open a plan with one room of this outline. */
  function openShape(points: Point[]) {
    const p = newProject('Shape')
    const f = p.floors[0]
    f.rooms.push(newRoom(f, points, 10))
    useEditor.getState().loadProject(p)
    return floor().rooms[0].id
  }

  it('refuses a line that leaves the room', () => {
    // A U open at the top: arms 0–200 and 400–600, joined along the bottom 300–500.
    const id = openShape([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 300 },
      { x: 400, y: 300 },
      { x: 400, y: 0 },
      { x: 600, y: 0 },
      { x: 600, y: 500 },
      { x: 0, y: 500 },
    ])
    // Across both arms, through the gap between them.
    expect(divideRoom(id, { x: 0, y: 100 }, { x: 600, y: 100 })).toBeNull()
    expect(floor().rooms).toHaveLength(1)
  })

  it('refuses a line through a corner, that would leave a piece touching itself there', () => {
    // An L: 500 × 200 along the top, 250 × 300 under its left half; its inner corner at (250, 200).
    const id = openShape([
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 200 },
      { x: 250, y: 200 },
      { x: 250, y: 500 },
      { x: 0, y: 500 },
    ])
    // From the left wall, through the inner corner, to the top wall (its middle well inside): the smaller part, the
    // new room, would be a piece of each arm meeting only at that corner.
    expect(divideRoom(id, { x: 0, y: 450 }, { x: 450, y: 0 })).toBeNull()
    expect(floor().rooms).toHaveLength(1)
  })
})

describe('open walls kept matched', () => {
  it('splits an open wall where the room across stops, and walls the rest', () => {
    openRoom()
    const id = floor().rooms[0].id
    const other = divideRoom(id, { x: 200, y: 0 }, { x: 200, y: 400 })!
    // The smaller part made shorter: 300 cm of the line still has it across, the last 100 cm doesn't.
    useEditor.getState().commit((d) => {
      d.floors[0].rooms.find((r) => r.id === other.id)!.points = rectPoints(0, 0, 200, 300)
    })
    const big = room(id)
    expect(wallAt(big, { x: 200, y: 0 }, { x: 200, y: 300 })?.open).toBe(true)
    expect(wallAt(big, { x: 200, y: 300 }, { x: 200, y: 400 })?.open).toBe(false)
    // Its walls: 400 + 400 + 400 round, and the 100 cm walled again, less the door.
    expect(m2(roomSurfaces(takeoff(floor()), id).walls)).toBe(m2((400 + 400 + 400 + 100) * 250 - 90 * 210))
  })

  it('walls an open wall again when the room across is gone', () => {
    openRoom()
    const id = floor().rooms[0].id
    const other = divideRoom(id, { x: 200, y: 0 }, { x: 200, y: 400 })!
    useEditor.getState().commit((d) => {
      d.floors[0].rooms = d.floors[0].rooms.filter((r) => r.id !== other.id)
    })
    expect(room(id).openEdges ?? []).toEqual([])
  })
})
