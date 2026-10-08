/**
 * What goes in each kind of room, and where. Each recipe places its main piece first (the bed, the TV wall, the
 * kitchen units, the bath) on the wall that suits it best, or another wall for another idea, then what goes with it,
 * then the rest as long as it fits and leaves the room easy to walk through.
 */
import { add, area, bbox, dist, dot, labelPoint, mul, offsetPolygon, pointInPolygon, signedArea, sub } from '../geometry'
import { newSymbol } from '../project'
import { HOOD_STYLES, tvSize } from '../symbols'
import type { Floor, PlanSymbol, Point, RoomUse } from '../types'
import { againstWall, axes, facing, local, overlaps, toLocal } from './geom'
import type { Box } from './geom'
import { facePoint } from './layout'
import type { Analysis, Cand, Layout, Opening, Placed } from './layout'
import type { DesignStyle } from './styles'

/** What the recipes placed that the lights and finishes go by. */
export interface Marks {
  bed?: Placed
  nightstands: Placed[]
  tvUnit?: Placed
  table?: Placed
  island?: Placed
  /** The walls the kitchen units run along. */
  run?: { faces: number[] }
  hood?: Placed
  uppers: Placed[]
  vanity?: Placed
  wet?: Placed
  /** Things in the walls or over the windows, not laid out on the floor: niches, curtains, blinds. */
  extra: PlanSymbol[]
}

export interface Ctx {
  L: Layout
  use: RoomUse
  /** What every room on the floor is for (a washing machine goes in the laundry, if there's one). */
  uses: Map<string, RoomUse>
  style: DesignStyle
  variant: number
  /** Which try at the room this is (each makes some choices differently). */
  attempt: number
  ac: boolean
  marks: Marks
}

type SlotCand = Cand & { snug?: boolean }

const ZONE_TOP = 140
const LIT = { color: 'warm' as const, brightness: 1 }

/** Floor kept clear, in an item's own frame: centered at (lx, ly), w across and d deep. */
function zone(b: Box, lx: number, ly: number, w: number, d: number): Box {
  const c = local(b, lx, ly)
  return { x: c.x, y: c.y, w, d, rot: b.rot, z0: 0, z1: ZONE_TOP }
}

const before = (b: Box, off = 35) => local(b, 0, b.d / 2 + off)
const doorPoint = (an: Analysis, o: Opening) => facePoint(an.faces[o.face], o.s)
const faceLen = (an: Analysis, i: number) => an.faces[i].s2 - an.faces[i].s1

/** Candidates along the walls for an item w × d (its back to the wall), with `clear` cm kept free in front. */
function wallCands(
  L: Layout,
  type: string,
  w: number,
  d: number,
  z0: number,
  z1: number,
  o: { clear?: number; clearW?: number; reach?: boolean; extra?: Partial<PlanSymbol>; step?: number; through?: Box[] } = {},
): SlotCand[] {
  return L.wallSlots(w, d, z0, z1, o.step ?? 10).map((sl) => ({
    sym: L.sym(type, sl.box, { width: w, depth: d, ...o.extra }),
    box: sl.box,
    face: sl.face,
    s: sl.s,
    snug: sl.snug,
    zones: o.clear ? [zone(sl.box, 0, d / 2 + o.clear / 2, o.clearW ?? w, o.clear)] : [],
    reach: o.reach ? [[before(sl.box)]] : [],
    ...(o.through?.length && { through: o.through }),
  }))
}

/**
 * The main piece of a room: the best place on each wall, the walls ranked by their best; `variant` picks which wall
 * (the best for the first idea, the next best for another…).
 */
function anchor<C extends Cand>(L: Layout, cands: C[], score: (c: C) => number, variant: number, then?: (c: C) => boolean): C | null {
  // Kept in the room already: that's the one.
  const kept = cands.length ? L.take(cands[0].sym.type) : null
  if (kept) {
    then?.(kept as C)
    return kept as C
  }
  const byFace = new Map<number, C[]>()
  const values = new Map<C, number>()
  for (const c of cands) {
    const v = score(c)
    if (v === -Infinity || !L.fits(c.box, c.zones, c.through)) continue
    values.set(c, v)
    byFace.set(c.face ?? -1, [...(byFace.get(c.face ?? -1) ?? []), c])
  }
  const ranked = [...byFace.values()].map((list) => list.sort((a, b) => values.get(b)! - values.get(a)!)).sort((a, b) => values.get(b[0])! - values.get(a[0])!)
  // The ideas: the best place on each wall, then the next best a little way along each wall, and so on.
  const ideas: C[] = []
  for (let round = 0; round < 3; round++) {
    for (const list of ranked) {
      const mine = ideas.filter((c) => c.face === list[0].face)
      if (mine.length !== round) continue
      const next = list.find((c) => mine.every((q) => Math.abs((q.s ?? 0) - (c.s ?? 0)) >= 60))
      if (next) ideas.push(next)
    }
  }
  if (!ideas.length) return null
  const k = variant % ideas.length
  const order = [...ideas.slice(k), ...ideas.slice(0, k), ...ranked.flat()]
  const tried = new Set<C>()
  for (const c of order) {
    if (tried.has(c) || tried.size >= 60) continue
    tried.add(c)
    const got = L.tryPlace([c], (x) => values.get(x) ?? -Infinity)
    if (!got) continue
    // What has to go with it (a sofa across from the TV): if that can't be done, the next idea.
    if (!then || then(got)) return got
  }
  return null
}

/** How far the room goes from p in a direction, to its outline. */
function depthFrom(poly: Point[], p: Point, d: Point) {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const e = sub(poly[(i + 1) % poly.length], a)
    const den = d.x * e.y - d.y * e.x
    if (Math.abs(den) < 1e-9) continue
    const w = sub(a, p)
    const t = (w.x * e.y - w.y * e.x) / den
    const u = (w.x * d.y - w.y * d.x) / den
    if (t > 0.5 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.min(best, t)
  }
  return best
}

/** A door straight ahead of something's front (across `width`). */
function doorAhead(an: Analysis, b: Box, width = b.w) {
  return an.doors.some((o) => {
    const l = toLocal(b, doorPoint(an, o))
    return l.y > 0 && Math.abs(l.x) < width / 2 + o.w / 2 - 15
  })
}

/** How far the nearest window is (0 without any: then it doesn't matter). */
function nearestWindow(an: Analysis, p: Point) {
  return an.windows.length ? Math.min(...an.windows.map((o) => dist(p, doorPoint(an, o)))) : 0
}

// ---------------------------------------------------------------------------
// Pieces several rooms share

/** A split air conditioner high on a wall, not blowing straight at `away` (a bed's head or foot). */
function airCon(ctx: Ctx, prefer?: number, away?: Box) {
  if (!ctx.ac) return
  const { L } = ctx
  const an = L.an
  L.tryPlace(wallCands(L, 'ac-split', 90, 22, 200, 232, { extra: { elevation: 200 } }), (c) => {
    const f = an.faces[c.face!]
    let v = -Math.abs(c.s! - (f.s1 + f.s2) / 2) / 30
    if (c.face === prefer) v += 10
    if (away && Math.abs(dot(f.inward, axes(away.rot).v)) > 0.9) v -= 15
    return v
  })
}

/** Plants in free corners. */
function plants(ctx: Ctx, n: number) {
  const { L } = ctx
  for (let i = 0; i < n; i++) {
    const cands = L.wallSlots(45, 45, 0, 110)
      .filter((s) => s.snug)
      .map((sl) => ({ sym: L.sym('plant', sl.box, { width: 45, depth: 45, height: 110 }), box: sl.box }))
    if (!L.tryPlace(cands, (c) => -nearestWindow(L.an, c.box) / 50 + L.rand() * 3)) break
  }
}

/** A desk against a wall, by a window if it can be, with its chair. */
function desk(ctx: Ctx, w: number, d: number): Placed | null {
  const { L } = ctx
  const an = L.an
  const got = L.tryPlace(wallCands(L, 'desk', w, d, 0, 76, { clear: 75, reach: true }), (c) => {
    const under = an.windows.some((o) => o.face === c.face && Math.abs(o.s - c.s!) < o.w / 2)
    return (under ? 15 : -nearestWindow(an, c.box) / 40) + (doorAhead(an, c.box) ? -6 : 0)
  })
  if (got && !got.kept) {
    const at = local(got.box, 0, d / 2 + 18)
    const box: Box = { x: at.x, y: at.y, w: 45, d: 45, rot: (got.box.rot + 180) % 360, z0: 0, z1: 90 }
    L.add({ sym: L.sym('chair', box), box })
  }
  return got
}

