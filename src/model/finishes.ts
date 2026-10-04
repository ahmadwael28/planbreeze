/**
 * Finishes for floors and walls: tiles (ceramic, porcelain, marble), planks (HDF laminate, SPC vinyl, parquet), plain
 * surfaces (carpet, microcement), and on walls paint, wallpaper and wood slats; the colors and sizes they come in, and
 * how their pieces are laid (the plan draws their lines, the 3D view a texture of them). Any of them can show a photo
 * of the real thing instead of a color.
 */
import type { FrameColor } from './symbols'
import type { Finish, FloorFinish, FloorPattern, Point, Room, Surface, WallFinish, WallSurface } from './types'

export type Place = 'floor' | 'wall'

interface FinishDef {
  name: string
  /** Pieces laid in a pattern (tiles, planks, slats), a seamless surface, wallpaper, or paint. */
  kind: 'tile' | 'plank' | 'slats' | 'plain' | 'paper' | 'paint'
  /** Colors it comes in (the first is the default). */
  colors: FrameColor[]
  /** Tile sides, plank width × length, or slat width × the gap between (cm), on floors; the first is the default. */
  sizes: [number, number][]
  /** …and on walls, when they're different. */
  wallSizes?: [number, number][]
  patterns: FloorPattern[]
  roughness: number
  /** Joint between tiles (cm). */
  grout?: number
  /** Wallpaper designs, and the size of one repeat of each (cm). */
  designs?: { id: string; name: string; repeat: [number, number] }[]
  hint: string
}

const TILE_PATTERNS: FloorPattern[] = ['straight', 'offset', 'diagonal', 'herringbone', 'chevron']
const PLANK_PATTERNS: FloorPattern[] = ['straight', 'herringbone', 'chevron']

