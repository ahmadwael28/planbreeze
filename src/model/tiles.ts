/**
 * Layouts of several tiles on one floor or wall: the tiles as a grid, which tile goes in each place on it, and quick
 * ways to fill it (a checkerboard, a random mix, a border).
 *
 * The grid is the one the finish is laid in (see surfaceLayout): straight, brick (offset) or diagonal tiles, the long
 * side across. Places on it are numbered from where the finish is laid from, in the grid's own frame `G`, which is the
 * surface's turned by the layout's angle about the grid's corner: G = R(-angle) · (q - origin), with q the surface's
 * coordinates y down (a floor: the plan from its origin; a wall: along it, and down from the floor, i.e. minus the
 * height). On a wall the corner is placed so its cut tiles are where they were chosen to be (see wallOrigin). The plan,
 * the 3D view and the layout editor all place tiles this way, so they agree.
 */
import { finishOf, surfaceLayout } from './finishes'
import type { Place } from './finishes'
import { pointInPolygon } from './geometry'
import type { Point, Surface, TileMix, WallSurface } from './types'

/** Where a wall's cut tiles go, as seen from the room (see WallSurface.cut). */
export type CutSide = 'left' | 'right' | 'both'

export interface TileGrid {
  /** A tile's long side (across, x) and short side (down, y), cm. */
  len: number
  w: number
  /** Every other row shifted by half a tile (brick bond). */
  offset: boolean
  /** The angle the grid is laid at (degrees), as in Layout. */
  angle: number
  /** Where the grid's corner (0, 0) is, in surface coordinates. */
  origin: Point
  /** How far apart the tiles' joints are along the surface's x (along a wall). */
  period: number
}

/** A wall's extent along it, left to right as seen from the room (surface x). */
export interface Span {
  u0: number
  u1: number
}

/** A place on the grid: column and row. */
export interface Cell {
  c: number
  r: number
}

const rad = (deg: number) => (deg * Math.PI) / 180

/** How far apart joints are along x for tiles len × w laid at `angle`: a tile's length, its width when turned. */
function periodOf(len: number, w: number, angle: number) {
  const a = rad(angle)
  const c = Math.abs(Math.cos(a))
  const s = Math.abs(Math.sin(a))
  if (s < 0.01) return len
  if (c < 0.01) return w
  return len / c
}

/**
 * Where along a wall its grid starts, so its cut tiles are where chosen: whole tiles from the left end (cut at the
 * right), from the right end (cut at the left), or centered, cut alike at both ends. Centered, there's a joint in the
 * middle of the wall or a tile: whichever leaves the bigger pieces at the ends, so there are no slivers.
 */
export function wallOrigin(cut: CutSide | undefined, span: Span, period: number): number {
  if (cut === 'left') return span.u1
  if (cut !== 'both') return span.u0
  const mid = (span.u0 + span.u1) / 2
  const half = (span.u1 - span.u0) / 2
  const piece = (o: number) => {
    const r = (((half - o) % period) + period) % period
    return r < 0.5 || period - r < 0.5 ? period : r
  }
  return piece(0) >= piece(period / 2) ? mid : mid - period / 2
}

/**
 * A surface's tiles as a grid, when they're laid in one (straight, brick or diagonal tiles); null otherwise. On a
 * wall, `span` (how far it reaches) places the grid for its cut tiles; without it the grid starts at the wall's start.
 */
export function tileGrid(s: Surface, place: Place, span?: Span): TileGrid | null {
  const f = finishOf(s, place)
  if (f.def.kind !== 'tile' || !f.size || !['straight', 'offset', 'diagonal'].includes(f.pattern)) return null
  const layout = surfaceLayout(s, place)
  if (!layout) return null
  const len = Math.max(...f.size)
  const w = Math.min(...f.size)
  const period = periodOf(len, w, layout.angle)
  const x = place === 'wall' && span ? wallOrigin((s as WallSurface).cut, span, period) : 0
  return { len, w, offset: f.pattern === 'offset', angle: layout.angle, origin: { x, y: 0 }, period }
}

/** How wide the cut tiles are at a wall's left and right ends (0: whole tiles there). */
export function cutPieces(g: TileGrid, span: Span): { left: number; right: number } {
  const mod = (v: number) => {
    const r = ((v % g.period) + g.period) % g.period
    return r < 0.5 || g.period - r < 0.5 ? 0 : r
  }
  return { left: mod(g.origin.x - span.u0), right: mod(span.u1 - g.origin.x) }
}

/** Surface coordinates (y down) to the grid's frame. */
export function toGrid(g: TileGrid, q: Point): Point {
  const a = rad(g.angle)
  const c = Math.cos(a)
  const s = Math.sin(a)
  const x = q.x - g.origin.x
  const y = q.y - g.origin.y
  return { x: c * x + s * y, y: -s * x + c * y }
}

/** The grid's frame to surface coordinates (y down). */
export function fromGrid(g: TileGrid, p: Point): Point {
  const a = rad(g.angle)
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: c * p.x - s * p.y + g.origin.x, y: s * p.x + c * p.y + g.origin.y }
}