/** A wardrobe of one of these lengths (longest first), with room to open it. */
function wardrobe(ctx: Ctx, lengths: number[], score: (c: SlotCand) => number, extra: Partial<PlanSymbol> = {}) {
  const { L } = ctx
  // Columns in the walls shallow enough to build a wardrobe round: a good place for one, as it hides them.
  const around = L.shallowColumns(45)
  const hides = (c: SlotCand) => (around.some((col) => overlaps(c.box, col)) ? 6 : 0)
  for (const len of lengths) {
    // Room to stand at it and open it; its ends can meet another wardrobe in a corner.
    const cands = wallCands(L, 'wardrobe', len, 60, 0, 225, { clear: 70, clearW: Math.max(40, len - 120), reach: true, extra, through: around })
    const got = L.tryPlace(cands, (c) => score(c) + hides(c))
    if (got) return got
  }
  return null
}

/** A TV (`inches` across) on the wall facing something (a bed), across from its middle. */
function tvFacing(ctx: Ctx, target: Box, inches: number, z0: number) {
  const { L } = ctx
  const { width: w, height: h } = tvSize(inches)
  const ahead = axes(target.rot).v
  const cands: Cand[] = []
  L.an.faces.forEach((f, i) => {
    if (dot(f.inward, ahead) > -0.95) return
    const s = dot(sub(target, f.a), f.dir)
    if (s - w / 2 < f.s1 || s + w / 2 > f.s2) return
    const box = againstWall(facePoint(f, s), f.inward, w, 8, z0, z0 + h)
    cands.push({ sym: L.sym('tv', box, { width: w, height: h, depth: 8, elevation: z0 }), box, face: i, s })
  })
  return L.tryPlace(cands)
}

// ---------------------------------------------------------------------------
// Bedrooms

function bedroom(ctx: Ctx) {
  const { L, use, marks } = ctx
  const an = L.an
  const b = bbox(an.poly)
  const short = Math.min(b.maxX - b.minX, b.maxY - b.minY)
  const single = use === 'kids' || short < 260
  const bedW = single ? 90 : use === 'master' ? (short >= 340 ? 180 : 160) : short >= 300 ? 160 : 140
  const bedD = single ? 200 : bedW >= 180 ? 210 : 200
  const type = single ? 'bed-single' : 'bed-double'
  const cands: SlotCand[] = L.wallSlots(bedW, bedD, 0, 100).map((sl) => {
    const box = sl.box
    const zones = [zone(box, 0, bedD / 2 + 30, bedW, 60)]
    const side = (sx: number) => local(box, sx * (bedW / 2 + 30), bedD * 0.2)
    if (!single) for (const sx of [-1, 1]) zones.push(zone(box, sx * (bedW / 2 + 28), bedD / 4 + 5, 55, bedD / 2 - 10))
    const reach = single ? [[side(-1), side(1), local(box, 0, bedD / 2 + 30)]] : [[side(-1)], [side(1)]]
    return { sym: L.sym(type, box, { width: bedW, depth: bedD }), box, zones, reach, face: sl.face, s: sl.s, snug: sl.snug }
  })
  const entry = an.entry && doorPoint(an, an.entry)
  const score = (c: SlotCand) => {
    const f = an.faces[c.face!]
    let v = Math.min(faceLen(an, c.face!), 600) / 25
    if (an.doors.some((o) => o.face === c.face)) v -= 20
    if (doorAhead(an, c.box)) v -= 15
    if (entry) v += dist(c.box, entry) / 50
    if (an.windows.some((o) => o.face === c.face && Math.abs(o.s - c.s!) < (o.w + c.box.w) / 2)) v -= 15
    v += single ? (c.snug ? 6 : 0) : -Math.abs(c.s! - (f.s1 + f.s2) / 2) / 12
    return v
  }
  const bed = anchor(L, cands, score, ctx.variant)
  if (!bed) return
  marks.bed = bed
  if (!single) {
    for (const sx of [-1, 1]) {
      for (const [w, d] of [
        [45, 40],
        [35, 35],
      ]) {
        const at = local(bed.box, sx * (bedW / 2 + w / 2 + 2), -bedD / 2 + d / 2)
        const box: Box = { x: at.x, y: at.y, w, d, rot: bed.box.rot, z0: 0, z1: 60 }
        const got = L.tryPlace([{ sym: L.sym('nightstand', box, { width: w, depth: d }), box }])
        if (got) {
          marks.nightstands.push(got)
          break
        }
      }
    }
  }
  const near = (c: SlotCand) => (entry ? -dist(c.box, entry) / 80 : 0)
  wardrobe(
    ctx,
    use === 'master' ? [240, 200, 160, 120] : use === 'kids' ? [120, 100, 80] : [180, 150, 120, 100],
    (c) => (c.snug ? 8 : 0) + (c.face === bed.face ? -6 : 0) + near(c) + (dot(L.an.faces[c.face!].inward, axes(bed.box.rot).v) < -0.9 ? -8 : 0),
    use === 'master' ? { doors: 'sliding' } : {},
  )
  if (use === 'master' || use === 'bedroom') tvFacing(ctx, bed.box, use === 'master' ? 55 : 43, 110)
  if (use === 'master') {
    L.tryPlace(
      wallCands(L, 'dressing-table', 110, 45, 0, 160, { clear: 60, reach: true, extra: { style: ctx.style.dressing, led: true, light: LIT } }),
      (c) => -nearestWindow(an, c.box) / 40 + (c.face === bed.face ? -10 : 0),
    )
    if (an.area >= 15) {
      L.tryPlace(
        L.wallSlots(80, 80, 0, 85)
          .filter((s) => s.snug)
          .map((sl) => ({ sym: L.sym('armchair', sl.box, { width: 80, depth: 80 }), box: sl.box, reach: [[before(sl.box, 30)]] })),
        (c) => -nearestWindow(an, c.box) / 40,
      )
    }
  }
  if (use === 'kids') {
    const d = desk(ctx, 120, 60)
    L.tryPlace(wallCands(L, 'bookshelf', 100, 35, 0, 200, { clear: 50 }), (c) => (d ? -dist(c.box, d.box) / 60 : 0))
  }
  airCon(ctx, undefined, bed.box)
  plants(ctx, use === 'master' ? 1 : 0)
}

// ---------------------------------------------------------------------------
// Living and dining

function living(ctx: Ctx) {
  const { L, marks } = ctx
  const an = L.an
  const unitW = an.area >= 22 ? 200 : an.area >= 14 ? 180 : 150
  // A 65″ TV in a big living room, 55″ otherwise.
  const tv = tvSize(an.area >= 22 ? 65 : 55)
  const tvBox = (face: number, s: number) => againstWall(facePoint(an.faces[face], s), an.faces[face].inward, tv.width, 8, 100, 100 + tv.height)
  const score = (c: Cand) => {
    const f = an.faces[c.face!]
    const room = depthFrom(an.poly, facePoint(f, c.s!, 1), f.inward)
    if (room < 290) return -Infinity
    if (!L.fits(tvBox(c.face!, c.s!))) return -Infinity
    let v = Math.min(faceLen(an, c.face!), 700) / 25 - Math.abs(c.s! - (f.s1 + f.s2) / 2) / 12 + Math.min(room, 500) / 50
    if (an.doors.some((o) => o.face === c.face)) v -= 12
    // Across from a window, the screen catches the glare.
    if (an.windows.some((o) => dot(an.faces[o.face].inward, f.inward) < -0.9)) v -= 10
    return v
  }
  let seat: Placed | null = null
  const unit = anchor(L, wallCands(L, 'tv-unit', unitW, 45, 0, 50), score, ctx.variant, (u) => {
    // A kept unit out in the room: the sofa is up to you.
    if (u.face === undefined) return true
    const tb = tvBox(u.face!, u.s!)
    const set = L.tryPlace([{ sym: L.sym('tv', tb, { ...tv, depth: 8, elevation: 100 }), box: tb }])
    seat = facingSofa(ctx, u)
    if (seat) return true
    if (set) L.remove(set)
    L.remove(u)
    return false
  })
  if (unit?.kept && !seat) seat = L.take('sofa')
  if (!unit || !seat) {
    // No wall for a TV with seats across from it: a sofa along the longest wall.
    L.tryPlace(wallCands(L, 'sofa', 200, 90, 0, 85, { clear: 60, reach: true }), (c) => faceLen(an, c.face!) / 20)
    return
  }
  marks.tvUnit = unit
  seating(ctx, unit, seat)
}

