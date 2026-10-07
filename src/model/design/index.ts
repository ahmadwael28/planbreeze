/**
 * Suggesting an interior design for the rooms of a floor: for each room, by what it's for and the chosen style, its
 * furniture laid out around its doors and windows, its floor and wall finishes, its ceiling, lights and switches.
 * Nothing changes until a design is applied (in one undo step); each room can be asked for another idea.
 */
import { dot, labelPoint, pointInPolygon, sub } from '../geometry'
import { CEILING_STYLES } from '../lighting'
import { isOutdoor, newSymbol } from '../project'
import { SYMBOL_MAP } from '../symbols'
import type { CeilingStyle, Floor, PlanSymbol, Room, RoomUse, WallSurface } from '../types'
import { facing, local, seeded } from './geom'
import { analyze, boxOf, facePoint, Layout } from './layout'
import type { Analysis, Placed } from './layout'
import { dressWindows, RECIPES, spread } from './recipes'
import type { Ctx, Marks } from './recipes'
import { isWet } from './roles'
import { styleById } from './styles'
import type { DesignStyle, StyleId } from './styles'

export { guessUses, ROOM_USES, USE_NAMES } from './roles'
export { DESIGN_STYLES } from './styles'
export type { StyleId } from './styles'

export interface DesignOptions {
  style: StyleId
  /** Furniture: replace what's there, keep it and add what's missing round it, or leave it alone. */
  furniture: 'replace' | 'add' | 'none'
  floors: boolean
  walls: boolean
  /** Gypsum ceilings and curtain pockets. */
  ceilings: boolean
  /** Lights and their switches (the room's own go, unless kept). */
  lighting: boolean
  /** Curtains and blinds over the windows (the room's own go, unless kept). */
  curtains: boolean
  /** Air conditioning in living rooms and bedrooms. */
  ac: boolean
}

/** The options as saved by an older version (furniture on or off, finishes and lighting as one each). */
export function upgradeOptions(o: Record<string, unknown>): DesignOptions {
  const on = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
  return {
    style: (o.style as StyleId) ?? 'modern',
    furniture: o.furniture === false ? 'none' : o.furniture === 'add' || o.furniture === 'none' ? o.furniture : 'replace',
    floors: on(o.floors, on(o.finishes, true)),
    walls: on(o.walls, on(o.finishes, true)),
    ceilings: on(o.ceilings, on(o.lighting, true)),
    lighting: on(o.lighting, true),
    curtains: on(o.curtains, true),
    ac: on(o.ac, true),
  }
}

export interface RoomDesign {
  roomId: string
  use: RoomUse
  variant: number
  /** Symbols it takes away, and the ones it adds. */
  remove: string[]
  add: PlanSymbol[]
  /** Changes to the room itself: finishes, ceiling. */
  patch: Partial<Room>
}

/** How many tries a room gets: more where the order things go in matters (a tight bathroom), fewer where it hardly does. */
const TRIES: Partial<Record<RoomUse, number>> = { bathroom: 5, ensuite: 5, wc: 4, living: 4, kitchen: 2, balcony: 1, laundry: 2 }

/** What matters most in a room: a design that fits these in beats one that doesn't. */
const WORTH: Record<string, number> = {
  'bed-double': 30,
  'bed-single': 30,
  sofa: 25,
  'sofa-corner': 26,
  'kitchen-sink': 30,
  stove: 15,
  fridge: 12,
  toilet: 30,
  bathtub: 16,
  shower: 15,
  'bath-vanity': 12,
  washbasin: 12,
  'tv-unit': 8,
  wardrobe: 8,
  'dining-table': 12,
  'round-table': 10,
  'kitchen-island': 6,
  desk: 8,
  nightstand: 2,
}

/** Things that stay when a room is redesigned: built in, or not furniture. */
const KEEP = new Set(['column', 'wall-post', 'stairs', 'gypsum-box', 'label'])

const isLight = (s: PlanSymbol) => !!SYMBOL_MAP.get(s.type)?.fixture
/** Lights up on the ceiling don't get in the way of furniture. */
const onCeiling = (s: PlanSymbol) => {
  const f = SYMBOL_MAP.get(s.type)?.fixture
  return !!f && f !== 'switch' && f !== 'wall'
}

/** The symbols in a room (room lights by their room, the rest by where they stand; doors and windows aren't). */
export function inRoom(s: PlanSymbol, room: Room) {
  return s.room ? s.room === room.id : !s.wall && pointInPolygon(s, room.points)
}

