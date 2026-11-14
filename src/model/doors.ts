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
import { NICHES, SYMBOL_MAP } from './symbols'
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

/** How a door's slats go: round it (beside it and over it), only over it, or only beside it, either side. */
export type SlatStyle = 'round' | 'over' | 'beside'
export const slatStyle = (s: NonNullable<PlanSymbol['slats']>): SlatStyle => s.style ?? 'round'

/** A stretch of slats: from x0 to x1 across the door (its middle at 0), from `bottom` up to the top of its side. */
export interface SlatPiece {
  x0: number
  x1: number
  bottom: number
}

/** The slats round a door on one face of its wall. */
export interface SlatSide {
  /** Which face: 1 the room the door's in (its plan's +y), -1 the other. */
  face: 1 | -1
  /** The room on that side, and its wall there (none outside). */
  room?: Room
  edge?: number
  /** Where they are: clear of the door and its frame, the wall's ends on that side and what else is in the wall. */
  pieces: SlatPiece[]
  /** Up to the ceiling on that side (a gypsum one's, where there is). */
  top: number
  /** Whether a door, window, opening or niche next to it in the wall stopped them short of where they'd go. */
  stopped: boolean
  /** The slats as a wall finish (for the takeoff). */
  surface: WallSurface
}

/** How far a door's or window's frame comes round its opening on the wall (cm): a wooden door's architrave. */
const frameOf = (type: string) => (type === 'door' || type === 'door-double' ? 6 : 1)

/** Which faces of its wall a door's slats are on: 1 its own room's, -1 the other. */
const facesOf = (s: NonNullable<PlanSymbol['slats']>): (1 | -1)[] => (s.side === 'both' ? [1, -1] : s.side === 'other' ? [-1] : [1])

/**
 * Where slats on a door's `face`, `e` either side of its middle to its frame's edge and asked to go `reach` past it (only
 * over it, or not), would run into the other doors, windows, openings and niches in its wall (a niche only on the face
 * it's cut into): across it (x, its middle at 0), on its left (-1) or right. At their frames, where there's no wall to
 * fix them to (hard). Where another door has slats on that face too and the two would overlap, they meet: halfway along
 * the overlap; or where one's only over its door, the other's, coming down to the floor, go on to its frame.
 */
function stopsBeside(
  sym: PlanSymbol,
  floor: Floor,
  pose: { x: number; y: number; rotation: number },
  t: number,
  face: 1 | -1,
  e: number,
  reach: number,
  over: boolean,
) {
  const r = (pose.rotation * Math.PI) / 180
  const out: { at: number; side: 1 | -1; hard: boolean }[] = []
  for (const o of floor.symbols) {
    if (o.id === sym.id || !o.wall || !SYMBOL_MAP.get(o.type)?.wall) continue
    const p = symbolPose(o, floor.rooms)
    const turn = ((p.rotation - pose.rotation) * Math.PI) / 180
    // In the same wall: along it, its middle on the wall's centre line.
    if (Math.abs(Math.sin(turn)) > 0.02) continue
    const dx = p.x - pose.x
    const dy = p.y - pose.y
    if (Math.abs(-dx * Math.sin(r) + dy * Math.cos(r)) > t / 2 + 1) continue
    const same = Math.cos(turn) > 0 ? 1 : -1
    if (NICHES.has(o.type) && (o.flipY ? -1 : 1) * face * same <= 0) continue
    const at = dx * Math.cos(r) + dy * Math.sin(r)
    const side = at < 0 ? -1 : 1
    // The edge of its frame on this door's side, and how far from that edge this door's slats would go.
    const theirs = side * (at - side * (o.width / 2 + frameOf(o.type)))
    const ours = e + reach
    const slatted = o.slats && SLATTED_DOORS.has(o.type) && facesOf(o.slats).some((g) => g * same === face)
    const past = slatted ? Math.max(0, o.slats!.width) : 0
    if (slatted && ours > theirs - past) {
      const theirsOver = slatStyle(o.slats!) === 'over'
      const at = over === theirsOver ? (Math.max(e, theirs - past) + Math.min(theirs, ours)) / 2 : theirsOver ? theirs : Math.max(e, theirs - past)
      out.push({ at: side * at, side, hard: false })
    } else out.push({ at: side * theirs, side, hard: true })
  }
  return out
}

