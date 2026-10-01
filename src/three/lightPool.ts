/**
 * A fixed set of real three.js lights shared by all the light fixtures in the scene.
 *
 * Every real light makes every surface's shader loop over it, and changing how many there are recompiles all the
 * shaders: with the 100+ fixtures of a real lighting design that meant seconds of frozen page and a low frame rate.
 * So fixtures only carry virtual lights (where, which way, how bright), and these few real ones go to the fixtures
 * that matter most from where the camera is: the nearest, those in the same room first. Rooms whose fixtures didn't
 * all get one have a soft fill light standing in for the rest, so the home doesn't go dark around the room you're in.
 *
 * Walking around must not make lights jump: a fixture keeps its real light until another is clearly closer, and
 * handing one over fades it out and the other in, with the room's fill light making up the difference meanwhile.
 */
import * as THREE from 'three'

export interface VirtualLight {
  kind: 'spot' | 'point' | 'rect'
  /** Where the light is (and for rect lights, which way it faces), inside its fixture. */
  anchor: THREE.Object3D
  color: THREE.Color
  /** Intensity when on; `intensity` is what it is now (0 when switched off). */
  base: number
  intensity: number
  /** Spot lights (they shine straight down): cone half-angle and edge softness. */
  angle?: number
  penumbra?: number
  /** Rect lights: size in meters. */
  width?: number
  height?: number
  /** The room it's in, if any. */
  room?: string
  /** How much of it a real light gives now (0 … 1, while fading); the room's fill light gives the rest. */
  share?: number
}

/** A room that can get a fill light: an anchor at its middle, near the ceiling, and how far the light reaches (cm). */
export interface PoolRoom {
  id: string
  anchor: THREE.Object3D
  reach: number
}

/** How many real lights of each kind there are, whatever the design. */
/** Enough spots for most rooms to have all theirs, so walking about in them hands nothing over. */
export const POOL_SIZE = { spot: 12, point: 4, rect: 2, fill: 8 }

/** Lights in other rooms than the one in focus count as this much further away (m). */
const OTHER_ROOM = 3
/** A light (or fill) that has a real one keeps it until another is this much closer (m). */
const KEEP = 1.5
/** Handing a real light over to another fixture fades it out, and in, over this long (s). */
const FADE = 0.4
/**
 * How strong a fill light is for the output it stands in for: it shines all around, while the lights it replaces
 * mostly shine down. In the room in focus it only tops up the real lights there, so it's weaker.
 */
const FILL_GAIN = 1.5
const FOCUS_FILL_GAIN = 0.8

/** Luminous output of a virtual light, roughly (to size fill lights). */
function flux(v: VirtualLight) {
  if (v.kind === 'spot') return v.intensity * 2 * Math.PI * (1 - Math.cos(v.angle ?? 0.5))
  if (v.kind === 'point') return v.intensity * 4 * Math.PI
  return v.intensity * Math.PI * (v.width ?? 1) * (v.height ?? 1)
}

/** A real light and what it's lent to: a fixture's light, or a room (fill). `share` fades in and out. */
interface Slot<T> {
  light: THREE.Light
  to: T | null
  share: number
}

export class LightPool {
  readonly group = new THREE.Group()
  private slots: Record<VirtualLight['kind'], Slot<VirtualLight>[]> = { spot: [], point: [], rect: [] }
  private fills: Slot<PoolRoom>[] = []
  private lights: VirtualLight[] = []
  private focusRoom: string | null = null
  /** What should have a real light now, in order of importance. */
  private want = new Set<VirtualLight>()
  private wantRooms = new Set<PoolRoom>()
  /** Still fading lights in or out. */
  animating = false

