import polygonClipping from 'polygon-clipping'
import { isDraft } from 'immer'
import { offsetEdges, offsetEdgesStepped, offsetPolygon, pointInPolygon, projectOnSegment, signedArea } from './geometry'
import type { Ceiling, CeilingStyle, Floor, LightColor, LightSettings, PlanSymbol, Point, Room } from './types'

export const LIGHT_COLORS: Record<LightColor, { label: string; kelvin: number; hex: string }> = {
  warm: { label: 'Warm', kelvin: 2700, hex: '#ffc88f' },
  white: { label: 'White', kelvin: 4000, hex: '#fff3e6' },
  cool: { label: 'Cool', kelvin: 6000, hex: '#dce8ff' },
}

/** Color temperatures lamps and LED strips come in, from a candle-like glow to cool daylight. */
export const KELVINS: { kelvin: number; name: string }[] = [
  { kelvin: 2200, name: 'Amber glow' },
  { kelvin: 2700, name: 'Warm white' },
  { kelvin: 3000, name: 'Soft white' },
  { kelvin: 3500, name: 'Neutral warm' },
  { kelvin: 4000, name: 'Neutral white' },
  { kelvin: 5000, name: 'Daylight' },
  { kelvin: 6500, name: 'Cool daylight' },
]
export const KELVIN_MIN = 2200
export const KELVIN_MAX = 6500

/** The tint of light at some color temperatures (softened, as eyes adapt to it), to blend between. */
const TINTS: [number, string][] = [
  [2200, '#ffb877'],
  [2700, '#ffc88f'],
  [3000, '#ffd3a4'],
  [3500, '#ffe2c4'],
  [4000, '#fff3e6'],
  [5000, '#f1f1f6'],
  [6000, '#dce8ff'],
  [6500, '#d4e3ff'],
]

/** The tint of light at a color temperature (K). */
export function kelvinHex(k: number): string {
  const t = Math.min(KELVIN_MAX, Math.max(KELVIN_MIN, k))
  const i = Math.max(0, TINTS.findIndex(([at]) => at >= t) - 1)
  const [k0, a] = TINTS[i]
  const [k1, b] = TINTS[Math.min(i + 1, TINTS.length - 1)]
  const f = k1 === k0 ? 0 : (t - k0) / (k1 - k0)
  const ch = (hex: string, s: number) => parseInt(hex.slice(1 + s * 2, 3 + s * 2), 16)
  return `#${[0, 1, 2].map((s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * f).toString(16).padStart(2, '0')).join('')}`
}

/** A light's color temperature (K): chosen, or that of its warm / white / cool. */
export const kelvinOf = (light?: { color?: LightColor; kelvin?: number }) => light?.kelvin ?? LIGHT_COLORS[light?.color ?? 'warm'].kelvin

/** The tint of a light. */
export const lightHex = (light?: { color?: LightColor; kelvin?: number }) => kelvinHex(kelvinOf(light))

/** Warm, white or cool, for a color temperature. */
export const colorForKelvin = (k: number): LightColor => (k < 3300 ? 'warm' : k < 5000 ? 'white' : 'cool')

/** A light at a color temperature (K), its warm / white / cool kept in step. */
export const withKelvin = (light: LightSettings, kelvin: number): LightSettings => ({ ...light, kelvin, color: colorForKelvin(kelvin) })

/** What a color temperature is called (the nearest named one). */
export function kelvinName(k: number) {
  return KELVINS.reduce((best, x) => (Math.abs(x.kelvin - k) < Math.abs(best.kelvin - k) ? x : best)).name
}

export const CEILING_STYLES: Record<CeilingStyle, { name: string; description: string; defaults: Omit<Ceiling, 'style'> }> = {
  flat: { name: 'Flat drop ceiling', description: 'A lowered gypsum ceiling across the whole room', defaults: { drop: 20, band: 0 } },
  tray: { name: 'Tray (bulkhead)', description: 'A lowered band along the walls, higher in the middle', defaults: { drop: 25, band: 60 } },
  cove: { name: 'Cove with hidden light', description: 'A bulkhead with a trough that hides an LED strip', defaults: { drop: 30, band: 60 } },
  floating: { name: 'Floating panel', description: 'A panel hung in the middle with light around its edges', defaults: { drop: 25, band: 50 } },
  stepped: { name: 'Double step', description: 'Two lowered bands stepping up to the middle', defaults: { drop: 30, band: 45 } },
}

