/**
 * A takeoff of the floor's finished surfaces, as a quantity surveyor's is, to buy the right amount of each finish:
 * each room's floor, walls and ceiling, part by part, with what each part is finished with (tiles, planks, paint,
 * wallpaper; ceilings painted, gypsum board where there's a gypsum ceiling), measured as the 3D view builds them.
 *
 * - Floors: the room, less what's built on it (columns, walls standing on their own, boxes, benches, a bath…).
 * - Walls: up to the ceiling (a gypsum one's, or into its pockets and gaps), less doors and windows and what's built
 *   against them; plus what's built and finished like them: columns' sides, niches' linings, window reveals, a toilet's
 *   box, a shower's half wall, a bench, a tiled vanity…
 * - Ceilings: the slab, or the gypsum (its bands, bulkhead sides, cove, panel edges, pockets and gaps, boxes, beams;
 *   a beam in a room tiled up to it is tiled like the walls, and counted with them).
 * - Stone: worktops, a vanity's or a bench's stone top, niches' sills, the shelves on toilets' boxes and half walls;
 *   each in its stone (one of WORKTOPS, or the light stone shelves are), with the length of its front edge.
 *
 * What each kind of item does is its rule (see RULES); a kind that does nothing to them is listed in UNTOUCHED. Every
 * kind in the library is one or the other (checked as the app starts, in development): a new kind that's built, clad,
 * cut into a wall or hung from a ceiling needs its rule, so the takeoff keeps up with it on its own.
 */
import polygonClipping from 'polygon-clipping'
import { beamFinish, builtBox, halfWallBoxes, hangDepth } from './built'
import { aroundColumns, wallColumns } from './developed'
import { finishOf, FINISHES, startsAtFloor, WALL_WHITE, wallBands, wallSurfaceAt } from './finishes'
import { add, area, bbox, dist, inwardNormal, mul, pointInPolygon, projectOnSegment, signedArea } from './geometry'
import {
  bandEdge,
  ceilingDropAt,
  ceilingOutline,
  ceilingRoom,
  ceilingZones,
  COVE_LIP,
  COVE_WIDTH,
  hiddenLightInGap,
  onCeilingJoin,
  PANEL_EDGE,
  SHADOW_GAP,
} from './lighting'
import { isOpen, isOutdoor, roomOuter, symbolPose } from './project'
import type { ResolvedPose } from './project'
import { alcoveOpenings, CEILING_AC, hasWorktop, partitionTop, stoneSill, styleOf, SYMBOL_MAP, SYMBOLS, tankBoxDepth, vanitySinks, worktopOf } from './symbols'
import type { Ceiling, CeilingStyle, Floor, PlanSymbol, Point, Room, Surface, WallSurface } from './types'
import { aroundCuts, cutsFor, nicheDepth, roomFaces, wallBehind, wallOpenings } from './walls'
import type { Opening } from './walls'

export type TakeoffPlace = 'floor' | 'wall' | 'ceiling' | 'stone'

/** A part of a room's finished surfaces. */
export interface TakeoffPart {
  /** The room it's in ('' if it's in none). */
  room: string
  place: TakeoffPlace
  /** What it is, in English (shown translated): "Walls", "Column sides", "Niche lining"… */
  what: string
  /** Its finish (none: a floor with none chosen yet). */
  surface?: Surface
  /** Its area (cm²); less than 0, taken off another part (the wall behind a toilet's box…). */
  area: number
  /** The item it comes from. */
  from?: string
  /** Gypsum board: a dropped ceiling, its bands, sides and boxes. */
  board?: boolean
  /** Stone (place 'stone'): which (a worktop's id, see WORKTOPS, or SHELF_STONE), and how long its front edge is (cm). */
  stone?: string
  length?: number
}

/** The light stone the shelves on toilets' boxes and half walls are made of (see the 3D view's LEDGE_STONE). */
export const SHELF_STONE = 'shelf'

/** Ceilings are painted white, the slab and gypsum alike. */
export const CEILING_PAINT: Surface = { finish: 'paint', color: '#f5f5f4' }
/** Walls with no finish chosen: plain white paint (as the 3D view shows them). */
const PLAIN_WALL: WallSurface = { finish: 'paint', color: WALL_WHITE }

/** How deep a window's reveal is, of its wall's thickness (its frame's in the middle of the wall); an open doorway's is all of it. */
const WINDOW_REVEAL = 0.5

interface Ctx {
  floor: Floor
  H: number
  openings: Opening[]
  /** Footprints of what stands solid on the floor up to the ceiling (columns, walls on their own): faces against them don't show. */
  solids: Point[][]
  out: TakeoffPart[]
}

const ring = (pts: Point[]) => pts.map((p) => [p.x, p.y] as [number, number])

