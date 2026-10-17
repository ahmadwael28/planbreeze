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

/** A switch's name without its room's in front (on the plan, where the room goes without saying). */
export function shortSwitchLabel(sym: PlanSymbol, room: Room | undefined): string | undefined {
  const prefix = room?.name.trim()
  return prefix && sym.label?.startsWith(`${prefix} `) && sym.label.length > prefix.length + 1 ? sym.label.slice(prefix.length + 1) : sym.label
}