const isDressing = (s: PlanSymbol) => s.type === 'curtain' || s.type === 'blind'
/** Furniture: not built in, not a light, not curtains, not a person. */
const isFurniture = (s: PlanSymbol) => !KEEP.has(s.type) && !isLight(s) && !isDressing(s) && s.type !== 'person'

/** Whether a room has furniture a design would replace. */
export function isFurnished(floor: Floor, room: Room) {
  return floor.symbols.some((s) => inRoom(s, room) && isFurniture(s) && !s.keep)
}

/** Kept furniture, ready to stand in for what a recipe asks for: its footprint, and the wall its back is to. */
function keptPiece(s: PlanSymbol, an: Analysis): Placed {
  const box = boxOf(s, an.floor)
  const back = local(box, 0, -box.d / 2)
  const front = { x: -Math.sin((box.rot * Math.PI) / 180), y: Math.cos((box.rot * Math.PI) / 180) }
  const i = an.faces.findIndex((f) => {
    const off = dot(sub(back, f.a), f.inward)
    const at = dot(sub(back, f.a), f.dir)
    return dot(front, f.inward) > 0.99 && Math.abs(off) < 15 && at >= f.s1 - 1 && at <= f.s2 + 1
  })
  return { sym: s, box, kept: true, ...(i >= 0 && { face: i, s: dot(sub(back, an.faces[i].a), an.faces[i].dir) }) }
}

/** A design for one room. */
export function designRoom(floor: Floor, room: Room, use: RoomUse, uses: Map<string, RoomUse>, opts: DesignOptions, variant = 0): RoomDesign {
  const style = styleById(opts.style)
  // What goes: the room's lights, curtains and furniture, as they're being redone; never doors, windows, what's
  // built in, or anything marked to keep.
  const goes = (s: PlanSymbol) => {
    if (!inRoom(s, room) || KEEP.has(s.type) || s.keep) return false
    if (isLight(s)) return opts.lighting
    if (isDressing(s)) return opts.curtains
    if (s.type === 'person') return opts.furniture === 'replace'
    return opts.furniture === 'replace'
  }
  const gone = new Set(floor.symbols.filter(goes).map((s) => s.id))
  const stays = floor.symbols.filter((s) => inRoom(s, room) && !gone.has(s.id) && !s.room)
  const fixed = stays.filter((s) => !onCeiling(s) && !isDressing(s) && s.type !== 'person')
  const an = analyze(room, floor, fixed, uses)
  const kept = fixed.filter(isFurniture).map((s) => keptPiece(s, an))
  const furnish = opts.furniture !== 'none'
  // A few tries, each making some choices differently (a bath or a shower, the order things are tried in): the one
  // that gets the most of what matters into the room wins.
  let ctx: Ctx | null = null
  let best = -1
  for (let attempt = 0; attempt < (furnish ? (TRIES[use] ?? 3) : 1); attempt++) {
    const marks: Marks = { nightstands: [], uppers: [], extra: [] }
    const c: Ctx = { L: new Layout(an, seeded(`${room.id}:${variant}:${attempt}`), attempt ? 6 : 0.01, kept), use, style, variant, attempt, ac: opts.ac, marks }
    if (furnish) RECIPES[use](c)
    const value = c.L.placed.reduce((sum, p) => sum + (p.ghost ? 0 : (WORTH[p.sym.type] ?? 1)), 0)
    if (value > best) {
      best = value
      ctx = c
    }
  }
  const { L, marks } = ctx!
  // Curtains go up where the windows have none left.
  if (opts.curtains) dressWindows(ctx!, stays.filter(isDressing))
  const add = [...(furnish ? L.placed.filter((p) => !p.ghost).map((p) => p.sym) : []), ...marks.extra]
  const patch: Partial<Room> = {}
  if (opts.floors || opts.walls) {
    const f = finishes(an, use, style, marks)
    if (opts.floors) patch.floor = f.floor
    if (opts.walls) Object.assign(patch, { walls: f.walls, wallFinishes: f.wallFinishes })
  }
  if ((opts.lighting || opts.ceilings) && !isOutdoor(room)) {
    const lit = lights(an, use, style, marks, opts)
    if (opts.lighting) add.push(...lit.symbols)
    if (opts.ceilings) Object.assign(patch, lit.patch)
  }
  return { roomId: room.id, use, variant, remove: [...gone], add, patch }
}