/** A point in an item's own frame (x across, y from its back to its front) on the plan. */
function framed(pose: ResolvedPose) {
  const r = (pose.rotation * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return (x: number, y: number): Point => ({ x: pose.x + x * c - y * s, y: pose.y + x * s + y * c })
}

/** The room a point's in: the smallest that has it (a closet in a bedroom). */
function roomAt(floor: Floor, p: Point): Room | undefined {
  return floor.rooms
    .filter((r) => r.points.length >= 3 && !isOutdoor(r) && pointInPolygon(p, r.points))
    .sort((a, b) => area(a.points) - area(b.points))[0]
}

/** The finish on a room's wall (plain white paint if it has none). */
const wallOf = (room: Room, edge: number): WallSurface => wallSurfaceAt(room, edge) ?? PLAIN_WALL

/**
 * A stretch of something finished like a wall (`s`: tiles to their height, paint above…), `length` long from z0 up to
 * z1, as parts in each of its finishes; or taken off (`sign` -1).
 */
function clad(ctx: Ctx, part: Omit<TakeoffPart, 'surface' | 'area' | 'place'>, s: WallSurface, length: number, z0: number, z1: number, sign = 1) {
  if (length < 0.5 || z1 - z0 < 0.5) return
  for (const b of wallBands(s, ctx.H)) {
    const lo = Math.max(z0, b.z0)
    const hi = Math.min(z1, b.z1)
    if (hi - lo > 0.01) ctx.out.push({ ...part, place: 'wall', surface: b.surface, area: sign * length * (hi - lo) })
  }
}

/** A flat face of something finished like a wall (a sill, a top, an underside: `a` cm²) at height y, in the finish there. */
function cladFlat(ctx: Ctx, part: Omit<TakeoffPart, 'surface' | 'area' | 'place'>, s: WallSurface, a: number, y: number) {
  if (a < 0.5) return
  const bands = wallBands(s, ctx.H)
  const b = bands.find((x) => y < x.z1) ?? bands[bands.length - 1]
  ctx.out.push({ ...part, place: 'wall', surface: b.surface, area: a })
}

/** A piece of stone (`a` cm², its front edge `length` long) in a room. */
function stone(ctx: Ctx, room: Room, what: string, kind: string, a: number, length: number, from: string) {
  if (a > 0.5) ctx.out.push({ room: room.id, place: 'stone', what, stone: kind, area: a, length, from })
}

/**
 * Whether a face of something built shows: what's just in front of it (`at`, facing `n`) is in the room (or the next
 * one, open to it), not in a wall or a column.
 */
function shows(ctx: Ctx, room: Room, at: Point, n: Point) {
  const q = add(at, mul(n, 3))
  const inside = pointInPolygon(q, room.points) || openTo(ctx, room).some((r) => pointInPolygon(q, r.points))
  return inside && !ctx.solids.some((s) => pointInPolygon(q, s))
}

/** The rooms a room's open to (across its open walls: one space, divided into rooms). */
function openTo(ctx: Ctx, room: Room): Room[] {
  const out = new Set<Room>()
  const n = room.points.length
  const sa = signedArea(room.points)
  for (const i of room.openEdges ?? []) {
    const a = room.points[i]
    const b = room.points[(i + 1) % n]
    if (!a || !b) continue
    const p = add(mul(add(a, b), 0.5), mul(inwardNormal(a, b, sa), -2))
    const r = ctx.floor.rooms.find((x) => x !== room && x.points.length >= 3 && !isOutdoor(x) && pointInPolygon(p, x.points))
    if (r) out.add(r)
  }
  return [...out]
}

type Side = 'back' | 'front' | 'left' | 'right'

/** The faces of a box (x0…x1 across, y0…y1 back to front, in an item's frame): each one's side, length, middle, which way it faces, and whether it shows. */
function boxSides(ctx: Ctx, room: Room, at: (x: number, y: number) => Point, b: { x0: number; x1: number; y0: number; y1: number }) {
  const c = at((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)
  return [
    { side: 'back' as Side, a: at(b.x0, b.y0), b: at(b.x1, b.y0) },
    { side: 'front' as Side, a: at(b.x0, b.y1), b: at(b.x1, b.y1) },
    { side: 'left' as Side, a: at(b.x0, b.y0), b: at(b.x0, b.y1) },
    { side: 'right' as Side, a: at(b.x1, b.y0), b: at(b.x1, b.y1) },
  ].map((f) => {
    const m = mul(add(f.a, f.b), 0.5)
    const len = Math.hypot(m.x - c.x, m.y - c.y) || 1
    const n = { x: (m.x - c.x) / len, y: (m.y - c.y) / len }
    return { side: f.side, length: dist(f.a, f.b), mid: m, n, shows: shows(ctx, room, m, n) }
  })
}

/** The faces of a box (as boxSides) that show: each one's length. */
function boxFaces(ctx: Ctx, room: Room, at: (x: number, y: number) => Point, b: { x0: number; x1: number; y0: number; y1: number }, skip: Side[] = []) {
  return boxSides(ctx, room, at, b)
    .filter((f) => !skip.includes(f.side) && f.shows)
    .map((f) => f.length)
}

/** The finish of the wall a face (its middle `at`, facing `n`) is right up against: the nearest wall there. */
function wallAgainst(ctx: Ctx, at: Point, n: Point): { s: WallSurface; room?: Room; top: number } {
  const q = add(at, mul(n, 1))
  let best: { room: Room; edge: number; d: number } | null = null
  for (const r of ctx.floor.rooms) {
    if (r.points.length < 3 || isOutdoor(r)) continue
    r.points.forEach((a, i) => {
      if (isOpen(r, i)) return
      const d = projectOnSegment(q, a, r.points[(i + 1) % r.points.length]).dist
      if (d < 5 && (!best || d < best.d)) best = { room: r, edge: i, d }
    })
  }
  const b = best as { room: Room; edge: number } | null
  return b ? { s: wallOf(b.room, b.edge), room: b.room, top: wallTop(ctx, b.room, b.edge, hiddenGapWalls(ctx.floor, b.room)) } : { s: PLAIN_WALL, top: ctx.H }
}

/** Area of polygons left after clipping (outer rings less their holes). */
function clippedArea(mp: [number, number][][][]) {
  return mp.reduce((t, poly) => t + poly.reduce((s, r, i) => s + (i ? -1 : 1) * area(r.map(([x, y]) => ({ x, y }))), 0), 0)
}

/** A room's own floor: less the smaller rooms drawn in it (with their walls). */
function floorArea(room: Room, rooms: Room[]) {
  const mine = area(room.points)
  const box = bbox(room.points)
  const inside = rooms.filter((r) => {
    if (r === room || r.points.length < 3 || isOutdoor(r) || area(r.points) >= mine) return false
    const b = bbox(r.points)
    return b.minX < box.maxX && b.maxX > box.minX && b.minY < box.maxY && b.maxY > box.minY
  })
  if (!inside.length) return mine
  try {
    return clippedArea(polygonClipping.difference([ring(room.points)], ...inside.map((r) => [ring(roomOuter(r))])))
  } catch {
    return mine
  }
}

/** Walls whose ceiling stops short of them for a hidden light, up into its gap (plain room's edges, see ceilingRoom). */
function hiddenGapWalls(floor: Floor, room: Room): Set<number> {
  const light = floor.symbols.find((s) => s.room === room.id && s.type === 'cove-light')
  if (!light || !hiddenLightInGap(room, light)) return new Set()
  const off = new Set([...(light.cove?.off ?? []), ...(room.curtainPockets ?? []), ...(room.openEdges ?? [])])
  return new Set(room.points.map((_, i) => i).filter((i) => !off.has(i)))
}

/** How high a room's wall shows: up to its ceiling, or on up to the slab in a curtain pocket or a hidden light's gap. */
function wallTop(ctx: Ctx, room: Room, edge: number, gaps: Set<number>) {
  const c = room.ceiling
  if (!c || c.style === 'floating') return ctx.H
  if (room.curtainPockets?.includes(edge) || gaps.has(edge)) return ctx.H
  if (room.shadowGaps?.includes(edge)) return Math.min(ctx.H, ctx.H - c.drop + SHADOW_GAP.depth)
  return ctx.H - c.drop
}

/** A room's floor, walls and ceiling (an outdoor one's floor only). */
function roomParts(ctx: Ctx, room: Room) {
  const { floor } = ctx
  ctx.out.push({ room: room.id, place: 'floor', what: 'Floor', surface: room.floor, area: floorArea(room, floor.rooms) })
  if (isOutdoor(room)) return

  // Its walls, as the 3D view finishes them: each face round the room up to its ceiling, around its doors and windows
  // (a niche's opening too: its lining's its own part) and the columns standing on it.
  const gaps = hiddenGapWalls(floor, room)
  for (const f of roomFaces(room, floor.rooms)) {
    if (f.s2 - f.s1 < 1) continue
    const top = wallTop(ctx, room, f.edge, gaps)
    const cuts = cutsFor(ctx.openings, f.a, f.dir, mul(f.inward, -1), f.t, f.s2).filter((c) => c.side !== 'outer')
    const cols = wallColumns(floor, room, f.edge)
    const sign = f.dir.x * f.inward.y - f.dir.y * f.inward.x > 0 ? 1 : -1
    for (const band of wallBands(wallOf(room, f.edge), top)) {
      let a = 0
      for (const [s1, s2, z0, z1] of aroundCuts(cuts, f.s2, band.z0, band.z1, f.s1)) {
        const [w1, w2] = [sign * s1, sign * s2].sort((x, y) => x - y)
        a += aroundColumns(cols, w1, w2).reduce((t, [p, q]) => t + q - p, 0) * (z1 - z0)
      }
      if (a > 0.5) ctx.out.push({ room: room.id, place: 'wall', what: 'Walls', surface: band.surface, area: a })
    }
  }
  ceilingParts(ctx, room)
}

/** The length of a ceiling's edge (`poly`'s sides), but where it runs on into the next room's ceiling. */
function edgeLength(poly: Point[], room: Room) {
  let t = 0
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]
    if (!onCeilingJoin(room, a, b)) t += dist(a, b)
  })
  return t
}