/** The sofa across from the TV, 2–3 m away, against the far wall or with a way round behind it. */
function facingSofa(ctx: Ctx, unit: Placed): Placed | null {
  const { L } = ctx
  const an = L.an
  const f = an.faces[unit.face!]
  const room = depthFrom(an.poly, facePoint(f, unit.s!, 1), f.inward)
  const corner = an.area >= 20 && (ctx.variant % 2 === 0 || an.area >= 28) && ctx.attempt % 3 !== 2
  const options: [string, number, number][] = corner
    ? [
        ['sofa-corner', 260, 200],
        ['sofa-corner', 230, 180],
        ['sofa', 220, 95],
        ['sofa', 190, 90],
      ]
    : [
        ['sofa', 220, 95],
        ['sofa', 190, 90],
        ['sofa', 160, 85],
      ]
  const rot = (unit.box.rot + 180) % 360
  let sofa: Placed | null = null
  for (const [type, w, d] of options) {
    const ideal = type === 'sofa-corner' ? 190 : 250
    const cands: Cand[] = []
    for (const v of [ideal, ideal - 20, ideal + 20, ideal - 40, ideal + 40, ideal + 60, ideal - 60, room - 45 - d]) {
      if (v < 160 || v > 380) continue
      const dc = 45 + v + d / 2
      const back = room - (dc + d / 2)
      if (back < -0.5) continue
      for (const flipX of type === 'sofa-corner' ? [false, true] : [false]) {
        const at = facePoint(f, unit.s!, dc)
        const box: Box = { x: at.x, y: at.y, w, d, rot, z0: 0, z1: 85 }
        const against = back < 2
        const zones = against ? [] : [zone(box, 0, -(d / 2 + 45), w, 90)]
        cands.push({
          sym: L.sym(type, box, { width: w, depth: d, flipX }),
          box,
          zones,
          reach: [[local(box, -(w / 2 - 30), d / 2 + 30), local(box, w / 2 - 30, d / 2 + 30)]],
          s: v,
        })
      }
    }
    sofa = L.tryPlace(cands, (c) => -Math.abs(c.s! - ideal) / 10 + (c.zones?.length ? 0 : 4))
    if (sofa) break
  }
  return sofa
}

/** Round the sofa: a coffee table, an armchair, a sofa table behind it; a sideboard, air conditioning, plants. */
function seating(ctx: Ctx, unit: Placed, first: Placed) {
  const { L } = ctx
  const an = L.an
  let sofa = first
  const sw = sofa.box.w
  const sd = sofa.box.d
  const cornerSofa = sofa.sym.type === 'sofa-corner'
  const seat = Math.min(95, sd * 0.6, sw * 0.6)
  // A corner sofa takes up its back run and its chaise, not the corner between them (the coffee table goes there).
  if (cornerSofa && !sofa.kept) {
    const whole = sofa.box
    const side = sofa.sym.flipX ? 1 : -1
    const back = local(whole, 0, -sd / 2 + seat / 2)
    const chaise = local(whole, side * (sw / 2 - seat / 2), seat / 2)
    L.remove(sofa)
    sofa = L.add({ ...sofa, box: { ...whole, x: back.x, y: back.y, d: seat } })
    L.add({ sym: sofa.sym, box: { ...whole, x: chaise.x, y: chaise.y, w: seat, d: sd - seat }, ghost: true })
    sofa = { ...sofa, box: whole }
  }
  // A coffee table in front of the seat (beside a corner sofa's chaise).
  const ctW = Math.min(110, (cornerSofa ? sw - seat : sw) * 0.55)
  const ctD = 60
  const lx = cornerSofa ? (sofa.sym.flipX ? -1 : 1) * (seat / 2) : 0
  const ly = (cornerSofa ? -sd / 2 + seat : sd / 2) + 40 + ctD / 2
  const ca = local(sofa.box, lx, ly)
  const ctBox: Box = { x: ca.x, y: ca.y, w: ctW, d: ctD, rot: sofa.box.rot, z0: 0, z1: 45 }
  const table = L.tryPlace([{ sym: L.sym('coffee-table', ctBox, { width: ctW, depth: ctD }), box: ctBox }])
  // An armchair at the side of the coffee table, turned to it.
  if (table && !cornerSofa) {
    const cands: Cand[] = [-1, 1].map((sx) => {
      const at = local(table.box, sx * (ctW / 2 + 60), 0)
      const box: Box = { x: at.x, y: at.y, w: 80, d: 80, rot: (table.box.rot + (sx < 0 ? 270 : 90)) % 360, z0: 0, z1: 85 }
      return { sym: L.sym('armchair', box, { width: 80, depth: 80 }), box, reach: [[before(box, 30)]] }
    })
    L.tryPlace(cands, (c) => (an.entry ? dist(c.box, doorPoint(an, an.entry)) / 50 : 0))
  }
  // Behind a sofa out in the room, a sofa table.
  if (sofa.zones?.length && !cornerSofa) {
    const at = local(sofa.box, 0, -(sd / 2 + 20))
    const box: Box = { x: at.x, y: at.y, w: Math.min(150, sw * 0.7), d: 35, rot: sofa.box.rot, z0: 0, z1: 70 }
    // It stands in the way behind: only with a way past it still.
    const behind = zone(sofa.box, 0, -(sd / 2 + 40 + 45), sw, 90)
    if (L.fits(box, [behind])) {
      L.remove(sofa)
      L.add({ ...sofa, zones: [] })
      if (!L.tryPlace([{ sym: L.sym('sofa-table', box, { width: box.w, depth: 35 }), box, zones: [behind] }])) {
        L.remove(L.placed[L.placed.length - 1])
        L.add(sofa)
      }
    }
  }
  // Along another wall: a sideboard.
  L.tryPlace(wallCands(L, 'sideboard', 160, 45, 0, 85, { clear: 60 }), (c) => (c.face === unit.face ? -20 : faceLen(an, c.face!) / 50))
  airCon(ctx, unit.face)
  plants(ctx, 2)
}

/** A dining table (its chairs round it) where there's room, as near the middle as it can be. */
function diningTable(ctx: Ctx, sizes: [number, number][]): Placed | null {
  const { L } = ctx
  const an = L.an
  const c = labelPoint(an.poly)
  const longest = an.faces.reduce((a, f) => (f.s2 - f.s1 > a.s2 - a.s1 ? f : a))
  const along = (Math.atan2(longest.dir.y, longest.dir.x) * 180) / Math.PI
  const b = bbox(an.poly)
  for (const [w, d] of sizes) {
    const round = w === d
    const cands: Cand[] = []
    // Spots 25 cm apart, out from the middle.
    for (let x = b.minX + 12.5; x <= b.maxX; x += 25) {
      for (let y = b.minY + 12.5; y <= b.maxY; y += 25) {
        if (!pointInPolygon({ x, y }, an.poly)) continue
        for (const r of round ? [0] : [along, along + 90]) {
          // The chairs round it, and room to pull them out.
          const box: Box = { x, y, w: round ? w + 70 : w, d: d + 70, rot: ((r % 360) + 360) % 360, z0: 0, z1: 90 }
          const zones = round ? [] : [zone(box, 0, d / 2 + 50, w, 30), zone(box, 0, -(d / 2 + 50), w, 30)]
          cands.push({
            sym: L.sym(round ? 'round-table' : 'dining-table', box, { width: w, depth: d }),
            box,
            zones,
            reach: [round ? [-1, 1].flatMap((k) => [local(box, 0, k * (d / 2 + 60)), local(box, k * (w / 2 + 60), 0)]) : [local(box, 0, d / 2 + 60), local(box, 0, -(d / 2 + 60))]],
          })
        }
      }
    }
    const got = L.tryPlace(cands, (k) => -dist(k.box, c) / 10, 20)
    if (got) return got
  }
  return null
}