export const FINISHES: Record<Finish, FinishDef> = {
  ceramic: {
    name: 'Ceramic tile',
    kind: 'tile',
    colors: [
      { name: 'White', hex: '#efece6' },
      { name: 'Cream', hex: '#e7dbc5' },
      { name: 'Beige', hex: '#d5c0a1' },
      { name: 'Grey', hex: '#a9a8a3' },
      { name: 'Blue grey', hex: '#8b98a3' },
      { name: 'Sage', hex: '#9fae98' },
      { name: 'Terracotta', hex: '#b5693f' },
    ],
    sizes: [
      [40, 40],
      [30, 30],
      [45, 45],
      [60, 60],
      [30, 60],
    ],
    wallSizes: [
      [30, 60],
      [25, 40],
      [20, 20],
      [15, 15],
      [10, 30],
      [7.5, 15],
    ],
    patterns: TILE_PATTERNS,
    roughness: 0.4,
    grout: 0.3,
    hint: 'Glazed ceramic, for bathrooms and kitchens.',
  },
  porcelain: {
    name: 'Porcelain tile',
    kind: 'tile',
    colors: [
      { name: 'Carrara white', hex: '#ebe9e5' },
      { name: 'Ivory', hex: '#e5dbca' },
      { name: 'Light grey', hex: '#c6c5c1' },
      { name: 'Warm grey', hex: '#9c958d' },
      { name: 'Wood look', hex: '#b48a62' },
      { name: 'Anthracite', hex: '#4a4c4f' },
      { name: 'Black', hex: '#26272a' },
    ],
    sizes: [
      [60, 60],
      [60, 120],
      [80, 80],
      [120, 120],
      [30, 60],
      [20, 120],
    ],
    wallSizes: [
      [30, 60],
      [60, 120],
      [60, 60],
      [7.5, 30],
      [20, 120],
    ],
    patterns: TILE_PATTERNS,
    roughness: 0.22,
    grout: 0.2,
    hint: 'Dense and hard wearing, in large formats with thin joints.',
  },
  marble: {
    name: 'Marble',
    kind: 'tile',
    colors: [
      { name: 'Galala', hex: '#e8dbc1' },
      { name: 'Carrara', hex: '#f1f0ed' },
      { name: 'Calacatta', hex: '#f3eee5' },
      { name: 'Crema Marfil', hex: '#e1d0b2' },
      { name: 'Emperador', hex: '#6b4a35' },
      { name: 'Nero Marquina', hex: '#1f1f22' },
    ],
    sizes: [
      [60, 60],
      [80, 80],
      [60, 120],
      [40, 80],
    ],
    wallSizes: [
      [60, 120],
      [30, 60],
      [60, 60],
      [40, 80],
    ],
    patterns: TILE_PATTERNS,
    roughness: 0.12,
    grout: 0.1,
    hint: 'Polished natural stone, veined.',
  },
  hdf: {
    name: 'HDF laminate',
    kind: 'plank',
    colors: [
      { name: 'Natural oak', hex: '#c9a27a' },
      { name: 'Light oak', hex: '#dcc09b' },
      { name: 'White oak', hex: '#e2d5c2' },
      { name: 'Grey oak', hex: '#a39a8f' },
      { name: 'Smoked oak', hex: '#7e6a57' },
      { name: 'Walnut', hex: '#6d4b33' },
    ],
    sizes: [
      [19, 138],
      [24, 138],
      [19, 120],
    ],
    patterns: PLANK_PATTERNS,
    roughness: 0.55,
    hint: 'Wood-look laminate planks.',
  },
  spc: {
    name: 'SPC vinyl',
    kind: 'plank',
    colors: [
      { name: 'Natural oak', hex: '#c4a07b' },
      { name: 'Honey oak', hex: '#cd9e65' },
      { name: 'Whitewash', hex: '#dcd4c8' },
      { name: 'Ash grey', hex: '#b2aca3' },
      { name: 'Stone grey', hex: '#9a9893' },
      { name: 'Dark walnut', hex: '#5b4130' },
    ],
    sizes: [
      [18, 122],
      [23, 152],
      [12, 60],
    ],
    patterns: PLANK_PATTERNS,
    roughness: 0.45,
    hint: 'Waterproof rigid vinyl planks, good for wet areas.',
  },
  parquet: {
    name: 'Parquet',
    kind: 'plank',
    colors: [
      { name: 'Oak', hex: '#b88a5a' },
      { name: 'Maple', hex: '#dfc398' },
      { name: 'Teak', hex: '#a06f3f' },
      { name: 'Walnut', hex: '#6a4931' },
      { name: 'Mahogany', hex: '#7a3f2a' },
    ],
    sizes: [
      [9, 45],
      [7, 35],
      [12, 60],
    ],
    patterns: ['herringbone', 'chevron', 'straight'],
    roughness: 0.48,
    hint: 'Solid wood blocks, usually laid in herringbone or chevron.',
  },
  carpet: {
    name: 'Carpet',
    kind: 'plain',
    colors: [
      { name: 'Beige', hex: '#cbbfad' },
      { name: 'Sand', hex: '#d8c7a8' },
      { name: 'Grey', hex: '#8f8f8d' },
      { name: 'Charcoal', hex: '#4a4a4a' },
      { name: 'Navy', hex: '#2c3a55' },
      { name: 'Burgundy', hex: '#6e2b33' },
    ],
    sizes: [],
    patterns: [],
    roughness: 1,
    hint: 'Wall-to-wall carpet.',
  },
  concrete: {
    name: 'Microcement',
    kind: 'plain',
    colors: [
      { name: 'Light', hex: '#c9c7c2' },
      { name: 'Warm', hex: '#b8aa98' },
      { name: 'Mid grey', hex: '#a09d97' },
      { name: 'Dark', hex: '#6d6b67' },
    ],
    sizes: [],
    patterns: [],
    roughness: 0.7,
    hint: 'A seamless troweled cement finish.',
  },
  paint: {
    name: 'Paint',
    kind: 'paint',
    colors: [
      { name: 'White', hex: '#f3f1ec' },
      { name: 'Off white', hex: '#ebe4d6' },
      { name: 'Greige', hex: '#cfc5b6' },
      { name: 'Light grey', hex: '#c8cacb' },
      { name: 'Sage', hex: '#a7b39e' },
      { name: 'Dusty blue', hex: '#9db0bf' },
      { name: 'Blush', hex: '#dcb9ad' },
      { name: 'Terracotta', hex: '#c07a5a' },
      { name: 'Olive', hex: '#7b7d5a' },
      { name: 'Navy', hex: '#2f3d55' },
      { name: 'Charcoal', hex: '#48494b' },
    ],
    sizes: [],
    patterns: [],
    roughness: 0.92,
    hint: 'Matt emulsion in any color.',
  },
  wallpaper: {
    name: 'Wallpaper',
    kind: 'paper',
    colors: [
      { name: 'Cream', hex: '#ece3cf' },
      { name: 'Sage', hex: '#a9b49c' },
      { name: 'Blue grey', hex: '#9aa8b3' },
      { name: 'Blush', hex: '#d9b8ab' },
      { name: 'Ochre', hex: '#c99a4b' },
      { name: 'Navy', hex: '#2e3a52' },
      { name: 'Charcoal', hex: '#3f4042' },
    ],
    sizes: [],
    patterns: [],
    roughness: 0.85,
    designs: [
      { id: 'linen', name: 'Linen', repeat: [53, 53] },
      { id: 'stripes', name: 'Stripes', repeat: [53, 53] },
      { id: 'geometric', name: 'Geometric', repeat: [53, 53] },
      { id: 'botanical', name: 'Botanical', repeat: [53, 64] },
    ],
    hint: 'Rolls 53 cm wide; add a photo of the one you like.',
  },
  slats: {
    name: 'Wood slats',
    kind: 'slats',
    colors: [
      { name: 'Oak', hex: '#c09466' },
      { name: 'Light oak', hex: '#d8bd96' },
      { name: 'Walnut', hex: '#6a4a32' },
      { name: 'Grey', hex: '#8e8b86' },
      { name: 'Black', hex: '#2a2a2b' },
      { name: 'White', hex: '#ecebe7' },
    ],
    sizes: [],
    wallSizes: [
      [3, 1.5],
      [2, 1],
      [4, 2],
      [6, 2],
    ],
    patterns: [],
    roughness: 0.6,
    hint: 'Fluted wood (or WPC) panels with grooves between the slats.',
  },
}