/**
 * The upright faces of each style of gypsum ceiling (see buildCeilings in the 3D view): the bulkhead's side up to the
 * slab, each step's, a cove's lip and the back of its trough, a floating panel's edge. Every style has its own.
 */
const CEILING_SIDES: Record<CeilingStyle, (room: Room, c: Ceiling) => { what: string; area: number }[]> = {
  flat: () => [],
  tray: (r, c) => [{ what: 'Bulkhead sides', area: edgeLength(bandEdge(r), r) * c.drop }],
  stepped: (r, c) => [{ what: 'Bulkhead sides', area: ((edgeLength(bandEdge(r), r) + edgeLength(bandEdge(r, 2), r)) * c.drop) / 2 }],
  cove: (r, c) => [{ what: 'Cove lip and trough', area: edgeLength(bandEdge(r), r) * COVE_LIP + edgeLength(bandEdge(r, 1, -COVE_WIDTH), r) * (c.drop - 1) }],
  floating: (r) => [{ what: 'Panel edges', area: edgeLength(bandEdge(r), r) * PANEL_EDGE }],
}

/**
 * A room's ceiling: the slab; or a gypsum one, its levels (bands, steps, a panel), its upright faces, the slab where it
 * shows (the raised middle, round a panel, up in pockets and gaps), the sides of its pockets and gaps, and where it
 * steps to the next room's across an open wall.
 */
