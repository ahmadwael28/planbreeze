import polygonClipping from 'polygon-clipping'
import { offsetEdges, offsetPolygon, pointInPolygon, projectOnSegment, signedArea } from './geometry'
import type { Ceiling, CeilingStyle, Floor, LightColor, PlanSymbol, Point, Room } from './types'

export const LIGHT_COLORS: Record<LightColor, { label: string; kelvin: number; hex: string }> = {
  warm: { label: 'Warm', kelvin: 2700, hex: '#ffc88f' },
  white: { label: 'White', kelvin: 4000, hex: '#fff3e6' },
  cool: { label: 'Cool', kelvin: 6000, hex: '#dce8ff' },
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

/** Footprints of the columns built into a room's walls, reaching a little into the wall so cutting them out is clean. */
export function roomColumns(room: Room, floor: Floor): Point[][] {
  const out: Point[][] = []
  for (const s of floor.symbols) {
    if (s.type !== 'wall-post' || !pointInPolygon(s, room.points)) continue
    const r = (s.rotation * Math.PI) / 180
    const c = Math.cos(r)
    const sn = Math.sin(r)
    // Its back (local -y) is against the wall.
    const corners: [number, number][] = [
      [-s.width / 2, -s.depth / 2 - 3],
      [s.width / 2, -s.depth / 2 - 3],
      [s.width / 2, s.depth / 2],
      [-s.width / 2, s.depth / 2],
    ]
    out.push(corners.map(([x, y]) => ({ x: s.x + x * c - y * sn, y: s.y + x * sn + y * c })))
  }
  return out
}

/** How each edge of a room as its ceiling sees it came about: the room's wall it's along, and whether it's a column's side. */
const shapes = new WeakMap<Room, { parent: number[]; face: boolean[] }>()
const ceilingRooms = new WeakMap<Room, { symbols: PlanSymbol[]; room: Room }>()

/**
 * The room as its ceiling sees it: columns built into its walls cut out of it, so the gypsum, cove lights, shadow gaps
 * and curtain pockets go around them. Per-wall settings carry over: each piece of the outline takes its wall's, and a
 * column's sides take those of the wall it stands on (shadow gaps not if they stop at columns; pockets never).
 */
export function ceilingRoom(room: Room, floor: Floor): Room {
  const hit = ceilingRooms.get(room)
  if (hit && hit.symbols === floor.symbols) return hit.room
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
        curtainPockets: map(room.curtainPockets, false),
        ceiling: room.ceiling && { ...room.ceiling, bands: room.ceiling.bands && pts.map((_, i) => room.ceiling!.bands![parent[i]] ?? null) },
      }
      shapes.set(out, { parent, face })
    }
  }
  ceilingRooms.set(room, { symbols: floor.symbols, room: out })
  return out
}

/**
 * A cove light's settings on the room as its ceiling sees it (see ceilingRoom): its dark walls carried over, and the
 * columns' sides dark too if it stops at columns.
 */
export function ceilingLight(sym: PlanSymbol, croom: Room): PlanSymbol {
  const info = shapes.get(croom)
  if (!info || !sym.room) return sym
  const off = new Set(sym.cove?.off ?? [])
  const stop = sym.type === 'cove-light' && sym.cove?.columns === 'stop'
  const mapped = info.parent.map((_, i) => i).filter((i) => off.has(info.parent[i]) || (stop && info.face[i]))
  return { ...sym, cove: { ...sym.cove, off: mapped } }
}

/** Usual width of a curtain pocket (cm). */
export const POCKET_WIDTH = 15

export const pocketWidth = (room: Room) => room.pocketWidth ?? POCKET_WIDTH

/** The ceiling's band width along wall i: its own, or the ceiling's. */
export const bandAt = (room: Room, i: number) => room.ceiling?.bands?.[i] ?? room.ceiling?.band ?? 0

/** The room moved in by the ceiling's band on each wall (each its own width) times `k`, plus `extra`. */
export function bandInset(room: Room, k = 1, extra = 0): Point[] {
  const d = room.points.map((_, i) => -(bandAt(room, i) * k + extra))
  return d.every((x) => x === 0) ? room.points : offsetEdges(room.points, d)
}