const odd = (n: number) => ((n % 2) + 2) % 2 === 1

/** Where row `r` starts across: brick bond shifts every other row by half a tile. */
const shift = (g: TileGrid, r: number) => (g.offset && odd(r) ? g.len / 2 : 0)

/** A place's tile, in the grid's frame. */
export function cellRect(g: TileGrid, { c, r }: Cell) {
  return { x: c * g.len + shift(g, r), y: r * g.w, w: g.len, h: g.w }
}

/** The place on the grid at a point in the grid's frame. */
export function cellAt(g: TileGrid, p: Point): Cell {
  const r = Math.floor(p.y / g.w)
  return { c: Math.floor((p.x - shift(g, r)) / g.len), r }
}

export const cellKey = ({ c, r }: Cell) => `${c},${r}`

export function parseKey(k: string): Cell {
  const [c, r] = k.split(',').map(Number)
  return { c, r }
}

/** Which tile is at a place: 0 the surface's own, 1 the first of its mix… (back to its own if that one's gone). */
export function tileIndex(s: Surface, key: string): number {
  const k = s.cells?.[key] ?? 0
  return k > 0 && k <= (s.mix?.length ?? 0) ? k : 0
}

/** The tile with this index: the surface's own (0) or one of its mix. */
export function tileStyle(s: Surface, k: number): TileMix {
  return k > 0 && s.mix?.[k - 1] ? s.mix[k - 1] : { image: s.image, color: s.color }
}

/** Does this surface have tiles other than its own laid anywhere? */
export function hasMix(s: Surface | undefined): boolean {
  return !!s?.mix?.length && !!s.cells && Object.values(s.cells).some((k) => k > 0 && k <= s.mix!.length)
}

/** The grid's extent around some points (surface coordinates): the columns and rows that cover them. */
export function cellRange(g: TileGrid, pts: Point[]) {
  const gp = pts.map((p) => toGrid(g, p))
  const xs = gp.map((p) => p.x)
  const ys = gp.map((p) => p.y)
  const r0 = Math.floor(Math.min(...ys) / g.w) - 1
  const r1 = Math.ceil(Math.max(...ys) / g.w)
  const c0 = Math.floor(Math.min(...xs) / g.len) - 2
  const c1 = Math.ceil(Math.max(...xs) / g.len) + 1
  return { c0, c1, r0, r1, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

/** A place's tile outline in surface coordinates. */
export function cellOutline(g: TileGrid, cell: Cell): Point[] {
  const { x, y, w, h } = cellRect(g, cell)
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ].map((p) => fromGrid(g, p))
}

/** The places whose tiles are at least partly on the surface (`areas`: its outline, or the parts of a wall). */
export function cellsOn(g: TileGrid, areas: Point[][]): Cell[] {
  const inside = (p: Point) => areas.some((a) => pointInPolygon(p, a))
  const { c0, c1, r0, r1 } = cellRange(g, areas.flat())
  const out: Cell[] = []
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const { x, y, w, h } = cellRect(g, { c, r })
      // A few points across the tile, just inside its edges.
      const hit = [0.04, 0.5, 0.96].some((u) => [0.04, 0.5, 0.96].some((v) => inside(fromGrid(g, { x: x + w * u, y: y + h * v }))))
      if (hit) out.push({ c, r })
    }
  }
  return out
}

/** The middle of a place's tile, in surface coordinates. */
export function cellCenter(g: TileGrid, cell: Cell): Point {
  const { x, y, w, h } = cellRect(g, cell)
  return fromGrid(g, { x: x + w / 2, y: y + h / 2 })
}

/** A repeatable pseudo-random number in [0, 1) for a place (so a random mix stays the same). */
function hash(c: number, r: number, seed: number) {
  let h = (c * 374761393 + r * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Checkerboard: tiles `a` and `b` taking turns. */
export function checker(cells: Cell[], a: number, b: number): Record<string, number> {
  return Object.fromEntries(cells.map((cell) => [cellKey(cell), odd(cell.c + cell.r) ? b : a]))
}

/** A random mix of these tiles, each about as often as the others. */
export function randomMix(cells: Cell[], tiles: number[], seed: number): Record<string, number> {
  return Object.fromEntries(cells.map((cell) => [cellKey(cell), tiles[Math.floor(hash(cell.c, cell.r, seed) * tiles.length)] ?? 0]))
}

/**
 * The tiles along the edges of the surface: a tile is on the border when a tile next to it would be off the surface
 * (so a cut sliver at the wall and the whole tile beside it both count).
 */
export function borderCells(g: TileGrid, cells: Cell[], areas: Point[][]): Cell[] {
  const inside = (p: Point) => areas.some((a) => pointInPolygon(p, a))
  return cells.filter((cell) => {
    const { x, y, w, h } = cellRect(g, cell)
    const m = { x: x + w / 2, y: y + h / 2 }
    return [
      { x: m.x - w, y: m.y },
      { x: m.x + w, y: m.y },
      { x: m.x, y: m.y - h },
      { x: m.x, y: m.y + h },
    ].some((p) => !inside(fromGrid(g, p)))
  })
}