/** Width of the light trough in a cove ceiling. */
export const COVE_WIDTH = 15

/** Width and depth of a shadow gap between wall and ceiling. */
export const SHADOW_GAP = { width: 5, depth: 5 }

/** Ceilings with a band whose inner edge can carry a hidden LED strip. */
export function hasTrayEdge(room: Room) {
  return room.ceiling?.style === 'tray' || room.ceiling?.style === 'stepped'
}

/** Colors for switch wiring lines, one per switch. */
export const WIRE_COLORS = ['#f97316', '#8b5cf6', '#10b981', '#ec4899', '#0ea5e9', '#eab308', '#ef4444', '#14b8a6']

export function inset(room: Room, by: number): Point[] {
  return by === 0 ? room.points : offsetPolygon(room.points, -by)
}

/** How far from `o` along `d` the room's outline is, if it's within `max`. */
function rayToOutline(o: Point, d: Point, pts: Point[], max: number): number | null {
  let best = max
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const e = { x: pts[(i + 1) % pts.length].x - a.x, y: pts[(i + 1) % pts.length].y - a.y }
    const den = d.x * e.y - d.y * e.x
    if (Math.abs(den) < 1e-9) continue
    const ao = { x: a.x - o.x, y: a.y - o.y }
    const t = (ao.x * e.y - ao.y * e.x) / den
    const s = (ao.x * d.y - ao.y * d.x) / den
    if (t >= 0 && s >= 0 && s <= 1 && t < best) best = t
  }
  return best < max ? best : null
}

/**
 * Footprints of the columns built into a room's walls, reaching a little into the wall so cutting them out is clean.
 * One a few centimeters from a corner reaches the other wall too: no sliver of ceiling is left between them.
 */
export function roomColumns(room: Room, floor: Floor): Point[][] {
  const out: Point[][] = []
  for (const s of floor.symbols) {
    if (s.type !== 'wall-post' || !pointInPolygon(s, room.points)) continue
    const r = (s.rotation * Math.PI) / 180
    const c = Math.cos(r)
    const sn = Math.sin(r)
    const at = (x: number, y: number) => ({ x: s.x + x * c - y * sn, y: s.y + x * sn + y * c })
    const reach = (side: 1 | -1) => {
      const t = rayToOutline(at((side * s.width) / 2, 0), { x: side * c, y: side * sn }, room.points, 8)
      return t === null ? 0 : t + 3
    }
    const left = s.width / 2 + reach(-1)
    const right = s.width / 2 + reach(1)
    // Its back (local -y) is against the wall.
    out.push([at(-left, -s.depth / 2 - 3), at(right, -s.depth / 2 - 3), at(right, s.depth / 2), at(-left, s.depth / 2)])
  }
  return out
}

/**
 * How each edge of a room as its ceiling sees it came about: the room's wall it's along, and whether it's a column's
 * side; and the room itself and its columns (the band's inner edge is measured from the walls, see bandInset).
 */
const shapes = new WeakMap<Room, { parent: number[]; face: boolean[]; room: Room; columns: Point[][] }>()
const ceilingRooms = new WeakMap<Room, { symbols: PlanSymbol[]; room: Room }>()

/**
 * The room as its ceiling sees it: columns built into its walls cut out of it, so where the gypsum meets the walls it
 * fits around them, and what runs along the walls (hidden lights, shadow gaps, curtain pockets) goes around them. The
 * band's inner edge stays straight, measured from the walls (see bandInset). Per-wall settings carry over: each piece
 * of the outline takes its wall's, and a column's sides take those of the wall it stands on (shadow gaps not if they
 * stop at columns; pockets never).
 */