function dining(ctx: Ctx) {
  const { L, marks } = ctx
  marks.table = diningTable(ctx, [[220, 100], [180, 90], [160, 90], [140, 80], [110, 110]]) ?? undefined
  L.tryPlace(wallCands(L, 'sideboard', 180, 45, 0, 85, { clear: 60 }), (c) => faceLen(L.an, c.face!) / 50)
  plants(ctx, 1)
  airCon(ctx)
}

// ---------------------------------------------------------------------------
// Kitchen

type Module = { type: string; w: number; h: number; d: number }

/** How far a corner unit reaches along each wall from the corner (cm). */
const CORNER = 90

const MOD = {
  fridge: { type: 'fridge', w: 70, h: 180, d: 65 },
  tower: { type: 'oven-tower', w: 60, h: 220, d: 60 },
  sink: (w: number) => ({ type: 'kitchen-sink', w, h: 90, d: 60 }),
  dw: { type: 'dishwasher', w: 60, h: 90, d: 60 },
  hob: { type: 'stove', w: 60, h: 90, d: 60 },
  counter: (w: number) => ({ type: 'counter', w, h: 90, d: 60 }),
}

/** Kitchen units a room can keep: a plan is built round them, where they stand. */
const RUN = new Set(['counter', 'kitchen-sink', 'stove', 'dishwasher', 'fridge', 'oven-tower', 'washing-machine', 'kitchen-corner'])

/** Kitchen units along one wall: `len` cm of it from `start` on face `face`, running `dir` along it. */
interface Leg {
  face: number
  start: number
  dir: 1 | -1
  len: number
}

/**
 * Units along one wall, or two or three meeting in corners (an L, a U), as legs end to end. Each leg but the last
 * ends in the corner, where a corner unit goes; the next starts past the corner.
 */
interface Chain {
  shape: 'I' | 'L' | 'U'
  legs: Leg[]
}

/**
 * The ways units could run round a room's walls: along any clear stretch, round a corner, round two. `through`: what
 * a run may take in (kept units, shallow columns in the walls).
 */
function chains(L: Layout, through: Box[]): Chain[] {
  const an = L.an
  const n = an.faces.length
  const free = an.faces.map((_, i) => L.freeAlong(i, 60, 0, 90, through))
  const out: Chain[] = []
  free.forEach((list, i) =>
    list.forEach(([s1, s2]) => {
      if (s2 - s1 < 120) return
      out.push({ shape: 'I', legs: [{ face: i, start: s1, dir: 1, len: s2 - s1 }] })
      out.push({ shape: 'I', legs: [{ face: i, start: s2, dir: -1, len: s2 - s1 }] })
    }),
  )
  // Face i ending where face j starts, j turning into the room: an inside corner.
  const corner = (i: number, j: number) => {
    const fi = an.faces[i]
    const fj = an.faces[j]
    return dist(facePoint(fi, fi.s2), facePoint(fj, fj.s1)) < 1 && dot(fj.dir, fi.inward) > 0.95
  }
  const intoEnd = (i: number) => free[i].find(([, s2]) => Math.abs(s2 - an.faces[i].s2) < 1)
  const fromStart = (j: number) => free[j].find(([s1]) => Math.abs(s1 - an.faces[j].s1) < 1)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j || !corner(i, j)) continue
      const a = intoEnd(i)
      const b = fromStart(j)
      if (!a || !b) continue
      const la = a[1] - a[0]
      const lb = b[1] - b[0]
      if (la >= 120 && lb >= 120) {
        out.push({ shape: 'L', legs: [{ face: i, start: a[0], dir: 1, len: la }, { face: j, start: b[0] + 60, dir: 1, len: lb - 60 }] })
        out.push({ shape: 'L', legs: [{ face: j, start: b[1], dir: -1, len: lb }, { face: i, start: a[1] - 60, dir: -1, len: la - 60 }] })
      }
      // On round a second corner, with a metre to stand in between the facing runs.
      for (let k = 0; k < n; k++) {
        if (k === i || k === j || !corner(j, k) || b[1] < an.faces[j].s2 - 1) continue
        const c = fromStart(k)
        if (!c) continue
        const lc = c[1] - c[0]
        if (la < 120 || lc < 120 || lb < 220) continue
        out.push({
          shape: 'U',
          legs: [
            { face: i, start: a[0], dir: 1, len: la },
            { face: j, start: b[0] + 60, dir: 1, len: lb - 60 },
            { face: k, start: c[0] + 60, dir: 1, len: lc - 60 },
          ],
        })
        out.push({
          shape: 'U',
          legs: [
            { face: k, start: c[1], dir: -1, len: lc },
            { face: j, start: b[1] - 60, dir: -1, len: lb - 60 },
            { face: i, start: a[1] - 60, dir: -1, len: la - 60 },
          ],
        })
      }
    }
  }
  return out
}

/** A unit on a chain, at `at` cm along it (end to end over its legs); `kept`: the room's own, where it stands. */
type Spot = Module & { at: number; kept?: Placed }

/** Where the kept units stand along a chain (the ones that do). */
function keptAlong(L: Layout, legs: Leg[], kept: Placed[]): Spot[] {
  const out: Spot[] = []
  let from = 0
  legs.forEach((leg, i) => {
    for (const p of kept) {
      if (p.face !== leg.face) continue
      const q = L.along(leg.face, p.box)
      if (q.n1 > 3) continue
      const a = from + (q.s1 - leg.start) * leg.dir
      const b = from + (q.s2 - leg.start) * leg.dir
      const lo = Math.min(a, b)
      let hi = Math.max(a, b)
      if (lo < from - 3 || hi > from + leg.len + 3) continue
      // A kept corner unit reaches on round the corner.
      if (p.sym.type === 'kitchen-corner' && i < legs.length - 1 && Math.abs(hi - (from + leg.len)) < 3) hi = from + leg.len + CORNER - 60
      out.push({ type: p.sym.type, w: hi - lo, h: p.box.z1 - p.box.z0, d: p.box.d, at: lo, kept: p })
    }
    from += leg.len
  })
  return out
}

/** What a plan has to add: tall units, a sink (no width: there's one already), the dishwasher, the hob, a washer. */
interface Want {
  tall: Module[]
  sinkW: number | null
  dw: boolean
  hob: boolean
  washer: boolean
}

/**
 * The units along a chain, round the ones kept there: tall ones at an end; the sink (the dishwasher beside it) as
 * near a window's middle as it'll go; the hob a comfortable step from the sink with worktop between; none of them in
 * a corner or across one, nor in front of a column; a corner unit in each corner nothing kept stands in; worktop in
 * between. A few ways to do it (the tall units at either end, the hob either side of the sink), best first.
 */
