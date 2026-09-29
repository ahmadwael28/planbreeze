import { offsetPolygon, pointInPolygon } from './geometry'
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

/** Colors for switch wiring lines, one per switch. */
export const WIRE_COLORS = ['#f97316', '#8b5cf6', '#10b981', '#ec4899', '#0ea5e9', '#eab308', '#ef4444', '#14b8a6']

export function inset(room: Room, by: number): Point[] {
  return by === 0 ? room.points : offsetPolygon(room.points, -by)
}

/** Areas of a room's ceiling at different heights, for drawing and 3D. `drop` is below the structural ceiling. */
export function ceilingZones(room: Room): { outer: Point[]; inner?: Point[]; drop: number }[] {
  const c = room.ceiling
  if (!c) return []
  switch (c.style) {
    case 'flat':
      return [{ outer: room.points, drop: c.drop }]
    case 'tray':
    case 'cove':
      return [{ outer: room.points, inner: inset(room, c.band), drop: c.drop }]
    case 'stepped':
      return [
        { outer: room.points, inner: inset(room, c.band), drop: c.drop },
        { outer: inset(room, c.band), inner: inset(room, c.band * 2), drop: c.drop / 2 },
      ]
    case 'floating':
      return [{ outer: inset(room, c.band), drop: c.drop }]
  }
}

/** Ceiling height (cm above the floor) at a point, taking gypsum ceilings and boxes into account. */
export function ceilingHeightAt(floor: Floor, p: Point): number {
  let h = floor.height
  for (const room of floor.rooms) {
    if (!room.ceiling || !pointInPolygon(p, room.points)) continue
    for (const z of ceilingZones(room)) {
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

/** Where a cove / hidden light runs, and whether it shines up (into a cove) or down (a shadow gap). */
export function covePath(room: Room): { path: Point[]; up: boolean; drop: number } {
  const c = room.ceiling
  if (c?.style === 'cove') return { path: inset(room, c.band - COVE_WIDTH / 2), up: true, drop: c.drop - 4 }
  if (c?.style === 'floating') return { path: inset(room, c.band + 4), up: true, drop: c.drop - 6 }
  return { path: inset(room, 6), up: false, drop: (c?.drop ?? 0) + 3 }
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
