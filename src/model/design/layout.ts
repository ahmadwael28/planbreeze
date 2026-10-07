/**
 * Laying out one room: what's there to work with (its walls as seen from inside, its doors and which way they swing,
 * its windows and how high they start, what has to stay), and placing items in it one at a time: each has to fit in
 * the room, clear of what's there, of the floor doors need and (if tall) of windows, its own clearances free, and
 * with a way left to walk to every door and to everything that needs reaching.
 */
import { add, area, bbox, dot, mul, pointInPolygon, sub } from '../geometry'
import { newSymbol, symbolPose } from '../project'
import { SYMBOL_MAP } from '../symbols'
import type { Floor, PlanSymbol, Point, Room, RoomUse } from '../types'
import { roomFaces } from '../walls'
import type { WallFace } from '../walls'
import { againstWall, distToBox, inside, overlaps } from './geom'
import type { Box } from './geom'

export interface Opening {
  sym: PlanSymbol
  kind: 'door' | 'opening' | 'window'
  /** The face it's in, and its middle along it (as the face measures). */
  face: number
  s: number
  w: number
  sill: number
  top: number
  /** A hinged door's leaf swings into this room. */
  swingIn: boolean
  /** A window, or a glass door (curtains go over it). */
  glazed: boolean
  /** The end of the opening its hinge is at along the face (-1 toward its start, 1 its end; 0: none or two). */
  hinge: -1 | 0 | 1
  /** The room it leads to. */
  to?: Room
}

export interface Analysis {
  room: Room
  floor: Floor
  poly: Point[]
  /** Floor area, m². */
  area: number
  faces: WallFace[]
  openings: Opening[]
  /** Doors and openings: the ways in. */
  doors: Opening[]
  windows: Opening[]
  /** The way in that matters most (from the hallway or living room, a door over an opening). */
  entry?: Opening
  /** Floor doors need kept clear: their swing and the way through. */
  clear: Box[]
  /** The space in front of windows, at their height: nothing tall stands there. */
  glass: Box[]
  /** What stays where it is: columns, stairs, anything not being replaced. */
  fixed: Box[]
}

const HINGED = new Set(['door', 'door-double', 'door-alu', 'door-alu-double'])
const GLAZED = new Set(['door-alu', 'door-alu-double', 'door-alu-sliding', 'door-sliding'])

/** A point along a face, `off` cm out from it into the room. */
export const facePoint = (f: WallFace, s: number, off = 0): Point => add(add(f.a, mul(f.dir, s)), mul(f.inward, off))

/** A symbol's footprint, at its height. */
export function boxOf(sym: PlanSymbol, floor: Floor): Box {
  const def = SYMBOL_MAP.get(sym.type)
  const z0 = sym.elevation ?? 0
  return { x: sym.x, y: sym.y, w: sym.width, d: sym.depth, rot: sym.rotation, z0, z1: def?.fullHeight ? floor.height : z0 + sym.height }
}