function planChain(legs: Leg[], windows: [number, number, number][], worktopOnly: [number, number][], fixed: Spot[], want: Want): { spots: Spot[]; cost: number }[] {
  const ends: number[] = []
  let total = 0
  for (const l of legs) ends.push((total += l.len))
  const T = total
  const starts = [0, ...ends.slice(0, -1)]
  const over = (a0: number, a1: number, b: [number, number] | [number, number, number]) => a0 < b[1] - 0.5 && a1 > b[0] + 0.5
  const onLeg = (x0: number, x1: number) => starts.some((s, i) => x0 >= s - 0.5 && x1 <= ends[i] + 0.5)
  const kept: [number, number][] = fixed.map((f) => [f.at, f.at + f.w])
  const corners = ends.slice(0, -1).map((e): [number, number] => [e - CORNER, e + CORNER - 60])
  // A corner unit in each corner nothing kept stands in (otherwise worktop round what's there).
  const cornerUnits = corners.filter((c) => !kept.some((k) => over(k[0], k[1], c)))
  const taken: [number, number][] = [...corners, ...worktopOnly, ...kept]
  const ok = (x0: number, x1: number, underWindow: boolean, more: [number, number][] = []) =>
    x0 >= -0.5 && x1 <= T + 0.5 && onLeg(x0, x1) && ![...taken, ...more].some((t) => over(x0, x1, t)) && (underWindow || !windows.some((w) => over(x0, x1, w)))
  const keptSink = fixed.find((f) => f.type === 'kitchen-sink')
  const keptHob = fixed.find((f) => f.type === 'stove')
  const keptDw = fixed.find((f) => f.type === 'dishwasher')
  const tallW = want.tall.reduce((s, m) => s + m.w, 0)
  type Pick = { tallAt: number | null; sink: number | null; sinkW: number; dw: number | null; hob: number | null; cost: number }
  // The best way for each kind of layout: which end the tall units are at, which side of the sink the hob is.
  const best = new Map<string, Pick>()
  // Tall units at an end of the run, or beside a tall one kept (an oven tower by the fridge).
  const tallSpots = new Set<number>([0, T - tallW])
  for (const f of fixed) if (f.type === 'fridge' || f.type === 'oven-tower') [f.at - tallW, f.at + f.w].forEach((x) => tallSpots.add(Math.round(x * 10) / 10))
  for (const tallAt of tallW ? [...tallSpots] : [null]) {
    if (tallAt !== null && !ok(tallAt, tallAt + tallW, false)) continue
    // Worktop beside tall units to put things down.
    const landing: [number, number][] = tallAt === null ? [] : [[tallAt - 40, tallAt + tallW + 40]]
    const sinks: { sink: number | null; sinkW: number; dw: number | null }[] = []
    if (keptSink) {
      const beside = want.dw ? [keptSink.at - 60, keptSink.at + keptSink.w].filter((x) => ok(x, x + 60, true, landing)) : []
      if (beside.length) for (const x of beside) sinks.push({ sink: keptSink.at, sinkW: keptSink.w, dw: x })
      else sinks.push({ sink: keptSink.at, sinkW: keptSink.w, dw: keptDw?.at ?? null })
    } else if (want.sinkW) {
      const sw = want.sinkW
      for (let x = 0; x + sw <= T + 0.5; x += 10) {
        if (!ok(x, x + sw, true, landing)) continue
        if (!want.dw) sinks.push({ sink: x, sinkW: sw, dw: keptDw?.at ?? null })
        else for (const d of [x - 60, x + sw]) if (ok(d, d + 60, true, landing) && !over(d, d + 60, [x, x + sw])) sinks.push({ sink: x, sinkW: sw, dw: d })
      }
      if (!sinks.length) continue
    } else sinks.push({ sink: null, sinkW: 0, dw: keptDw?.at ?? null })
    const hobs: (number | null)[] = keptHob ? [keptHob.at] : []
    if (!keptHob && want.hob) for (let x = 30; x + 60 <= T - 30 + 0.5; x += 10) if (ok(x, x + 60, false, landing)) hobs.push(x)
    if (!hobs.length) {
      if (want.hob) continue
      hobs.push(null)
    }
    for (const s of sinks) {
      const lo = Math.min(s.sink ?? Infinity, s.dw ?? Infinity)
      const hi = Math.max(s.sink !== null ? s.sink + s.sinkW : -Infinity, s.dw !== null ? s.dw + 60 : -Infinity)
      const mid = s.sink !== null ? s.sink + s.sinkW / 2 : null
      const toWindow = mid === null || keptSink ? 0 : windows.length ? Math.min(...windows.map(([, , c]) => Math.abs(c - mid))) : Math.abs(mid - T / 2) / 20
      for (const h of hobs) {
        // Worktop between the hob and the sink (and its dishwasher).
        if (h !== null && !keptHob && lo !== Infinity && !(h + 60 + 60 <= lo || h >= hi + 60)) continue
        if (h !== null && s.dw !== null && over(h, h + 60, [s.dw, s.dw + 60])) continue
        const apart = h === null || mid === null ? 130 : Math.abs(h + 30 - mid)
        const cost = toWindow + Math.abs(apart - 130) / 4
        const key = `${tallAt}|${h === null || mid === null ? '-' : h < mid ? 'l' : 'r'}`
        if (!best.has(key) || cost < best.get(key)!.cost) best.set(key, { tallAt, sink: s.sink, sinkW: s.sinkW, dw: s.dw, hob: h, cost })
      }
    }
  }
  return [...best.values()]
    .sort((a, b) => a.cost - b.cost)
    .map((p) => {
      const spots: Spot[] = [...fixed]
      if (p.tallAt !== null) {
        let x = p.tallAt
        for (const m of want.tall) {
          spots.push({ ...m, at: x })
          x += m.w
        }
      }
      if (!keptSink && p.sink !== null) spots.push({ ...MOD.sink(p.sinkW), at: p.sink })
      if (!keptDw && p.dw !== null) spots.push({ ...MOD.dw, at: p.dw })
      if (!keptHob && p.hob !== null) spots.push({ ...MOD.hob, at: p.hob })
      for (const [c0, c1] of cornerUnits) spots.push({ type: 'kitchen-corner', w: c1 - c0, h: 90, d: 60, at: c0 })
      // Worktop in the gaps, a piece per leg.
      const filled = spots.map((s): [number, number] => [s.at, s.at + s.w]).sort((a, b) => a[0] - b[0])
      const gaps: [number, number][] = []
      let cur = 0
      for (const [a, b] of filled) {
        if (a > cur + 0.5) gaps.push([cur, a])
        cur = Math.max(cur, b)
      }
      if (T > cur + 0.5) gaps.push([cur, T])
      const pieces: [number, number][] = []
      for (const [g0, g1] of gaps) {
        starts.forEach((s, i) => {
          const a = Math.max(g0, s)
          const b = Math.min(g1, ends[i])
          if (b - a >= 5) pieces.push([a, b])
        })
      }
      // A washing machine under the worktop: in the stretch of it farthest from the hob, at whichever end it fits.
      if (want.washer) {
        const hob = p.hob !== null ? p.hob + 30 : T / 2
        const at = pieces
          .flatMap(([a, b]) => (b - a >= 60 ? [a, b - 60] : []))
          .filter((x) => ok(x, x + 60, true))
          .sort((u, v) => Math.abs(v + 30 - hob) - Math.abs(u + 30 - hob))[0]
        if (at !== undefined) {
          const i = pieces.findIndex(([a, b]) => at >= a - 0.5 && at + 60 <= b + 0.5)
          const [a, b] = pieces[i]
          pieces.splice(i, 1, ...([[a, at], [at + 60, b]] as [number, number][]).filter(([u, v]) => v - u >= 5))
          spots.push({ type: 'washing-machine', w: 60, h: 90, d: 60, at })
        }
      }
      for (const [a, b] of pieces) spots.push({ ...MOD.counter(Math.round((b - a) * 10) / 10), at: a })
      return { spots, cost: p.cost }
    })
}

function kitchen(ctx: Ctx) {
  const { L } = ctx
  planning.uses = ctx.uses
  const plans = kitchenPlans(L)
  if (!plans.length) {
    islandOrTable(ctx, null)
    return
  }
  // Round the units kept: only the ways that take in as many of them as any does; then the fullest kitchen, the sink
  // under a window, the most worktop. Another idea is the next of them.
  const most = Math.max(...plans.map((p) => p.kept))
  const value = (p: KitchenPlan) => -p.level * 100 + (p.windowed ? 60 : 0) - p.cost / 3 + Math.min(p.total, 700) / 10
  // The same units in the same places is the same idea, whichever end the run was measured from.
  const seen = new Set<string>()
  const ideas = plans
    .filter((p) => p.kept === most)
    .sort((a, b) => value(b) - value(a))
    .filter((p) => {
      const sig = p.spots
        .filter((s) => !s.kept && s.type !== 'counter')
        .map((s) => {
          const { leg, s: at } = onChain(p.chain.legs, s.at, s.w)
          return `${s.type}@${leg.face}:${Math.round(at / 10)}`
        })
        .sort()
        .join(',')
      if (seen.has(sig)) return false
      seen.add(sig)
      return true
    })
  // This idea, or the next if its sink or hob can't go in after all (something in the way of standing at it).
  const before = L.snapshot()
  for (let k = 0; k < ideas.length; k++) {
    if (placeKitchen(ctx, ideas[(ctx.variant + k) % ideas.length])) return
    L.restore(before)
    ctx.marks.uppers = []
    ctx.marks.hood = ctx.marks.island = ctx.marks.table = undefined
  }
  islandOrTable(ctx, null)
}