/**
 * The slats round a door, on each face of its wall it has them on, in its style: beside it as far as asked, up from the
 * floor; over it from its frame; or over it and that far past it either side. Up to the ceiling there, clear of its
 * frame (a wooden door's architrave, 6 cm round it), and stopping at the wall's ends on that side and at the doors,
 * windows and openings next to it, where there's no wall to fix them to; meeting another door's slats halfway.
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
  const e = sym.width / 2 + frameOf(sym.type)
  const doorTop = sym.height + frameOf(sym.type)
  const style = slatStyle(s)
  const faces = facesOf(s)
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
    // As far as asked, but not past the wall's ends, nor into what's next to it in the wall.
    const [x0, x1] = [Math.max(lo, -e - beside), Math.min(hi, e + beside)]
    let [from, to] = [x0, x1]
    let [hardFrom, hardTo] = [false, false]
    for (const stop of stopsBeside(sym, floor, pose, t, face, e, beside, style === 'over')) {
      if (stop.side < 0 && stop.at > from) [from, hardFrom] = [stop.at, stop.hard]
      if (stop.side > 0 && stop.at < to) [to, hardTo] = [stop.at, stop.hard]
    }
    const top = Math.max(doorTop, ceilingHeightAt(floor, probe))
    const pieces: SlatPiece[] = []
    const piece = (p: number, q: number, bottom: number) => {
      if (q - p > 0.5 && top - bottom > 0.5) pieces.push({ x0: p, x1: q, bottom })
    }
    if (style === 'over') piece(from, to, doorTop)
    else {
      piece(from, Math.min(-e, to), 0)
      if (style === 'round') piece(Math.max(from, -e), Math.min(to, e), doorTop)
      piece(Math.max(e, from), to, 0)
    }
    return {
      face,
      room: room && edge !== undefined ? room : undefined,
      edge: room ? edge : undefined,
      pieces,
      top,
      stopped: (hardFrom && from > x0 + 0.5) || (hardTo && to < x1 - 0.5),
      surface,
    }
  })
}

/**
 * Where each slat goes on one face: its middle across the door and how low it comes. On a grid from the door's middle,
 * so they're alike either side of it; only whole ones, where the pieces are.
 */
export function slatsAlong(side: SlatSide): { x: number; bottom: number }[] {
  const [slat, gap] = DOOR_SLAT
  const pitch = slat + gap
  if (!side.pieces.length) return []
  const lo = Math.min(...side.pieces.map((p) => p.x0))
  const hi = Math.max(...side.pieces.map((p) => p.x1))
  const out: { x: number; bottom: number }[] = []
  for (let k = Math.ceil((lo + slat / 2) / pitch); k * pitch <= hi - slat / 2; k++) {
    const x = k * pitch
    const on = side.pieces.filter((p) => p.x1 > x - slat / 2 && p.x0 < x + slat / 2)
    const covered = on.reduce((sum, p) => sum + Math.min(x + slat / 2, p.x1) - Math.max(x - slat / 2, p.x0), 0)
    if (covered >= slat - 0.01) out.push({ x, bottom: Math.max(...on.map((p) => p.bottom)) })
  }
  return out
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

/** A door's wood slats in a line: how they go, how far, which side, its wood (for its panel's summary). */
export function slatsSummary(sym: PlanSymbol, floor: Floor, units: Units) {
  const s = sym.slats
  if (!s) return t('None')
  const names = slatSideNames(sym, floor)
  const wood = FINISHES.slats.colors.find((c) => c.hex === (s.color ?? FINISHES.slats.colors[0].hex))?.name
  const style = slatStyle(s)
  const length = formatLength(s.width, units)
  return [
    style === 'over' ? t('Over it') : style === 'beside' ? t('Either side') : t('Round it'),
    style !== 'over' ? t('{length} beside it', { length }) : s.width > 0.5 ? t('{length} past it', { length }) : '',
    s.side === 'both' ? t('Both sides') : s.side === 'other' ? names.other : names.home,
    wood ? t(wood) : t('Custom color'),
  ]
    .filter(Boolean)
    .join(' · ')
}