/** Look at a room: its faces, the doors and windows in them, what they need kept clear. */
export function analyze(room: Room, floor: Floor, fixed: PlanSymbol[], uses: Map<string, RoomUse>): Analysis {
  const faces = roomFaces(room, floor.rooms)
  const openings: Opening[] = []
  for (const sym of floor.symbols) {
    const def = SYMBOL_MAP.get(sym.type)
    if (!def?.wall || sym.type === 'shower-niche') continue
    const pose = symbolPose(sym, floor.rooms)
    const r = (pose.rotation * Math.PI) / 180
    const along = { x: Math.cos(r), y: Math.sin(r) }
    faces.forEach((f, i) => {
      if (Math.abs(along.x * f.dir.y - along.y * f.dir.x) > 0.02) return
      const out = mul(f.inward, -1)
      const centerLine = add(f.a, mul(out, f.t / 2))
      if (Math.abs(dot(sub(pose, centerLine), out)) > f.t / 2 + 1) return
      const s = dot(sub(pose, f.a), f.dir)
      if (s + sym.width / 2 < f.s1 || s - sym.width / 2 > f.s2) return
      const kind = sym.type.startsWith('window') ? 'window' : sym.type === 'opening' ? 'opening' : 'door'
      const leafDir = mul({ x: -Math.sin(r), y: Math.cos(r) }, sym.flipY ? -1 : 1)
      const hinged = HINGED.has(sym.type)
      const hingeAt = add(pose, mul(along, (sym.flipX ? 1 : -1) * (sym.width / 2)))
      const bottom = sym.elevation ?? def.sill ?? 0
      const beyond = facePoint(f, s, -(f.t + 15))
      openings.push({
        sym,
        kind,
        face: i,
        s,
        w: sym.width,
        sill: bottom,
        top: bottom + sym.height,
        swingIn: hinged && dot(leafDir, f.inward) > 0,
        glazed: kind === 'window' || GLAZED.has(sym.type),
        hinge: hinged && !sym.type.includes('double') ? (dot(sub(hingeAt, f.a), f.dir) < s ? -1 : 1) : 0,
        to: floor.rooms.find((x) => x.id !== room.id && pointInPolygon(beyond, x.points)),
      })
    })
  }
  const doors = openings.filter((o) => o.kind !== 'window' && o.sill < 5)
  const windows = openings.filter((o) => o.kind === 'window')
  // A swinging leaf needs its arc; any other way through, a path a metre wide (a wide sliding door or opening
  // isn't all walkway).
  const clear = doors.map((o) => {
    const leaf = o.sym.type.includes('double') ? o.w / 2 : o.w
    const depth = o.swingIn ? Math.max(leaf, 60) + 10 : 60
    const width = o.swingIn ? o.w + 10 : Math.min(o.w + 10, 100)
    return againstWall(facePoint(faces[o.face], o.s), faces[o.face].inward, width, depth, 0, 210)
  })
  const glass = windows.map((o) => againstWall(facePoint(faces[o.face], o.s), faces[o.face].inward, o.w, 25, o.sill, o.top))
  const publicUse = (u?: RoomUse) => u === 'hall' || u === 'living' || u === 'dining' || u === 'kitchen'
  const entry = [...doors].sort((a, b) => rank(b) - rank(a))[0]
  function rank(o: Opening) {
    return (o.kind === 'door' ? 2 : 1) + (o.to && publicUse(uses.get(o.to.id)) ? 3 : 0) + (o.to ? 1 : 0) + o.w / 1000
  }
  return {
    room,
    floor,
    poly: room.points,
    area: area(room.points) / 1e4,
    faces,
    openings,
    doors,
    windows,
    entry,
    clear,
    glass,
    fixed: fixed.map((s) => boxOf(s, floor)),
  }
}

/** Something to place: the symbol (already posed), its footprint, the floor it needs free in front or around it. */
export interface Cand {
  sym: PlanSymbol
  box: Box
  /** Floor this item needs kept clear (to sit, open a door, walk past); others can't stand there. */
  zones?: Box[]
  /** Spots that must be reachable on foot: at least one of each group. */
  reach?: Point[][]
  face?: number
  s?: number
  /** Only takes up space (another part of something placed, like a corner sofa's chaise): not a symbol of its own. */
  ghost?: boolean
}

export type Placed = Cand

/** A slot against a wall: a footprint with its back to the face, `s` along it. */
export interface Slot {
  box: Box
  face: number
  s: number
  /** Snug against the start or end of its stretch of wall (a corner, a door frame). */
  snug: boolean
}

/** Room for a person to walk (half the width of a path, cm). */
const WALK = 25
const CELL = 10

export class Layout {
  placed: Placed[] = []
  private grid: { x0: number; y0: number; nx: number; ny: number; still: Uint8Array } | null = null

  readonly an: Analysis
  readonly rand: () => number
  /** How much chance shakes up the order candidates are tried in (another try at the room is another order). */
  readonly jitter: number

  constructor(an: Analysis, rand: () => number, jitter = 0.01) {
    this.an = an
    this.rand = rand
    this.jitter = jitter
  }

  /** A symbol posed like a box (its own size may differ: a toilet's box includes the space beside it). */
  sym(type: string, box: Pick<Box, 'x' | 'y' | 'rot'>, extra: Partial<PlanSymbol> = {}): PlanSymbol {
    return { ...newSymbol(type, Math.round(box.x * 10) / 10, Math.round(box.y * 10) / 10), rotation: box.rot, ...extra }
  }

  private solids(skip?: Placed) {
    return [...this.an.fixed, ...this.placed.filter((p) => p !== skip).map((p) => p.box)]
  }