export function ceilingRoom(plain: Room, floor: Floor): Room {
  const hit = ceilingRooms.get(plain)
  if (hit && hit.symbols === floor.symbols) return hit.room
  // Along an open wall there's no wall for a shadow gap or curtain pocket.
  const open = new Set(plain.openEdges ?? [])
  const room = open.size
    ? { ...plain, shadowGaps: plain.shadowGaps?.filter((i) => !open.has(i)), curtainPockets: plain.curtainPockets?.filter((i) => !open.has(i)) }
    : plain
  let out = room
  const cols = roomColumns(room, floor)
  if (cols.length && room.points.length >= 3) {
    const ring = (pts: Point[]) => [pts.map((p) => [p.x, p.y] as [number, number])]
    const parts = polygonClipping.difference(ring(room.points), ...cols.map(ring))
    const outer = parts.map((poly) => poly[0]).sort((a, b) => Math.abs(signedArea(b.map(([x, y]) => ({ x, y })))) - Math.abs(signedArea(a.map(([x, y]) => ({ x, y })))))[0]
    if (outer && outer.length > 3) {
      let pts = outer.slice(0, -1).map(([x, y]) => ({ x, y }))
      if (Math.sign(signedArea(pts)) !== Math.sign(signedArea(room.points))) pts = pts.reverse()
      const n = room.points.length
      const parent: number[] = []
      const face: boolean[] = []
      pts.forEach((a, i) => {
        const b = pts[(i + 1) % pts.length]
        const along = room.points.findIndex((p, k) => {
          const q = room.points[(k + 1) % n]
          return projectOnSegment(a, p, q).dist < 0.5 && projectOnSegment(b, p, q).dist < 0.5
        })
        if (along >= 0) {
          parent.push(along)
          face.push(false)
          return
        }
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        let best = 0
        room.points.forEach((p, k) => {
          const q = room.points[(k + 1) % n]
          const bp = room.points[best]
          if (projectOnSegment(m, p, q).dist < projectOnSegment(m, bp, room.points[(best + 1) % n]).dist) best = k
        })
        parent.push(best)
        face.push(true)
      })
      const map = (edges: number[] | undefined, onFaces: boolean) => {
        if (!edges?.length) return edges
        const on = new Set(edges)
        const mapped = pts.map((_, i) => i).filter((i) => on.has(parent[i]) && (onFaces || !face[i]))
        return mapped.length ? mapped : undefined
      }
      out = {
        ...room,
        points: pts,
        shadowGaps: map(room.shadowGaps, room.gapsAtColumns !== 'stop'),
        curtainPockets: map(room.curtainPockets, room.pocketsAtColumns === 'wrap'),
        openEdges: map(room.openEdges, false),
        ceilingBreaks: map(room.ceilingBreaks, false),
        ceiling: room.ceiling && { ...room.ceiling, bands: room.ceiling.bands && pts.map((_, i) => room.ceiling!.bands![parent[i]] ?? null) },
      }
      shapes.set(out, { parent, face, room, columns: cols })
    }
  }
  // Its hidden light along the walls: the gypsum stops short of the walls it lights (those without a curtain pocket,
  // whose own light takes over there).
  const hidden = floor.symbols.find((s) => s.room === room.id && s.type === 'cove-light')
  if (hidden && hiddenLightInGap(room, hidden)) {
    const light = ceilingLight(hidden, out)
    const off = new Set(light.cove?.off ?? [])
    const pocket = onPocketWall(out)
    const lit = out.points.map((_, i) => i).filter((i) => !off.has(i) && !pocket(i) && !out.openEdges?.includes(i))
    if (lit.length) {
      const info = shapes.get(out)
      out = { ...out, hiddenGaps: lit, hiddenGapWidth: hidden.cove?.gap ?? HIDDEN_GAP }
      if (info) shapes.set(out, info)
    }
  }
  ceilingRooms.set(plain, { symbols: floor.symbols, room: out })
  return out
}

/**
 * A cove light's settings on the room as its ceiling sees it (see ceilingRoom): its dark walls carried over, and the
 * columns' sides dark too if it stops at columns.
 */
export function ceilingLight(sym: PlanSymbol, croom: Room): PlanSymbol {
  const info = shapes.get(croom)
  if (!info || !sym.room || followsBand(croom, sym)) return sym
  const off = new Set(sym.cove?.off ?? [])
  const stop = sym.type === 'cove-light' && sym.cove?.columns === 'stop'
  const mapped = info.parent.map((_, i) => i).filter((i) => off.has(info.parent[i]) || (stop && info.face[i]))
  return { ...sym, cove: { ...sym.cove, off: mapped } }
}

/**
 * A room light that runs along the band's inner edge rather than the walls (in a cove's trough, around a floating
 * panel, inside a tray): straight, like the band, whatever columns there are.
 */
export function followsBand(room: Room, sym: PlanSymbol) {
  const style = room.ceiling?.style
  return sym.type === 'cove-light' && (style === 'cove' || style === 'floating' || (sym.cove?.at === 'inner' && hasTrayEdge(room)))
}

