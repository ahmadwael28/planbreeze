/**
 * People in the plan, to judge sizes by: how tall and broad they are, and whether they stand, sit or lie down. Seats
 * and beds take them at the right height, facing the right way (the plan's sizes are in cm).
 */
import { itemFrame } from './placement'
import { frameOf, OUTFITS, SKIN_TONES, SOFA, seatsAlong } from './symbols'
import type { PlanSymbol, Point } from './types'

export type PersonPose = NonNullable<PlanSymbol['pose']>

export const PERSON = { height: 175, width: 45, minHeight: 50, maxHeight: 220, minWidth: 20, maxWidth: 70 }

/** Typical people: height and shoulder width (cm). */
export const PERSON_PRESETS: { name: string; height: number; width: number }[] = [
  { name: 'Child', height: 115, width: 30 },
  { name: 'Teen', height: 160, width: 40 },
  { name: 'Adult', height: 175, width: 45 },
  { name: 'Tall', height: 192, width: 50 },
]

export const POSE_NAMES: Record<PersonPose, string> = { stand: 'Standing', sit: 'Sitting', lie: 'Lying' }

/** How much floor a person takes, front to back (cm): standing feet to back, sitting back to toes, or lying full length. */
export function personDepth(height: number, width: number, pose: PersonPose = 'stand') {
  if (pose === 'lie') return Math.round(height)
  if (pose === 'sit') return Math.round(height * 0.31 + width * 0.3)
  return Math.round(Math.max(24, width * 0.66))
}

/** Items people can sit or lie on, and how high (cm; `top`: on top of it, like a bed's mattress). */
const HOLDS: Record<string, { name: string; sit?: number | 'top'; lie?: number | 'top' }> = {
  chair: { name: 'chair', sit: 46 },
  armchair: { name: 'armchair', sit: 44 },
  sofa: { name: 'sofa', sit: 44, lie: 44 },
  'sofa-corner': { name: 'corner sofa', sit: 44, lie: 44 },
  'bed-double': { name: 'bed', sit: 'top', lie: 'top' },
  'bed-single': { name: 'bed', sit: 'top', lie: 'top' },
  toilet: { name: 'toilet', sit: 44 },
}

/** Where a person settles on something: what it is, how high they are off the floor, and their pose in the plan. */
export interface Support {
  item: PlanSymbol
  /** What it's called ("sofa"). */
  name: string
  /** Height of the seat or mattress they're on (cm). */
  height: number
  x: number
  y: number
  rotation: number
}

const nearest = (v: number, list: number[]) => list.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), list[0])
const clamp = (v: number, a: number, b: number) => (a > b ? (a + b) / 2 : Math.min(b, Math.max(a, v)))

/**
 * Where a person in a pose settles on an item (in its local frame): their middle, and which way their front (feet)
 * points. Seats put their back against the backrest, on the nearest cushion; beds put sitters on the nearest edge
 * and sleepers with their head at the headboard.
 */
function settle(item: PlanSymbol, pose: 'sit' | 'lie', l: Point, face: Point, H: number, W: number): { at: Point; dir: Point } | null {
  const w = item.width
  const d = item.depth
  const D = personDepth(H, W, pose)
  switch (item.type) {
    case 'chair':
      return { at: { x: 0, y: -d / 2 + 5 + D / 2 }, dir: { x: 0, y: 1 } }
    case 'toilet':
      return { at: { x: 0, y: -d / 2 + Math.min(20, d * 0.3) + 2 + D / 2 }, dir: { x: 0, y: 1 } }
    case 'armchair':
    case 'sofa': {
      // As the 3D model has it: its back, back cushions (about 12 cm out from the back) and seat cushions.
      const one = item.type === 'armchair'
      const arm = one ? Math.min(18, w * 0.17) : Math.min(20, w * 0.09)
      const back = Math.min(20, d * 0.22) + 12
      const inner = w - arm * 2
      if (pose === 'lie') return { at: { x: 0, y: back / 2 }, dir: { x: face.x < 0 ? -1 : 1, y: 0 } }
      const n = one ? 1 : seatsAlong(w - 2 * Math.min(SOFA.arm, w * 0.09))
      const cushions = Array.from({ length: n }, (_, i) => -inner / 2 + (inner * (i + 0.5)) / n)
      // A little forward, as they lean back into the cushions.
      return { at: { x: nearest(l.x, cushions), y: -d / 2 + back + D / 2 + 4 }, dir: { x: 0, y: 1 } }
    }
    case 'sofa-corner': {
      const arm = Math.min(SOFA.arm, w * 0.12, d * 0.12)
      const back = Math.min(SOFA.back, d * 0.2, w * 0.2)
      const seat = Math.min(SOFA.seat, d * 0.6, w * 0.6)
      const L = -w / 2
      const T = -d / 2
      const runX = w - back - arm
      const runY = d - seat - arm
      if (pose === 'lie') return { at: { x: L + back + runX / 2, y: T + back + (seat - back) / 2 }, dir: { x: face.x < 0 ? -1 : 1, y: 0 } }
      // Against the back cushions, about 12 cm out from the back.
      if (l.x < L + seat && l.y > T + seat) {
        // Down the side, facing across.
        const n = seatsAlong(runY)
        const ys = Array.from({ length: n }, (_, i) => T + seat + (runY * (i + 0.5)) / n)
        return { at: { x: L + back + 16 + D / 2, y: nearest(l.y, ys) }, dir: { x: 1, y: 0 } }
      }
      const n = seatsAlong(runX)
      const xs = Array.from({ length: n }, (_, i) => L + back + (runX * (i + 0.5)) / n)
      return { at: { x: nearest(l.x, xs), y: T + back + 16 + D / 2 }, dir: { x: 0, y: 1 } }
    }
    case 'bed-double':
    case 'bed-single': {
      if (pose === 'lie') {
        const x = item.type === 'bed-double' ? (l.x < 0 ? -w / 4 : w / 4) : 0
        // Head on the pillow at the headboard.
        return { at: { x, y: -d / 2 + 8 + D / 2 }, dir: { x: 0, y: 1 } }
      }
      // On the nearest side or the foot, feet on the floor beyond it.
      const edges = [
        { gap: l.x + w / 2, dir: { x: -1, y: 0 } },
        { gap: w / 2 - l.x, dir: { x: 1, y: 0 } },
        { gap: d / 2 - l.y, dir: { x: 0, y: 1 } },
      ]
      const e = edges.reduce((b, x) => (x.gap < b.gap ? x : b))
      const inset = D / 2 - 20
      if (e.dir.y) return { at: { x: clamp(l.x, -w / 2 + W / 2, w / 2 - W / 2), y: d / 2 - inset }, dir: e.dir }
      return { at: { x: e.dir.x * (w / 2 - inset), y: clamp(l.y, -d / 2 + 50, d / 2 - W / 2) }, dir: e.dir }
    }
  }
  return null
}