  /** Whether a footprint (and the clearances it needs) can go here, given what's placed. */
  fits(box: Box, zones: Box[] = []): boolean {
    const { poly } = this.an
    if (!inside(box, poly)) return false
    const solids = this.solids()
    if (solids.some((o) => overlaps(box, o))) return false
    if (this.an.clear.some((c) => overlaps(box, c))) return false
    if (this.an.glass.some((g) => overlaps(box, g))) return false
    for (const z of zones) {
      if (!inside(z, poly, 0.5)) return false
      if (solids.some((o) => overlaps(z, o))) return false
    }
    return !this.placed.some((p) => p.zones?.some((z) => overlaps(box, z)))
  }

  add(c: Cand): Placed {
    this.placed.push(c)
    return c
  }

  remove(p: Placed) {
    this.placed = this.placed.filter((x) => x !== p)
  }

  /**
   * Try candidates best first: the first that fits and still leaves every door and everything placed within reach is
   * placed. Candidates scored -Infinity are left out.
   */
  tryPlace<C extends Cand>(cands: C[], score: (c: C) => number = () => 0, limit = 40): C | null {
    const ranked = cands
      .map((c) => ({ c, v: score(c) + this.rand() * this.jitter }))
      .filter((x) => x.v > -Infinity)
      .sort((a, b) => b.v - a.v)
    let tried = 0
    // The floor blocked by what's placed so far, worked out once for all the candidates.
    let base: Uint8Array | null = null
    for (const { c } of ranked) {
      if (!this.fits(c.box, c.zones)) continue
      base ??= this.blocked(this.placed)
      this.add(c)
      if (this.reachable(this.blocked([c], base))) return c
      this.remove(c)
      if (++tried >= limit) break
    }
    return null
  }

  /** Every place along the walls a footprint w × d could stand with its back to the wall (not checked for fit). */
  wallSlots(w: number, d: number, z0: number, z1: number, step = 10, gap = 0): Slot[] {
    const out: Slot[] = []
    this.an.faces.forEach((f, i) => {
      if (f.s2 - f.s1 < w - 0.5) return
      const lo = f.s1 + w / 2
      const hi = f.s2 - w / 2
      const ss = new Set<number>([lo, hi, (lo + hi) / 2])
      for (let s = lo; s <= hi; s += step) ss.add(s)
      // Snug against door and window frames.
      for (const o of this.an.openings) {
        if (o.face !== i) continue
        for (const s of [o.s - o.w / 2 - 5 - w / 2, o.s + o.w / 2 + 5 + w / 2]) if (s >= lo && s <= hi) ss.add(s)
      }
      for (const s of ss) {
        const box = againstWall(facePoint(f, s), f.inward, w, d, z0, z1, gap)
        out.push({ box, face: i, s, snug: Math.abs(s - lo) < 0.5 || Math.abs(s - hi) < 0.5 })
      }
    })
    return out
  }

  /** The parts of a face clear of doors (and of anything between `z0` and `z1` within `depth` of it), as [s1, s2]. */
  freeAlong(face: number, depth: number, z0: number, z1: number): [number, number][] {
    const f = this.an.faces[face]
    let free: [number, number][] = [[f.s1, f.s2]]
    const cut = (a: number, b: number) => {
      free = free.flatMap(([s1, s2]): [number, number][] => {
        if (b <= s1 || a >= s2) return [[s1, s2]]
        return [
          [s1, Math.max(s1, a)],
          [Math.min(s2, b), s2],
        ].filter(([x, y]) => y - x > 0.5) as [number, number][]
      })
    }
    const boxes = [...this.an.clear, ...this.an.glass, ...this.solids()].filter((b) => Math.min(b.z1, z1) - Math.max(b.z0, z0) > 0)
    for (const b of boxes) {
      const cs = [
        { x: -b.w / 2, y: -b.d / 2 },
        { x: b.w / 2, y: -b.d / 2 },
        { x: b.w / 2, y: b.d / 2 },
        { x: -b.w / 2, y: b.d / 2 },
      ].map((p) => {
        const r = (b.rot * Math.PI) / 180
        const q = { x: b.x + p.x * Math.cos(r) - p.y * Math.sin(r), y: b.y + p.x * Math.sin(r) + p.y * Math.cos(r) }
        return { s: dot(sub(q, f.a), f.dir), n: dot(sub(q, f.a), f.inward) }
      })
      const n0 = Math.min(...cs.map((c) => c.n))
      const n1 = Math.max(...cs.map((c) => c.n))
      if (n1 <= 0.5 || n0 >= depth) continue
      cut(Math.min(...cs.map((c) => c.s)), Math.max(...cs.map((c) => c.s)))
    }
    for (const o of this.an.openings) if (o.face === face && o.sill < z1 && o.top > z0) cut(o.s - o.w / 2 - 3, o.s + o.w / 2 + 3)
    return free
  }

