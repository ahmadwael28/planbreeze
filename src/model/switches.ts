/** Light switches: which room they're in, and naming them after it. */
import { pointInPolygon } from './geometry'
import { symbolPose } from './project'
import type { Floor, PlanSymbol, Room } from './types'

/** The room a switch is in: it's against a wall, facing into the room (so just in front of it). */
export function switchRoom(sym: PlanSymbol, rooms: Room[]): Room | undefined {
  const p = symbolPose(sym, rooms)
  const r = (p.rotation * Math.PI) / 180
  const f = sym.flipY ? -1 : 1
  const front = { x: p.x - Math.sin(r) * f * 10, y: p.y + Math.cos(r) * f * 10 }
  return rooms.find((room) => pointInPolygon(front, room.points)) ?? rooms.find((room) => pointInPolygon(p, room.points))
}

/** A new switch's name: its room's, then a number (Kitchen S1, Kitchen S2…); just the number outside any room. */
export function newSwitchLabel(floor: Floor, room: Room | undefined): string {
  const prefix = room?.name.trim() ? `${room.name.trim()} ` : ''
  const used = new Set(floor.symbols.filter((s) => s.type === 'switch').map((s) => s.label))
  let n = 1
  while (used.has(`${prefix}S${n}`)) n++
  return `${prefix}S${n}`
}

/** A switch's name with its room's in front (Living room Spots). */
export function roomSwitchLabel(room: Room | undefined, label: string): string {
  const name = room?.name.trim()
  return name ? `${name} ${label}` : label
}

/**
 * Name a floor's switches after their rooms, as new ones are (an older plan's, once): the room's name in front of
 * theirs (Spots in the living room: Living room Spots). One with no name, or one only repeating its room's (Bath in the
 * Bathroom), is numbered: Bathroom S1. Several in a room each naming part of it (Kitchen and Dining in the Kitchen &
 * dining) keep theirs after it, to tell them apart. Ones already named so, or outside any room, stay as they are.
 */
export function nameSwitchesAfterRooms(floor: Floor) {
  const byRoom = new Map<string, { room: Room; sws: PlanSymbol[] }>()
  for (const s of floor.symbols) {
    if (s.type !== 'switch') continue
    const room = switchRoom(s, floor.rooms)
    const name = room?.name.trim()
    if (!room || !name || s.label?.startsWith(`${name} `)) continue
    const at = byRoom.get(room.id)
    if (at) at.sws.push(s)
    else byRoom.set(room.id, { room, sws: [s] })
  }
  for (const { room, sws } of byRoom.values()) {
    const name = room.name.trim().toLowerCase()
    const repeats = sws.filter((s) => s.label?.trim() && name.includes(s.label.trim().toLowerCase()))
    for (const s of sws) {
      const label = s.label?.trim()
      if (label && (repeats.length > 1 || !repeats.includes(s))) s.label = roomSwitchLabel(room, label)
      else s.label = newSwitchLabel(floor, room)
    }
  }
}

/** A switch's name without its room's in front (on the plan, where the room goes without saying). */
export function shortSwitchLabel(sym: PlanSymbol, room: Room | undefined): string | undefined {
  const prefix = room?.name.trim()
  return prefix && sym.label?.startsWith(`${prefix} `) && sym.label.length > prefix.length + 1 ? sym.label.slice(prefix.length + 1) : sym.label
}