export const FLOOR_GROUPS: [string, FloorFinish[]][] = [
  ['Tiles', ['ceramic', 'porcelain', 'marble']],
  ['Planks', ['hdf', 'spc', 'parquet']],
  ['Other', ['carpet', 'concrete']],
]

export const WALL_GROUPS: [string, WallFinish[]][] = [
  ['Paint and paper', ['paint', 'wallpaper']],
  ['Tiles', ['ceramic', 'porcelain', 'marble']],
  ['Other', ['slats', 'concrete']],
]

export const PATTERN_NAMES: Record<FloorPattern, string> = {
  straight: 'Straight',
  offset: 'Offset (brick)',
  diagonal: 'Diagonal',
  herringbone: 'Herringbone',
  chevron: 'Chevron',
}

/** Herringbone and chevron need tiles at least about twice as long as they're wide. */
export function patternsFor(def: FinishDef, size: [number, number] | undefined): FloorPattern[] {
  if (def.kind !== 'tile' || !size) return def.patterns
  const long = Math.max(...size) / Math.min(...size) >= 1.9
  return def.patterns.filter((p) => long || (p !== 'herringbone' && p !== 'chevron'))
}

/** The size a photo covers on a seamless finish (wallpaper repeat, carpet) when none is set. */
const PHOTO_REPEAT: [number, number] = [53, 53]

/** A floor's or wall's finish with every choice filled in. */
export function finishOf(s: Surface, place: Place = 'floor') {
  const def = FINISHES[s.finish]
  const sizes = place === 'wall' ? (def.wallSizes ?? def.sizes) : def.sizes
  const design = def.designs && (def.designs.find((d) => d.id === s.design) ?? def.designs[0])
  const size: [number, number] | undefined = s.size ?? sizes[0] ?? (s.image ? PHOTO_REPEAT : design?.repeat)
  const patterns = patternsFor(def, size)
  return {
    def,
    sizes,
    color: s.color ?? def.colors[0].hex,
    size,
    patterns,
    pattern: s.pattern && patterns.includes(s.pattern) ? s.pattern : (patterns[0] ?? 'straight'),
    design,
  }
}