  /** The walking grid: cells too near a wall, or something fixed, to walk through. */
  private walkGrid() {
    const { poly } = this.an
    if (!this.grid) {
      const b = bbox(poly)
      const nx = Math.ceil((b.maxX - b.minX) / CELL)
      const ny = Math.ceil((b.maxY - b.minY) / CELL)
      const still = new Uint8Array(nx * ny)
      const solid = this.an.fixed.filter((f) => f.z0 < 100)
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const p = { x: b.minX + (i + 0.5) * CELL, y: b.minY + (j + 0.5) * CELL }
          let blocked = !pointInPolygon(p, poly) || edgeDist(p, poly) < WALK
          if (!blocked) blocked = solid.some((f) => distToBox(p, f) < WALK)
          still[j * nx + i] = blocked ? 1 : 0
        }
      }
      this.grid = { x0: b.minX, y0: b.minY, nx, ny, still }
    }
    return this.grid
  }

  /** The cells blocked by these items as well (on top of `from`, or the fixed ones). */
  private blocked(items: Placed[], from?: Uint8Array): Uint8Array {
    const { x0, y0, nx, ny, still } = this.walkGrid()
    const blocked = (from ?? still).slice()
    for (const p of items) {
      const box = p.box
      if (box.z0 >= 100) continue
      const r = Math.hypot(box.w, box.d) / 2 + WALK
      const i0 = Math.max(0, Math.floor((box.x - r - x0) / CELL))
      const i1 = Math.min(nx - 1, Math.floor((box.x + r - x0) / CELL))
      const j0 = Math.max(0, Math.floor((box.y - r - y0) / CELL))
      const j1 = Math.min(ny - 1, Math.floor((box.y + r - y0) / CELL))
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (blocked[j * nx + i]) continue
          if (distToBox({ x: x0 + (i + 0.5) * CELL, y: y0 + (j + 0.5) * CELL }, box) < WALK) blocked[j * nx + i] = 1
        }
      }
    }
    return blocked
  }

  /** Whether every door and every item's reach points can be walked to from the way in. */
  reachable(blocked = this.blocked(this.placed)): boolean {
    const { x0, y0, nx, ny } = this.walkGrid()
    const cellOf = (p: Point) => {
      const i = Math.floor((p.x - x0) / CELL)
      const j = Math.floor((p.y - y0) / CELL)
      return i >= 0 && j >= 0 && i < nx && j < ny ? j * nx + i : -1
    }
    // A target counts as reached if any free cell within reach of it was.
    const near = (p: Point, seen: Uint8Array) => {
      for (let dj = -3; dj <= 3; dj++) {
        for (let di = -3; di <= 3; di++) {
          const c = cellOf({ x: p.x + di * CELL, y: p.y + dj * CELL })
          if (c >= 0 && seen[c]) return true
        }
      }
      return false
    }
    const starts = this.an.doors.map((o) => facePoint(this.an.faces[o.face], o.s, 40))
    if (!starts.length) return true
    const seen = new Uint8Array(nx * ny)
    const queue: number[] = []
    for (let dj = -3; dj <= 3 && !queue.length; dj++) {
      for (let di = -3; di <= 3; di++) {
        const c = cellOf({ x: starts[0].x + di * CELL, y: starts[0].y + dj * CELL })
        if (c >= 0 && !blocked[c]) {
          queue.push(c)
          seen[c] = 1
        }
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q]
      const i = c % nx
      const j = (c - i) / nx
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ii = i + di
        const jj = j + dj
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue
        const n = jj * nx + ii
        if (seen[n] || blocked[n]) continue
        seen[n] = 1
        queue.push(n)
      }
    }
    if (!starts.every((p) => near(p, seen))) return false
    return this.placed.every((p) => (p.reach ?? []).every((group) => group.some((pt) => near(pt, seen))))
  }
}

function edgeDist(p: Point, poly: Point[]) {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const ab = sub(b, a)
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)))
    best = Math.min(best, Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t)))
  }
  return best
}