/**
 * What a sitting or lying person is on (the item under them that takes that pose, nearest first), and where they
 * settle on it. Null when they stand, or there's nothing under them to sit or lie on (then it's the floor).
 */
export function personSupport(person: PlanSymbol, symbols: PlanSymbol[]): Support | null {
  const pose = person.pose ?? 'stand'
  if (pose === 'stand') return null
  let best: Support | null = null
  let bestD = Infinity
  for (const item of symbols) {
    const hold = HOLDS[item.type]?.[pose]
    if (!hold || item.id === person.id) continue
    const f = itemFrame(item)
    const l = f.local(person)
    if (Math.abs(l.x) > item.width / 2 + 15 || Math.abs(l.y) > item.depth / 2 + 15) continue
    const away = Math.hypot(l.x / item.width, l.y / item.depth)
    if (away >= bestD) continue
    const spot = settle(item, pose, l, f.dirOf(person.rotation), person.height, person.width)
    if (!spot) continue
    bestD = away
    const at = f.world(spot.at)
    best = {
      item,
      name: HOLDS[item.type].name,
      height: hold === 'top' ? item.height : hold,
      x: Math.round(at.x * 10) / 10,
      y: Math.round(at.y * 10) / 10,
      rotation: f.facing(spot.dir),
    }
  }
  return best
}

/**
 * How a person rests on what they're on: how far they lean back sitting (radians; into a sofa's cushions, a little
 * against a chair), and how far their head and shoulders are raised lying (on a pillow, or a sofa's arm).
 */
export function restOn(type: string | undefined): { lean: number; raise: number } {
  switch (type) {
    case 'sofa':
    case 'sofa-corner':
    case 'armchair':
      return { lean: 0.22, raise: 0.2 }
    case 'chair':
      return { lean: 0.07, raise: 0 }
    case 'bed-double':
    case 'bed-single':
      return { lean: 0, raise: 0.17 }
  }
  return { lean: 0, raise: 0 }
}

/** Trousers that go with each outfit's top. */
const TROUSERS: Record<string, string> = {
  '#4f6f9c': '#c9bda5',
  '#ecebe6': '#3b4a66',
  '#b5543f': '#3a3633',
  '#6b7a4b': '#cdbf9f',
  '#2b2c2f': '#5b5f66',
  '#c8973b': '#2f3a52',
}
const HAIR = ['#2a1c13', '#4b3021', '#151515', '#8c6a3e', '#6f6a64', '#5a3a22']

/**
 * How a person looks: their top (the outfit chosen), trousers to go with it, skin (chosen, or one of the tones), and
 * hair and shoes that vary from person to person.
 */
export function personLook(p: PlanSymbol) {
  const hash = [...p.id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7)
  const top = frameOf(p)?.hex ?? OUTFITS[0].hex
  return {
    top,
    trousers: TROUSERS[top.toLowerCase()] ?? '#34404f',
    skin: p.style ?? SKIN_TONES[hash % SKIN_TONES.length].hex,
    hair: p.height > 0 && hash % 11 === 0 ? '#bdb7ad' : HAIR[(hash >>> 3) % HAIR.length],
    longHair: (hash >>> 5) % 3 === 0,
    shoes: (hash >>> 7) % 2 ? '#2b2b2b' : '#e6e3dc',
  }
}