/** Put designs into a (draft) floor: the rooms' uses and finishes, their old things out, the new ones in. */
export function applyDesigns(floor: Floor, designs: RoomDesign[]) {
  const gone = new Set(designs.flatMap((d) => d.remove))
  floor.symbols = floor.symbols.filter((s) => !gone.has(s.id))
  for (const d of designs) {
    const room = floor.rooms.find((r) => r.id === d.roomId)
    if (!room) continue
    room.use = d.use
    for (const [k, v] of Object.entries(d.patch)) {
      if (v === undefined) delete (room as unknown as Record<string, unknown>)[k]
      else (room as unknown as Record<string, unknown>)[k] = v
    }
    floor.symbols.push(...d.add)
  }
  // Switches lose the lights that went.
  const ids = new Set(floor.symbols.map((s) => s.id))
  for (const s of floor.symbols) if (s.controls) s.controls = s.controls.filter((id) => ids.has(id))
}

// ---------------------------------------------------------------------------
// Finishes

/** The room's own wall a face is (or stands in front of), if it's really that wall (an accent goes on it). */
function ownEdge(an: Analysis, face: number | undefined): number | undefined {
  if (face === undefined) return undefined
  const f = an.faces[face]
  const a = an.room.points[f.edge]
  return Math.abs(dot(sub(f.a, a), f.inward)) < 0.5 ? f.edge : undefined
}

function finishes(an: Analysis, use: RoomUse, style: DesignStyle, marks: Marks): Partial<Room> {
  const F = style.floors
  const paint = (color: string): WallSurface => ({ finish: 'paint', color })
  const accents: [number | undefined, WallSurface][] = []
  let patch: Partial<Room>
  switch (use) {
    case 'living':
    case 'dining':
      patch = { floor: F.main, walls: paint(style.paint.main) }
      accents.push([ownEdge(an, marks.tvUnit?.face), style.tvWall])
      break
    case 'hall':
      patch = { floor: F.hall, walls: paint(style.paint.main) }
      break
    case 'master':
      patch = { floor: F.bedroom, walls: paint(style.paint.bedroom) }
      accents.push([ownEdge(an, marks.bed?.face), style.bedWall])
      break
    case 'bedroom':
    case 'office':
    case 'dressing':
      patch = { floor: F.bedroom, walls: paint(style.paint.bedroom) }
      break
    case 'kids':
      patch = { floor: F.kids, walls: paint(style.paint.kids) }
      break
    case 'kitchen':
      patch = { floor: F.kitchen, walls: paint(style.paint.main) }
      for (const face of marks.run?.faces ?? []) accents.push([ownEdge(an, face), style.splash])
      break
    case 'bathroom':
    case 'wc':
      patch = { floor: F.wet, walls: style.bathWalls }
      break
    case 'ensuite':
      patch = { floor: F.wet, walls: style.ensuiteWalls }
      break
    case 'laundry':
      patch = { floor: F.wet, walls: paint(style.paint.main) }
      break
    case 'balcony':
      patch = { floor: F.outdoor }
      break
  }
  const per = an.room.points.map((): WallSurface | null => null)
  for (const [edge, s] of accents) if (edge !== undefined) per[edge] = s
  patch.wallFinishes = per.some(Boolean) ? per : undefined
  return patch
}

// ---------------------------------------------------------------------------
// Ceilings, lights and switches

const sym = (type: string, p: { x: number; y: number }, extra: Partial<PlanSymbol> = {}): PlanSymbol => ({
  ...newSymbol(type, Math.round(p.x), Math.round(p.y)),
  ...extra,
})

