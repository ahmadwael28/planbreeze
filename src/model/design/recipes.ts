/**
 * What goes in each kind of room, and where. Each recipe places its main piece first (the bed, the TV wall, the
 * kitchen units, the bath) on the wall that suits it best, or another wall for another idea, then what goes with it,
 * then the rest as long as it fits and leaves the room easy to walk through.
 */
import { bbox, dist, dot, labelPoint, offsetPolygon, pointInPolygon, signedArea, sub } from '../geometry'
import { newSymbol } from '../project'
import { HOOD_STYLES } from '../symbols'
import type { PlanSymbol, Point, RoomUse } from '../types'
import { againstWall, axes, facing, local, toLocal } from './geom'
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
  run?: { face: number }
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
  o: { clear?: number; clearW?: number; reach?: boolean; extra?: Partial<PlanSymbol>; step?: number } = {},
): SlotCand[] {
  return L.wallSlots(w, d, z0, z1, o.step ?? 10).map((sl) => ({
    sym: L.sym(type, sl.box, { width: w, depth: d, ...o.extra }),
    box: sl.box,
    face: sl.face,
    s: sl.s,
    snug: sl.snug,
    zones: o.clear ? [zone(sl.box, 0, d / 2 + o.clear / 2, o.clearW ?? w, o.clear)] : [],
    reach: o.reach ? [[before(sl.box)]] : [],
  }))
}

/**
 * The main piece of a room: the best place on each wall, the walls ranked by their best; `variant` picks which wall
 * (the best for the first idea, the next best for another…).
 */