function ceilingParts(ctx: Ctx, plain: Room) {
  const room = ceilingRoom(plain, ctx.floor)
  const id = plain.id
  const push = (what: string, a: number, board = false) => {
    if (a > 0.5) ctx.out.push({ room: id, place: 'ceiling', what, surface: CEILING_PAINT, area: a, ...(board && { board }) })
  }
  const slab = area(room.points)
  const c = room.ceiling
  if (!c) return push('Ceiling', slab)
  const gypsum = ceilingZones(room).reduce((t, z) => t + area(z.outer) - (z.inner ? area(z.inner) : 0), 0)
  push(c.style === 'floating' ? 'Floating panel' : 'Gypsum ceiling', gypsum, true)
  for (const s of CEILING_SIDES[c.style](room, c)) push(s.what, s.area, true)
  // Where the slab shows: up in its pockets and gaps along the walls, in the raised middle, round a floating panel.
  const strips = c.style === 'floating' ? 0 : slab - area(ceilingOutline(room))
  push('Ceiling in pockets and gaps', strips)
  push(c.style === 'floating' ? 'Ceiling round the panel' : 'Ceiling, raised middle', slab - strips - gypsum)
  if (c.style !== 'floating') {
    // The sides of its curtain pockets and hidden light's gaps (up to the slab), and its shadow gaps.
    const cut = ceilingOutline(room)
    const n = room.points.length
    const pockets = new Set([...(room.curtainPockets ?? []), ...(room.hiddenGaps ?? [])].filter((i) => i < n))
    let up = 0
    let groove = 0
    for (let i = 0; i < n; i++) {
      const len = dist(cut[i], cut[(i + 1) % n])
      if (pockets.has(i)) up += len * c.drop
      else if (room.shadowGaps?.includes(i)) groove += len * SHADOW_GAP.depth
    }
    push('Pocket and gap sides', up, true)
    push('Shadow gaps', groove, true)
  }
  // Open to the next room: where its ceiling's lower along the line, a gypsum face up to the other's.
  let step = 0
  for (const i of room.openEdges ?? []) {
    const a = room.points[i]
    const b = room.points[(i + 1) % room.points.length]
    if (!a || !b) continue
    const nrm = inwardNormal(a, b, signedArea(room.points))
    const L = dist(a, b)
    const at = (t: number, side: number) => ({ x: a.x + ((b.x - a.x) * t) / L + nrm.x * side, y: a.y + ((b.y - a.y) * t) / L + nrm.y * side })
    const plainOther = ctx.floor.rooms.find((r) => r.id !== plain.id && !r.kind && r.points.length >= 3 && pointInPolygon(at(L / 2, -1), r.points))
    const other = plainOther && ceilingRoom(plainOther, ctx.floor)
    for (let t = 0.5; t < L; t += 1) {
      const d = ceilingDropAt(room, at(t, 1)) - (other ? ceilingDropAt(other, at(t, -1)) : 0)
      if (d > 0.5) step += d
    }
  }
  push('Steps to the next ceiling', step, true)
}

/** Something under the ceiling at `p` covering it (`a` cm² of it): taken off the slab, or the gypsum there. */
function underCeiling(ctx: Ctx, room: Room, p: Point, a: number, from: string) {
  const gypsum = !!room.ceiling && ceilingDropAt(ceilingRoom(room, ctx.floor), p) > 0.5
  ctx.out.push({ room: room.id, place: 'ceiling', what: 'Covered by what hangs or stands there', surface: CEILING_PAINT, area: -a, from, ...(gypsum && { board: true }) })
}

/** Something standing on the floor covering it (`a` cm²). */
const onFloor = (ctx: Ctx, room: Room, a: number, from: string) =>
  ctx.out.push({ room: room.id, place: 'floor', what: 'Covered by what’s built on it', surface: room.floor, area: -a, from })

/** How high the ceiling is over a point (cm): a gypsum one's, else the slab. */
function ceilingAt(ctx: Ctx, room: Room | undefined, p: Point) {
  return room?.ceiling ? ctx.H - ceilingDropAt(ceilingRoom(room, ctx.floor), p) : ctx.H
}

/**
 * How high the ceiling is where an item meets it, seen from in front of it (a column cut out of a gypsum ceiling, a
 * bulkhead along the wall it's against): just in front of its front.
 */
const ceilingBy = (ctx: Ctx, room: Room | undefined, sym: PlanSymbol, pose: ResolvedPose) => ceilingAt(ctx, room, framed(pose)(0, sym.depth / 2 + 5))

type Rule = (sym: PlanSymbol, ctx: Ctx, pose: ResolvedPose) => void

/**
 * Something built against a wall and finished like it (see builtBox): its front and the sides that show, its niches'
 * sills and tops and its underside if they show, and the wall behind it taken off; the floor under it too.
 */
const built: Rule = (sym, ctx, pose) => {
  const room = roomAt(ctx.floor, pose)
  const at = wallBehind(pose, sym.depth, ctx.floor.rooms)
  if (!room || !at) return
  const box = builtBox(sym, ceilingBy(ctx, room, sym, pose))
  if (!box) return
  const s = wallOf(at.room, at.edge)
  const p = framed(pose)
  const w = sym.width
  const d = sym.depth
  const y1 = -d / 2 + box.depth
  const what = sym.type === 'toilet' ? 'Toilet’s box' : sym.type === 'shower-bench' ? 'Bench' : sym.type === 'alcove-niche' ? 'Alcove niche' : 'Tiled vanity'
  const part = { room: room.id, what, from: sym.id }
  const behind = { ...part, what: 'Hidden behind what’s built' }
  const spans = box.spans ?? [[box.y0, box.y1]]
  const top = ceilingBy(ctx, room, sym, pose)
  // Across a corner, its front the diagonal and the two walls behind it; else its front and the sides that show, and
  // the wall behind it (an alcove's fill: the column's side and the wall beside it too, where it's built).
  const [front, hidden, footprint] = box.corner
    ? [Math.hypot(w, d), w + d, (w * d) / 2]
    : [w + boxFaces(ctx, room, p, { x0: -w / 2, x1: w / 2, y0: -d / 2, y1 }, ['back', 'front']).reduce((t, l) => t + l, 0), sym.type === 'alcove-niche' ? w + 2 * box.depth : w, w * box.depth]
  for (const [a, b] of spans) {
    clad(ctx, part, s, front, a, b)
    clad(ctx, behind, s, hidden, a, b, -1)
  }
  // Its niches' sills and tops (an alcove's niches' backs and sides are the wall's and the column's, which show there),
  // and an underside that shows.
  for (const cap of box.caps ?? []) cladFlat(ctx, part, s, footprint, cap.y)
  if (box.under) cladFlat(ctx, part, s, footprint, box.y0)
  // The floor under it, if it stands on it; the ceiling over it, if it goes up to it.
  if (spans[0][0] < 0.5) onFloor(ctx, room, footprint, sym.id)
  if (spans[spans.length - 1][1] >= top - 0.5) underCeiling(ctx, room, pose, footprint, sym.id)
}