/**
 * Where a gypsum ceiling's outer edge runs: along the walls, or short of them where there's a shadow gap or a
 * curtain pocket.
 */
export function ceilingOutline(room: Room): Point[] {
  const gaps = new Set(room.shadowGaps ?? [])
  const pockets = new Set(room.ceiling && room.ceiling.style !== 'floating' ? (room.curtainPockets ?? []) : [])
  if (!gaps.size && !pockets.size) return room.points
  return offsetEdges(
    room.points,
    room.points.map((_, i) => (pockets.has(i) ? -pocketWidth(room) : gaps.has(i) ? -SHADOW_GAP.width : undefined)),
  )
}

/**
 * After a room's outline changed, carry per-wall values over (like `remapEdges`): a new wall takes the value of the
 * old wall it lies along.
 */
export function remapEdgeValues<T>(oldPts: Point[], newPts: Point[], values: (T | null)[] | undefined): (T | null)[] | undefined {
  if (!values?.length || oldPts.length === newPts.length) return values
  return newPts.map((a, i) => {
    const b = newPts[(i + 1) % newPts.length]
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const j = oldPts.findIndex((p, k) => projectOnSegment(m, p, oldPts[(k + 1) % oldPts.length]).dist < 1)
    return j >= 0 ? (values[j] ?? null) : null
  })
}

/** Areas of a room's ceiling at different heights, for drawing and 3D. `drop` is below the structural ceiling. */
export function ceilingZones(room: Room): { outer: Point[]; inner?: Point[]; drop: number }[] {
  const c = room.ceiling
  if (!c) return []
  switch (c.style) {
    case 'flat':
      return [{ outer: ceilingOutline(room), drop: c.drop }]
    case 'tray':
    case 'cove':
      return [{ outer: ceilingOutline(room), inner: bandInset(room), drop: c.drop }]
    case 'stepped':
      return [
        { outer: ceilingOutline(room), inner: bandInset(room), drop: c.drop },
        { outer: bandInset(room), inner: bandInset(room, 2), drop: c.drop / 2 },
      ]
    case 'floating':
      return [{ outer: bandInset(room), drop: c.drop }]
  }
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
    if (s.type !== 'gypsum-box') continue
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
  // A curtain pocket goes up to the slab: its LED sits at the top, lighting the curtain below.
  if (sym?.type === 'pocket-light') return { led: 3, mouth }
  return { led: Math.max(mouth - SHADOW_GAP.depth + 1, 0.3), mouth }
}

/**
 * Where a room's hidden light runs (one point per wall, so edge i follows wall i), and whether it
 * shines up (into a cove or tray) or down (along the walls). A shadow gap light runs in the groove.
 */
export function covePath(room: Room, sym?: PlanSymbol): { path: Point[]; up: boolean; drop: number } {
  if (sym?.type === 'gap-light') return { path: inset(room, SHADOW_GAP.width / 2), up: false, drop: gapDrops(room).led }
  if (sym?.type === 'pocket-light') return { path: inset(room, pocketWidth(room) / 2), up: false, drop: gapDrops(room, sym).led }
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

/** The lit runs of a room's hidden light: one per wall that isn't switched off (a shadow gap light: that has a gap). */
export function coveRuns(room: Room, sym?: PlanSymbol): { runs: { a: Point; b: Point; edge: number }[]; up: boolean; drop: number } {
  const { path, up, drop } = covePath(room, sym)
  const gaps = sym?.type === 'gap-light' ? new Set(room.shadowGaps ?? []) : sym?.type === 'pocket-light' ? new Set(room.curtainPockets ?? []) : null
  const off = new Set(sym?.cove?.off ?? [])
  const runs = path
    .map((a, i) => ({ a, b: path[(i + 1) % path.length], edge: i }))
    .filter((r) => (!gaps || gaps.has(r.edge)) && !off.has(r.edge))
  return { runs, up, drop }
}

/**
 * After a room's outline changed (a wall split or a corner removed), carry per-wall settings over:
 * a new wall keeps a setting when it lies along a wall that had it.
 */
export function remapEdges(oldPts: Point[], newPts: Point[], edges: number[] | undefined): number[] | undefined {
  if (!edges?.length || oldPts.length === newPts.length) return edges
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