  constructor() {
    this.group.name = 'light pool'
    for (let i = 0; i < POOL_SIZE.spot; i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 0, 0.5, 0.65, 2)
      this.group.add(l, l.target)
      this.slots.spot.push({ light: l, to: null, share: 0 })
    }
    for (let i = 0; i < POOL_SIZE.point; i++) this.slots.point.push({ light: this.addPoint(), to: null, share: 0 })
    for (let i = 0; i < POOL_SIZE.rect; i++) {
      const l = new THREE.RectAreaLight(0xffffff, 0, 1, 1)
      this.group.add(l)
      this.slots.rect.push({ light: l, to: null, share: 0 })
    }
    for (let i = 0; i < POOL_SIZE.fill; i++) this.fills.push({ light: this.addPoint(), to: null, share: 0 })
  }

  private addPoint() {
    const l = new THREE.PointLight(0xffffff, 0, 0, 2)
    this.group.add(l)
    return l
  }

  /** Switch every real light off (nothing to light). */
  clear() {
    for (const s of this.all()) {
      s.to = null
      s.share = 0
      s.light.intensity = 0
    }
    this.lights = []
    this.want.clear()
    this.wantRooms.clear()
    this.animating = false
  }

  private all(): Slot<unknown>[] {
    return [...this.slots.spot, ...this.slots.point, ...this.slots.rect, ...this.fills]
  }

  /**
   * Decide which lights should have a real one, seen from `focus` (world position) in `focusRoom`: the nearest that
   * are on, those in that room first, and the ones that have one already unless another is clearly closer. Then fill
   * lights for the nearest rooms that still have lights without one. `instant` puts everything in place at once
   * (a new scene, or a switch flipped); otherwise the changes fade in over the next frames (see `step`).
   */
  retarget(lights: VirtualLight[], rooms: PoolRoom[], focus: THREE.Vector3, focusRoom: string | null, instant: boolean) {
    if (lights !== this.lights) {
      // A new scene: its lights are new, so nothing carries over.
      for (const s of this.all()) {
        s.to = null
        s.share = 0
      }
      this.lights = lights
      instant = true
    }
    this.focusRoom = focusRoom
    const held = new Set<unknown>(this.all().map((s) => s.to))
    const p = new THREE.Vector3()
    const ranked = lights
      .filter((v) => v.intensity > 0)
      .map((v) => {
        const d = v.anchor.getWorldPosition(p).distanceTo(focus) + (focusRoom && v.room !== focusRoom ? OTHER_ROOM : 0)
        return { v, d: d - (held.has(v) ? KEEP : 0) }
      })
      .sort((a, b) => a.d - b.d)
    this.want = new Set()
    for (const kind of ['spot', 'point', 'rect'] as const) {
      ranked
        .filter((r) => r.v.kind === kind)
        .slice(0, this.slots[kind].length)
        .forEach((r) => this.want.add(r.v))
    }
    const lit = new Set(lights.filter((v) => v.intensity > 0 && v.room && !this.want.has(v)).map((v) => v.room))
    this.wantRooms = new Set(
      rooms
        .filter((r) => lit.has(r.id))
        .map((r) => ({ r, d: r.anchor.getWorldPosition(p).distanceTo(focus) - (held.has(r) ? KEEP : 0) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, this.fills.length)
        .map((x) => x.r),
    )
    this.step(instant ? Infinity : 0)
  }

  /** Move the fades on by `dt` seconds and set the real lights; false once everything is in place. */
  step(dt: number): boolean {
    const d = dt / FADE
    let busy = false
    const fade = <T>(slots: Slot<T>[], want: Set<T>, place: (s: Slot<T>) => void, isOff: (t: T) => boolean, release: (t: T) => void) => {
      // Lights no longer wanted fade out and free their slot; switched-off ones go out at once.
      for (const s of slots) {
        if (!s.to) continue
        const off = isOff(s.to)
        if (!want.has(s.to) || off) {
          s.share = off ? 0 : Math.max(0, s.share - d)
          if (s.share === 0) {
            release(s.to)
            s.to = null
          } else busy = true
        } else if (s.share < 1) {
          s.share = Math.min(1, s.share + d)
          busy ||= s.share < 1
        }
      }
      // Wanted ones without a real light take a free slot and fade in.
      const holding = new Set(slots.map((s) => s.to))
      for (const w of want) {
        if (holding.has(w)) continue
        const free = slots.find((s) => !s.to)
        if (!free) {
          busy = true // waiting for one to fade out
          break
        }
        free.to = w
        free.share = Math.min(1, d)
        place(free)
        busy ||= free.share < 1
      }
    }
    const q = new THREE.Quaternion()
    const at = new THREE.Vector3()
    for (const kind of ['spot', 'point', 'rect'] as const) {
      const want = new Set([...this.want].filter((v) => v.kind === kind))
      fade(
        this.slots[kind],
        want,
        (s) => {
          const v = s.to!
          const l = s.light
          v.anchor.getWorldPosition(at)
          l.position.copy(at)
          if (l instanceof THREE.SpotLight) {
            l.angle = v.angle ?? 0.5
            l.penumbra = v.penumbra ?? 0.65
            l.target.position.set(at.x, at.y - 1, at.z)
          } else if (l instanceof THREE.RectAreaLight) {
            l.quaternion.copy(v.anchor.getWorldQuaternion(q))
            l.width = v.width ?? 1
            l.height = v.height ?? 1
          }
        },
        (v) => v.intensity === 0,
        (v) => (v.share = 0),
      )
      for (const s of this.slots[kind]) {
        s.light.intensity = s.to ? s.to.intensity * s.share : 0
        if (s.to) {
          s.light.color.copy(s.to.color)
          s.to.share = s.share
        }
      }
    }

    // What each room's real lights don't give (fully, or while fading), and its color.
    const left = new Map<string, { flux: number; color: THREE.Color }>()
    for (const v of this.lights) {
      if (!v.room || v.intensity === 0) continue
      const f = flux(v) * (1 - (v.share ?? 0))
      if (f <= 0) continue
      const r = left.get(v.room) ?? { flux: 0, color: new THREE.Color(0, 0, 0) }
      r.flux += f
      r.color.r += v.color.r * f
      r.color.g += v.color.g * f
      r.color.b += v.color.b * f
      left.set(v.room, r)
    }
    const scale = new THREE.Vector3()
    fade(
      this.fills,
      this.wantRooms,
      (s) => {
        const r = s.to!
        const l = s.light as THREE.PointLight
        l.position.copy(r.anchor.getWorldPosition(at))
        l.distance = r.reach * r.anchor.getWorldScale(scale).x
      },
      () => false,
      () => {},
    )
    for (const s of this.fills) {
      const out = s.to && left.get(s.to.id)
      if (!s.to || !out) {
        s.light.intensity = 0
        continue
      }
      s.light.intensity = (out.flux / (4 * Math.PI)) * (s.to.id === this.focusRoom ? FOCUS_FILL_GAIN : FILL_GAIN) * s.share
      s.light.color.copy(out.color).multiplyScalar(1 / out.flux)
    }
    this.group.updateMatrixWorld(true)
    this.animating = busy
    return busy
  }
}
