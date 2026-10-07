/** What each room is for (living room, master bedroom, bathroom…), and a first guess at it for a drawn plan. */
import { area, bbox, pointInPolygon } from '../geometry'
import { isOutdoor, symbolPose } from '../project'
import { SYMBOL_MAP } from '../symbols'
import type { Floor, Room, RoomUse } from '../types'

export const ROOM_USES: { id: RoomUse; name: string; hint: string }[] = [
  { id: 'living', name: 'Living room', hint: 'Sofa facing the TV, coffee table, armchair' },
  { id: 'kitchen', name: 'Kitchen', hint: 'Units along a wall, an island if there’s room' },
  { id: 'dining', name: 'Dining room', hint: 'A table for the space, a sideboard' },
  { id: 'master', name: 'Master bedroom', hint: 'A big bed, wardrobe, dressing table, TV' },
  { id: 'bedroom', name: 'Bedroom', hint: 'A double bed, nightstands, wardrobe' },
  { id: 'kids', name: 'Kids room', hint: 'A single bed, desk, wardrobe, shelves' },
  { id: 'office', name: 'Office', hint: 'A desk by the window, shelves' },
  { id: 'bathroom', name: 'Bathroom', hint: 'Bathtub or shower, toilet, vanity' },
  { id: 'ensuite', name: 'En-suite', hint: 'A shower, toilet and vanity' },
  { id: 'wc', name: 'Guest WC', hint: 'Toilet and a small basin' },
  { id: 'hall', name: 'Hallway', hint: 'A console, a coat wardrobe' },
  { id: 'dressing', name: 'Dressing room', hint: 'Wardrobes along the walls' },
  { id: 'laundry', name: 'Laundry / storage', hint: 'Shelving' },
  { id: 'balcony', name: 'Balcony', hint: 'A small table and chairs, plants' },
]

export const USE_NAMES = Object.fromEntries(ROOM_USES.map((u) => [u.id, u.name])) as Record<RoomUse, string>

/** Bedrooms of any kind. */
export const isBedroom = (u: RoomUse | undefined) => u === 'master' || u === 'bedroom' || u === 'kids'
/** Rooms with water: tiled, with their own fittings. */
export const isWet = (u: RoomUse | undefined) => u === 'bathroom' || u === 'ensuite' || u === 'wc' || u === 'laundry'

/** Names people give rooms (English and Arabic), and what they mean. */
const NAMES: [RegExp, RoomUse][] = [
  [/en.?suite|ensuite|master bath|حمام رئيسي/i, 'ensuite'],
  [/\bwc\b|toilet|powder|guest bath|حمام ضيوف|تواليت/i, 'wc'],
  [/bath|shower|حمام/i, 'bathroom'],
  [/master|main bed|رئيسي|ماستر/i, 'master'],
  [/kid|child|nursery|أطفال|اطفال|ولاد/i, 'kids'],
  [/bed|guest|نوم/i, 'bedroom'],
  [/kitchen|kitchenette|مطبخ/i, 'kitchen'],
  [/dining|سفرة|طعام/i, 'dining'],
  [/living|lounge|salon|reception|family|sitting|ريسبشن|صالة|صالون|معيشة|استقبال/i, 'living'],
  [/office|study|work|مكتب/i, 'office'],
  [/dress|closet|wardrobe|walk.?in|دريسنج|دولاب/i, 'dressing'],
  [/laundry|utility|storage|store|pantry|غسيل|مخزن/i, 'laundry'],
  [/hall|corridor|entr|lobby|foyer|passage|ممر|طرقة|مدخل/i, 'hall'],
  [/balcon|terrace|patio|بلكون|شرفة|تراس/i, 'balcony'],
]

