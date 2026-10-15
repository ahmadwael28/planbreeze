/**
 * Layouts of several tiles on one floor or wall: the tiles as a grid, which tile goes in each place on it, and quick
 * ways to fill it (a checkerboard, a random mix, a border).
 *
 * The grid is the one the finish is laid in (see surfaceLayout): straight, brick (offset) or diagonal tiles, the long
 * side across. Places on it are numbered from where the finish is laid from, in the grid's own frame `G`, which is the
 * surface's turned by the layout's angle: G = R(-angle) · q, with q the surface's coordinates y down (a floor: the plan
 * from its origin; a wall: along it, and down from the floor, i.e. minus the height). The plan, the 3D view and the
 * layout editor all place tiles this way, so they agree.
 */
import { finishOf, surfaceLayout } from './finishes'
import type { Place } from './finishes'
import { pointInPolygon } from './geometry'
import type { Point, Surface, TileMix } from './types'

export interface TileGrid {
  /** A tile's long side (across, x) and short side (down, y), cm. */
  len: number
  w: number
  /** Every other row shifted by half a tile (brick bond). */
  offset: boolean
  /** The angle the grid is laid at (degrees), as in Layout. */
  angle: number
}

/** A place on the grid: column and row. */
export interface Cell {
  c: number
  r: number
}

/** A surface's tiles as a grid, when they're laid in one (straight, brick or diagonal tiles); null otherwise. */
export function tileGrid(s: Surface, place: Place): TileGrid | null {
  const f = finishOf(s, place)
  if (f.def.kind !== 'tile' || !f.size || !['straight', 'offset', 'diagonal'].includes(f.pattern)) return null
  const layout = surfaceLayout(s, place)
  if (!layout) return null
  return { len: Math.max(...f.size), w: Math.min(...f.size), offset: f.pattern === 'offset', angle: layout.angle }
}

const rad = (deg: number) => (deg * Math.PI) / 180

/** Surface coordinates (y down) to the grid's frame. */
export function toGrid(g: TileGrid, q: Point): Point {
  const a = rad(g.angle)
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: c * q.x + s * q.y, y: -s * q.x + c * q.y }
}

/** The grid's frame to surface coordinates (y down). */
export function fromGrid(g: TileGrid, p: Point): Point {
  const a = rad(g.angle)
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: c * p.x - s * p.y, y: s * p.x + c * p.y }
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
