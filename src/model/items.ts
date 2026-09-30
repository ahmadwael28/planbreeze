/**
 * Working with several things at once: selecting them, moving, deleting, copying and pasting them,
 * and grouping them. Pure functions over a floor (or a draft of one).
 */
import { bbox } from './geometry'
import { uid } from './project'
import type { Dimension, Floor, ItemKind, ItemRef, PlanSymbol, Point, Room, SavedView, Selection } from './types'

export const refKey = (r: ItemRef) => `${r.kind}:${r.id}`

/** The items a selection covers. */
export function refsOf(sel: Selection | null): ItemRef[] {
  if (!sel) return []
  if (sel.kind === 'multi') return sel.items
  return [{ kind: sel.kind, id: sel.id }]
}

/** A selection for these items: nothing, a single item, or several. */
export function selectionOf(refs: ItemRef[]): Selection | null {
  const seen = new Set<string>()
  const items = refs.filter((r) => !seen.has(refKey(r)) && !!seen.add(refKey(r)))
  if (!items.length) return null
  if (items.length === 1) return { kind: items[0].kind, id: items[0].id }
  return { kind: 'multi', items }
}

export function isSelected(sel: Selection | null, kind: ItemKind, id: string) {
  if (!sel) return false
  if (sel.kind === 'multi') return sel.items.some((r) => r.kind === kind && r.id === id)
  return sel.kind === kind && sel.id === id
}

function find(floor: Floor, ref: ItemRef): { groupId?: string } | undefined {
  switch (ref.kind) {
    case 'room':
      return floor.rooms.find((x) => x.id === ref.id)
    case 'symbol':
      return floor.symbols.find((x) => x.id === ref.id)
    case 'dimension':
      return floor.dimensions?.find((x) => x.id === ref.id)
    case 'view':
      return floor.views?.find((x) => x.id === ref.id)
  }
}

export function exists(floor: Floor, ref: ItemRef) {
  return !!find(floor, ref)
}

/** Everything on the floor, as refs (cove lights come with their rooms, so they're left out). */
export function allRefs(floor: Floor): ItemRef[] {
  return [
    ...floor.rooms.map((r) => ({ kind: 'room' as const, id: r.id })),
    ...floor.symbols.filter((s) => !s.room && !s.wall).map((s) => ({ kind: 'symbol' as const, id: s.id })),
    ...(floor.dimensions ?? []).map((d) => ({ kind: 'dimension' as const, id: d.id })),
    ...(floor.views ?? []).map((v) => ({ kind: 'view' as const, id: v.id })),
  ]
}

/** The item and, if it's in a group, the rest of the group. */
export function withGroup(floor: Floor, ref: ItemRef): ItemRef[] {
  const g = find(floor, ref)?.groupId
  if (!g) return [ref]
  return [
    ...floor.rooms.filter((r) => r.groupId === g).map((r) => ({ kind: 'room' as const, id: r.id })),
    ...floor.symbols.filter((s) => s.groupId === g).map((s) => ({ kind: 'symbol' as const, id: s.id })),
    ...(floor.dimensions ?? []).filter((d) => d.groupId === g).map((d) => ({ kind: 'dimension' as const, id: d.id })),
    ...(floor.views ?? []).filter((v) => v.groupId === g).map((v) => ({ kind: 'view' as const, id: v.id })),
  ]
}

/** Items lying fully inside a rectangle (symbols: their center). */
export function refsInRect(floor: Floor, a: Point, b: Point): ItemRef[] {
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)
  const inside = (p: Point) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1
  const out: ItemRef[] = []
  for (const r of floor.rooms) if (r.points.length && r.points.every(inside)) out.push({ kind: 'room', id: r.id })
  for (const s of floor.symbols) if (!s.room && !s.wall && inside(s)) out.push({ kind: 'symbol', id: s.id })
  for (const d of floor.dimensions ?? []) if (inside(d.a) && inside(d.b)) out.push({ kind: 'dimension', id: d.id })
  for (const v of floor.views ?? []) if (inside(v.eye)) out.push({ kind: 'view', id: v.id })
  // A room's doors and windows travel with it, so they needn't be listed.
  return out
}

/** Copies of the selected items, detached from the floor. Rooms bring their doors, windows and cove lights. */
export interface Clip {
  rooms: Room[]
  symbols: PlanSymbol[]
  dimensions: Dimension[]
  views: SavedView[]
}

export function copyItems(floor: Floor, refs: ItemRef[]): Clip {
  const ids = (k: ItemKind) => new Set(refs.filter((r) => r.kind === k).map((r) => r.id))
  const rooms = ids('room')
  const syms = ids('symbol')
  const dims = ids('dimension')
  const views = ids('view')
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
  return {
    rooms: floor.rooms.filter((r) => rooms.has(r.id)).map(clone),
    symbols: floor.symbols
      .filter((s) => syms.has(s.id) || (s.wall && rooms.has(s.wall.roomId)) || (s.room && rooms.has(s.room)))
      .map(clone),
    dimensions: (floor.dimensions ?? []).filter((d) => dims.has(d.id)).map(clone),
    views: (floor.views ?? []).filter((v) => views.has(v.id)).map(clone),
  }
}