/** What a room's furniture says it is. */
function byContents(room: Room, floor: Floor): RoomUse | undefined {
  const types = new Set(floor.symbols.filter((s) => !s.wall && !s.room && pointInPolygon(s, room.points)).map((s) => s.type))
  const has = (...t: string[]) => t.some((x) => types.has(x))
  if (has('bathtub', 'shower', 'shower-quadrant')) return 'bathroom'
  if (has('toilet')) return 'wc'
  if (has('stove', 'kitchen-sink', 'counter', 'kitchen-island', 'oven-tower')) return 'kitchen'
  if (has('bed-double')) return 'bedroom'
  if (has('bed-single')) return 'kids'
  if (has('dining-table') && !has('sofa', 'sofa-corner')) return 'dining'
  if (has('sofa', 'sofa-corner')) return 'living'
  if (has('desk')) return 'office'
  return undefined
}

/** The rooms each room's doors and openings lead to. */
export function neighbors(floor: Floor): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>(floor.rooms.map((r) => [r.id, new Set<string>()]))
  for (const s of floor.symbols) {
    // Doors and openings: the ways between rooms.
    if (!SYMBOL_MAP.get(s.type)?.wall || !(s.type.startsWith('door') || s.type === 'opening')) continue
    const p = symbolPose(s, floor.rooms)
    const r = (p.rotation * Math.PI) / 180
    const n = { x: -Math.sin(r), y: Math.cos(r) }
    const reach = (p.wallThickness ?? 10) / 2 + 15
    const a = floor.rooms.find((x) => pointInPolygon({ x: p.x + n.x * reach, y: p.y + n.y * reach }, x.points))
    const b = floor.rooms.find((x) => pointInPolygon({ x: p.x - n.x * reach, y: p.y - n.y * reach }, x.points))
    if (a && b && a !== b) {
      out.get(a.id)!.add(b.id)
      out.get(b.id)!.add(a.id)
    }
  }
  return out
}

/** The windows in a room's walls. */
function windowCount(room: Room, floor: Floor) {
  return floor.symbols.filter((s) => s.wall?.roomId === room.id && s.type.startsWith('window')).length
}

/**
 * A guess at what each room is for: by its name, then by what's in it, then by its size and shape (the biggest is
 * the living room, a long narrow one a hallway, a small one a bathroom…). Rooms already given a use keep it.
 */
export function guessUses(floor: Floor): Map<string, RoomUse> {
  const out = new Map<string, RoomUse>()
  const rest: Room[] = []
  for (const room of floor.rooms) {
    if (room.points.length < 3) continue
    const named = NAMES.find(([re]) => re.test(room.name))?.[1]
    const use = room.use ?? (isOutdoor(room) ? 'balcony' : (named ?? byContents(room, floor)))
    if (use) out.set(room.id, use)
    else rest.push(room)
  }
  const links = neighbors(floor)
  const taken = (u: RoomUse) => [...out.values()].includes(u)
  // Narrow ones are hallways, small ones bathrooms; the rest by size, biggest first.
  const sized = rest
    .map((room) => {
      const b = bbox(room.points)
      return { room, area: area(room.points) / 1e4, short: Math.min(b.maxX - b.minX, b.maxY - b.minY), long: Math.max(b.maxX - b.minX, b.maxY - b.minY) }
    })
    .sort((a, b) => b.area - a.area)
  for (const r of sized) {
    if (r.short < 170 && r.long / r.short > 2.2) out.set(r.room.id, 'hall')
    else if (r.area < 2.5) out.set(r.room.id, 'wc')
    else if (r.area < 6.5) out.set(r.room.id, 'bathroom')
  }
  for (const r of sized) {
    if (out.has(r.room.id)) continue
    const windows = windowCount(r.room, floor)
    let use: RoomUse
    if (!taken('living')) use = 'living'
    else if (!taken('kitchen') && r.area < 16 && [...(links.get(r.room.id) ?? [])].some((id) => out.get(id) === 'living' || out.get(id) === 'hall')) use = 'kitchen'
    else if (!taken('master') && windows) use = 'master'
    else if (r.area < 7) use = 'office'
    else use = 'bedroom'
    out.set(r.room.id, use)
  }
  // A bathroom you can only get into from a bedroom is its en-suite.
  for (const [id, use] of out) {
    if (use !== 'bathroom') continue
    const ns = [...(links.get(id) ?? [])].map((n) => out.get(n))
    if (ns.length && ns.every((u) => isBedroom(u) || u === 'dressing')) out.set(id, 'ensuite')
  }
  return out
}