/** A band's inner edge kept clear of columns deeper than the band: it goes around them, `margin` off. */
function clearOfColumns(inner: Point[], columns: Point[][], margin = 10): Point[] {
  const hits = columns.filter((c) => c.some((p) => pointInPolygon(p, inner)) || inner.some((p) => pointInPolygon(p, c)))
  if (!hits.length || inner.length < 3) return inner
  const ring = (pts: Point[]) => [pts.map((p) => [p.x, p.y] as [number, number])]
  const parts = polygonClipping.difference(ring(inner), ...hits.map((c) => ring(offsetPolygon(c, margin))))
  const area = (r: [number, number][]) => Math.abs(signedArea(r.map(([x, y]) => ({ x, y }))))
  const outer = parts.map((p) => p[0]).sort((a, b) => area(b) - area(a))[0]
  if (!outer || outer.length < 4) return inner
  const pts = outer.slice(0, -1).map(([x, y]) => ({ x, y }))
  return Math.sign(signedArea(pts)) === Math.sign(signedArea(inner)) ? pts : pts.reverse()
}

/** Usual width of a curtain pocket (cm). */
export const POCKET_WIDTH = 15

/** Usual width of the gap a hidden light along the walls sits in, between a gypsum ceiling and the wall (cm). */
export const HIDDEN_GAP = 10

/**
 * Whether a room's hidden light sits in a gap between its gypsum ceiling and the walls (like a curtain pocket, the LED
 * up in it, lighting the wall below): along the walls of a flat, tray or stepped gypsum ceiling.
 */
export function hiddenLightInGap(room: Room, sym: PlanSymbol) {
  const style = room.ceiling?.style
  return sym.type === 'cove-light' && sym.cove?.at !== 'inner' && (style === 'flat' || style === 'tray' || style === 'stepped')
}

export const pocketWidth = (room: Room) => room.pocketWidth ?? POCKET_WIDTH

/**
 * The open walls (see Room.openEdges) a room's gypsum ceiling runs on across, into the next room's as one ceiling: all
 * but those it stops at.
 */
export const ceilingJoins = (room: Room) => (room.openEdges ?? []).filter((i) => !room.ceilingBreaks?.includes(i))

/** Whether a–b lies along one of the open walls the room's ceiling runs on across. */
export function onCeilingJoin(room: Room, a: Point, b: Point): boolean {
  return ceilingJoins(room).some((i) => {
    const p = room.points[i]
    const q = room.points[(i + 1) % room.points.length]
    return !!p && !!q && projectOnSegment(a, p, q).dist < 0.5 && projectOnSegment(b, p, q).dist < 0.5
  })
}

/** The ceiling's band width along wall i: its own, or the ceiling's (none where it runs on into the next room). */
export const bandAt = (room: Room, i: number) => (ceilingJoins(room).includes(i) ? 0 : (room.ceiling?.bands?.[i] ?? room.ceiling?.band ?? 0))

/**
 * The room moved in by the ceiling's band on each wall (each its own width) times `k`, plus `extra`: the band's inner
 * edge, and what runs along it. Measured from the walls, so it stays straight past columns built into them, unless a
 * column stands out further than the band (then it goes around it).
 */
export function bandInset(room: Room, k = 1, extra = 0, stepped = false): Point[] {
  const info = shapes.get(room)
  const base = info?.room ?? room
  // Where it runs on into the next room's ceiling: right to the line, to meet that one's.
  const joins = new Set(ceilingJoins(base))
  const d = base.points.map((_, i) => (joins.has(i) ? 0 : -(bandAt(base, i) * k + extra)))
  const inner = d.every((x) => x === 0) ? base.points : stepped ? offsetEdgesStepped(base.points, d) : offsetEdges(base.points, d)
  return info ? clearOfColumns(inner, info.columns) : inner
}

/**
 * The band's inner edge as it's built: like bandInset, but with a step where a wall with a band runs in line into an
 * open wall the ceiling runs on across (more corners, so not for what's numbered by wall, like lights' dark walls).
 */
export const bandEdge = (room: Room, k = 1, extra = 0) => bandInset(room, k, extra, true)

/**
 * Where a gypsum ceiling's outer edge runs: along the walls, or short of them where there's a shadow gap or a
 * curtain pocket.
 */