/** One piece of a finish in a layout block: its outline, which way it runs, and which piece it is (for its shade). */
export interface FloorPiece {
  pts: Point[]
  axis: Point
  id: number
}

export interface Layout {
  /** The size of one block, which repeats seamlessly (pieces may cross its edges and carry on from the other side). */
  block: [number, number]
  pieces: FloorPiece[]
  /** The angle the block is laid at (degrees). */
  angle: number
}

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
]

/**
 * Herringbone: planks w × len at right angles, laid out square to the axes as a staircase of alternating ones, then
 * turned 45°. It repeats every √2·len across and √2·w down.
 */
function herringbone(w: number, len: number): Omit<Layout, 'angle'> {
  const s = Math.SQRT1_2
  const turn45 = (u: number, v: number): Point => ({ x: (u - v) * s, y: (u + v) * s })
  const rows = Math.max(1, Math.round(len / w))
  const W = Math.SQRT2 * len
  const H = rows * Math.SQRT2 * w
  const pieces: FloorPiece[] = []
  const n = Math.ceil(len / w)
  for (let k = -n - 3; k <= rows + n + 3; k++) {
    for (let m = -3; m <= 3; m++) {
      const u = k * w - m * len
      const v = k * w + m * len
      const shapes: [Point[], Point][] = [
        [[turn45(u, v), turn45(u + len, v), turn45(u + len, v + w), turn45(u, v + w)], { x: s, y: s }],
        [[turn45(u, v + w), turn45(u + w, v + w), turn45(u + w, v + w + len), turn45(u, v + w + len)], { x: -s, y: s }],
      ]
      shapes.forEach(([pts, axis], t) => {
        const xs = pts.map((p) => p.x)
        const ys = pts.map((p) => p.y)
        if (Math.max(...xs) <= 0 || Math.min(...xs) >= W || Math.max(...ys) <= 0 || Math.min(...ys) >= H) return
        // The same id for a piece and its copies a block away, so they get the same shade.
        pieces.push({ pts, axis, id: ((((k % rows) + rows) % rows) * 2 + t) % 97 })
      })
    }
  }
  return { block: [W, H], pieces }
}

/**
 * Chevron: planks w × len cut at 45° at both ends, meeting in a row of V shapes. Columns of them lean one way, then the
 * other; each is a parallelogram with its cut ends on the lines where they meet.
 */
function chevron(w: number, len: number): Omit<Layout, 'angle'> {
  const c = Math.SQRT1_2
  const X = len * c // how far across one reaches
  const h = w / c // its cut end
  const rows = Math.max(1, Math.round((2 * X) / h))
  const pieces: FloorPiece[] = []
  for (let r = 0; r < rows; r++) {
    const y = r * h
    pieces.push({
      pts: [
        { x: 0, y },
        { x: X, y: y + X },
        { x: X, y: y + X + h },
        { x: 0, y: y + h },
      ],
      axis: { x: c, y: c },
      id: r * 2,
    })
    pieces.push({
      pts: [
        { x: X, y: y + X },
        { x: 2 * X, y },
        { x: 2 * X, y: y + h },
        { x: X, y: y + X + h },
      ],
      axis: { x: c, y: -c },
      id: r * 2 + 1,
    })
  }
  return { block: [2 * X, rows * h], pieces }
}