/** A column or wall standing on its own: its faces that show, finished like the room's walls (or painted), and what it stands on and up to. */
function standing(sym: PlanSymbol, ctx: Ctx, pose: ResolvedPose, s: WallSurface, top: number, what: string, cap: boolean) {
  const room = roomAt(ctx.floor, pose)
  if (!room) return
  const w = sym.width
  const d = sym.depth
  const lengths = boxFaces(ctx, room, framed(pose), { x0: -w / 2, x1: w / 2, y0: -d / 2, y1: d / 2 })
  clad(ctx, { room: room.id, what, from: sym.id }, s, lengths.reduce((t, l) => t + l, 0), 0, top)
  // Its top, when it's lower than the ceiling and has no stone shelf on it.
  if (cap) cladFlat(ctx, { room: room.id, what, from: sym.id }, s, w * d, top)
  onFloor(ctx, room, w * d, sym.id)
  if (top >= ceilingBy(ctx, room, sym, pose) - 0.5) underCeiling(ctx, room, pose, w * d, sym.id)
}

/** A window's or an open doorway's reveals: its sides and head in the wall's thickness, finished like the wall. */
const reveals: Rule = (sym, ctx, pose) => {
  const room = sym.wall && ctx.floor.rooms.find((r) => r.id === sym.wall!.roomId)
  if (!room || !sym.wall) return
  const def = SYMBOL_MAP.get(sym.type)
  // Tiled where the wall is (or painted, as it is); painted in a papered or slatted wall.
  const wall = wallOf(room, sym.wall.edge)
  const s: WallSurface = ['paper', 'slats'].includes(FINISHES[wall.finish].kind) ? { finish: 'paint', color: wall.above ?? WALL_WHITE } : wall
  const depth = (pose.wallThickness ?? room.wallThickness) * (sym.type === 'opening' ? 1 : WINDOW_REVEAL)
  const bottom = sym.elevation ?? def?.sill ?? 0
  const top = Math.min(bottom + sym.height, ctx.H)
  const part = { room: room.id, what: sym.type === 'opening' ? 'Doorway reveals' : 'Window reveals', from: sym.id }
  clad(ctx, part, s, 2 * depth, bottom, top)
  cladFlat(ctx, part, s, sym.width * depth, top)
}

/** A niche in a wall: its back, sides, top and (unless it's stone) its sill, finished like the wall at its height. */
const niche: Rule = (sym, ctx, pose) => {
  const room = sym.wall && ctx.floor.rooms.find((r) => r.id === sym.wall!.roomId)
  if (!room || !sym.wall) return
  const s = wallOf(room, sym.wall.edge)
  const r = nicheDepth(pose.wallThickness ?? sym.depth)
  const sill = sym.elevation ?? SYMBOL_MAP.get(sym.type)?.sill ?? 0
  const w = sym.width
  const h = sym.height
  // As the 3D view lines it: in the finish at its middle (tiles, if they come up that high).
  const band = wallBands(s, ctx.H).find((b) => sill + h / 2 <= b.z1) ?? wallBands(s, ctx.H)[0]
  const lining = w * h + 2 * r * h + w * r + (stoneSill(sym) ? 0 : w * r)
  ctx.out.push({ room: room.id, place: 'wall', what: 'Niche lining', surface: band.surface, area: lining, from: sym.id })
  if (stoneSill(sym)) stone(ctx, room, 'Niche sills', worktopOf(sym).id, (w + 1) * (r + 1.5), w + 1, sym.id)
}

/** Kitchen units, an island, a built-in washing machine's top: a worktop as big as it is (an L across a corner). */
const worktop: Rule = (sym, ctx, pose) => {
  const room = roomAt(ctx.floor, pose)
  if (!room || !hasWorktop(sym)) return
  const w = sym.width
  const d = sym.depth
  if (sym.type === 'kitchen-corner') {
    // Its arms as deep as the 3D view makes them; the front edge the inside of the L.
    const a = Math.min(60, w - 10, d - 10)
    return stone(ctx, room, 'Worktops', worktopOf(sym).id, w * a + a * (d - a), w - a + (d - a), sym.id)
  }
  stone(ctx, room, 'Worktops', worktopOf(sym).id, w * d, w, sym.id)
}

/**
 * The stone of what's built against a wall: a vanity's top (all of it, or over its washing machine's bay where its own
 * ceramic one doesn't reach), a bench's top, an alcove's niches' sills, the shelf on a toilet's box.
 */
function builtStone(sym: PlanSymbol, ctx: Ctx, pose: ResolvedPose) {
  const room = roomAt(ctx.floor, pose)
  if (!room) return
  const w = sym.width
  const d = sym.depth
  const top = worktopOf(sym).id
  if (sym.type === 'bath-vanity') {
    const lay = vanitySinks(sym)
    if (sym.basin || styleOf(sym) === 'tiled') stone(ctx, room, 'Vanity tops', top, w * d, w, sym.id)
    else if (lay.washer) stone(ctx, room, 'Vanity tops', top, (w - (lay.x1 - lay.x0)) * d, w - (lay.x1 - lay.x0), sym.id)
  } else if (sym.type === 'shower-bench' && styleOf(sym) !== 'fold-down') {
    // A nose over its front; across a corner, a triangle.
    stone(ctx, room, 'Bench tops', top, styleOf(sym) === 'corner' ? (w * d) / 2 : w * (d + 1.5), styleOf(sym) === 'corner' ? Math.hypot(w, d) : w, sym.id)
  } else if (sym.type === 'alcove-niche' && stoneSill(sym)) {
    const sills = alcoveOpenings(sym, ceilingBy(ctx, room, sym, pose)).length
    stone(ctx, room, 'Niche sills', top, sills * w * (d + 1.5), sills * w, sym.id)
  } else if (sym.type === 'toilet' && sym.mount === 'wall' && (sym.tankBox ?? 'ledge') === 'ledge') {
    stone(ctx, room, 'Shelves', SHELF_STONE, (w + 2) * (tankBoxDepth(sym) + 2), w + 2, sym.id)
  }
}