export function ceilingOutline(room: Room): Point[] {
  const gaps = new Set(room.shadowGaps ?? [])
  const pockets = new Set(room.ceiling && room.ceiling.style !== 'floating' ? (room.curtainPockets ?? []) : [])
  const hidden = new Set(room.hiddenGaps ?? [])
  if (!gaps.size && !pockets.size && !hidden.size) return room.points
  return offsetEdges(
    room.points,
    room.points.map((_, i) =>
      pockets.has(i) ? -pocketWidth(room) : hidden.has(i) ? -(room.hiddenGapWidth ?? HIDDEN_GAP) : gaps.has(i) ? -SHADOW_GAP.width : undefined,
    ),
  )
}

/**
 * After a room's outline changed, carry per-wall values over (like `remapEdges`): a new wall takes the value of the
 * old wall it lies along.
 */
export function remapEdgeValues<T>(oldPts: Point[], newPts: Point[], values: (T | null)[] | undefined, force = false): (T | null)[] | undefined {
  if (!values?.length || (!force && oldPts.length === newPts.length)) return values
  return newPts.map((a, i) => {
    const b = newPts[(i + 1) % newPts.length]
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const j = oldPts.findIndex((p, k) => projectOnSegment(m, p, oldPts[(k + 1) % oldPts.length]).dist < 1)
    return j >= 0 ? (values[j] ?? null) : null
  })
}

type Zone = { outer: Point[]; inner?: Point[]; drop: number }

/**
 * A band: what's between `outer` and `inner`. Where the ceiling runs on into the next room's, the inner edge reaches
 * the line, so the band is open there (a U, not a ring).
 */
function bandZone(room: Room, outer: Point[], inner: Point[], drop: number): Zone[] {
  if (!ceilingJoins(room).length) return [{ outer, inner, drop }]
  const ring = (pts: Point[]) => [pts.map((p) => [p.x, p.y] as [number, number])]
  // Its inner edge reaches a little past the line, so the band comes out open there however the sums round.
  const past = offsetEdges(
    inner,
    inner.map((p, i) => (onCeilingJoin(room, p, inner[(i + 1) % inner.length]) ? 1 : undefined)),
  )
  try {
    return polygonClipping.difference(ring(outer), ring(past)).map((poly) => {
      const [o, h] = poly.map((r) => r.slice(0, -1).map(([x, y]) => ({ x, y })))
      return { outer: o, inner: h, drop }
    })
  } catch {
    return [{ outer, inner, drop }]
  }
}

const zoneCache = new WeakMap<Room, Zone[]>()

/** Areas of a room's ceiling at different heights, for drawing and 3D. `drop` is below the structural ceiling. */
export function ceilingZones(room: Room): Zone[] {
  // Rooms being changed (drafts) are worked out afresh each time.
  if (isDraft(room) || isDraft(room.points)) return zonesOf(room)
  let z = zoneCache.get(room)
  if (!z) zoneCache.set(room, (z = zonesOf(room)))
  return z
}

function zonesOf(room: Room): Zone[] {
  const c = room.ceiling
  if (!c) return []
  switch (c.style) {
    case 'flat':
      return [{ outer: ceilingOutline(room), drop: c.drop }]
    case 'tray':
    case 'cove':
      return bandZone(room, ceilingOutline(room), bandEdge(room), c.drop)
    case 'stepped':
      return [...bandZone(room, ceilingOutline(room), bandEdge(room), c.drop), ...bandZone(room, bandEdge(room), bandEdge(room, 2), c.drop / 2)]
    case 'floating':
      return [{ outer: bandEdge(room), drop: c.drop }]
  }
}

/** How far below the structure a room's ceiling is at `p` (in the room's ceiling, as `ceilingRoom` makes it). */
export function ceilingDropAt(croom: Room, p: Point): number {
  let drop = 0.2
  for (const z of ceilingZones(croom)) {
    if (pointInPolygon(p, z.outer) && !(z.inner && pointInPolygon(p, z.inner))) drop = Math.max(drop, z.drop)
  }
  return drop
}

