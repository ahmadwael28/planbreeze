/** Placing items against others: a person on a seat (see people), a sofa table behind a sofa. */
import type { PlanSymbol, Point } from './types'

/** An item's own frame: to and from its local coordinates (its back toward -y), flips included. */
export function itemFrame(item: PlanSymbol) {
  const r = (item.rotation * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const fx = item.flipX ? -1 : 1
  const fy = item.flipY ? -1 : 1
  return {
    local: (p: Point): Point => {
      const dx = p.x - item.x
      const dy = p.y - item.y
      return { x: (dx * c + dy * s) * fx, y: (-dx * s + dy * c) * fy }
    },
    world: (l: Point): Point => {
      const x = l.x * fx
      const y = l.y * fy
      return { x: item.x + x * c - y * s, y: item.y + x * s + y * c }
    },
    /** The plan rotation (degrees) of something facing `dir` (local). */
    facing: (dir: Point) => {
      const x = dir.x * fx
      const y = dir.y * fy
      const wx = x * c - y * s
      const wy = x * s + y * c
      return Math.round((((Math.atan2(-wx, wy) * 180) / Math.PI) % 360 + 360) % 360)
    },
    /** Which way a plan rotation faces, in local terms. */
    dirOf: (rotation: number) => {
      const a = (rotation * Math.PI) / 180
      const wx = -Math.sin(a)
      const wy = Math.cos(a)
      return { x: (wx * c + wy * s) * fx, y: (-wx * s + wy * c) * fy }
    },
  }
}

const clamp = (v: number, a: number, b: number) => (a > b ? (a + b) / 2 : Math.min(b, Math.max(a, v)))

/**
 * Where a sofa table goes behind the nearest sofa (or corner sofa, behind whichever of its backs is nearer): against
 * its back, turned along it, within its length. Null when there's no sofa within `reach` (cm) of it.
 */
export function behindSofa(table: PlanSymbol, symbols: PlanSymbol[], reach = 120): Pick<PlanSymbol, 'x' | 'y' | 'rotation'> | null {
  let best: { at: Point; dir: Point; f: ReturnType<typeof itemFrame> } | null = null
  let bestD = reach
  const td = table.depth
  const tw = table.width
  for (const s of symbols) {
    if (s.type !== 'sofa' && s.type !== 'sofa-corner') continue
    const f = itemFrame(s)
    const l = f.local(table)
    const backs = [
      // Along the back, behind it (local -y).
      { gap: Math.abs(l.y + s.depth / 2 + td / 2), along: l.x, half: s.width / 2, at: (x: number) => ({ x, y: -s.depth / 2 - td / 2 - 1 }), dir: { x: 0, y: 1 }, within: Math.abs(l.x) < s.width / 2 + tw / 2 },
    ]
    if (s.type === 'sofa-corner') {
      // And down its side (local -x), the table turned along it.
      backs.push({
        gap: Math.abs(l.x + s.width / 2 + td / 2),
        along: l.y,
        half: s.depth / 2,
        at: (y: number) => ({ x: -s.width / 2 - td / 2 - 1, y }),
        dir: { x: 1, y: 0 },
        within: Math.abs(l.y) < s.depth / 2 + tw / 2,
      })
    }
    for (const b of backs) {
      if (!b.within || b.gap >= bestD) continue
      bestD = b.gap
      best = { at: b.at(clamp(b.along, -b.half + tw / 2, b.half - tw / 2)), dir: b.dir, f }
    }
  }
  if (!best) return null
  const w = best.f.world(best.at)
  return { x: Math.round(w.x * 10) / 10, y: Math.round(w.y * 10) / 10, rotation: best.f.facing(best.dir) }
}