/** Where a stretch of a chain is: its leg, the middle of it along that leg's wall, and how far into the leg it starts. */
function onChain(legs: Leg[], x: number, w: number) {
  let from = 0
  for (const leg of legs) {
    if (x < from + leg.len - 0.5) return { leg, s: leg.start + leg.dir * (x - from + w / 2), local: x - from }
    from += leg.len
  }
  const leg = legs[legs.length - 1]
  return { leg, s: leg.start + leg.dir * (x - (from - leg.len) + w / 2), local: x - (from - leg.len) }
}

type KitchenPlan = { chain: Chain; spots: Spot[]; level: number; cost: number; windowed: boolean; total: number; kept: number }

/** Worked out once per room (every try at it starts from the same room). */
const planned = new WeakMap<Analysis, KitchenPlan[]>()
/** The floor's room uses, for the plans being worked out. */
const planning: { uses?: Map<string, RoomUse> } = {}

/** For each way units could run, the fullest kitchen that fits along it, round the units kept. */
function kitchenPlans(L: Layout): KitchenPlan[] {
  const an = L.an
  const cached = planned.get(an)
  if (cached) return [...cached]
  const shallow = L.shallowColumns(40)
  const kept = L.keptOf(RUN)
  const has = (t: string) => kept.some((k) => k.sym.type === t)
  const washer = !has('washing-machine') && !!planning.uses && washerRoom(an.floor, planning.uses) === 'kitchen'
  // What to add, fullest first: a fridge and an oven tower (unless there are), the dishwasher, a full-size sink.
  const fridge = has('fridge') ? [] : [MOD.fridge]
  const tower = has('oven-tower') ? [] : [MOD.tower]
  const talls = [[...fridge, ...tower], fridge, []].filter((t, i, all) => all.findIndex((u) => u.length === t.length) === i)
  const wants: Want[] = []
  for (const tall of talls) {
    for (const dw of has('dishwasher') ? [false] : [true, false]) {
      for (const sinkW of has('kitchen-sink') ? [null] : [80, 60]) wants.push({ tall, dw, sinkW, hob: !has('stove'), washer })
    }
  }
  const plans: KitchenPlan[] = []
  for (const chain of chains(L, [...shallow, ...kept.map((k) => k.box)])) {
    // The windows along it (the sink goes under one), in the chain's own measure.
    const windows: [number, number, number][] = []
    let from = 0
    for (const leg of chain.legs) {
      for (const o of an.windows) {
        if (o.face !== leg.face || o.sill < 85) continue
        const u = (s: number) => from + (s - leg.start) * leg.dir
        const a = u(o.s - o.w / 2)
        const b = u(o.s + o.w / 2)
        const lo = Math.max(from, Math.min(a, b) - 5)
        const hi = Math.min(from + leg.len, Math.max(a, b) + 5)
        if (hi > lo) windows.push([lo, hi, u(o.s)])
      }
      from += leg.len
    }
    // Columns along it: worktop runs on in front of them.
    const worktopOnly: [number, number][] = []
    let at = 0
    for (const leg of chain.legs) {
      for (const c of shallow) {
        const p = L.along(leg.face, c)
        if (p.n1 > 2 || p.n2 > 60) continue
        const a = at + (p.s1 - leg.start) * leg.dir
        const b = at + (p.s2 - leg.start) * leg.dir
        const lo = Math.max(at, Math.min(a, b) - 2)
        const hi = Math.min(at + leg.len, Math.max(a, b) + 2)
        if (hi > lo) worktopOnly.push([lo, hi])
      }
      at += leg.len
    }
    const fixed = keptAlong(L, chain.legs, kept)
    // The fullest set that fits, and a couple of plainer ones (more ideas: a hob where a tower would have gone).
    let found = 0
    for (let level = 0; level < wants.length && found < 3; level++) {
      const ways = planChain(chain.legs, windows, worktopOnly, fixed, wants[level])
      if (!ways.length) continue
      found++
      for (const w of ways) plans.push({ chain, ...w, level, windowed: windows.length > 0 && !has('kitchen-sink'), total: from, kept: fixed.length })
    }
  }
  planned.set(an, plans)
  return [...plans]
}

/**
 * The units of a plan along their walls (the kept ones where they are), the hood, wall cabinets, then an island or a
 * table. False if its sink or hob couldn't go in.
 */
function placeKitchen(ctx: Ctx, plan: KitchenPlan): boolean {
  const { L, marks, style } = ctx
  const an = L.an
  const { legs } = plan.chain
  marks.run = { faces: legs.map((l) => l.face) }
  const ends: number[] = []
  let total = 0
  for (const l of legs) ends.push((total += l.len))
  const where = (x: number, w: number) => onChain(legs, x, w)
  const cabinets = style.cabinets
  const shallow = L.shallowColumns(40)
  // The units along each leg (kept ones too), for the wall cabinets over them and the hood over the hob.
  const along: { m: Spot; leg: Leg; from: number }[] = []
  for (const m of [...plan.spots].sort((a, b) => a.at - b.at)) {
    if (m.type === 'kitchen-corner') {
      if (!m.kept) placeCorner(ctx, legs, ends.findIndex((e) => Math.abs(e - CORNER - m.at) < 1), shallow)
      continue
    }
    const { leg, s, local: lx } = where(m.at, m.w)
    if (m.kept) {
      along.push({ m, leg, from: lx })
      continue
    }
    const f = an.faces[leg.face]
    const box = againstWall(facePoint(f, s), f.inward, m.w, m.d, 0, m.h)
    const extra: Partial<PlanSymbol> = { width: m.w, depth: m.d }
    if (m.type === 'oven-tower') extra.frame = cabinets
    if (m.type === 'washing-machine') extra.style = 'built-in'
    if (m.type !== 'fridge' && m.type !== 'oven-tower') extra.top = style.worktop
    const counter = m.type === 'counter'
    const c: Cand = { sym: L.sym(m.type, box, extra), box, reach: counter ? [] : [[before(box, 40)]], zones: counter ? [] : [zone(box, 0, m.d / 2 + 50, m.w, 100)] }
    // The worktop runs on over a column in the wall (the cabinet under it built round it).
    if (L.fits(box, c.zones, counter ? shallow : [])) {
      L.add(c)
      along.push({ m, leg, from: lx })
    } else if (m.type === 'kitchen-sink' || m.type === 'stove') return false
  }
  const fridgeInRun = plan.spots.some((x) => x.type === 'fridge') || L.keptOf(new Set(['fridge'])).length > 0
  // The hood over the hob (the kept one, if it's that); wall cabinets over the rest of each wall.
  const hob = along.find((x) => x.m.type === 'stove')
  let hood: { leg: Leg; range: [number, number] } | null = null
  if (hob) {
    const hoodStyle = HOOD_STYLES.find((h) => h.id === style.hood) ?? HOOD_STYLES[0]
    const w = 90
    const mid = hob.from + hob.m.w / 2
    const f = an.faces[hob.leg.face]
    const box = againstWall(facePoint(f, hob.leg.start + hob.leg.dir * mid), f.inward, w, 50, 155, 155 + (hoodStyle.height ?? 45))
    const got = L.tryPlace([{ sym: L.sym('range-hood', box, { width: w, depth: 50, elevation: 155, height: hoodStyle.height, style: hoodStyle.id, led: true, light: LIT }), box }])
    if (got) {
      marks.hood = got
      hood = { leg: hob.leg, range: [mid - w / 2 - 2, mid + w / 2 + 2] }
    }
  }
  const cut = (list: [number, number][], a: number, b: number) =>
    list.flatMap(([s1, s2]): [number, number][] => (b <= s1 || a >= s2 ? [[s1, s2]] : ([[s1, Math.max(s1, a)], [Math.min(s2, b), s2]] as [number, number][]).filter(([p, q]) => q - p > 0.5)))
  const hasCorner = (i: number) => plan.spots.some((s) => s.type === 'kitchen-corner' && Math.abs(s.at - (ends[i] - CORNER)) < 1)
  legs.forEach((leg, k) => {
    const f = an.faces[leg.face]
    let spans: [number, number][] = along.filter((y) => y.leg === leg && y.m.h <= 100).map((y): [number, number] => [y.from, y.from + y.m.w])
    // Over the corner units too: on into the corner along the first wall, from where it ends along the next.
    if (k > 0 && hasCorner(k - 1)) spans.push([35 - 60, CORNER - 60])
    if (k < legs.length - 1 && hasCorner(k)) spans.push([leg.len - CORNER, leg.len])
    spans.sort((p, q) => p[0] - q[0])
    spans = spans.reduce((out: [number, number][], [a, b]) => {
      const last = out[out.length - 1]
      if (last && a <= last[1] + 0.5) last[1] = Math.max(last[1], b)
      else out.push([a, b])
      return out
    }, [])
    if (hood?.leg === leg) spans = cut(spans, hood.range[0], hood.range[1])
    for (const c of an.columns) {
      const p = L.along(leg.face, c)
      if (p.n1 > 2 || p.n2 > 60) continue
      const a = (p.s1 - leg.start) * leg.dir
      const b = (p.s2 - leg.start) * leg.dir
      spans = cut(spans, Math.min(a, b) - 2, Math.max(a, b) + 2)
    }
    for (const o of an.windows) {
      if (o.face !== leg.face) continue
      const a = (o.s - o.w / 2 - leg.start) * leg.dir
      const b = (o.s + o.w / 2 - leg.start) * leg.dir
      spans = cut(spans, Math.min(a, b) - 5, Math.max(a, b) + 5)
    }
    for (const [a, b] of spans) {
      if (b - a < 30) continue
      const n = Math.ceil((b - a) / 100)
      const w = (b - a) / n
      for (let i = 0; i < n; i++) {
        const box = againstWall(facePoint(f, leg.start + leg.dir * (a + w * (i + 0.5))), f.inward, w, 35, 145, 215)
        // Wall cabinets kept up there already are left be (these only go where there's room).
        const got = L.tryPlace([{ sym: L.sym('wall-cabinet', box, { width: Math.round(w * 10) / 10, depth: 35, elevation: 145, frame: cabinets, led: true, light: LIT }), box }])
        if (got) marks.uppers.push(got)
      }
    }
  })
  const main = legs.reduce((a, b) => (b.len > a.len ? b : a))
  if (!fridgeInRun) {
    const mid = facePoint(an.faces[main.face], main.start + (main.dir * main.len) / 2)
    L.tryPlace(wallCands(L, 'fridge', 70, 65, 0, 180, { clear: 90, reach: true }), (c) => -dist(c.box, mid) / 50)
  }
  islandOrTable(ctx, plan.chain.shape === 'U' ? null : main)
  return true
}