/** A gypsum box: its underside and the sides that show below the ceiling, gypsum board painted; the ceiling and walls it covers. */
const hanging: Rule = (sym, ctx, pose) => {
  const room = roomAt(ctx.floor, pose)
  if (!room) return
  const box = hangDepth(sym)
  const drop = room.ceiling ? ceilingDropAt(ceilingRoom(room, ctx.floor), pose) : 0
  const below = box - drop
  if (below < 0.5) return
  const w = sym.width
  const d = sym.depth
  const sides = boxSides(ctx, room, framed(pose), { x0: -w / 2, x1: w / 2, y0: -d / 2, y1: d / 2 })
  const a = w * d + sides.reduce((t, f) => t + (f.shows ? f.length : 0), 0) * below
  ctx.out.push({ room: room.id, place: 'ceiling', what: 'Gypsum box', surface: CEILING_PAINT, area: a, from: sym.id, board: true })
  underCeiling(ctx, room, pose, w * d, sym.id)
  // Against a wall, the top of each wall it's against hidden (as high as that wall shows).
  const top = ctx.H - drop
  for (const f of sides) {
    if (f.shows) continue
    const wall = wallAgainst(ctx, f.mid, f.n)
    clad(ctx, { room: (wall.room ?? room).id, what: 'Hidden behind what’s built', from: sym.id }, wall.s, f.length, top - below, Math.min(top, wall.top), -1)
  }
}

/**
 * A beam, hung from the slab: what shows of it below the ceiling (a gypsum one hides it where it's as low; measured
 * every centimetre along it, as a tray's or a cove's band comes down near the walls). Its sides and underside are
 * finished like the walls round it (see beamFinish, as the 3D view clads it) or painted like the ceiling; the ceiling
 * under it is taken off, and the walls its ends (or a side) are against, where it hides them.
 */
const beam: Rule = (sym, ctx, pose) => {
  const home = roomAt(ctx.floor, pose)
  if (!home) return
  const box = hangDepth(sym)
  const w = sym.width
  const d = sym.depth
  const p = framed(pose)
  const bottom = ctx.H - box
  const inRoom = (at: Point) => roomAt(ctx.floor, at) ?? home
  // How far it shows below the ceiling at a point, and the room that's in.
  const below = (at: Point) => {
    const r = inRoom(at)
    return { r, b: Math.max(0, box - (r.ceiling ? ceilingDropAt(ceilingRoom(r, ctx.floor), at) : 0)) }
  }
  const s = beamFinish(sym, ctx.floor)
  // What's counted, by room: each stretch of side (its length and how far it shows), the underside, the ceiling under it.
  const sideParts = new Map<Room, { length: number; below: number }[]>()
  const under = new Map<Room, number>()
  const addSide = (r: Room, length: number, b: number) => {
    const list = sideParts.get(r) ?? []
    const last = list[list.length - 1]
    if (last && Math.abs(last.below - b) < 0.05) last.length += length
    else list.push({ length, below: b })
    sideParts.set(r, list)
  }
  const n = Math.max(1, Math.round(w))
  const step = w / n
  const xs = Array.from({ length: n }, (_, i) => -w / 2 + (i + 0.5) * step)
  // Its underside: centimetre by centimetre along its middle.
  for (const x of xs) {
    const { r, b } = below(p(x, 0))
    if (b >= 0.5) under.set(r, (under.get(r) ?? 0) + step * d)
  }
  if (!under.size) return
  // Its sides, each measured just outside it (a band or a pocket can run along it); its ends, just past them.
  for (const f of boxSides(ctx, home, p, { x0: -w / 2, x1: w / 2, y0: -d / 2, y1: d / 2 })) {
    const long = f.side === 'back' || f.side === 'front'
    const samples = long
      ? xs.map((x) => ({ at: p(x, (f.side === 'back' ? -1 : 1) * (d / 2 + 1)), length: step }))
      : [{ at: p((f.side === 'left' ? -1 : 1) * (w / 2 + 1), 0), length: d }]
    if (!f.shows) {
      // Against a wall: the strip of it the beam hides, off that wall (in its room), as high as it shows.
      const wall = wallAgainst(ctx, f.mid, f.n)
      for (const smp of samples) {
        const { b } = below(smp.at)
        const z1 = Math.min(bottom + b, wall.top)
        if (z1 - bottom >= 0.5) clad(ctx, { room: (wall.room ?? home).id, what: 'Hidden behind what’s built', from: sym.id }, wall.s, smp.length, bottom, z1, -1)
      }
      continue
    }
    for (const smp of samples) {
      const { r, b } = below(smp.at)
      if (b >= 0.5) addSide(r, smp.length, b)
    }
  }
  for (const [r, list] of sideParts) {
    for (const st of list) {
      if (s) clad(ctx, { room: r.id, what: 'Beams', from: sym.id }, s, st.length, bottom, bottom + st.below)
      else ctx.out.push({ room: r.id, place: 'ceiling', what: 'Beams', surface: CEILING_PAINT, area: st.length * st.below, from: sym.id })
    }
  }
  for (const [r, a] of under) {
    if (s) cladFlat(ctx, { room: r.id, what: 'Beams', from: sym.id }, s, a, bottom)
    else ctx.out.push({ room: r.id, place: 'ceiling', what: 'Beams', surface: CEILING_PAINT, area: a, from: sym.id })
    underCeiling(ctx, r, pose, a, sym.id)
  }
}

/**
 * What each kind of item does to the finished surfaces round it. Doors, windows and niches (items set in a wall) also
 * have their openings taken off the walls (see roomParts).
 */