/** Ceiling height (cm above the floor) at a point, taking gypsum ceilings and boxes into account. */
export function ceilingHeightAt(floor: Floor, p: Point): number {
  let h = floor.height
  for (const r of floor.rooms) {
    if (!r.ceiling || !pointInPolygon(p, r.points)) continue
    for (const z of ceilingZones(ceilingRoom(r, floor))) {
      if (pointInPolygon(p, z.outer) && !(z.inner && pointInPolygon(p, z.inner))) h = Math.min(h, floor.height - z.drop)
    }
  }
  for (const s of floor.symbols) {
    if (s.type !== 'gypsum-box' && s.type !== 'beam') continue
    const r = (-s.rotation * Math.PI) / 180
    const dx = p.x - s.x
    const dy = p.y - s.y
    const lx = dx * Math.cos(r) - dy * Math.sin(r)
    const ly = dx * Math.sin(r) + dy * Math.cos(r)
    if (Math.abs(lx) <= s.width / 2 && Math.abs(ly) <= s.depth / 2) h = Math.min(h, floor.height - (s.height || 30))
  }
  return h
}

/**
 * How far below the ceiling slab a room's shadow gap LED sits (cm), and the gap's mouth: with a gypsum ceiling the
 * groove goes up from it; with none it's just a dark strip at the ceiling.
 */
export function gapDrops(room: Room, sym?: PlanSymbol): { led: number; mouth: number } {
  const c = room.ceiling
  const mouth = c && c.style !== 'floating' ? c.drop : 0.2
  // A curtain pocket, or a hidden light's gap, goes up to the slab: its LED sits at the top, lighting what's below.
  if (sym?.type === 'pocket-light' || (sym && hiddenLightInGap(room, sym))) return { led: 3, mouth }
  return { led: Math.max(mouth - SHADOW_GAP.depth + 1, 0.3), mouth }
}

/**
 * Where a room's hidden light runs (one point per wall, so edge i follows wall i), and whether it
 * shines up (into a cove or tray) or down (along the walls). A shadow gap light runs in the groove.
 */
export function covePath(room: Room, sym?: PlanSymbol): { path: Point[]; up: boolean; drop: number } {
  if (sym?.type === 'gap-light') return { path: inset(room, SHADOW_GAP.width / 2), up: false, drop: gapDrops(room).led }
  if (sym?.type === 'pocket-light') return { path: inset(room, pocketWidth(room) / 2), up: false, drop: gapDrops(room, sym).led }
  // A hidden light along the walls of a gypsum ceiling: up in its gap between the gypsum and the wall.
  if (sym && hiddenLightInGap(room, sym)) return { path: inset(room, (sym.cove?.gap ?? HIDDEN_GAP) / 2), up: false, drop: gapDrops(room, sym).led }
  const c = room.ceiling
  if (c?.style === 'cove') return { path: bandInset(room, 1, -COVE_WIDTH / 2), up: true, drop: c.drop - 4 }
  if (c?.style === 'floating') return { path: bandInset(room, 1, 4), up: true, drop: c.drop - 6 }
  if (c && sym?.cove?.at === 'inner' && hasTrayEdge(room)) {
    // On top of the band, just behind its inner edge: hidden from below, washing the raised middle.
    const drop = c.style === 'stepped' ? c.drop / 2 : c.drop
    return { path: bandInset(room, c.style === 'stepped' ? 2 : 1, -6), up: true, drop: drop - 3 }
  }
  return { path: inset(room, 6), up: false, drop: (c?.drop ?? 0) + 3 }
}

/**
 * The lit runs of a room's hidden light: one per wall that isn't switched off (a shadow gap or curtain pocket light:
 * that has its gap). Each wall has one gap with a light at most: a curtain pocket, else the hidden light's gap, else a
 * shadow gap.
 */
export function coveRuns(room: Room, sym?: PlanSymbol): { runs: { a: Point; b: Point; edge: number }[]; up: boolean; drop: number } {
  const { path, up, drop } = covePath(room, sym)
  const pockets = new Set(room.ceiling && room.ceiling.style !== 'floating' ? (room.curtainPockets ?? []) : [])
  const pocket = onPocketWall(room)
  const hidden = new Set(room.hiddenGaps ?? [])
  let only: ((edge: number) => boolean) | null = null
  if (sym?.type === 'pocket-light') only = (e) => pockets.has(e)
  else if (sym?.type === 'gap-light') only = (e) => (room.shadowGaps ?? []).includes(e) && !pocket(e) && !hidden.has(e)
  // A hidden light in a gap runs where its gap is (see ceilingRoom).
  else if (sym && hiddenLightInGap(room, sym)) only = (e) => hidden.has(e)
  const off = new Set(sym?.cove?.off ?? [])
  // Along the walls: none where there's no wall. Along the band's inner edge: none where the ceiling runs on into the
  // next room's (the band's open there).
  for (const i of !sym || !followsBand(room, sym) ? (room.openEdges ?? []) : ceilingJoins(room)) off.add(i)
  const runs = path
    .map((a, i) => ({ a, b: path[(i + 1) % path.length], edge: i }))
    .filter((r) => (!only || only(r.edge)) && !off.has(r.edge))
  return { runs, up, drop }
}