function lights(an: Analysis, use: RoomUse, style: DesignStyle, marks: Marks, opts: DesignOptions): { symbols: PlanSymbol[]; patch: Partial<Room> } {
  const room = an.room
  const out: PlanSymbol[] = []
  const wet = isWet(use)
  // The ceiling suggested, or (if ceilings are left alone) the room's own.
  const suggested: CeilingStyle = use === 'living' && an.area >= 12 ? 'cove' : use === 'master' || (use === 'dining' && an.area >= 10) ? 'tray' : 'flat'
  const ceiling: CeilingStyle | undefined = opts.ceilings ? suggested : room.ceiling?.style
  const patch: Partial<Room> = { ceiling: { style: suggested, ...CEILING_STYLES[suggested].defaults }, shadowGaps: undefined, curtainPockets: undefined }
  // Curtains hide up in pockets in the ceiling, lit in the living room and master bedroom.
  const pocketWalls = !opts.ceilings
    ? (room.curtainPockets ?? [])
    : use === 'living' || use === 'master' || use === 'bedroom'
      ? [...new Set(an.openings.filter((o) => o.glazed).map((o) => ownEdge(an, o.face)).filter((e): e is number => e !== undefined))]
      : []
  if (opts.ceilings && pocketWalls.length) patch.curtainPockets = pocketWalls
  const roomLight = (type: string) => {
    const s = sym(type, labelPoint(room.points), { room: room.id })
    out.push(s)
    return s
  }
  const main: PlanSymbol[] = []
  const mood: PlanSymbol[] = []
  const curtains: PlanSymbol[] = []
  const pendants: PlanSymbol[] = []
  const bedside: PlanSymbol[] = []
  const counter: PlanSymbol[] = [...marks.uppers.map((p) => p.sym), ...(marks.hood ? [marks.hood.sym] : [])]
  const mirror: PlanSymbol[] = marks.vanity ? [marks.vanity.sym] : []
  if (ceiling && ceiling !== 'flat') mood.push(roomLight('cove-light'))
  if (pocketWalls.length && (use === 'living' || use === 'master')) curtains.push(roomLight('pocket-light'))

  const band = ceiling ? CEILING_STYLES[ceiling].defaults.band : 0
  const spotted = ['living', 'kitchen', 'dining', 'hall', 'office', 'dressing', 'bathroom', 'ensuite', 'wc', 'laundry'].includes(use)
  if (spotted) {
    const inset = band ? band + 30 : wet ? 40 : 55
    const light = wet ? { color: 'cool' as const, brightness: 1 } : undefined
    for (const p of spread(room.points, inset, use === 'hall' || use === 'living' ? 150 : 130)) {
      const s = sym('spot', p, light ? { light } : {})
      out.push(s)
      main.push(s)
    }
  }
  const middle = marks.bed ? local(marks.bed.box, 0, marks.bed.box.d / 2 + 10) : labelPoint(room.points)
  if (use === 'master') main.push(sym('chandelier', pointInPolygon(middle, room.points) ? middle : labelPoint(room.points), { style: style.chandelier }))
  if (use === 'bedroom') main.push(sym('light', labelPoint(room.points)))
  if (use === 'kids') main.push(sym('pendant', labelPoint(room.points), { style: 'drum' }))
  out.push(...main.filter((s) => !out.includes(s)))
  // Over the table, over an island.
  const t = marks.table
  if (t) {
    const w = t.sym.width
    pendants.push(
      w >= 160 && t.sym.type === 'dining-table'
        ? sym('linear-pendant', t.box, { rotation: t.box.rot, width: Math.min(w - 40, 160) })
        : sym('pendant', t.box, { style: style.pendant }),
    )
  }
  if (marks.island) for (const sx of [-1, 1]) pendants.push(sym('pendant', local(marks.island.box, (sx * marks.island.box.w) / 4, -13.5), { style: style.pendant }))
  out.push(...pendants)
  // Wall lights over the nightstands.
  for (const n of marks.nightstands) {
    const p = local(n.box, 0, -n.box.d / 2 + 7.5)
    bedside.push(sym('wall-light', p, { rotation: n.box.rot, elevation: 140 }))
  }
  out.push(...bedside)

  // Switches by the way in, on the side the door opens away from.
  const groups: [string, PlanSymbol[]][] = [
    ['Lights', main],
    [use === 'kitchen' ? 'Pendants' : 'Table', pendants],
    ['Mood', mood],
    ['Curtains', curtains],
    ['Counter', counter],
    ['Mirror', mirror],
  ]
  out.push(...switchesAt(an, groups.filter(([, l]) => l.length)))
  // And by the bed, for its lights.
  if (marks.bed && bedside.length) {
    const b = marks.bed.box
    const p = local(b, b.w / 2 + 12, -b.d / 2 + 10)
    out.push(sym('switch', p, { label: 'Bedside', rotation: b.rot, height: 75, controls: [...bedside, ...main].map((s) => s.id) }))
  }
  return { symbols: out, patch }
}

/** Switches beside the way in, side by side, each for a group of lights. */
function switchesAt(an: Analysis, groups: [string, PlanSymbol[]][]): PlanSymbol[] {
  const e = an.entry
  if (!e || !groups.length) return []
  const f = an.faces[e.face]
  // On the side away from the hinge (where the hand reaches as the door opens), else the other.
  const latch = e.hinge === 0 ? 1 : -e.hinge
  for (const side of [latch, -latch]) {
    const ss = groups.map((_, k) => e.s + side * (e.w / 2 + 15 + k * 20))
    const ok = ss.every((s) => s > f.s1 + 10 && s < f.s2 - 10 && !an.openings.some((o) => o.face === e.face && o !== e && Math.abs(o.s - s) < o.w / 2 + 12))
    if (!ok) continue
    return groups.map(([label, lights], k) => sym('switch', facePoint(f, ss[k], 10), { label, rotation: facing(f.inward), controls: lights.map((l) => l.id) }))
  }
  return []
}