const RULES: Record<string, Rule> = {
  // Columns: a column in a wall's sides and front (the wall behind it doesn't show: see roomParts), a column on its own
  // all round; finished like the wall (the room's walls).
  'wall-post': (sym, ctx, pose) => {
    const at = wallBehind(pose, sym.depth, ctx.floor.rooms)
    const room = at?.room ?? roomAt(ctx.floor, pose)
    if (!room) return
    const s = at ? wallOf(at.room, at.edge) : wallOf(room, 0)
    const w = sym.width
    const d = sym.depth
    const sides = boxFaces(ctx, room, framed(pose), { x0: -w / 2, x1: w / 2, y0: -d / 2, y1: d / 2 }, ['back'])
    clad(ctx, { room: room.id, what: 'Column sides', from: sym.id }, s, sides.reduce((t, l) => t + l, 0), 0, ceilingBy(ctx, room, sym, pose))
    onFloor(ctx, room, w * d, sym.id)
  },
  column: (sym, ctx, pose) => {
    const room = roomAt(ctx.floor, pose)
    standing(sym, ctx, pose, room?.walls ?? PLAIN_WALL, ceilingBy(ctx, room, sym, pose), 'Columns', false)
  },
  // Walls standing on their own (and half walls): both faces and their ends, finished like the room's walls or
  // painted; a low one's top, unless there's a stone shelf on it.
  partition: (sym, ctx, pose) => {
    const room = roomAt(ctx.floor, pose)
    const s: WallSurface = sym.frame ? { finish: 'paint', color: sym.frame } : (room?.walls ?? PLAIN_WALL)
    const top = Math.min(partitionTop(sym, ctx.H), ceilingBy(ctx, room, sym, pose))
    standing(sym, ctx, pose, s, top, sym.partial ? 'Half walls' : 'Walls on their own', !!sym.partial && !sym.shelf)
    // Its stone shelf, a little proud of its faces.
    if (room && sym.partial && sym.shelf) stone(ctx, room, 'Shelves', SHELF_STONE, sym.width * (sym.depth + 2), sym.width, sym.id)
  },
  // (Library presets of a wall on its own; placed, they're walls.)
  'half-wall': (...a) => RULES.partition(...a),
  'half-wall-glass': (...a) => RULES.partition(...a),
  // Built against a wall and finished like it, and the stone on it.
  toilet: (...a) => (built(...a), builtStone(...a)),
  'shower-bench': (...a) => (built(...a), builtStone(...a)),
  'alcove-niche': (...a) => (built(...a), builtStone(...a)),
  'bath-vanity': (...a) => (built(...a), builtStone(...a)),
  // Worktops.
  counter: worktop,
  'kitchen-sink': worktop,
  stove: worktop,
  dishwasher: worktop,
  'kitchen-corner': worktop,
  'kitchen-island': worktop,
  'washing-machine': worktop,
  // A shower's own half wall, finished like the room's walls, under its stone shelf.
  shower: (sym, ctx, pose) => {
    const room = roomAt(ctx.floor, pose)
    if (!room || !sym.halfWall) return
    const p = framed(pose)
    for (const b of halfWallBoxes(sym, ctx.floor)) {
      const lengths = boxFaces(ctx, room, p, { x0: b.x0, x1: b.x1, y0: b.z0, y1: b.z1 })
      clad(ctx, { room: room.id, what: 'Shower’s half wall', from: sym.id }, room.walls ?? PLAIN_WALL, lengths.reduce((t, l) => t + l, 0), 0, sym.halfWall)
      onFloor(ctx, room, (b.x1 - b.x0) * (b.z1 - b.z0), sym.id)
      // Its stone shelf, a little longer and wider than it.
      const long = Math.max(b.x1 - b.x0, b.z1 - b.z0)
      stone(ctx, room, 'Shelves', SHELF_STONE, (long + 2) * (Math.min(b.x1 - b.x0, b.z1 - b.z0) + 2), long + 2, sym.id)
    }
  },
  // A bath built in: no floor finish under it.
  bathtub: (sym, ctx, pose) => {
    const room = roomAt(ctx.floor, pose)
    if (room) onFloor(ctx, room, sym.width * sym.depth, sym.id)
  },
  // In a wall: windows' and open doorways' reveals, niches' linings.
  window: reveals,
  'window-wide': reveals,
  opening: reveals,
  'shower-niche': niche,
  'wall-niche': niche,
  // From the ceiling: gypsum boxes and beams; air conditioning set into it, in place of the ceiling there.
  'gypsum-box': hanging,
  beam,
  ...Object.fromEntries(
    [...CEILING_AC].map((type): [string, Rule] => [
      type,
      (sym, ctx, pose) => {
        const room = roomAt(ctx.floor, pose)
        if (room) underCeiling(ctx, room, pose, sym.width * sym.depth, sym.id)
      },
    ]),
  ),
}

/**
 * Kinds of items that do nothing to the finished surfaces: furniture and fittings standing on a finished floor or
 * hung on a finished wall, lights, switches and the like. Doors' openings come off the walls (see roomParts), their
 * frames cover their reveals. The ceiling items set their room's ceiling (see ceilingParts).
 */
const UNTOUCHED = new Set([
  'door', 'door-double', 'door-sliding', 'door-barn', 'door-alu', 'door-alu-double', 'door-alu-sliding',
  'curtain', 'blind',
  'sofa', 'sofa-corner', 'armchair', 'coffee-table', 'sofa-table', 'tv-unit', 'display-cabinet', 'sideboard', 'coffee-corner',
  'tv-stand', 'tv', 'dining-table', 'round-table', 'chair', 'bookshelf', 'plant',
  'bed-double', 'bed-single', 'wardrobe', 'wardrobe-corner', 'dressing-table', 'nightstand', 'desk',
  'wall-cabinet', 'range-hood', 'oven-tower', 'fridge',
  'washbasin', 'towel-rail', 'towel-radiator', 'shower-quadrant',
  'ac-split', 'ac-floor', 'ac-outdoor',
  'outlet', 'switch', 'light', 'spot', 'led-profile', 'track', 'cove-light', 'gap-light', 'pocket-light',
  'pendant', 'linear-pendant', 'chandelier', 'wall-light',
  'ceiling-flat', 'ceiling-tray', 'ceiling-cove', 'ceiling-floating', 'ceiling-stepped',
  'stairs', 'person', 'label',
])