/** A corner unit in the corner at the end of leg `i`: an L round it, its back to that leg's wall. */
function placeCorner(ctx: Ctx, legs: Leg[], i: number, shallow: Box[]) {
  const { L, style } = ctx
  if (i < 0 || i + 1 >= legs.length) return
  const A = legs[i]
  const fA = L.an.faces[A.face]
  const corner = facePoint(fA, A.start + A.dir * A.len)
  const toward = mul(fA.dir, A.dir)
  const mid = add(add(corner, mul(toward, -CORNER / 2)), mul(fA.inward, CORNER / 2))
  const rot = facing(fA.inward)
  const box: Box = { x: mid.x, y: mid.y, w: CORNER, d: CORNER, rot, z0: 0, z1: 90 }
  // Its corner is at its back left: flipped when the corner is to its right.
  const flipX = dot(axes(rot).u, toward) > 0
  if (L.fits(box, [], shallow)) L.add({ sym: L.sym('kitchen-corner', box, { width: CORNER, depth: CORNER, flipX, top: style.worktop }), box })
}

/** An island along the main run where there's room for it and both aisles; a table as well (or instead) if there's room. */
function islandOrTable(ctx: Ctx, main: Leg | null) {
  const { L, marks, style } = ctx
  const an = L.an
  const keptIsland = L.keeps(['kitchen-island'])
  if (keptIsland) marks.island = keptIsland
  else if (main) {
    const f = an.faces[main.face]
    const runMid = main.start + (main.dir * main.len) / 2
    for (const w of [240, 200, 160]) {
      if (w > main.len + 20) continue
      const cands: Cand[] = []
      for (const off of [0, -20, 20, -40, 40]) {
        for (const aisle of [110, 100, 120]) {
          const d = 95
          const c = facePoint(f, runMid + off, 60 + aisle + d / 2)
          const frame = { x: c.x, y: c.y, rot: facing(f.inward) }
          const bc = local(frame, 0, 13.5)
          const box: Box = { x: bc.x, y: bc.y, w, d: d + 27, rot: frame.rot, z0: 0, z1: 95 }
          cands.push({
            sym: L.sym('kitchen-island', frame, { width: w, depth: d, frame: style.cabinets, top: style.worktop }),
            box,
            zones: [zone(box, 0, (d + 27) / 2 + 35, w, 70)],
            reach: [[local(frame, 0, -d / 2 - 35)], [local(frame, 0, d / 2 + 70)]],
            s: Math.abs(off) + Math.abs(aisle - 110),
          })
        }
      }
      const island = L.tryPlace(cands, (c) => -c.s!)
      if (island) {
        marks.island = island
        break
      }
    }
  }
  // Room for a table as well (a kitchen-diner), or instead.
  if (marks.island ? an.area >= 20 : an.area >= 9) {
    marks.table = diningTable(ctx, marks.island ? [[180, 90], [160, 90], [140, 80]] : [[140, 80], [90, 90]]) ?? undefined
  }
}

// ---------------------------------------------------------------------------
// Bathrooms

function bathroom(ctx: Ctx) {
  const { L, use, marks, style } = ctx
  const an = L.an
  const entry = an.entry && doorPoint(an, an.entry)
  const far = (c: Cand) => (entry ? dist(c.box, entry) / 20 : 0)
  const onDoorWall = (c: Cand) => an.doors.some((o) => o.face === c.face)
  // A bath or a shower: a bath in a family bathroom with room for one, on some of the tries.
  const wet = () => {
    let got: Placed | null = null
    if (use === 'bathroom' && an.area >= 3.8 && ctx.attempt % 2 === 0) {
      got = L.tryPlace(wallCands(L, 'bathtub', 170, 75, 0, 60, { clear: 55, reach: true }), (c) => (c.snug ? 15 : 0) + far(c) + (onDoorWall(c) ? -10 : 0))
    }
    for (const s of [90, 80]) {
      if (got) break
      got = L.tryPlace(wallCands(L, 'shower', s, s, 0, 200, { clear: 55, reach: true }), (c) => (c.snug ? 25 : -10) + far(c))
    }
    if (got) marks.wet = got
  }
  const basin = () => {
    if (use === 'wc') {
      L.tryPlace(wallCands(L, 'washbasin', 50, 40, 0, 85, { clear: 55, reach: true }), (c) => (entry ? -dist(c.box, entry) / 30 : 0))
      return
    }
    for (const w of use === 'ensuite' || an.area >= 6 ? [120, 100, 80, 60] : [80, 60, 50]) {
      if (w === 50) {
        // No room for a vanity: a small basin.
        L.tryPlace(wallCands(L, 'washbasin', 50, 40, 0, 85, { clear: 55, reach: true }), (c) => (entry ? -dist(c.box, entry) / 30 : 0))
        return
      }
      const v = L.tryPlace(
        wallCands(L, 'bath-vanity', w, 48, 0, 190, { clear: 60, reach: true, extra: { sinks: w >= 120 ? 2 : undefined, style: style.vanity, frame: style.cabinets, top: style.worktop, led: true, light: LIT } }),
        (c) => (entry ? -dist(c.box, entry) / 40 : 0) + (marks.wet && c.face === marks.wet.face ? 4 : 0),
      )
      if (v) {
        marks.vanity = v
        return
      }
    }
  }
  // The toilet's footprint includes a little room at its sides; not facing the door if it can help it.
  const toilet = () => {
    const plumbing = marks.vanity ?? marks.wet
    L.tryPlace(
      L.wallSlots(60, 65, 0, 80).map((sl) => ({
        sym: L.sym('toilet', sl.box, { width: 40, depth: 65 }),
        box: sl.box,
        face: sl.face,
        zones: [zone(sl.box, 0, 65 / 2 + 27.5, 60, 55)],
        reach: [[before(sl.box, 30)]],
      })),
      (c) => (doorAhead(an, c.box, 40) ? -12 : 0) + (plumbing ? -dist(c.box, plumbing.box) / 60 : 0),
    )
  }
  // The order they're fitted in changes from try to try: in a tight room, what goes first gets the best spot.
  const orders = [
    [wet, basin, toilet],
    [toilet, wet, basin],
    [wet, toilet, basin],
    [toilet, basin, wet],
  ]
  for (const step of use === 'wc' ? [toilet, basin] : orders[ctx.attempt % orders.length]) step()
  if (marks.wet) niche(ctx, marks.wet)
  if (use === 'bathroom' && washerRoom(an.floor, ctx.uses) === 'bathroom') washingMachine(ctx, 'front')
  if (use !== 'wc') {
    const by = marks.wet ?? marks.vanity
    L.tryPlace(wallCands(L, 'towel-radiator', 50, 10, 15, 135, { extra: { elevation: 15 } }), (c) => (by ? -dist(c.box, by.box) / 40 : 0))
  }
}

