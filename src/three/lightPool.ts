/**
 * A fixed set of real three.js lights shared by all the light fixtures in the scene.
 *
 * Every real light makes every surface's shader loop over it, and changing how many there are recompiles all the
 * shaders: with the 100+ fixtures of a real lighting design that meant seconds of frozen page and a low frame rate.
 * So fixtures only carry virtual lights (where, which way, how bright), and these few real ones go to the fixtures
 * that matter most from where the camera is: the nearest, those in the same room first. Rooms whose fixtures didn't
 * all get one have a soft fill light standing in for the rest, so the home doesn't go dark around the room you're in.
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
}

/** A room that can get a fill light: an anchor at its middle, near the ceiling, and how far the light reaches (cm). */
export interface PoolRoom {
  id: string
  anchor: THREE.Object3D
  reach: number
}

/** How many real lights of each kind there are, whatever the design. */
export const POOL_SIZE = { spot: 10, point: 4, rect: 2, fill: 8 }

/** Lights in other rooms than the one in focus count as this much further away (m). */
const OTHER_ROOM = 3
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

export class LightPool {
  readonly group = new THREE.Group()
  private spots: THREE.SpotLight[] = []
  private points: THREE.PointLight[] = []
  private rects: THREE.RectAreaLight[] = []
  private fills: THREE.PointLight[] = []

  constructor() {
    this.group.name = 'light pool'
    for (let i = 0; i < POOL_SIZE.spot; i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 0, 0.5, 0.65, 2)
      this.group.add(l, l.target)
      this.spots.push(l)
    }
    for (let i = 0; i < POOL_SIZE.point; i++) this.points.push(this.addPoint())
    for (let i = 0; i < POOL_SIZE.rect; i++) {
      const l = new THREE.RectAreaLight(0xffffff, 0, 1, 1)
      this.group.add(l)
      this.rects.push(l)
    }
    for (let i = 0; i < POOL_SIZE.fill; i++) this.fills.push(this.addPoint())
  }

  private addPoint() {
    const l = new THREE.PointLight(0xffffff, 0, 0, 2)
    this.group.add(l)
    return l
  }

  /** Switch every real light off (nothing to light). */
  clear() {
    for (const l of [...this.spots, ...this.points, ...this.rects, ...this.fills]) l.intensity = 0
  }

  /**
   * Give the real lights to the virtual ones that are on and nearest `focus` (world position), those in `focusRoom`
   * first, and put fill lights in the nearest rooms that still have lights without one.
   */
  assign(lights: VirtualLight[], rooms: PoolRoom[], focus: THREE.Vector3, focusRoom: string | null) {
    const p = new THREE.Vector3()
    const ranked = lights
      .filter((v) => v.intensity > 0)
      .map((v) => {
        const at = v.anchor.getWorldPosition(p).clone()
        return { v, at, d: at.distanceTo(focus) + (focusRoom && v.room !== focusRoom ? OTHER_ROOM : 0) }
      })
      .sort((a, b) => a.d - b.d)
    // Output (and its color) per room of the lights that don't get a real one.
    const left = new Map<string, { flux: number; color: THREE.Color }>()
    const hand = <L extends THREE.Light>(kind: VirtualLight['kind'], slots: L[], apply: (l: L, v: VirtualLight, at: THREE.Vector3) => void) => {
      let i = 0
      for (const { v, at } of ranked) {
        if (v.kind !== kind) continue
        if (i < slots.length) {
          const l = slots[i++]
          l.color.copy(v.color)
          l.intensity = v.intensity
          apply(l, v, at)
        } else if (v.room) {
          const f = flux(v)
          const r = left.get(v.room) ?? { flux: 0, color: new THREE.Color(0, 0, 0) }
          r.flux += f
          r.color.r += v.color.r * f
          r.color.g += v.color.g * f
          r.color.b += v.color.b * f
          left.set(v.room, r)
        }
      }
      for (; i < slots.length; i++) slots[i].intensity = 0
    }
    hand('spot', this.spots, (l, v, at) => {
      l.angle = v.angle ?? 0.5
      l.penumbra = v.penumbra ?? 0.65
      l.position.copy(at)
      l.target.position.set(at.x, at.y - 1, at.z)
    })
    hand('point', this.points, (l, _v, at) => l.position.copy(at))
    const q = new THREE.Quaternion()
    hand('rect', this.rects, (l, v, at) => {
      l.position.copy(at)
      l.quaternion.copy(v.anchor.getWorldQuaternion(q))
      l.width = v.width ?? 1
      l.height = v.height ?? 1
    })

    // Fill lights in the nearest rooms that still have some.
    const fillRooms = rooms
      .filter((r) => left.has(r.id))
      .map((r) => ({ r, at: r.anchor.getWorldPosition(p).clone() }))
      .sort((a, b) => a.at.distanceTo(focus) - b.at.distanceTo(focus))
    const scale = new THREE.Vector3()
    this.fills.forEach((l, i) => {
      const f = fillRooms[i]
      if (!f) {
        l.intensity = 0
        return
      }
      const out = left.get(f.r.id)!
      l.position.copy(f.at)
      l.intensity = (out.flux / (4 * Math.PI)) * (f.r.id === focusRoom ? FOCUS_FILL_GAIN : FILL_GAIN)
      l.distance = f.r.reach * f.r.anchor.getWorldScale(scale).x
      l.color.copy(out.color).multiplyScalar(1 / out.flux)
    })
    this.group.updateMatrixWorld(true)
  }
}