/** Kinds in the library with neither a rule nor a place in UNTOUCHED: each needs one (see the top of this file). */
export const unaccounted = () => SYMBOLS.map((d) => d.type).filter((t) => !(t in RULES) && !UNTOUCHED.has(t))

if (import.meta.env?.DEV) {
  const missing = unaccounted()
  if (missing.length) console.error(`takeoff: no rule for ${missing.join(', ')} — add one to RULES (or to UNTOUCHED) in src/model/takeoff.ts`)
}

const cache = new WeakMap<Floor, TakeoffPart[]>()

/** The takeoff of a floor's finished surfaces, part by part (see the top of this file). */
export function takeoff(floor: Floor): TakeoffPart[] {
  const hit = cache.get(floor)
  if (hit) return hit
  const solids = floor.symbols
    .filter((s) => s.type === 'wall-post' || s.type === 'column' || (s.type === 'partition' && !s.partial))
    .map((s) => {
      const at = framed(symbolPose(s, floor.rooms))
      return [at(-s.width / 2, -s.depth / 2), at(s.width / 2, -s.depth / 2), at(s.width / 2, s.depth / 2), at(-s.width / 2, s.depth / 2)]
    })
  const ctx: Ctx = { floor, H: floor.height, openings: wallOpenings(floor), solids, out: [] }
  for (const room of floor.rooms) if (room.points.length >= 3) roomParts(ctx, room)
  for (const sym of floor.symbols) {
    const rule = RULES[sym.type]
    if (rule) rule(sym, ctx, symbolPose(sym, floor.rooms))
  }
  cache.set(floor, ctx.out)
  return ctx.out
}

/** A room's floor, walls and ceiling (cm²), and the gypsum board in its ceiling. */
export function roomSurfaces(parts: TakeoffPart[], room: string) {
  const sum = (f: (p: TakeoffPart) => boolean) => parts.reduce((t, p) => t + (p.room === room && f(p) ? p.area : 0), 0)
  return {
    floor: sum((p) => p.place === 'floor'),
    walls: sum((p) => p.place === 'wall'),
    ceiling: sum((p) => p.place === 'ceiling'),
    board: sum((p) => !!p.board),
    stone: sum((p) => p.place === 'stone'),
  }
}

/** Each part of a room's surfaces, those of the same kind in the same finish together (largest first in each place). */
export function roomBreakdown(parts: TakeoffPart[], room: string) {
  const out = new Map<string, TakeoffPart>()
  for (const p of parts) {
    if (p.room !== room) continue
    const key = JSON.stringify([p.place, p.what, p.surface ?? null, p.stone ?? null])
    const e = out.get(key)
    if (e) {
      e.area += p.area
      if (p.length) e.length = (e.length ?? 0) + p.length
    } else out.set(key, { ...p, from: undefined })
  }
  const order: TakeoffPlace[] = ['floor', 'wall', 'ceiling', 'stone']
  return [...out.values()].filter((p) => Math.abs(p.area) >= 50).sort((a, b) => order.indexOf(a.place) - order.indexOf(b.place) || b.area - a.area)
}

/** Area per finish (each color, size, pattern…) over the parts in a place, what's taken off taken off (cm²). */
export function finishTotals(parts: TakeoffPart[], place: TakeoffPlace): { surface: Surface; area: number }[] {
  const out = new Map<string, { surface: Surface; area: number }>()
  for (const p of parts) {
    if (p.place !== place || !p.surface) continue
    const f = finishOf(p.surface, place === 'floor' ? 'floor' : 'wall')
    const key = JSON.stringify([p.surface.finish, p.surface.image ?? f.color, f.size, f.pattern, f.design?.id])
    const e = out.get(key)
    if (e) e.area += p.area
    else out.set(key, { surface: p.surface, area: p.area })
  }
  return [...out.values()].filter((e) => e.area > 0.5).sort((a, b) => b.area - a.area)
}

/**
 * Skirting boards, as the 3D view lays them (cm, per room): along the foot of each room's walls but where they're
 * tiled (or slatted) down to the floor, broken at doorways; and round the columns standing on them.
 */
export function skirting(floor: Floor): Map<string, number> {
  const out = new Map<string, number>()
  const openings = wallOpenings(floor)
  for (const room of floor.rooms) {
    if (room.points.length < 3 || isOutdoor(room)) continue
    let len = 0
    for (const f of roomFaces(room, floor.rooms)) {
      if (f.s2 - f.s1 < 5 || startsAtFloor(wallSurfaceAt(room, f.edge))) continue
      const cols = wallColumns(floor, room, f.edge)
      const sign = f.dir.x * f.inward.y - f.dir.y * f.inward.x > 0 ? 1 : -1
      // Along it but in doorways (windows don't come down to the floor), and behind its columns; on round their sides.
      const doors = cutsFor(openings, f.a, f.dir, mul(f.inward, -1), f.t, f.s2).filter((c) => c.bottom <= 1)
      for (const [s1, s2] of aroundCuts(doors, f.s2, 0, 1, f.s1)) {
        const [w1, w2] = [sign * s1, sign * s2].sort((x, y) => x - y)
        len += aroundColumns(cols, w1, w2).reduce((t, [p, q]) => t + q - p, 0)
      }
      for (const c of cols) len += 2 * c.depth + (c.uR - c.uL)
    }
    out.set(room.id, len)
  }
  return out
}

/** Area and front edge of each stone over the floor (cm², cm), largest first. */
export function stoneTotals(parts: TakeoffPart[]): { stone: string; area: number; length: number }[] {
  const out = new Map<string, { stone: string; area: number; length: number }>()
  for (const p of parts) {
    if (p.place !== 'stone' || !p.stone) continue
    const e = out.get(p.stone) ?? { stone: p.stone, area: 0, length: 0 }
    e.area += p.area
    e.length += p.length ?? 0
    out.set(p.stone, e)
  }
  return [...out.values()].sort((a, b) => b.area - a.area)
}