/** A niche in the wall behind the shower or the bath, for bottles. */
function niche(ctx: Ctx, wet: Placed) {
  const an = ctx.L.an
  const f = an.faces[wet.face!]
  // Only in the room's own wall.
  const corner = an.room.points[f.edge]
  if (Math.abs(dot(sub(f.a, corner), f.inward)) > 0.5 || Math.abs(dot(sub(f.a, corner), f.dir)) > 0.5) return
  const bath = wet.sym.type === 'bathtub'
  ctx.marks.extra.push({
    ...newSymbol('shower-niche', 0, 0),
    depth: an.room.wallThickness,
    wall: { roomId: an.room.id, edge: f.edge, offset: Math.round(wet.s! * 10) / 10 },
    width: bath ? 60 : 40,
    height: bath ? 30 : 50,
    elevation: bath ? 70 : 110,
    shelf: bath ? undefined : true,
  })
}

// ---------------------------------------------------------------------------
// The rest

function hall(ctx: Ctx) {
  const { L } = ctx
  const an = L.an
  const entry = an.entry && doorPoint(an, an.entry)
  const outer = an.doors.find((o) => !o.to)
  const front = outer ? doorPoint(an, outer) : entry
  L.tryPlace(wallCands(L, 'wardrobe', 100, 60, 0, 225, { clear: 90, reach: true, through: L.shallowColumns(45) }), (c) => (front ? -dist(c.box, front) / 20 : 0))
  L.tryPlace(wallCands(L, 'sideboard', 120, 40, 0, 85, { clear: 90 }), (c) => faceLen(an, c.face!) / 50 - (front ? dist(c.box, front) / 80 : 0))
  plants(ctx, 1)
}

function dressing(ctx: Ctx) {
  const { L } = ctx
  for (let k = 0; k < 6; k++) {
    if (!wardrobe(ctx, [240, 200, 160, 120, 100, 80], (c) => (c.snug ? 5 : 0) + L.rand(), { doors: 'sliding' })) break
  }
  L.tryPlace(wallCands(L, 'dressing-table', 100, 45, 0, 160, { clear: 60, reach: true, extra: { style: ctx.style.dressing, led: true, light: LIT } }))
}

function office(ctx: Ctx) {
  const { L } = ctx
  const d = desk(ctx, 140, 70) ?? desk(ctx, 120, 60)
  L.tryPlace(wallCands(L, 'bookshelf', 120, 35, 0, 200, { clear: 50 }), (c) => (d ? -dist(c.box, d.box) / 60 : 0))
  L.tryPlace(
    L.wallSlots(80, 80, 0, 85)
      .filter((s) => s.snug)
      .map((sl) => ({ sym: L.sym('armchair', sl.box, { width: 80, depth: 80 }), box: sl.box, reach: [[before(sl.box, 30)]] })),
  )
  airCon(ctx)
  plants(ctx, 1)
}

/** Where a floor's washing machine goes: the laundry if there is one, else a family bathroom with room for it, else the kitchen. */
function washerRoom(floor: Floor, uses: Map<string, RoomUse>): RoomUse {
  if ([...uses.values()].includes('laundry')) return 'laundry'
  return floor.rooms.some((r) => uses.get(r.id) === 'bathroom' && area(r.points) >= 5.5e4) ? 'bathroom' : 'kitchen'
}

/** A washing machine against a wall, by the plumbing if there is any yet, room in front to load it. */
function washingMachine(ctx: Ctx, style: 'front' | 'stacked'): Placed | null {
  const { L, marks } = ctx
  const h = style === 'stacked' ? 170 : 85
  const by = marks.vanity ?? marks.wet
  return L.tryPlace(wallCands(L, 'washing-machine', 60, 60, 0, h, { clear: 70, reach: true, extra: { style, height: h } }), (c) => (by ? -dist(c.box, by.box) / 60 : 0))
}

function laundry(ctx: Ctx) {
  const { L } = ctx
  if (!washingMachine(ctx, 'stacked')) washingMachine(ctx, 'front')
  for (let i = 0; i < 2; i++) L.tryPlace(wallCands(L, 'bookshelf', 100, 40, 0, 200, { clear: 70 }), () => L.rand())
}

function balcony(ctx: Ctx) {
  // A small round table (its chairs come with it), plants in the corners.
  diningTable(ctx, [[70, 70]])
  plants(ctx, 2)
}

export const RECIPES: Record<RoomUse, (ctx: Ctx) => void> = {
  living,
  kitchen,
  dining,
  master: bedroom,
  bedroom,
  kids: bedroom,
  office,
  bathroom,
  ensuite: bathroom,
  wc: bathroom,
  hall,
  dressing,
  laundry,
  balcony,
}

// ---------------------------------------------------------------------------
// Windows: curtains in living rooms and bedrooms, blinds elsewhere.

export function dressWindows(ctx: Ctx, have: PlanSymbol[] = []) {
  const { L, use, style } = ctx
  const an = L.an
  // A window with a curtain or blind kept over it already keeps that.
  const covered = (o: Opening) => have.some((s) => dist(s, doorPoint(an, o)) < o.w / 2 + 40)
  const curtains = use === 'living' || use === 'master' || use === 'bedroom' || use === 'dining' || use === 'office'
  const blinds = use === 'kitchen' || use === 'kids' || use === 'bathroom' || use === 'ensuite' || use === 'laundry'
  for (const o of an.openings) {
    if (!o.glazed || (o.kind !== 'window' && !curtains) || covered(o)) continue
    const f = an.faces[o.face]
    if (curtains) {
      const w = Math.min(o.w + 40, f.s2 - f.s1)
      const s = Math.min(Math.max(o.s, f.s1 + w / 2), f.s2 - w / 2)
      const box = againstWall(facePoint(f, s), f.inward, w, 15, 0, 0)
      ctx.marks.extra.push(L.sym('curtain', box, { width: w, depth: 15, frame: style.curtain }))
    } else if (blinds) {
      const box = againstWall(facePoint(f, o.s), f.inward, o.w + 10, 8, 0, 0)
      ctx.marks.extra.push(L.sym('blind', box, { width: o.w + 10, depth: 8 }))
    }
  }
}

/** Points spread over a room `spacing` apart, `inset` in from its walls (its middle, if it's too small for that). */
export function spread(poly: Point[], inset: number, spacing: number): Point[] {
  const inner = offsetPolygon(poly, -inset)
  const ok = Math.sign(signedArea(inner)) === Math.sign(signedArea(poly)) && Math.abs(signedArea(inner)) > 100
  if (!ok) return [labelPoint(poly)]
  const b = bbox(inner)
  const nx = Math.max(1, Math.round((b.maxX - b.minX) / spacing) + 1)
  const ny = Math.max(1, Math.round((b.maxY - b.minY) / spacing) + 1)
  const out: Point[] = []
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const p = {
        x: nx === 1 ? (b.minX + b.maxX) / 2 : b.minX + ((b.maxX - b.minX) * i) / (nx - 1),
        y: ny === 1 ? (b.minY + b.maxY) / 2 : b.minY + ((b.maxY - b.minY) * j) / (ny - 1),
      }
      if (pointInPolygon(p, inner)) out.push({ x: Math.round(p.x), y: Math.round(p.y) })
    }
  }
  return out.length ? out : [labelPoint(poly)]
}

