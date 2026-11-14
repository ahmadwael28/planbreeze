/**
 * Wood slats round a door: on the wall beside it and over it, up to the ceiling, on one face of the wall or both (see
 * PlanSymbol.slats). The 3D view builds them (see buildScene) and the takeoff counts them in place of the wall's finish
 * there (see takeoff), from the same stretches.
 */
import { t } from '@/i18n'
import { FINISHES } from './finishes'
import { pointInPolygon, projectOnSegment } from './geometry'
import { ceilingHeightAt } from './lighting'
import { symbolPose } from './project'
import type { Floor, PlanSymbol, Room, Units, WallSurface } from './types'
import { formatLength } from './units'

/** Doors that can have slats round them: not a barn door, which slides over the wall. */
export const SLATTED_DOORS = new Set(['door', 'door-double', 'door-sliding', 'door-alu', 'door-alu-double', 'door-alu-sliding'])

/** How wide each slat is and the groove between them (cm), and how far they stand out on their dark backing. */
export const DOOR_SLAT: [number, number] = [3, 1.5]
export const SLAT_DEPTH = 2
export const SLAT_BACKING = 0.6

/** How far beside a door slats go when they're first put round it (cm). */
export const SLATS_BESIDE = 40

/** The slats round a door on one face of its wall. */
export interface SlatSide {
  /** Which face: 1 the room the door's in (its plan's +y), -1 the other. */
  face: 1 | -1
  /** The room on that side, and its wall there (none outside). */
  room?: Room
  edge?: number
  /** From and to along the wall (x across the door, its middle at 0), clear of the wall's ends on that side. */
  x0: number
  x1: number
  /** The door's opening and its frame, from -e to e and up to doorTop: where there are none. */
  e: number
  doorTop: number
  /** Up to the ceiling on that side (a gypsum one's, where there is). */
  top: number
  /** The slats as a wall finish (for the takeoff). */
  surface: WallSurface
}

/**
 * The slats round a door, on each face of its wall it has them on: beside it as far as asked (but not past the wall's
 * ends on that side), over it, up to the ceiling there; clear of its frame (a wooden door's architrave, 6 cm round it).
 */
export function doorSlats(sym: PlanSymbol, floor: Floor): SlatSide[] {
  const s = sym.slats
  if (!s || !sym.wall || !SLATTED_DOORS.has(sym.type)) return []
  const home = floor.rooms.find((r) => r.id === sym.wall!.roomId)
  if (!home) return []
  const pose = symbolPose(sym, floor.rooms)
  const t = pose.wallThickness ?? home.wallThickness
  const r = (pose.rotation * Math.PI) / 180
  const xAxis = { x: Math.cos(r), y: Math.sin(r) }
  const yAxis = { x: -Math.sin(r), y: Math.cos(r) }
  const wooden = sym.type === 'door' || sym.type === 'door-double'
  const e = sym.width / 2 + (wooden ? 6 : 1)
  const doorTop = sym.height + (wooden ? 6 : 1)
  const faces: (1 | -1)[] = s.side === 'both' ? [1, -1] : s.side === 'other' ? [-1] : [1]
  const surface: WallSurface = { finish: 'slats', color: s.color ?? FINISHES.slats.colors[0].hex, size: DOOR_SLAT }
  return faces.map((face) => {
    // Just off that face of the wall: the room there, its ceiling, and its wall (the door's own, on its side).
    const probe = { x: pose.x + yAxis.x * face * (t / 2 + 15), y: pose.y + yAxis.y * face * (t / 2 + 15) }
    const room = face === 1 ? home : floor.rooms.find((x) => x.id !== home.id && pointInPolygon(probe, x.points))
    let edge: number | undefined = face === 1 ? sym.wall!.edge : undefined
    if (room && edge === undefined) {
      let best = Infinity
      room.points.forEach((a, i) => {
        const gap = projectOnSegment(pose, a, room.points[(i + 1) % room.points.length]).dist
        if (gap < best) [best, edge] = [gap, i]
      })
      if (best > t) edge = undefined
    }
    // As far beside it as asked, but no further than that wall goes (the door's own wall, outside).
    const wall = room && edge !== undefined ? room : home
    const we = room && edge !== undefined ? edge : sym.wall!.edge
    const a = wall.points[we]
    const b = wall.points[(we + 1) % wall.points.length]
    const along = (p: { x: number; y: number }) => (p.x - pose.x) * xAxis.x + (p.y - pose.y) * xAxis.y
    const [lo, hi] = [along(a), along(b)].sort((p, q) => p - q)
    const beside = Math.max(0, s.width)
    return {
      face,
      room: room && edge !== undefined ? room : undefined,
      edge: room ? edge : undefined,
      x0: Math.max(lo, -e - beside),
      x1: Math.min(hi, e + beside),
      e,
      doorTop,
      top: Math.max(doorTop, ceilingHeightAt(floor, probe)),
      surface,
    }
  })
}

/** How long a door's slats go beside it, and over it (cm), on one side: for the takeoff and its summary. */
export function slatSpans(side: SlatSide): { beside: number; over: number } {
  return {
    beside: Math.max(0, -side.e - side.x0) + Math.max(0, side.x1 - side.e),
    over: Math.max(0, Math.min(side.x1, side.e) - Math.max(side.x0, -side.e)),
  }
}

/** The room on the other face of a door's wall (none outside). */
export function roomBeyond(sym: PlanSymbol, floor: Floor): Room | undefined {
  if (!sym.wall) return undefined
  const pose = symbolPose(sym, floor.rooms)
  const r = (pose.rotation * Math.PI) / 180
  const t = pose.wallThickness ?? 10
  const probe = { x: pose.x + Math.sin(r) * (t / 2 + 15), y: pose.y - Math.cos(r) * (t / 2 + 15) }
  return floor.rooms.find((x) => x.id !== sym.wall!.roomId && pointInPolygon(probe, x.points))
}

/** What the two faces of a door's wall are called: by their rooms (outside, with none). */
export function slatSideNames(sym: PlanSymbol, floor: Floor) {
  const home = floor.rooms.find((r) => r.id === sym.wall?.roomId)
  const beyond = roomBeyond(sym, floor)
  return {
    home: t('{room} side', { room: home?.name ?? t('This room') }),
    other: beyond ? t('{room} side', { room: beyond.name }) : t('Outside'),
  }
}

/** A door's wood slats in a line: how far beside it, which side, its wood (for its panel's summary). */
export function slatsSummary(sym: PlanSymbol, floor: Floor, units: Units) {
  const s = sym.slats
  if (!s) return t('None')
  const names = slatSideNames(sym, floor)
  const wood = FINISHES.slats.colors.find((c) => c.hex === (s.color ?? FINISHES.slats.colors[0].hex))?.name
  return [
    t('{length} beside it', { length: formatLength(s.width, units) }),
    s.side === 'both' ? t('Both sides') : s.side === 'other' ? names.other : names.home,
    wood ? t(wood) : t('Custom color'),
  ].join(' · ')
}
