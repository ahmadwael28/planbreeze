/**
 * Floor finishes: tiles (ceramic, porcelain, marble), planks (HDF laminate, SPC vinyl, parquet) and plain surfaces
 * (carpet, microcement), with the colors and sizes they come in, and how their pieces are laid (the plan draws
 * their lines, the 3D view a texture of them).
 */
import type { FrameColor } from './symbols'
import type { FloorFinish, FloorPattern, Point, Room, RoomFloor } from './types'

interface FinishDef {
  name: string
  kind: 'tile' | 'plank' | 'plain'
  /** Colors it comes in (the first is the default). */
  colors: FrameColor[]
  /** Tile sides, or plank width × length (cm); the first is the default. */
  sizes: [number, number][]
  patterns: FloorPattern[]
  roughness: number
  /** Joint between tiles (cm). */
  grout?: number
  hint: string
}

export const FLOOR_FINISHES: Record<FloorFinish, FinishDef> = {
  ceramic: {
    name: 'Ceramic tile',
    kind: 'tile',
    colors: [
      { name: 'White', hex: '#efece6' },
      { name: 'Cream', hex: '#e7dbc5' },
      { name: 'Beige', hex: '#d5c0a1' },
      { name: 'Grey', hex: '#a9a8a3' },
      { name: 'Blue grey', hex: '#8b98a3' },
      { name: 'Terracotta', hex: '#b5693f' },
    ],
    sizes: [
      [40, 40],
      [30, 30],
      [45, 45],
      [60, 60],
      [30, 60],
    ],
    patterns: ['straight', 'offset', 'diagonal'],
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
      { name: 'Anthracite', hex: '#4a4c4f' },
      { name: 'Black', hex: '#26272a' },
    ],
    sizes: [
      [60, 60],
      [60, 120],
      [80, 80],
      [120, 120],
      [30, 60],
    ],
    patterns: ['straight', 'offset', 'diagonal'],
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
    patterns: ['straight', 'offset', 'diagonal'],
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
    patterns: ['straight', 'herringbone'],
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
    ],
    patterns: ['straight', 'herringbone'],
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
    patterns: ['herringbone', 'straight'],
    roughness: 0.48,
    hint: 'Solid wood blocks, usually laid in herringbone.',
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
}

/** A room's floor with every choice filled in. */
export function floorOf(floor: RoomFloor) {
  const def = FLOOR_FINISHES[floor.finish]
  const size = floor.size ?? def.sizes[0]
  return {
    def,
    color: floor.color ?? def.colors[0].hex,
    size,
    pattern: floor.pattern && def.patterns.includes(floor.pattern) ? floor.pattern : (def.patterns[0] ?? 'straight'),
  }
}

/** One piece of floor in a layout block: its outline, which way it runs, and which piece it is (for its shade). */
export interface FloorPiece {
  pts: Point[]
  axis: Point
  id: number
}

/**
 * How a floor's pieces are laid: one block of them that repeats seamlessly (pieces may cross its edges and carry on
 * from the other side), and the angle the block is laid at (degrees). Null for plain finishes.
 */
export function floorLayout(floor: RoomFloor): { block: [number, number]; pieces: FloorPiece[]; angle: number } | null {
  const { def, size, pattern } = floorOf(floor)
  if (def.kind === 'plain' || !size) return null
  const turn = floor.turned ? 90 : 0
  const rect = (x: number, y: number, w: number, h: number): Point[] => [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
  const along = { x: 1, y: 0 }
  if (def.kind === 'tile') {
    // The long side across (x), the short down (y).
    const [a, b] = [Math.min(...size), Math.max(...size)]
    const cols = Math.max(2, Math.round(240 / b))
    const rows = Math.max(2, Math.round(240 / a))
    const pieces: FloorPiece[] = []
    for (let r = 0; r < rows; r++) {
      const shift = pattern === 'offset' && r % 2 ? b / 2 : 0
      for (let c = 0; c < cols; c++) pieces.push({ pts: rect(c * b + shift, r * a, b, a), axis: along, id: r * cols + c })
    }
    return { block: [cols * b, rows * a], pieces, angle: (pattern === 'diagonal' ? 45 : 0) + turn }
  }
  const [w, len] = [Math.min(...size), Math.max(...size)]
  if (pattern === 'herringbone') {
    // Laid out with the planks square to the axes (a staircase of alternating ones), then turned 45°, which makes it
    // repeat every √2·width down and n·√2·width across, n the planks' length in widths.
    const n = Math.max(2, Math.round(len / w))
    const s = Math.SQRT1_2
    const turn45 = (u: number, v: number): Point => ({ x: (u - v) * s * w, y: (u + v) * s * w })
    const side = n * Math.SQRT2 * w
    const pieces: FloorPiece[] = []
    const range = 3 * n + 3
    for (let k = -range; k <= range; k++) {
      for (let m = -3; m <= 3; m++) {
        const u = k - n * m
        const v = k + n * m
        const shapes: [Point[], Point][] = [
          [[turn45(u, v), turn45(u + n, v), turn45(u + n, v + 1), turn45(u, v + 1)], { x: s, y: s }],
          [[turn45(u, v + 1), turn45(u + 1, v + 1), turn45(u + 1, v + 1 + n), turn45(u, v + 1 + n)], { x: -s, y: s }],
        ]
        shapes.forEach(([pts, axis], t) => {
          const xs = pts.map((p) => p.x)
          const ys = pts.map((p) => p.y)
          if (Math.max(...xs) < 0 || Math.min(...xs) > side || Math.max(...ys) < 0 || Math.min(...ys) > side) return
          pieces.push({ pts, axis, id: ((((k % n) + n) % n) * 2 + t) % 64 })
        })
      }
    }
    return { block: [side, side], pieces, angle: turn }
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

/** Floor area per finish (and size) over these rooms, in cm². */
export function floorAreas(rooms: Room[], area: (r: Room) => number): { floor: RoomFloor; area: number }[] {
  const out = new Map<string, { floor: RoomFloor; area: number }>()
  for (const r of rooms) {
    if (!r.floor) continue
    const f = floorOf(r.floor)
    const key = `${r.floor.finish}|${f.color}|${f.size?.join('x') ?? ''}|${f.pattern}`
    const e = out.get(key) ?? { floor: r.floor, area: 0 }
    e.area += area(r)
    out.set(key, e)
  }
  return [...out.values()]
}