/**
 * Whether a piece of a room's ceiling outline (see ceilingRoom) belongs to a wall with a curtain pocket: the pocket
 * itself, or the sides of a column on that wall when the pocket stops at it. The pocket's light is the only one there.
 */
export function onPocketWall(croom: Room): (edge: number) => boolean {
  if (!croom.ceiling || croom.ceiling.style === 'floating') return () => false
  const pockets = new Set(croom.curtainPockets ?? [])
  const info = shapes.get(croom)
  const walls = new Set(info?.room.curtainPockets ?? [])
  return (e) => pockets.has(e) || (!!info && walls.has(info.parent[e]))
}

/** The nearest point to `from` on the strip of a room light (where it's lit), or null if it's lit nowhere. */
export function nearestOnStrip(croom: Room, sym: PlanSymbol, from: Point): Point | null {
  let best: Point | null = null
  let bestD = Infinity
  for (const { a, b } of coveRuns(croom, sym).runs) {
    const { point, dist } = projectOnSegment(from, a, b)
    if (dist < bestD) {
      bestD = dist
      best = point
    }
  }
  return best
}

/** The kinds of light that run around a room's ceiling: a room has at most one of each. */
export const ROOM_LIGHTS = ['cove-light', 'pocket-light', 'gap-light']

/**
 * Merge extra lights of a kind in the same room into the first (they'd run along the same walls, one of them out of
 * reach of the panel): switches wired to them control the first instead. Returns whether anything changed.
 */
export function mergeRoomLights(floor: Floor): boolean {
  const keep = new Map<string, string>()
  const gone = new Map<string, string>()
  for (const s of floor.symbols) {
    if (!s.room || !ROOM_LIGHTS.includes(s.type)) continue
    const key = `${s.room}|${s.type}`
    const first = keep.get(key)
    if (first) gone.set(s.id, first)
    else keep.set(key, s.id)
  }
  if (!gone.size) return false
  floor.symbols = floor.symbols
    .filter((s) => !gone.has(s.id))
    .map((s) => (s.controls?.some((id) => gone.has(id)) ? { ...s, controls: [...new Set(s.controls.map((id) => gone.get(id) ?? id))] } : s))
  return true
}

/**
 * After a room's outline changed (a wall split or a corner removed), carry per-wall settings over:
 * a new wall keeps a setting when it lies along a wall that had it.
 */
export function remapEdges(oldPts: Point[], newPts: Point[], edges: number[] | undefined, force = false): number[] | undefined {
  if (!edges?.length || (!force && oldPts.length === newPts.length)) return edges
  const out: number[] = []
  newPts.forEach((a, i) => {
    const b = newPts[(i + 1) % newPts.length]
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const on = edges.some((j) => {
      const p = oldPts[j]
      const q = oldPts[(j + 1) % oldPts.length]
      return p && q && projectOnSegment(m, p, q).dist < 1
    })
    if (on) out.push(i)
  })
  return out
}

export const OTHER_LIGHTS = '__other'

/** Switches on this floor that control the given light. */
export function switchesFor(floor: Floor, lightId: string): PlanSymbol[] {
  return floor.symbols.filter((s) => s.type === 'switch' && s.controls?.includes(lightId))
}

/**
 * A light is on when any switch controlling it is on. Lights with no switch follow the
 * "other lights" toggle. Switch states default to on.
 */
export function isLightOn(floor: Floor, lightId: string, states: Record<string, boolean>): boolean {
  const sw = switchesFor(floor, lightId)
  if (!sw.length) return states[OTHER_LIGHTS] ?? true
  return sw.some((s) => states[s.id] ?? true)
}

/** Remove wiring to lights that no longer exist. */
export function pruneControls(floor: Floor) {
  const ids = new Set(floor.symbols.map((s) => s.id))
  for (const s of floor.symbols) {
    if (s.controls) s.controls = s.controls.filter((id) => ids.has(id))
  }
}