/** How a finish's pieces are laid (in the plan's or the wall's own coordinates). Null for seamless finishes. */
export function surfaceLayout(s: Surface, place: Place = 'floor'): Layout | null {
  const { def, size, pattern } = finishOf(s, place)
  if (!size || !['tile', 'plank', 'slats'].includes(def.kind)) return null
  const turn = s.turned ? 90 : 0
  const along = { x: 1, y: 0 }
  const [w, len] = [Math.min(...size), Math.max(...size)]
  if (def.kind === 'slats') {
    // Upright slats with grooves between them.
    const [slat, gap] = size
    const n = Math.max(4, Math.round(60 / (slat + gap)))
    const H = 120
    const pieces = Array.from({ length: n }, (_, i) => ({ pts: rect(i * (slat + gap) + gap / 2, -1, slat, H + 2), axis: { x: 0, y: 1 }, id: i }))
    return { block: [n * (slat + gap), H], pieces, angle: turn }
  }
  if (pattern === 'herringbone') return { ...herringbone(w, len), angle: turn }
  if (pattern === 'chevron') return { ...chevron(w, len), angle: turn }
  if (def.kind === 'tile') {
    // The long side across (x), the short down (y).
    const cols = Math.max(2, Math.round(240 / len))
    const rows = Math.max(2, Math.round(240 / w))
    const pieces: FloorPiece[] = []
    for (let r = 0; r < rows; r++) {
      const shift = pattern === 'offset' && r % 2 ? len / 2 : 0
      for (let c = 0; c < cols; c++) pieces.push({ pts: rect(c * len + shift, r * w, len, w), axis: along, id: r * cols + c })
    }
    return { block: [cols * len, rows * w], pieces, angle: (pattern === 'diagonal' ? 45 : 0) + turn }
  }
  // Straight planks: rows of them with their ends staggered, two lengths across.
  const rows = Math.max(4, Math.round(160 / w))
  const pieces: FloorPiece[] = []
  let prev = -1
  for (let r = 0; r < rows; r++) {
    // A spread-out stagger that never lines up with the row before.
    let off = (((r * 0.618034) % 1) * len + len * 0.17 * (r % 3)) % len
    if (prev >= 0 && Math.abs(off - prev) < len * 0.22) off = (off + len * 0.4) % len
    prev = off
    for (let k = -1; k <= 1; k++) pieces.push({ pts: rect(off + k * len, r * w, len, w), axis: along, id: r * 2 + (((k % 2) + 2) % 2) })
  }
  return { block: [2 * len, rows * w], pieces, angle: turn }
}

/** Area per finish (and color, size, pattern) of these surfaces, in cm². */
export function finishAreas<S extends Surface>(items: { surface: S; area: number }[], place: Place): { surface: S; area: number }[] {
  const out = new Map<string, { surface: S; area: number }>()
  for (const { surface, area } of items) {
    if (area <= 0) continue
    const f = finishOf(surface, place)
    const key = JSON.stringify([surface.finish, surface.image ?? f.color, f.size, f.pattern, f.design?.id])
    const e = out.get(key) ?? { surface, area: 0 }
    e.area += area
    out.set(key, e)
  }
  return [...out.values()]
}

/** Floor area per finish over these rooms, in cm². */
export function floorAreas(rooms: Room[], area: (r: Room) => number) {
  return finishAreas(
    rooms.filter((r) => r.floor).map((r) => ({ surface: r.floor!, area: area(r) })),
    'floor',
  )
}

/** The finish on one of a room's walls: its own, or the room's. */
export function wallSurfaceAt(room: Room, edge: number): WallSurface | undefined {
  return room.wallFinishes?.[edge] ?? room.walls
}

/** Plain white walls: what's under the paint above tiles, and walls with no finish. */
export const WALL_WHITE = '#f3f1ec'

/**
 * The finishes up one wall, from the floor: tiles or slats up to their height and paint above them, or one finish all
 * the way up (to `top`).
 */
export function wallBands(s: WallSurface, top: number): { surface: WallSurface; z0: number; z1: number }[] {
  const kind = FINISHES[s.finish].kind
  const h = (kind === 'tile' || kind === 'slats') && s.height ? Math.min(s.height, top) : top
  const bands = [{ surface: s, z0: 0, z1: h }]
  if (h < top - 0.5) bands.push({ surface: { finish: 'paint', color: s.above ?? WALL_WHITE }, z0: h, z1: top })
  return bands
}

/** Finishes laid from the floor up, so a wall with them has no skirting board. */
export const startsAtFloor = (s: WallSurface | undefined) => !!s && ['tile', 'slats'].includes(FINISHES[s.finish].kind)