export function clipSize(c: Clip) {
  return c.rooms.length + c.symbols.filter((s) => !s.room).length + c.dimensions.length + c.views.length
}

/**
 * Add a clip to a floor (a draft), shifted by (dx, dy), with fresh ids. Groups inside the clip stay
 * together as a new group. Returns what was added, for selecting it.
 */
export function pasteItems(floor: Floor, clip: Clip, dx: number, dy: number): ItemRef[] {
  const roomIds = new Map(clip.rooms.map((r) => [r.id, uid()]))
  const groupIds = new Map<string, string>()
  const group = (g?: string) => {
    if (!g) return undefined
    if (!groupIds.has(g)) groupIds.set(g, uid())
    return groupIds.get(g)
  }
  const move = (p: Point) => ({ x: p.x + dx, y: p.y + dy })
  const added: ItemRef[] = []
  for (const r of clip.rooms) {
    const id = roomIds.get(r.id)!
    floor.rooms.push({ ...r, id, points: r.points.map(move), groupId: group(r.groupId) })
    added.push({ kind: 'room', id })
  }
  for (const s of clip.symbols) {
    const copy: PlanSymbol = { ...s, id: uid(), ...move(s), groupId: group(s.groupId) }
    if (s.modules) copy.modules = s.modules.map((m) => ({ ...m, id: uid() }))
    copy.controls = undefined // wiring stays with the original switches
    if (s.room) {
      if (!roomIds.has(s.room)) continue
      copy.room = roomIds.get(s.room)
    }
    if (s.wall) {
      const newRoom = roomIds.get(s.wall.roomId)
      if (newRoom) copy.wall = { ...s.wall, roomId: newRoom }
      else if (floor.rooms.some((r) => r.id === s.wall!.roomId)) {
        // Pasted without its room: next to the original, along the same wall.
        copy.wall = { ...s.wall, offset: s.wall.offset + s.width + 20 }
      } else {
        copy.wall = undefined
      }
    }
    floor.symbols.push(copy)
    if (!copy.room && !(copy.wall && roomIds.has(s.wall!.roomId))) added.push({ kind: 'symbol', id: copy.id })
  }
  for (const d of clip.dimensions) {
    const id = uid()
    ;(floor.dimensions ??= []).push({ ...d, id, a: move(d.a), b: move(d.b), groupId: group(d.groupId) })
    added.push({ kind: 'dimension', id })
  }
  for (const v of clip.views) {
    const id = uid()
    ;(floor.views ??= []).push({
      ...v,
      id,
      eye: { ...v.eye, ...move(v.eye) },
      look: { ...v.look, ...move(v.look) },
      groupId: group(v.groupId),
    })
    added.push({ kind: 'view', id })
  }
  return added
}

/** Remove items from a floor (a draft); a room takes its doors, windows and cove lights with it. */
export function deleteItems(floor: Floor, refs: ItemRef[]) {
  const ids = (k: ItemKind) => new Set(refs.filter((r) => r.kind === k).map((r) => r.id))
  const rooms = ids('room')
  const syms = ids('symbol')
  const dims = ids('dimension')
  const views = ids('view')
  floor.rooms = floor.rooms.filter((r) => !rooms.has(r.id))
  floor.symbols = floor.symbols.filter((s) => !syms.has(s.id) && !(s.wall && rooms.has(s.wall.roomId)) && !(s.room && rooms.has(s.room)))
  if (floor.dimensions) floor.dimensions = floor.dimensions.filter((d) => !dims.has(d.id))
  if (floor.views) floor.views = floor.views.filter((v) => !views.has(v.id))
}

/** Move items on a floor (a draft) from their `orig` positions by (dx, dy). */
export function moveItems(floor: Floor, orig: Clip, dx: number, dy: number) {
  const move = (p: Point) => ({ x: p.x + dx, y: p.y + dy })
  for (const o of orig.rooms) {
    const r = floor.rooms.find((x) => x.id === o.id)
    if (r) r.points = o.points.map(move)
  }
  for (const o of orig.symbols) {
    const s = floor.symbols.find((x) => x.id === o.id)
    if (s && !s.wall && !s.room) Object.assign(s, move(o))
  }
  for (const o of orig.dimensions) {
    const d = floor.dimensions?.find((x) => x.id === o.id)
    if (d) Object.assign(d, { a: move(o.a), b: move(o.b) })
  }
  for (const o of orig.views) {
    const v = floor.views?.find((x) => x.id === o.id)
    if (v) Object.assign(v, { eye: { ...o.eye, ...move(o.eye) }, look: { ...o.look, ...move(o.look) } })
  }
}

/** Put items in a group (a fresh id) or take them out of any group (null). */
export function setGroup(floor: Floor, refs: ItemRef[], groupId: string | null) {
  const g = groupId ?? undefined
  for (const r of refs) {
    const x = find(floor, r)
    if (x) x.groupId = g
  }
}

export function clipBounds(c: Clip) {
  const pts = [
    ...c.rooms.flatMap((r) => r.points),
    ...c.symbols.filter((s) => !s.wall && !s.room),
    ...c.dimensions.flatMap((d) => [d.a, d.b]),
    ...c.views.map((v) => v.eye),
  ]
  return pts.length ? bbox(pts) : null
}