function anchor<C extends Cand>(L: Layout, cands: C[], score: (c: C) => number, variant: number, then?: (c: C) => boolean): C | null {
  const byFace = new Map<number, C[]>()
  const values = new Map<C, number>()
  for (const c of cands) {
    const v = score(c)
    if (v === -Infinity || !L.fits(c.box, c.zones)) continue
    values.set(c, v)
    byFace.set(c.face ?? -1, [...(byFace.get(c.face ?? -1) ?? []), c])
  }
  const ranked = [...byFace.values()].map((list) => list.sort((a, b) => values.get(b)! - values.get(a)!)).sort((a, b) => values.get(b[0])! - values.get(a[0])!)
  for (let k = 0; k < ranked.length; k++) {
    const got = L.tryPlace(ranked[(variant + k) % ranked.length], (c) => values.get(c) ?? -Infinity)
    if (!got) continue
    // What has to go with it (a sofa across from the TV): if that can't be done, the next wall.
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
  if (got) {
    const at = local(got.box, 0, d / 2 + 18)
    const box: Box = { x: at.x, y: at.y, w: 45, d: 45, rot: (got.box.rot + 180) % 360, z0: 0, z1: 90 }
    L.add({ sym: L.sym('chair', box), box })
  }
  return got
}

/** A wardrobe of one of these lengths (longest first), with room to open it. */
function wardrobe(ctx: Ctx, lengths: number[], score: (c: SlotCand) => number, extra: Partial<PlanSymbol> = {}) {
  const { L } = ctx
  for (const len of lengths) {
    // Room to stand at it and open it; its ends can meet another wardrobe in a corner.
    const got = L.tryPlace(wallCands(L, 'wardrobe', len, 60, 0, 225, { clear: 70, clearW: Math.max(40, len - 120), reach: true, extra }), score)
    if (got) return got
  }
  return null
}

/** A TV on the wall facing something (a bed), across from its middle. */
function tvFacing(ctx: Ctx, target: Box, w: number, z0: number) {
  const { L } = ctx
  const ahead = axes(target.rot).v
  const cands: Cand[] = []
  L.an.faces.forEach((f, i) => {
    if (dot(f.inward, ahead) > -0.95) return
    const s = dot(sub(target, f.a), f.dir)
    if (s - w / 2 < f.s1 || s + w / 2 > f.s2) return
    const box = againstWall(facePoint(f, s), f.inward, w, 8, z0, z0 + 72)
    cands.push({ sym: L.sym('tv', box, { width: w, depth: 8, elevation: z0 }), box, face: i, s })
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
  if (use === 'master' || use === 'bedroom') tvFacing(ctx, bed.box, use === 'master' ? 120 : 100, 110)
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
  const tvW = an.area >= 22 ? 150 : 125
  const tvBox = (face: number, s: number) => againstWall(facePoint(an.faces[face], s), an.faces[face].inward, tvW, 8, 100, 175)
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
    const tb = tvBox(u.face!, u.s!)
    const tv = L.tryPlace([{ sym: L.sym('tv', tb, { width: tvW, depth: 8, elevation: 100 }), box: tb }])
    seat = facingSofa(ctx, u)
    if (seat) return true
    if (tv) L.remove(tv)
    L.remove(u)
    return false
  })
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
  if (cornerSofa) {
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

const MOD = {
  fridge: { type: 'fridge', w: 70, h: 180, d: 65 },
  tower: { type: 'oven-tower', w: 60, h: 220, d: 60 },
  sink: (w: number) => ({ type: 'kitchen-sink', w, h: 90, d: 60 }),
  dw: { type: 'dishwasher', w: 60, h: 90, d: 60 },
  hob: { type: 'stove', w: 60, h: 90, d: 60 },
  counter: (w: number) => ({ type: 'counter', w, h: 90, d: 60 }),
}

/**
 * A run of kitchen units `len` long: tall ones at its start, then counters, the sink (with the dishwasher by it) and
 * the hob with worktop between them; the sink as near `sinkAt` as it'll go (under the window), the hob out from
 * under it.
 */
function planRun(len: number, tall: Module[], dw: boolean, sinkW: number, sinkAt: number | null, window: [number, number] | null): Module[] | null {
  const T = tall.reduce((s, m) => s + m.w, 0)
  const block = sinkW + (dw ? 60 : 0)
  const fixed = T + 40 + block + 60 + 60 + 30
  if (fixed > len + 0.5) return null
  const slack = len - fixed
  let best: { mods: Module[]; cost: number } | null = null
  for (const sinkFirst of [true, false]) {
    let e1: number
    let e2: number
    if (sinkFirst) {
      const base = T + 40 + sinkW / 2
      e1 = sinkAt === null ? slack * 0.3 : Math.max(0, Math.min(slack, sinkAt - base))
      e2 = Math.min(slack - e1, 60)
    } else {
      const base = T + 40 + 60 + 60 + sinkW / 2
      e1 = 0
      e2 = sinkAt === null ? Math.min(slack, 40) : Math.max(0, Math.min(slack, sinkAt - base))
    }
    const e3 = slack - e1 - e2
    const sinkBlock = [MOD.sink(sinkW), ...(dw ? [MOD.dw] : [])]
    const mods = sinkFirst
      ? [...tall, MOD.counter(40 + e1), ...sinkBlock, MOD.counter(60 + e2), MOD.hob, MOD.counter(30 + e3)]
      : [...tall, MOD.counter(40 + e1), MOD.hob, MOD.counter(60 + e2), ...sinkBlock, MOD.counter(30 + e3)]
    let at = 0
    let sinkCenter = 0
    let cost = 0
    for (const m of mods) {
      if (m.type === 'kitchen-sink') sinkCenter = at + m.w / 2
      if (window && (m.type === 'stove' || m.h > 100) && at < window[1] && at + m.w > window[0]) cost += 1000
      at += m.w
    }
    cost += sinkAt === null ? (sinkFirst ? 0 : 5) : Math.abs(sinkCenter - sinkAt)
    if (!best || cost < best.cost) best = { mods, cost }
  }
  return best && best.cost < 1000 ? best.mods : null
}

function kitchen(ctx: Ctx) {
  const { L, marks, style } = ctx
  const an = L.an
  // Stretches of wall clear for 60 cm deep units, a window over one the best place for the sink.
  const runs = an.faces
    .flatMap((_, i) => L.freeAlong(i, 60, 0, 90).map(([s1, s2]) => ({ face: i, s1, s2 })))
    .filter((r) => r.s2 - r.s1 >= 180)
    .map((r) => ({ ...r, win: an.windows.find((o) => o.face === r.face && o.s > r.s1 && o.s < r.s2 && o.sill >= 85) }))
  if (!runs.length) return
  const entry = an.entry && doorPoint(an, an.entry)
  type Plan = { run: (typeof runs)[number]; mods: Module[]; tallAtStart: boolean; window: [number, number] | null; fridgeInRun: boolean; level: number }
  // Along each stretch, the fullest set of units that fits (fridge, oven tower, dishwasher…).
  const plans = runs.flatMap((run): Plan[] => {
    const rf = an.faces[run.face]
    // Tall units go at the end away from the window (toward the way in, without one).
    const tallAtStart = run.win
      ? run.win.s - run.s1 > run.s2 - run.win.s
      : entry
        ? dist(facePoint(rf, run.s1), entry) < dist(facePoint(rf, run.s2), entry)
        : true
    const rel = (s: number) => (tallAtStart ? s - run.s1 : run.s2 - s)
    const sinkAt = run.win ? rel(run.win.s) : null
    const window: [number, number] | null = run.win
      ? [Math.min(rel(run.win.s - run.win.w / 2), rel(run.win.s + run.win.w / 2)) - 5, Math.max(rel(run.win.s - run.win.w / 2), rel(run.win.s + run.win.w / 2)) + 5]
      : null
    const sets = [
      [[MOD.fridge, MOD.tower], true, 80],
      [[MOD.fridge], true, 80],
      [[MOD.fridge], false, 80],
      [[], true, 80],
      [[], false, 60],
    ] as [Module[], boolean, number][]
    for (let level = 0; level < sets.length; level++) {
      const [tall, dw, sinkW] = sets[level]
      const mods = planRun(run.s2 - run.s1, tall, dw, sinkW, sinkAt, window)
      if (mods) return [{ run, mods, tallAtStart, window, fridgeInRun: tall.length > 0, level }]
    }
    return []
  })
  // The fullest kitchen first, one under a window next; another idea takes the next.
  plans.sort((a, b) => a.level - b.level || Number(!!b.run.win) - Number(!!a.run.win) || b.run.s2 - b.run.s1 - (a.run.s2 - a.run.s1))
  const plan = plans[ctx.variant % Math.max(1, plans.length)]
  if (!plan) return
  const { run, mods, tallAtStart, window, fridgeInRun } = plan
  const f = an.faces[run.face]
  const len = run.s2 - run.s1
  marks.run = { face: run.face }
  const cabinets = style.cabinets
  let at = 0
  const placed: { m: Module; p: Placed; from: number; to: number }[] = []
  for (const m of mods) {
    const mid = tallAtStart ? run.s1 + at + m.w / 2 : run.s2 - at - m.w / 2
    const box = againstWall(facePoint(f, mid), f.inward, m.w, m.d, 0, m.h)
    const extra: Partial<PlanSymbol> = { width: m.w, depth: m.d }
    if (m.type === 'oven-tower') extra.frame = cabinets
    const reach = m.type === 'counter' ? [] : [[before(box, 40)]]
    const c: Cand = { sym: L.sym(m.type, box, extra), box, reach, zones: m.type === 'counter' ? [] : [zone(box, 0, m.d / 2 + 50, m.w, 100)] }
    if (L.fits(box, c.zones)) placed.push({ m, p: L.add(c), from: at, to: at + m.w })
    at += m.w
  }
  // The hood over the hob, and wall cabinets over the rest (not over the window or the tall units).
  const hob = placed.find((x) => x.m.type === 'stove')
  let hoodRange: [number, number] = [-1, -1]
  if (hob) {
    const hoodStyle = HOOD_STYLES.find((h) => h.id === style.hood) ?? HOOD_STYLES[0]
    const w = 90
    const mid = (hob.from + hob.to) / 2
    const s = tallAtStart ? run.s1 + mid : run.s2 - mid
    const box = againstWall(facePoint(f, s), f.inward, w, 50, 155, 155 + (hoodStyle.height ?? 45))
    const hood = L.tryPlace([{ sym: L.sym('range-hood', box, { width: w, depth: 50, elevation: 155, height: hoodStyle.height, style: hoodStyle.id, led: true, light: LIT }), box }])
    if (hood) {
      marks.hood = hood
      hoodRange = [mid - w / 2 - 2, mid + w / 2 + 2]
    }
  }
  const low = placed.filter((x) => x.m.h <= 100)
  const spans: [number, number][] = []
  for (const x of low) {
    const last = spans[spans.length - 1]
    if (last && Math.abs(last[1] - x.from) < 0.5) last[1] = x.to
    else spans.push([x.from, x.to])
  }
  const cut = (list: [number, number][], a: number, b: number) =>
    list.flatMap(([s1, s2]): [number, number][] => (b <= s1 || a >= s2 ? [[s1, s2]] : ([[s1, Math.max(s1, a)], [Math.min(s2, b), s2]] as [number, number][]).filter(([p, q]) => q - p > 0.5)))
  let free = cut(spans, hoodRange[0], hoodRange[1])
  if (window) free = cut(free, window[0], window[1])
  for (const [a, b] of free) {
    if (b - a < 30) continue
    const n = Math.ceil((b - a) / 100)
    const w = (b - a) / n
    for (let i = 0; i < n; i++) {
      const mid = a + w * (i + 0.5)
      const s = tallAtStart ? run.s1 + mid : run.s2 - mid
      const box = againstWall(facePoint(f, s), f.inward, w, 35, 145, 215)
      const got = L.tryPlace([{ sym: L.sym('wall-cabinet', box, { width: Math.round(w * 10) / 10, depth: 35, elevation: 145, frame: cabinets, led: true, light: LIT }), box }])
      if (got) marks.uppers.push(got)
    }
  }
  if (!fridgeInRun) {
    L.tryPlace(wallCands(L, 'fridge', 70, 65, 0, 180, { clear: 90, reach: true }), (c) => -dist(c.box, facePoint(f, (run.s1 + run.s2) / 2)) / 50)
  }
  // An island where there's room for it and both aisles, else a small table.
  const runMid = (run.s1 + run.s2) / 2
  for (const w of [240, 200, 160]) {
    if (w > len + 20) continue
    const cands: Cand[] = []
    for (const off of [0, -20, 20, -40, 40]) {
      for (const aisle of [110, 100, 120]) {
        const d = 95
        const c = facePoint(f, runMid + off, 60 + aisle + d / 2)
        const frame = { x: c.x, y: c.y, rot: facing(f.inward) }
        const bc = local(frame, 0, 13.5)
        const box: Box = { x: bc.x, y: bc.y, w, d: d + 27, rot: frame.rot, z0: 0, z1: 95 }
        cands.push({
          sym: L.sym('kitchen-island', frame, { width: w, depth: d, frame: cabinets }),
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
        wallCands(L, 'bath-vanity', w, 48, 0, 190, { clear: 60, reach: true, extra: { sinks: w >= 120 ? 2 : undefined, style: style.vanity, frame: style.cabinets, led: true, light: LIT } }),
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
  L.tryPlace(wallCands(L, 'wardrobe', 100, 60, 0, 225, { clear: 90, reach: true }), (c) => (front ? -dist(c.box, front) / 20 : 0))
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

function laundry(ctx: Ctx) {
  const { L } = ctx
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

export function dressWindows(ctx: Ctx) {
  const { L, use, style } = ctx
  const an = L.an
  const curtains = use === 'living' || use === 'master' || use === 'bedroom' || use === 'dining' || use === 'office'
  const blinds = use === 'kitchen' || use === 'kids' || use === 'bathroom' || use === 'ensuite' || use === 'laundry'
  for (const o of an.openings) {
    if (!o.glazed || (o.kind !== 'window' && !curtains)) continue
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

