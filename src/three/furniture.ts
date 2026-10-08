/**
 * Detailed 3D models for furniture, fittings, doors and windows.
 *
 * Everything is in cm, in the symbol's local frame: X across its width, Y up from the floor, Z from
 * back (-depth/2, against the wall) to front (+depth/2). For doors and windows Z runs through the
 * wall, with +Z facing into the room.
 *
 * Models are built from many small parts, then merged per material (`compact`) so the extra detail
 * costs few draw calls.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { inwardNormal, signedArea } from '@/model/geometry'
import { openSides } from '@/model/guides'
import type { Side } from '@/model/guides'
import { personLook, restOn } from '@/model/people'
import { nicheDepth } from '@/model/walls'
import { worktopMaterial } from './worktops'
import {
  chairsAlong,
  cornerArm,
  curtainLayers,
  curtainPanels,
  frameOf,
  hasGlass,
  islandOverhang,
  islandStools,
  panelWidth,
  seatsAlong,
  SOFA,
  startsShut,
  styleOf,
  vanityMirror,
  vanitySinks,
  worktopOf,
} from '@/model/symbols'
import type { PlanSymbol, Point, Room } from '@/model/types'

export const COLORS = {
  wall: '#f4f4f5',
  slab: '#a8a29e',
  wood: '#b08968',
  woodDark: '#7f5539',
  woodLight: '#d2b48c',
  fabric: '#94a3b8',
  fabricLight: '#a9b6c8',
  fabric2: '#cbd5e1',
  headboard: '#64748b',
  accent: '#d08c3c',
  accent2: '#9f5f80',
  white: '#fafaf9',
  ceramic: '#f8fafc',
  metal: '#b4b4bb',
  chrome: '#e4e4e7',
  dark: '#3f3f46',
  black: '#18181b',
  screen: '#0b1220',
  sheet: '#e0e7ff',
  linen: '#f5f5f4',
  pot: '#9a3412',
  soil: '#3b2a20',
  leaves: ['#4d7c0f', '#65a30d', '#3f6212'],
  stone: '#d6d3d1',
  glass: '#bae6fd',
  door: '#d6c3a5',
  barn: '#6f4e37',
  barnDark: '#4a3222',
  frame: '#f5f5f4',
  mirror: '#d5dee8',
  light: '#fef9c3',
  books: ['#b91c1c', '#1d4ed8', '#15803d', '#a16207', '#6b21a8', '#334155', '#e7e5e4', '#0f766e'],
}

export type Finish = 'matte' | 'fabric' | 'wood' | 'satin' | 'gloss' | 'metal' | 'chrome' | 'leaf' | 'ceramic' | 'cloth'

const FINISHES: Record<Finish, { roughness: number; metalness: number; flat?: boolean; double?: boolean }> = {
  matte: { roughness: 0.85, metalness: 0 },
  fabric: { roughness: 0.97, metalness: 0 },
  wood: { roughness: 0.6, metalness: 0 },
  satin: { roughness: 0.45, metalness: 0 },
  gloss: { roughness: 0.18, metalness: 0 },
  metal: { roughness: 0.35, metalness: 0.5 },
  chrome: { roughness: 0.12, metalness: 0.45 },
  leaf: { roughness: 0.8, metalness: 0, flat: true },
  ceramic: { roughness: 0.15, metalness: 0, double: true },
  cloth: { roughness: 0.95, metalness: 0, double: true },
}

/** Caches materials per color and finish so the scene uses as few as possible. */
export class Materials {
  private cache = new Map<string, THREE.Material>()

  get(color: string, highlight = false, finish: Finish = 'matte'): THREE.MeshStandardMaterial {
    const key = `${color}|${highlight}|${finish}`
    let m = this.cache.get(key) as THREE.MeshStandardMaterial | undefined
    if (!m) {
      const f = FINISHES[finish]
      m = new THREE.MeshStandardMaterial({ color, roughness: f.roughness, metalness: f.metalness, flatShading: !!f.flat })
      if (f.double) m.side = THREE.DoubleSide
      if (highlight) {
        m.emissive = new THREE.Color('#2563eb')
        m.emissiveIntensity = 0.45
      }
      this.cache.set(key, m)
    }
    return m
  }

  glass(): THREE.Material {
    let m = this.cache.get('glass')
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: COLORS.glass,
        transparent: true,
        opacity: 0.35,
        roughness: 0.1,
        metalness: 0.1,
        depthWrite: false,
      })
      this.cache.set('glass', m)
    }
    return m
  }

  /** See-through fabric (sheer curtains, screen blinds), in a color. */
  sheer(color: string, opacity: number): THREE.Material {
    const key = `sheer|${color}|${opacity}`
    let m = this.cache.get(key)
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 1, side: THREE.DoubleSide, depthWrite: false })
      this.cache.set(key, m)
    }
    return m
  }

  /** Tinted (bronze) glass, for wardrobe doors. */
  tinted(): THREE.Material {
    let m = this.cache.get('tinted')
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: '#6b5a48', transparent: true, opacity: 0.5, roughness: 0.08, metalness: 0.2, depthWrite: false })
      this.cache.set('tinted', m)
    }
    return m
  }

  emissive(color: string): THREE.Material {
    const key = `emissive|${color}`
    let m = this.cache.get(key)
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 })
      this.cache.set(key, m)
    }
    return m
  }
}

// ---------------------------------------------------------------------------
// Primitives. Each returns a mesh whose bottom sits at `y`, centered on (x, z).

type Mat = THREE.Material

function mesh(geo: THREE.BufferGeometry, mat: Mat) {
  const m = new THREE.Mesh(geo, mat)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

export function box(w: number, h: number, d: number, x: number, y: number, z: number, mat: Mat) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y + h / 2, z)
  return m
}

/** Box with softened edges (cushions, cabinets, ceramics). */
function rbox(w: number, h: number, d: number, r: number, x: number, y: number, z: number, mat: Mat) {
  const radius = Math.max(0.05, Math.min(r, w / 2 - 0.05, h / 2 - 0.05, d / 2 - 0.05))
  const m = mesh(new RoundedBoxGeometry(w, h, d, 2, radius), mat)
  m.position.set(x, y + h / 2, z)
  return m
}

export function cylinder(r: number, h: number, x: number, y: number, z: number, mat: Mat, scaleZ = 1, rBottom = r, segments = 28) {
  const m = mesh(new THREE.CylinderGeometry(r, rBottom, h, segments), mat)
  m.position.set(x, y + h / 2, z)
  m.scale.z = scaleZ
  return m
}

/** Tapered round leg. */
function leg(x: number, z: number, h: number, mat: Mat, rTop = 2, rBottom = 1.4) {
  return cylinder(rTop, h, x, 0, z, mat, 1, rBottom, 12)
}

/** Solid of revolution from a (radius, height) profile. */
function lathe(profile: [number, number][], x: number, y: number, z: number, mat: Mat, segments = 36) {
  const m = mesh(new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), segments), mat)
  m.position.set(x, y, z)
  return m
}

function blob(r: number, x: number, y: number, z: number, mat: Mat, sy = 1) {
  const m = mesh(new THREE.IcosahedronGeometry(r, 1), mat)
  m.position.set(x, y, z)
  m.scale.y = sy
  return m
}

/** Deterministic pseudo-random numbers, so a model looks the same every time it's built. */
function random(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return () => {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    return (h >>> 0) / 4294967296
  }
}

const CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
]

/** Merge a model's meshes per material: the detail stays, the draw calls don't. */
export function compact(g: THREE.Group): THREE.Group {
  g.updateMatrixWorld(true)
  const byMat = new Map<Mat, THREE.BufferGeometry[]>()
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
    o.geometry.dispose()
    geo.applyMatrix4(o.matrixWorld)
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k)
    geo.clearGroups()
    const list = byMat.get(o.material) ?? []
    list.push(geo)
    byMat.set(o.material, list)
  })
  const out = new THREE.Group()
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos)
    geos.forEach((x) => x.dispose())
    if (!merged) continue
    const m = new THREE.Mesh(merged, mat)
    m.castShadow = !mat.transparent
    m.receiveShadow = true
    out.add(m)
  }
  return out
}

/** Like `compact`, but moving door parts (see `DoorPart`) stay separate pieces, so they can still open and close. */
function compactModel(g: THREE.Group): THREE.Group {
  const parts = g.children.filter((c) => c.userData.door)
  if (!parts.length) return compact(g)
  parts.forEach((p) => g.remove(p))
  const out = compact(g)
  for (const p of parts) {
    const wrap = new THREE.Group()
    wrap.add(...p.children)
    const piece = new THREE.Group()
    piece.position.copy(p.position)
    piece.rotation.copy(p.rotation)
    piece.userData.door = p.userData.door
    const merged = compact(wrap).children
    if (merged.length) piece.add(...merged)
    out.add(piece)
  }
  return out
}

/**
 * A moving part of a door, curtain or blind: a leaf turning about its hinge (`angle` to close it), a panel sliding
 * (`slide` along x to open it), a curtain panel gathering toward its end of the track (`gather`), or a blind's fabric
 * rolling up (`roll`; its bottom bar rising with it).
 */
export interface DoorPart {
  angle?: number
  slide?: number
  gather?: { span: number; fabric: number; openTo: number }
  roll?: { full: number; openTo: number; bar?: boolean; y0?: number }
  /** Starts shut (curtains and blinds drawn so as designed); doors start open. */
  startOpen?: boolean
}

/** How deep a panel of curtain folds: the same fabric over less width folds deeper. */
function drapeAmp(fabric: number, width: number) {
  const n = Math.max(2, Math.round(fabric / 14))
  return Math.min(8, Math.max(1.2, Math.sqrt(Math.max(0, (fabric / n / 2) ** 2 - (width / n / 2) ** 2)) / 2))
}

/** Put a door, curtain or blind part in place, from shut (0) to open (1: a curtain or blind as far as it opens). */
export function poseDoor(o: THREE.Object3D, open: number) {
  const d = o.userData.door as DoorPart
  if (d.angle !== undefined) o.rotation.y = (1 - open) * d.angle
  if (d.slide !== undefined) o.position.x = open * d.slide
  if (d.gather) {
    const { span, fabric, openTo } = d.gather
    const wp = panelWidth(span, open * openTo)
    o.scale.x = wp / span
    o.scale.z = drapeAmp(fabric, wp) / drapeAmp(fabric, span)
  }
  if (d.roll) {
    const { full, openTo, bar, y0 = 0 } = d.roll
    const len = Math.max(1, full * (1 - open * openTo))
    if (bar) o.position.y = y0 + (full - len)
    else o.scale.y = len / full
  }
  o.userData.open = open
}

/** A leaf built in its open position that turns about a hinge at (hx, z0) to close. */
function hinged(hx: number, z0: number, closeAngle: number, build: (g: THREE.Group) => void) {
  const pivot = new THREE.Group()
  pivot.position.set(hx, 0, z0)
  const inner = new THREE.Group()
  inner.position.set(-hx, 0, -z0)
  build(inner)
  pivot.add(inner)
  pivot.userData.door = { angle: closeAngle } satisfies DoorPart
  return pivot
}

/** A panel built in its closed position that slides `slide` along x to open. */
function sliding(slide: number, build: (g: THREE.Group) => void) {
  const g = new THREE.Group()
  build(g)
  g.userData.door = { slide } satisfies DoorPart
  return g
}

// ---------------------------------------------------------------------------
// People

/** A rounded limb from a to b. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: Mat, rEnd = r) {
  const dir = b.clone().sub(a)
  const len = dir.length()
  const m =
    rEnd === r
      ? mesh(new THREE.CapsuleGeometry(r, Math.max(0.1, len), 4, 12), mat)
      : mesh(new THREE.CylinderGeometry(rEnd, r, Math.max(0.1, len), 14), mat)
  m.position.copy(a).addScaledVector(dir, 0.5)
  if (len > 0) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  return m
}

/** An ellipsoid (radii x, y, z) centered at the point. */
function ellipsoid(rx: number, ry: number, rz: number, at: THREE.Vector3, mat: Mat, cap = 1) {
  const m = mesh(new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * cap), mat)
  m.scale.set(rx, ry, rz)
  m.position.copy(at)
  return m
}

/**
 * A person: H tall and W across the shoulders, skin, hair, top, trousers and shoes, in their plan footprint (front
 * toward +z). Standing on the floor; sitting on what they're on (`on.height` up, the floor without it), leaning back
 * into a sofa; or lying on it (head at the back of the footprint, on a pillow in bed).
 */
export function personModel(sym: PlanSymbol, mats: Materials, hl: boolean, on?: { height: number; type: string }): THREE.Group {
  const H = sym.height
  const W = sym.width
  const D = sym.depth
  const pose = sym.pose ?? 'stand'
  const look = personLook(sym)
  const m = {
    skin: mats.get(look.skin, hl, 'satin'),
    hair: mats.get(look.hair, hl, 'fabric'),
    top: mats.get(look.top, hl, 'fabric'),
    trousers: mats.get(look.trousers, hl, 'fabric'),
    shoes: mats.get(look.shoes, hl, 'satin'),
    eyes: mats.get('#2b2522', hl, 'gloss'),
  }
  const { lean, raise } = restOn(on?.type)
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  // Children have bigger heads for their size.
  const headK = H < 150 ? 1 + (150 - H) / 220 : 1
  const r = { thigh: W * 0.135, shin: W * 0.1, ankle: W * 0.07, arm: W * 0.085, fore: W * 0.07, hand: W * 0.075, neck: W * 0.085 }
  const hipY = H * 0.52

  /**
   * Hips up, its pivot at the hips (so it can lean): waist, chest, shoulders, neck and head with hair. `tilt` leans it
   * (negative: back). Arms are added separately, so hands can stay on the lap.
   */
  const upperBody = (tilt: number) => {
    const u = new THREE.Group()
    // Hips and torso as smooth bodies of revolution, flattened front to back.
    const body = (profile: [number, number][], mat: Mat) => {
      const b = mesh(new THREE.LatheGeometry(profile.map(([rx, y]) => new THREE.Vector2(rx * W, y * H)), 32), mat)
      b.scale.z = 0.56
      return b
    }
    u.add(body([[0.01, -0.075], [0.33, -0.07], [0.41, -0.035], [0.41, 0.02], [0.385, 0.06]], m.trousers))
    u.add(body([[0.39, 0.035], [0.37, 0.09], [0.42, 0.16], [0.465, 0.23], [0.47, 0.265], [0.36, 0.295], [0.13, 0.31], [0.001, 0.312]], m.top))
    for (const s of [-1, 1]) u.add(ellipsoid(W * 0.12, W * 0.12, W * 0.13, v(s * (W / 2 - W * 0.12), H * 0.27, 0), m.top))
    u.add(cylinder(r.neck, H * 0.05, 0, H * 0.3, W * 0.02, m.skin))
    const head = v(0, H * 0.37 + H * 0.06 * (headK - 1), W * 0.03)
    const hx = H * 0.043 * headK
    const hy = H * 0.062 * headK
    const hz = H * 0.053 * headK
    u.add(ellipsoid(hx, hy, hz, head, m.skin))
    for (const s of [-1, 1]) u.add(ellipsoid(hx * 0.18, hy * 0.24, hz * 0.14, v(s * hx * 0.98, head.y, head.z - hz * 0.05), m.skin)) // ears
    u.add(ellipsoid(hx * 0.16, hy * 0.17, hz * 0.2, v(0, head.y - hy * 0.12, head.z + hz * 0.95), m.skin)) // nose
    for (const s of [-1, 1]) {
      u.add(ellipsoid(hx * 0.11, hy * 0.08, hz * 0.06, v(s * hx * 0.36, head.y + hy * 0.06, head.z + hz * 0.9), m.eyes))
      u.add(ellipsoid(hx * 0.2, hy * 0.035, hz * 0.06, v(s * hx * 0.37, head.y + hy * 0.2, head.z + hz * 0.88), m.hair)) // brows
    }
    // Hair: a cap over the top and back of the head; long hair falls to the shoulders.
    const cap = ellipsoid(hx * 1.07, hy * 1.04, hz * 1.08, v(head.x, head.y + hy * 0.08, head.z - hz * 0.06), m.hair, 0.5)
    cap.rotation.x = -0.35
    u.add(cap)
    if (look.longHair) u.add(rbox(hx * 1.9, hy * 1.5, hz * 0.7, hz * 0.3, 0, head.y - hy * 1.25, head.z - hz * 0.65, m.hair))
    u.position.y = hipY
    u.rotation.x = tilt
    return u
  }
  /** A point on the upper body (hip-relative, before it leans), where it ends up once it leans. */
  const onUpper = (p: THREE.Vector3, tilt: number, at: THREE.Vector3) => p.clone().applyAxisAngle(v(1, 0, 0), tilt).add(at)

  const g = new THREE.Group()
  const standing = (raiseBy = 0) => {
    const s = new THREE.Group()
    for (const side of [-1, 1]) {
      const x = side * W * 0.19
      s.add(limb(v(x, hipY, 0), v(x, H * 0.28, 0.5), r.thigh, m.trousers, r.shin * 1.15))
      s.add(limb(v(x, H * 0.28, 0.5), v(x, H * 0.065, 0), r.shin * 1.15, m.trousers, r.ankle))
      s.add(rbox(W * 0.2, H * 0.05, H * 0.15, 2.5, x, 0, H * 0.04, m.shoes))
    }
    s.add(upperBody(raiseBy))
    // Arms hang at the sides.
    for (const side of [-1, 1]) {
      const at = v(0, hipY, 0)
      const shoulder = onUpper(v(side * (W / 2 - r.arm * 0.7), H * 0.285, 0), raiseBy, at)
      const elbow = onUpper(v(side * (W / 2 - r.arm * 0.4), H * 0.125, -1), raiseBy, at)
      const wrist = onUpper(v(side * (W / 2 - r.arm * 0.6), -H * 0.035, 2), raiseBy, at)
      s.add(limb(shoulder, elbow, r.arm, m.top))
      s.add(limb(elbow, wrist, r.fore, m.top, r.fore * 0.85))
      s.add(ellipsoid(r.hand * 0.8, r.hand * 1.4, r.hand, wrist.clone().add(v(0, -r.hand, 0)), m.skin))
    }
    return s
  }

  if (pose === 'lie') {
    // Standing, laid on its back: head toward -z, toes up, back on the surface; head and shoulders up on the pillow.
    const s = standing(raise)
    s.rotation.x = -Math.PI / 2
    s.position.set(0, (on?.height ?? 0) + W * 0.25 + 1, H / 2)
    g.add(s)
    return g
  }
  if (pose === 'sit') {
    const S = on?.height ?? 0
    const zb = -D / 2 + W * 0.25 // the middle of the torso, front to back
    const seatY = S + r.thigh
    const kneeZ = zb + H * 0.245
    const onFloor = S < 15
    const tilt = -lean
    for (const side of [-1, 1]) {
      const x = side * W * 0.19
      g.add(limb(v(x, seatY, zb + 3), v(x, seatY, kneeZ), r.thigh, m.trousers, r.shin * 1.15))
      if (onFloor) {
        // On the floor: legs out in front.
        g.add(limb(v(x, seatY, kneeZ), v(x, r.ankle, kneeZ + H * 0.22), r.shin * 1.15, m.trousers, r.ankle))
        g.add(rbox(W * 0.2, H * 0.12, H * 0.05, 2.5, x, 0, kneeZ + H * 0.25, m.shoes))
      } else {
        const ankleY = Math.max(H * 0.065, seatY - H * 0.215)
        g.add(limb(v(x, seatY, kneeZ), v(x, ankleY, kneeZ + 3), r.shin * 1.15, m.trousers, r.ankle))
        g.add(rbox(W * 0.2, H * 0.05, H * 0.15, 2.5, x, ankleY - H * 0.065, kneeZ + H * 0.06, m.shoes))
      }
    }
    const body = upperBody(tilt)
    body.position.set(0, seatY - H * 0.01, zb)
    g.add(body)
    // Arms from the shoulders, hands resting on the thighs.
    const at = body.position.clone()
    for (const side of [-1, 1]) {
      const shoulder = onUpper(v(side * (W / 2 - r.arm * 0.7), H * 0.285, 0), tilt, at)
      const hand = v(side * W * 0.23, seatY + r.thigh + 2, zb + H * 0.15)
      const elbow = v(side * (W / 2 - r.arm * 0.2), (shoulder.y + hand.y) / 2 - H * 0.03, (shoulder.z + hand.z) / 2 - H * 0.04)
      g.add(limb(shoulder, elbow, r.arm, m.top))
      g.add(limb(elbow, hand, r.fore, m.top, r.fore * 0.85))
      g.add(ellipsoid(r.hand * 0.8, r.hand * 0.6, r.hand * 1.4, hand.clone().add(v(0, 0, r.hand * 1.2)), m.skin))
    }
    return g
  }
  g.add(standing())
  g.position.z = -D / 2 + W * 0.25
  const out = new THREE.Group()
  out.add(g)
  return out
}

// ---------------------------------------------------------------------------
// Models

interface Kit {
  q: (color: string, finish?: Finish) => Mat
  glass: () => Mat
  tinted: () => Mat
  sheer: (color: string, opacity: number) => Mat
  /** The item's worktop (or `id`'s), laid by where it is in the room. */
  top: (id?: string) => Mat
}

function chair(k: Kit, x: number, z: number, rotDeg: number, w = 44, d = 46) {
  const g = new THREE.Group()
  const wood = k.q(COLORS.wood, 'wood')
  const seatY = 45
  for (const sx of [-1, 1]) {
    g.add(leg(sx * (w / 2 - 3), d / 2 - 3, seatY - 3, wood, 1.8, 1.3))
    // Back legs rise to form the back posts.
    g.add(box(3, 86, 3, sx * (w / 2 - 3), 0, -d / 2 + 2.5, wood))
  }
  g.add(box(w - 2, 5, d - 4, 0, seatY - 6, 0, wood)) // seat frame
  g.add(rbox(w - 3, 5, d - 5, 2, 0, seatY - 2, 0.5, k.q(COLORS.fabric2, 'fabric'))) // cushion
  g.add(rbox(w - 4, 13, 2.6, 1.2, 0, 70, -d / 2 + 2.5, wood)) // top rail
  g.add(box(w - 6, 3, 2, 0, 57, -d / 2 + 2.5, wood)) // lower rail
  g.position.set(x, 0, z)
  g.rotation.y = (-rotDeg * Math.PI) / 180
  return g
}

function table(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const top = 3.5
  g.add(rbox(w, top, d, 1.2, 0, h - top, 0, k.q(COLORS.wood, 'wood')))
  g.add(box(w - 12, 8, d - 12, 0, h - top - 8, 0, k.q(COLORS.woodDark, 'wood'))) // apron
  for (const [sx, sz] of CORNERS) g.add(box(5, h - top, 5, sx * (w / 2 - 6), 0, sz * (d / 2 - 6), k.q(COLORS.woodDark, 'wood')))
  return g
}

function coffeeTable(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  g.add(rbox(w, 4, d, 1.5, 0, h - 4, 0, k.q(COLORS.wood, 'wood')))
  g.add(rbox(w - 10, 2, d - 10, 0.8, 0, 12, 0, k.q(COLORS.woodDark, 'wood'))) // lower shelf
  for (const [sx, sz] of CORNERS) g.add(leg(sx * (w / 2 - 5), sz * (d / 2 - 5), h - 4, k.q(COLORS.woodDark, 'wood'), 2.2, 1.6))
  // A couple of books and a bowl, so it looks lived in.
  g.add(rbox(24, 2.5, 17, 0.4, -w * 0.2, h, 0, k.q(COLORS.books[1], 'satin')))
  g.add(rbox(21, 2, 15, 0.4, -w * 0.2 + 1, h + 2.5, 0.5, k.q(COLORS.books[6], 'satin')))
  g.add(lathe([[0, 0], [5, 0], [9, 6], [9.5, 6.5], [0.1, 1.2]], w * 0.2, h, 0, k.q(COLORS.ceramic, 'ceramic')))
  return g
}

// ---------- Air conditioning ----------

const AC_WHITE = '#f3f3f1'
const AC_DARK = '#2b2d31'

/** A disc facing the front (+z), r across, at (x, y, z). */
function disc(r: number, depth: number, x: number, y: number, z: number, mat: Mat) {
  const m = mesh(new THREE.CylinderGeometry(r, r, depth, 36), mat)
  m.rotation.x = Math.PI / 2
  m.position.set(x, y, z)
  return m
}

/** A wall split unit: a rounded white casing, the outlet and its flap along the bottom front, a small display. */
function acSplit(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const white = k.q(AC_WHITE, 'satin')
  const dark = k.q(AC_DARK, 'satin')
  g.add(rbox(w, h, d, Math.min(7, h * 0.28), 0, 0, 0, white))
  g.add(box(w - 12, h * 0.16, 1, 0, h * 0.06, d / 2 - 0.6, dark)) // outlet
  const flap = box(w - 14, 0.8, 7, 0, h * 0.04, d / 2 - 1, white)
  flap.rotation.x = 0.55
  g.add(flap)
  for (let i = 0; i < 6; i++) g.add(box(w - 16, 0.3, 0.7, 0, h - 0.2, -d / 2 + 4 + i * 2.2, dark)) // intake on top
  g.add(box(9, 2.2, 0.4, w / 2 - 15, h * 0.52, d / 2 + 0.05, dark)) // display
  g.add(box(0.9, 0.9, 0.3, w / 2 - 9, h * 0.52 + 0.65, d / 2 + 0.2, k.q('#38bdf8', 'gloss')))
  return g
}

/** A ceiling cassette: a flush panel with an intake grille in the middle and an outlet slot along each side. */
function acCassette(k: Kit, w: number, d: number, top: number) {
  const g = new THREE.Group()
  const white = k.q(AC_WHITE, 'satin')
  const dark = k.q(AC_DARK, 'satin')
  g.add(rbox(w, 3, d, 1, 0, top - 3, 0, white))
  const gw = w * 0.5
  const gd = d * 0.5
  g.add(box(gw, 0.4, gd, 0, top - 3.3, 0, k.q('#e2e2df', 'satin')))
  for (let i = 1; i < 8; i++) g.add(box(gw - 2, 0.2, 0.4, 0, top - 3.45, -gd / 2 + (gd * i) / 8, k.q('#c9c9c5', 'satin')))
  const s = Math.min(w, d) * 0.36
  for (const v of [-1, 1]) {
    g.add(box(s, 0.5, 4, 0, top - 3.4, v * (d / 2 - 7), dark))
    g.add(box(4, 0.5, s, v * (w / 2 - 7), top - 3.4, 0, dark))
  }
  return g
}

/** A linear slot diffuser of a ducted system: a white frame flush in the ceiling with two dark slots. */
function acSlot(k: Kit, w: number, d: number, top: number) {
  const g = new THREE.Group()
  g.add(box(w, 1, d, 0, top - 1, 0, k.q(AC_WHITE, 'satin')))
  for (const v of [-1, 1]) g.add(box(w - 4, 0.4, d * 0.22, 0, top - 1.2, (v * d) / 5, k.q(AC_DARK, 'satin')))
  return g
}

/** A floor-standing unit: a tall slim casing, its vertical outlet up the front, a display, and a dark base. */
function acFloor(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const white = k.q(AC_WHITE, 'satin')
  const dark = k.q(AC_DARK, 'satin')
  g.add(box(w * 0.92, 5, d * 0.92, 0, 0, 0, dark))
  g.add(rbox(w, h - 5, d, 5, 0, 5, 0, white))
  g.add(rbox(w * 0.5, h * 0.36, 1.2, 0.5, 0, h * 0.56, d / 2 - 0.4, dark)) // outlet
  for (let i = 0; i < 9; i++) g.add(box(0.5, h * 0.34, 1, -w * 0.22 + (w * 0.44 * i) / 8, h * 0.57, d / 2 + 0.1, white)) // louvres
  g.add(box(w * 0.28, 4, 0.4, 0, h * 0.44, d / 2 + 0.05, dark)) // display
  for (let i = 0; i < 10; i++) g.add(box(w * 0.7, 0.4, 0.6, 0, 12 + i * 2.2, d / 2 - 0.1, dark)) // intake at the bottom
  return g
}

/** An outdoor unit: a grey casing with a fan behind a round grille, side vents and feet. */
function acOutdoor(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const casing = k.q('#d9dad6', 'satin')
  const dark = k.q('#3a3c40', 'metal')
  for (const sx of [-1, 1]) g.add(box(6, 4, d - 4, sx * (w / 2 - 8), 0, 0, dark)) // feet
  g.add(rbox(w, h - 4, d, 1.5, 0, 4, 0, casing))
  const r = Math.min(w * 0.3, (h - 4) * 0.4)
  const cx = -w * 0.12
  const cy = 4 + (h - 4) / 2
  g.add(disc(r, 1, cx, cy, d / 2 - 0.3, dark))
  for (let i = 1; i <= 4; i++) {
    const ring = mesh(new THREE.TorusGeometry((r * i) / 4.4, 0.35, 6, 32), casing)
    ring.position.set(cx, cy, d / 2 + 0.3)
    g.add(ring)
  }
  g.add(box(r * 2, 0.6, 0.6, cx, cy - 0.3, d / 2 + 0.4, casing))
  g.add(box(0.6, r * 2, 0.6, cx, cy - r, d / 2 + 0.4, casing))
  for (let i = 0; i < 8; i++) g.add(box(w * 0.18, 0.5, 0.6, w / 2 - w * 0.14, 10 + i * ((h - 18) / 8), d / 2, dark)) // vents
  return g
}

// ---------- Dressing table ----------

/** A dressing table: drawers either side of a knee space, legs, its mirror (framed, round or ringed with bulbs) and stool. */
function dressingTable(k: Kit, sym: PlanSymbol, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const style = styleOf(sym)
  const body = style === 'classic' ? k.q(COLORS.wood, 'wood') : k.q('#f2f0ea', 'satin')
  const trim = style === 'classic' ? k.q(COLORS.woodDark, 'wood') : k.q('#c9a86a', 'metal')
  const glass = k.q('#dbe6ec', 'gloss')
  g.add(rbox(w, 3, d, 1, 0, h - 3, 0, body))
  // Drawers either side, a shallow one over the knee space.
  const dw = w * 0.3
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - dw / 2)
    g.add(rbox(dw, h * 0.45, d - 2, 1, x, h * 0.55 - 3, -1, body))
    for (const y of [h * 0.55 + 1, h * 0.55 + h * 0.22]) {
      g.add(box(dw - 4, h * 0.2, 0.8, x, y - 1, d / 2 - 1.5, body))
      g.add(cylinder(0.9, 1.6, x, y + h * 0.09, d / 2, trim))
    }
    for (const sz of [-1, 1]) g.add(leg(x + s * (dw / 2 - 3), sz * (d / 2 - 4), h * 0.55 - 3, trim, 1.8, 1.3))
  }
  g.add(box(w - dw * 2, 10, d - 2, 0, h - 13, -1, body))
  // The mirror on the back of the top.
  const m = vanityMirror(sym)
  const z = -d / 2 + 4
  if (m.round) {
    const r = m.w / 2
    const ring = mesh(new THREE.TorusGeometry(r, 1.6, 10, 48), trim)
    ring.position.set(0, h + m.bottom + r, z)
    g.add(ring)
    g.add(disc(r - 0.5, 0.6, 0, h + m.bottom + r, z, glass))
    g.add(box(4, m.bottom + 2, 4, 0, h, z, trim)) // stand
  } else {
    g.add(rbox(m.w, m.h, 3, 1, 0, h + m.bottom, z - 1, style === 'hollywood' ? body : trim))
    g.add(box(m.w - 6, m.h - 6, 0.5, 0, h + m.bottom + 3, z + 0.7, glass))
    if (style === 'hollywood') {
      // Bulbs up the sides and across the top.
      const bulb = k.q('#fff7e6', 'gloss')
      const n = 5
      for (let i = 0; i < n; i++) {
        const y = h + m.bottom + 8 + ((m.h - 16) * i) / (n - 1)
        for (const s of [-1, 1]) g.add(blob(2.4, s * (m.w / 2 - 3), y, z + 2, bulb))
      }
      for (let i = 1; i < 4; i++) g.add(blob(2.4, -m.w / 2 + 3 + ((m.w - 6) * i) / 4, h + m.bottom + m.h - 3, z + 2, bulb))
    }
  }
  // Its stool, tucked in.
  if (sym.stool !== false) {
    const sz = d / 2 + 6
    g.add(cylinder(17, 8, 0, 38, sz, k.q(COLORS.accent2, 'fabric')))
    for (const [sx, s2] of CORNERS) g.add(leg(sx * 11, sz + s2 * 11, 38, trim, 1.4, 1.1))
  }
  return g
}

/** A sofa table: a slim top on a light frame, a shelf below, and a lamp and a few things on it. */
function sofaTable(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const wood = k.q(COLORS.wood, 'wood')
  const metal = k.q(COLORS.dark, 'metal')
  g.add(rbox(w, 3.5, d, 1, 0, h - 3.5, 0, wood))
  g.add(rbox(w - 8, 2, d - 6, 0.6, 0, 16, 0, wood)) // shelf
  for (const sx of [-1, 1]) {
    // A U-shaped steel end frame at each end.
    for (const sz of [-1, 1]) g.add(box(2.5, h - 3.5, 2.5, sx * (w / 2 - 4), 0, sz * (d / 2 - 3), metal))
    g.add(box(2.5, 2.5, d - 6, sx * (w / 2 - 4), 14, 0, metal))
  }
  // A lamp at one end, books and a vase at the other.
  const lx = w / 2 - Math.min(22, w * 0.18)
  g.add(cylinder(6, 2, lx, h, 0, metal))
  g.add(cylinder(1, 30, lx, h + 2, 0, metal))
  g.add(cylinder(9, 18, lx, h + 30, 0, k.q(COLORS.linen, 'fabric'), 1, 12))
  g.add(rbox(22, 3, 16, 0.4, -w / 2 + 20, h, 0, k.q(COLORS.books[2], 'satin')))
  g.add(rbox(20, 2.5, 15, 0.4, -w / 2 + 21, h + 3, 0, k.q(COLORS.books[5], 'satin')))
  g.add(lathe([[0, 0], [4, 0], [5, 6], [3, 14], [3.4, 18], [0.1, 18]], -w / 2 + 42, h, 0, k.q(COLORS.ceramic, 'ceramic')))
  return g
}

function sofa(k: Kit, w: number, d: number, h: number, seats: number) {
  const g = new THREE.Group()
  const frame = k.q(COLORS.fabric, 'fabric')
  const cushion = k.q(COLORS.fabricLight, 'fabric')
  const legH = 8
  const arm = seats === 1 ? Math.min(18, w * 0.17) : Math.min(20, w * 0.09)
  const backT = Math.min(20, d * 0.22)
  const seatTop = 44
  const inner = w - 2 * arm
  const cw = inner / seats

  g.add(rbox(inner + 2, seatTop - 12 - legH, d - backT, 2, 0, legH, backT / 2, frame)) // seat base
  g.add(rbox(w, h - legH, backT, 4, 0, legH, -d / 2 + backT / 2, frame)) // back
  for (const s of [-1, 1]) g.add(rbox(arm, h * 0.72 - legH, d, 5, s * (w / 2 - arm / 2), legH, 0, frame))
  for (let i = 0; i < seats; i++) {
    const x = -inner / 2 + cw * (i + 0.5)
    g.add(rbox(cw - 1, 13, d - backT - 1, 5, x, seatTop - 13, backT / 2, cushion))
    const back = rbox(cw - 2, (h - seatTop) * 0.95, 14, 6, x, seatTop - 1, -d / 2 + backT + 5, cushion)
    back.rotation.x = -0.12
    g.add(back)
  }
  if (seats > 1) {
    for (const s of [-1, 1]) {
      const p = rbox(36, 36, 11, 8, s * (inner / 2 - 22), seatTop - 3, -d / 2 + backT + 17, k.q(COLORS.accent, 'fabric'))
      p.rotation.set(-0.25, s * 0.25, s * 0.12)
      g.add(p)
    }
  }
  for (const [sx, sz] of CORNERS) g.add(leg(sx * (w / 2 - 6), sz * (d / 2 - 6), legH, k.q(COLORS.woodDark, 'wood'), 2, 1.5))
  return g
}

/** An L-shaped sofa: seats along the back and down the left side, arms at both open ends. */
function cornerSofa(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const frame = k.q(COLORS.fabric, 'fabric')
  const cushion = k.q(COLORS.fabricLight, 'fabric')
  const legH = 8
  const arm = Math.min(SOFA.arm, w * 0.12, d * 0.12)
  const back = Math.min(SOFA.back, d * 0.2, w * 0.2)
  const seat = Math.min(SOFA.seat, d * 0.6, w * 0.6)
  const seatTop = 44
  const L = -w / 2
  const T = -d / 2
  // Backs along the top and down the left.
  g.add(rbox(w, h - legH, back, 4, 0, legH, T + back / 2, frame))
  g.add(rbox(back, h - legH, d - back, 4, L + back / 2, legH, T + back + (d - back) / 2, frame))
  // Seat bases.
  const runX = w - back - arm
  const runY = d - seat - arm
  g.add(rbox(runX + 2, seatTop - 12 - legH, seat - back, 2, L + back + runX / 2, legH, T + back + (seat - back) / 2, frame))
  g.add(rbox(seat - back, seatTop - 12 - legH, runY + 2, 2, L + back + (seat - back) / 2, legH, T + seat + runY / 2, frame))
  // Arms at the two open ends.
  g.add(rbox(arm, h * 0.72 - legH, seat, 5, w / 2 - arm / 2, legH, T + seat / 2, frame))
  g.add(rbox(seat, h * 0.72 - legH, arm, 5, L + seat / 2, legH, d / 2 - arm / 2, frame))
  // Seat and back cushions: along the top run (including the corner), then down the side.
  const nx = seatsAlong(runX)
  const cx = runX / nx
  for (let i = 0; i < nx; i++) {
    const x = L + back + cx * (i + 0.5)
    g.add(rbox(cx - 1, 13, seat - back - 1, 5, x, seatTop - 13, T + back + (seat - back) / 2, cushion))
    const b = rbox(cx - 2, (h - seatTop) * 0.95, 14, 6, x, seatTop - 1, T + back + 5, cushion)
    b.rotation.x = -0.12
    g.add(b)
  }
  const ny = seatsAlong(runY)
  const cy = runY / ny
  for (let i = 0; i < ny; i++) {
    const z = T + seat + cy * (i + 0.5)
    g.add(rbox(seat - back - 1, 13, cy - 1, 5, L + back + (seat - back) / 2, seatTop - 13, z, cushion))
    const b = rbox(14, (h - seatTop) * 0.95, cy - 2, 6, L + back + 5, seatTop - 1, z, cushion)
    b.rotation.z = 0.12
    g.add(b)
  }
  // Two cushions in the corner.
  for (const [x, z, ry] of [
    [L + back + 22, T + back + 16, 0.6],
    [w / 2 - arm - 22, T + back + 16, -0.25],
  ] as const) {
    const p = rbox(36, 36, 11, 8, x, seatTop - 3, z, k.q(COLORS.accent, 'fabric'))
    p.rotation.set(-0.25, ry, 0)
    g.add(p)
  }
  const legs: [number, number][] = [
    [L + 6, T + 6],
    [w / 2 - 6, T + 6],
    [w / 2 - 6, T + seat - 6],
    [L + seat - 6, T + seat - 6],
    [L + seat - 6, d / 2 - 6],
    [L + 6, d / 2 - 6],
  ]
  for (const [x, z] of legs) g.add(leg(x, z, legH, k.q(COLORS.woodDark, 'wood'), 2, 1.5))
  return g
}

function bed(k: Kit, w: number, d: number, h: number, pillows: number) {
  const g = new THREE.Group()
  const legH = 8
  const frameTop = Math.max(legH + 14, h - 20)
  g.add(rbox(w, frameTop - legH, d, 2, 0, legH, 0, k.q(COLORS.woodDark, 'wood'))) // frame
  for (const [sx, sz] of CORNERS) g.add(box(5, legH, 5, sx * (w / 2 - 5), 0, sz * (d / 2 - 5), k.q(COLORS.woodDark, 'wood')))
  g.add(rbox(w - 6, h - frameTop + 2, d - 8, 6, 0, frameTop - 2, 1, k.q(COLORS.white, 'fabric'))) // mattress
  const duvetD = Math.max(d * 0.5, d - 60)
  const duvetZ = d / 2 - duvetD / 2 + 1
  g.add(rbox(w - 2, 10, duvetD + 2, 4, 0, h - 6, duvetZ, k.q(COLORS.sheet, 'fabric'))) // duvet, draping over the sides
  g.add(rbox(w - 1.5, 10.5, 14, 4, 0, h - 6, duvetZ - duvetD / 2 + 6, k.q(COLORS.linen, 'fabric'))) // folded-back sheet
  g.add(rbox(w - 1, 11, 32, 4, 0, h - 6, d / 2 - 20, k.q(COLORS.accent2, 'fabric'))) // throw at the foot
  const pw = (w - 16) / pillows
  for (let i = 0; i < pillows; i++) {
    const p = rbox(pw - 6, 13, 40, 6.5, -w / 2 + 8 + pw * (i + 0.5), h - 1, -d / 2 + 30, k.q(COLORS.white, 'fabric'))
    p.rotation.x = 0.22
    g.add(p)
  }
  g.add(rbox(w + 6, 110, 9, 4, 0, 0, -d / 2 + 4.5, k.q(COLORS.headboard, 'fabric'))) // upholstered headboard
  return g
}

/** A cabinet front with a handle; `pull` is 'bar' (horizontal), 'post' (vertical) or 'knob'. */
function front(
  k: Kit,
  g: THREE.Group,
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
  color: string,
  pull: 'bar' | 'post' | 'knob' | 'none',
  pullAt: 'top' | 'middle' | 'side' | 'bottom' = 'top',
  side = 1,
) {
  g.add(rbox(w, h, 1.8, 0.5, x, y, z, k.q(color, 'satin')))
  if (pull === 'none') return
  const hz = z + 1.6
  const metal = k.q(COLORS.chrome, 'chrome')
  if (pull === 'knob') g.add(mesh(new THREE.SphereGeometry(1.4, 12, 8), metal).translateX(x).translateY(y + h / 2).translateZ(hz))
  else if (pull === 'bar') g.add(box(Math.min(w * 0.5, 30), 1.2, 1.4, x, pullAt === 'top' ? y + h - 7 : pullAt === 'bottom' ? y + 5 : y + h / 2, hz, metal))
  else g.add(box(1.2, Math.min(h * 0.4, 34), 1.4, pullAt === 'side' ? x + side * (w / 2 - 5) : x, y + h / 2 - Math.min(h * 0.2, 17), hz, metal))
}

function nightstand(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const legH = 7
  g.add(rbox(w, h - legH - 2.5, d - 1, 1, 0, legH, -0.5, k.q(COLORS.wood, 'wood')))
  g.add(rbox(w + 1, 2.5, d + 0.5, 1, 0, h - 2.5, 0, k.q(COLORS.woodDark, 'wood')))
  for (const [sx, sz] of CORNERS) g.add(leg(sx * (w / 2 - 4), sz * (d / 2 - 4), legH, k.q(COLORS.woodDark, 'wood'), 1.5, 1))
  const dh = (h - legH - 2.5 - 3) / 2
  for (let i = 0; i < 2; i++) front(k, g, w - 3, dh - 1, 0, legH + 1 + i * dh, d / 2 - 0.4, COLORS.woodLight, 'knob')
  return g
}

interface WardrobeOpts {
  doors: 'hinged' | 'sliding'
  glass: boolean
  /** A plain panel instead of doors at the left end, this long (where a corner wardrobe's other run stands in front). */
  blind?: number
}

/** A glass door in a slim frame. */
function glassDoor(k: Kit, g: THREE.Group, w: number, h: number, x: number, y: number, z: number) {
  const frame = k.q(COLORS.dark, 'metal')
  const f = 3
  for (const s of [-1, 1]) g.add(box(f, h, 2, x + s * (w / 2 - f / 2), y, z, frame))
  for (const yy of [y, y + h - f]) g.add(box(w - 2 * f, f, 2, x, yy, z, frame))
  g.add(box(w - 2 * f, h - 2 * f, 0.6, x, y + f, z, k.tinted()))
}

/** What shows through glass doors: a rail of clothes and a shelf above. */
function wardrobeInside(k: Kit, g: THREE.Group, w: number, d: number, h: number, plinth: number) {
  const rand = random(`${w}x${d}x${h}`)
  g.add(box(w - 4, 1.8, d - 6, 0, h - 40, -1, k.q(COLORS.woodLight, 'wood')))
  const rail = cylinder(1, w - 6, 0, 0, 0, k.q(COLORS.chrome, 'chrome'), 1, 1, 10)
  rail.rotation.z = Math.PI / 2
  rail.position.set(0, h - 48, 0)
  g.add(rail)
  for (let x = -w / 2 + 8; x < w / 2 - 8; x += 7 + rand() * 6) {
    const len = 60 + rand() * 50
    g.add(box(3 + rand() * 2, len, d * 0.62, x, h - 50 - len, 0, k.q(COLORS.books[Math.floor(rand() * COLORS.books.length)], 'fabric')))
  }
  g.add(box(w - 4, 1.8, d - 6, 0, plinth + 1, -1, k.q(COLORS.woodLight, 'wood')))
}

/** A run of wardrobe, doors facing +z: hinged doors (handles meeting in pairs) or sliding ones on staggered tracks. */
function wardrobe(k: Kit, w: number, d: number, h: number, o: WardrobeOpts) {
  const g = new THREE.Group()
  const plinth = 8
  const wood = k.q(COLORS.wood, 'wood')
  g.add(box(w - 4, plinth, d - 6, 0, 0, -2, k.q(COLORS.dark, 'satin')))
  if (o.glass) {
    // Open inside: back, sides, top and bottom, with clothes behind the glass.
    g.add(box(w, h - plinth, 1.8, 0, plinth, -d / 2 + 0.9, wood))
    for (const s of [-1, 1]) g.add(box(1.8, h - plinth, d - 2, s * (w / 2 - 0.9), plinth, -1, wood))
    g.add(box(w, 1.8, d - 2, 0, h - 1.8, -1, wood))
    wardrobeInside(k, g, w, d, h, plinth)
  } else g.add(rbox(w, h - plinth, d - 2, 0.8, 0, plinth, -1, wood))
  const blind = o.blind ?? 0
  const x0 = -w / 2 + blind
  const span = w - blind
  const dh = h - plinth - 3
  const y = plinth + 1.5
  if (blind > 0) front(k, g, blind - 0.6, dh, -w / 2 + blind / 2, y, d / 2 - 1.2, COLORS.woodLight, 'none')
  const door = (dw: number, x: number, z: number, side: number) => {
    if (o.glass) {
      glassDoor(k, g, dw, dh, x, y, z)
      g.add(box(1.2, 34, 1.4, x + side * (dw / 2 - 6), y + dh / 2 - 17, z + 1.6, k.q(COLORS.chrome, 'chrome')))
    } else front(k, g, dw, dh, x, y, z, COLORS.woodLight, 'post', 'side', side)
  }
  if (o.doors === 'sliding') {
    // Two or three panels on two tracks, overlapping a little, under a top track.
    const n = span > 220 ? 3 : 2
    const pw = span / n + 2
    for (let i = 0; i < n; i++) door(pw, x0 + ((span - pw) * i) / (n - 1) + pw / 2, d / 2 - 1.2 + (i % 2 ? 2.4 : 0), i === 0 ? 1 : -1)
    g.add(box(span, 3, 5.5, x0 + span / 2, h - 3, d / 2 + 0.6, k.q(COLORS.metal, 'metal')))
  } else {
    const n = Math.max(1, Math.round(span / 55))
    const dw = span / n
    // Handles meet at the middle of each pair of doors.
    for (let i = 0; i < n; i++) door(dw - 0.6, x0 + dw * (i + 0.5), d / 2 - 1.2, i % 2 === 0 ? 1 : -1)
  }
  return g
}

const ORNAMENT_COLORS = ['#f5f1ea', '#1e3a8a', '#c9a45c', '#9cbfa7', '#b4664a', '#e7e1d6', '#3f4b5b', '#7c2d12']

/** Ornaments along a shelf from x0 to x1 at height y (up to maxH tall), in a cabinet `d` deep: vases, bowls, plates, figures. */
function ornaments(k: Kit, g: THREE.Group, rand: () => number, x0: number, x1: number, y: number, d: number, maxH: number) {
  let x = x0 + 3
  while (x < x1 - 8) {
    const kind = Math.floor(rand() * 4)
    const mat = k.q(ORNAMENT_COLORS[Math.floor(rand() * ORNAMENT_COLORS.length)], 'ceramic')
    const z = -d * 0.12 + (rand() - 0.5) * d * 0.15
    if (kind === 0) {
      // A vase.
      const vh = Math.min(maxH - 2, 12 + rand() * 18)
      const r = 2.5 + rand() * 3
      g.add(lathe([[0.1, 0], [r * 0.7, 0], [r, vh * 0.35], [r * 0.5, vh * 0.8], [r * 0.6, vh], [0.1, vh]], x + r, y, z, mat, 20))
      x += 2 * r + 4 + rand() * 4
    } else if (kind === 1) {
      // A bowl.
      const r = 5 + rand() * 4
      g.add(lathe([[0.1, 0], [r * 0.5, 0], [r, r * 0.5], [r * 0.95, r * 0.55], [0.1, 0.6]], x + r, y, z, mat, 24))
      x += 2 * r + 4
    } else if (kind === 2) {
      // A plate on its edge, leaning on the back.
      const r = Math.min(maxH / 2 - 1, 7 + rand() * 4)
      const plate = cylinder(r, 0.8, 0, 0, 0, mat, 1, r, 28)
      plate.rotation.x = Math.PI / 2 - 0.15
      plate.position.set(x + r, y + r, -d / 2 + 5)
      g.add(plate)
      x += 2 * r + 3
    } else {
      // A small figure: a body and a head.
      const r = 2 + rand() * 1.5
      const fh = Math.min(maxH - 5, 8 + rand() * 8)
      g.add(cylinder(r, fh, x + r, y, z, mat, 1, r * 1.2, 16))
      g.add(mesh(new THREE.SphereGeometry(r * 0.9, 14, 10), mat).translateX(x + r).translateY(y + fh + r * 0.7).translateZ(z))
      x += 2 * r + 5
    }
  }
}

/** Shelves of a cabinet with glass doors (or open), from y0 to y1: glass shelves with ornaments on each. */
function showcase(k: Kit, g: THREE.Group, seed: string, w: number, d: number, y0: number, y1: number) {
  const rand = random(seed)
  const levels = Math.max(1, Math.round((y1 - y0) / 34))
  const gap = (y1 - y0) / levels
  for (let i = 0; i < levels; i++) {
    const y = y0 + i * gap
    if (i > 0) g.add(box(w - 4, 0.8, d - 5, 0, y - 0.8, -0.5, k.glass()))
    ornaments(k, g, rand, -w / 2 + 2, w / 2 - 2, y, d - 4, gap - 3)
  }
}

/** A display (China) cabinet: a cupboard below and a vitrine above, glass doors and shelves of ornaments unless solid. */
function displayCabinet(k: Kit, sym: PlanSymbol, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const wood = k.q(COLORS.woodDark, 'wood')
  const plinth = 8
  const lower = Math.min(85, h * 0.42)
  g.add(box(w - 2, plinth, d - 4, 0, 0, -1, k.q(COLORS.dark, 'satin')))
  g.add(box(w, h - plinth, 1.8, 0, plinth, -d / 2 + 0.9, wood))
  for (const s of [-1, 1]) g.add(box(1.8, h - plinth, d, s * (w / 2 - 0.9), plinth, 0, wood))
  g.add(box(w, 1.8, d, 0, plinth, 0, wood))
  g.add(rbox(w + 3, 3.5, d + 2, 0.6, 0, h - 3.5, 0.5, wood)) // cornice
  g.add(rbox(w + 1.5, 2.5, d + 1.5, 0.5, 0, lower, 0.6, wood)) // ledge between cupboard and vitrine
  const n = Math.max(2, Math.round(w / 55))
  const dw = w / n
  for (let i = 0; i < n; i++) front(k, g, dw - 0.8, lower - plinth - 2.5, -w / 2 + dw * (i + 0.5), plinth + 1.5, d / 2 - 1, COLORS.woodLight, 'knob')
  const y0 = lower + 2.5
  const y1 = h - 3.5
  const glass = hasGlass(sym)
  if (glass) showcase(k, g, sym.id, w, d, y0, y1)
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + dw * (i + 0.5)
    if (glass) {
      glassDoor(k, g, dw - 0.8, y1 - y0 - 1, x, y0 + 0.5, d / 2 - 1)
      g.add(mesh(new THREE.SphereGeometry(1.2, 12, 8), k.q(COLORS.chrome, 'chrome')).translateX(x + (i % 2 ? -1 : 1) * (dw / 2 - 5)).translateY(y0 + 40).translateZ(d / 2 + 0.6))
    } else front(k, g, dw - 0.8, y1 - y0 - 1, x, y0 + 0.5, d / 2 - 1, COLORS.woodLight, 'post', 'side', i % 2 ? -1 : 1)
  }
  return g
}

/** A sideboard (buffet) on legs: doors, wood or glass with ornaments behind. */
function sideboard(k: Kit, sym: PlanSymbol, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const wood = k.q(COLORS.wood, 'wood')
  const legH = 14
  for (const [sx, sz] of CORNERS) g.add(leg(sx * (w / 2 - 6), sz * (d / 2 - 5), legH, k.q(COLORS.dark, 'metal'), 1.4, 1))
  const glass = hasGlass(sym)
  const body = h - legH - 3
  if (glass) {
    g.add(box(w, body, 1.8, 0, legH, -d / 2 + 0.9, wood))
    for (const s of [-1, 1]) g.add(box(1.8, body, d, s * (w / 2 - 0.9), legH, 0, wood))
    g.add(box(w, 1.8, d, 0, legH, 0, wood))
    showcase(k, g, sym.id, w, d, legH + 1.8, h - 3)
  } else g.add(rbox(w, body, d - 2, 0.6, 0, legH, -1, wood))
  g.add(rbox(w + 2, 3, d + 1.5, 0.8, 0, h - 3, 0, k.q(COLORS.woodDark, 'wood')))
  const n = Math.max(2, Math.round(w / 50))
  const dw = w / n
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + dw * (i + 0.5)
    if (glass) glassDoor(k, g, dw - 0.8, body - 1, x, legH + 0.5, d / 2 - 1)
    else front(k, g, dw - 0.8, body - 1, x, legH + 0.5, d / 2 - 1, COLORS.woodLight, 'bar', 'top')
  }
  return g
}

/** An espresso machine with its portafilter and a cup, and a grinder beside it, on a counter at height y. */
function espresso(k: Kit, g: THREE.Group, x: number, y: number, z: number, body = '#d4d4d8') {
  const chrome = k.q(COLORS.chrome, 'chrome')
  const black = k.q('#27272a', 'satin')
  g.add(rbox(32, 34, 30, 2, x, y, z, k.q(body, 'metal')))
  g.add(box(30, 2, 12, x, y, z + 19, chrome))
  g.add(cylinder(4, 6, x, y + 18, z + 18, chrome, 1, 3, 16))
  const handle = box(1.6, 1.6, 14, x + 6, y + 19, z + 24, black)
  handle.rotation.y = 0.5
  g.add(handle)
  g.add(cylinder(3, 6, x, y + 2, z + 18, k.q('#f5f5f4', 'ceramic'), 1, 2.6, 16))
  g.add(rbox(13, 22, 18, 2, x + 26, y, z, black))
  g.add(cylinder(6, 14, x + 26, y + 22, z, k.tinted(), 1, 3, 18))
}

/** Cups with saucers, and jars of coffee, along a shelf from x0 to x1 at height y, centered at depth z. */
function cupsAndJars(k: Kit, g: THREE.Group, rand: () => number, x0: number, x1: number, y: number, z: number) {
  for (let x = x0; x < x1; x += 9 + rand() * 4) {
    if (rand() < 0.35) {
      g.add(cylinder(3.6, 12, x + 3.6, y, z, k.glass(), 1, 3.6, 18))
      g.add(cylinder(3.2, 7, x + 3.6, y + 0.2, z, k.q('#3b2416', 'matte'), 1, 3.2, 14))
      g.add(cylinder(3.8, 1.2, x + 3.6, y + 12, z, k.q('#27272a', 'satin'), 1, 3.8, 18))
      x += 3
    } else {
      g.add(cylinder(5, 0.6, x + 4, y, z, k.q('#f5f5f4', 'ceramic'), 1, 5, 20))
      g.add(cylinder(3.4, 6.5, x + 4, y + 0.6, z, k.q(rand() < 0.5 ? '#f5f5f4' : '#1f2937', 'ceramic'), 1, 2.8, 18))
    }
  }
}

/** A modern coffee niche: handleless cabinets below and above, a black counter, a stone back with a floating shelf. */
function coffeeModern(k: Kit, sym: PlanSymbol, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const rand = random(sym.id)
  const counter = 90
  const lacquer = k.q('#d6d3d1', 'satin')
  const side = 2.5
  g.add(box(w - 4, 10, d - 6, 0, 0, -2, k.q(COLORS.dark, 'satin')))
  g.add(box(w, counter - 14, d - 2, 0, 10, -1, lacquer))
  const n = Math.max(2, Math.round(w / 50))
  const dw = w / n
  for (let i = 0; i < n; i++) {
    front(k, g, dw - 0.6, counter - 16, -w / 2 + dw * (i + 0.5), 11, d / 2 - 1, '#e7e5e4', 'none')
    g.add(box(dw - 6, 1.2, 1, -w / 2 + dw * (i + 0.5), counter - 10, d / 2 + 0.4, k.q('#a8a29e', 'satin'))) // finger groove
  }
  g.add(box(w + 1, 3, d + 1, 0, counter - 4, 0, k.q('#1c1917', 'gloss')))
  // Tall sides framing the niche, the upper cabinet, and the stone back.
  const upper = Math.max(counter + 70, h - 55)
  for (const s of [-1, 1]) g.add(box(side, h - counter + 1, d, s * (w / 2 - side / 2), counter - 1, 0, lacquer))
  g.add(box(w, h - upper, d - 8, 0, upper, -4, lacquer))
  for (let i = 0; i < n; i++) front(k, g, dw - 0.6, h - upper - 1, -w / 2 + dw * (i + 0.5), upper + 0.5, d / 2 - 4 + 0.9, '#e7e5e4', 'none')
  g.add(box(w - 2 * side, upper - counter, 1.5, 0, counter, -d / 2 + 0.75, k.q('#efece6', 'gloss')))
  const shelfY = counter + (upper - counter) * 0.58
  g.add(box(w - 2 * side, 2.5, 22, 0, shelfY, -d / 2 + 12.5, k.q(COLORS.woodDark, 'wood')))
  cupsAndJars(k, g, rand, -w / 2 + 10, w / 2 - 12, shelfY + 2.5, -d / 2 + 12)
  espresso(k, g, -w / 2 + 24, counter, -d / 2 + 18, '#3f3f46')
  return g
}

/** Industrial coffee shelves: a black steel frame, wood shelves, mugs hanging from a rail. */
function coffeeIndustrial(k: Kit, sym: PlanSymbol, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const rand = random(sym.id)
  const steel = k.q('#1f1f22', 'metal')
  const wood = k.q('#8a5a3b', 'wood')
  for (const [sx, sz] of CORNERS) g.add(box(2.5, h, 2.5, sx * (w / 2 - 1.25), 0, sz * (d / 2 - 1.25), steel))
  const levels = [12, 90, 135, 175].filter((y) => y < h - 4)
  for (const y of levels) {
    g.add(box(w, 3.5, d, 0, y, 0, wood))
    for (const sz of [-1, 1]) g.add(box(w, 2, 2, 0, y - 2, sz * (d / 2 - 1), steel))
  }
  espresso(k, g, -w / 2 + 22, 93.5, -d / 2 + 18)
  // Baskets underneath, cups and jars up top, mugs on hooks under the top shelf.
  for (let x = -w / 2 + 6; x < w / 2 - 30; x += 32) g.add(rbox(28, 22, d - 10, 2, x + 14, 15.5, 0, k.q('#c8b28e', 'fabric')))
  if (levels[2]) cupsAndJars(k, g, rand, -w / 2 + 6, w / 2 - 10, levels[2] + 3.5, 0)
  const top = levels[levels.length - 1]
  const railY = top - 6
  const rail = cylinder(0.7, w - 8, 0, 0, 0, steel, 1, 0.7, 8)
  rail.rotation.z = Math.PI / 2
  rail.position.set(0, railY, d / 2 - 8)
  g.add(rail)
  for (let x = -w / 2 + 10; x < w / 2 - 8; x += 12) g.add(cylinder(3.5, 8, x, railY - 11, d / 2 - 8, k.q(rand() < 0.5 ? '#f5f5f4' : '#7c2d12', 'ceramic'), 1, 3, 16))
  return g
}

/** A two-tier bar cart on wheels, the machine and cups on top. */
function coffeeCart(k: Kit, sym: PlanSymbol, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const rand = random(sym.id)
  const gold = k.q('#b08d57', 'metal')
  const ch = Math.min(h, 88)
  for (const [sx, sz] of CORNERS) {
    g.add(box(1.8, ch - 6, 1.8, sx * (w / 2 - 1), 6, sz * (d / 2 - 1), gold))
    g.add(cylinder(3, 2.5, sx * (w / 2 - 1), 0.5, sz * (d / 2 - 1), k.q('#27272a', 'satin'), 1, 3, 14).rotateX(Math.PI / 2))
  }
  for (const y of [22, ch - 3]) {
    g.add(box(w - 2, 1.2, d - 2, 0, y, 0, k.glass()))
    g.add(box(w, 2.5, 1.2, 0, y, d / 2 - 0.6, gold))
    g.add(box(w, 2.5, 1.2, 0, y, -d / 2 + 0.6, gold))
  }
  const bar = cylinder(1, d - 4, 0, 0, 0, gold, 1, 1, 10)
  bar.rotation.x = Math.PI / 2
  bar.position.set(w / 2 + 4, ch + 4, 0)
  g.add(bar)
  espresso(k, g, -w / 2 + 20, ch - 1.8, -d / 2 + 16)
  cupsAndJars(k, g, rand, -w / 2 + 4, w / 2 - 6, 23.2, 0)
  return g
}

/** A coffee corner: a base cabinet with a stone counter, an espresso machine and grinder, shelves of cups and jars. */
function coffeeCorner(k: Kit, sym: PlanSymbol, w: number, d: number, h: number) {
  const style = styleOf(sym)
  if (style === 'modern') return coffeeModern(k, sym, w, d, h)
  if (style === 'industrial') return coffeeIndustrial(k, sym, w, d, h)
  if (style === 'cart') return coffeeCart(k, sym, w, d, h)
  const g = new THREE.Group()
  const rand = random(sym.id)
  const counter = 90
  const wood = k.q(COLORS.wood, 'wood')
  const stone = k.q('#ece8e1', 'gloss')
  const chrome = k.q(COLORS.chrome, 'chrome')
  const black = k.q('#27272a', 'satin')
  // Base cabinet and counter.
  g.add(box(w - 4, 10, d - 6, 0, 0, -2, k.q(COLORS.dark, 'satin')))
  g.add(rbox(w, counter - 14, d - 2, 0.6, 0, 10, -1, wood))
  const n = Math.max(2, Math.round(w / 50))
  const dw = w / n
  for (let i = 0; i < n; i++) front(k, g, dw - 0.8, counter - 16, -w / 2 + dw * (i + 0.5), 11, d / 2 - 1, COLORS.woodLight, 'bar', 'top')
  g.add(rbox(w + 2, 4, d + 2, 0.5, 0, counter - 4, 0, stone))
  // Backsplash up to the shelves, and the shelves.
  g.add(box(w, Math.min(h, 185) - counter, 1.5, 0, counter, -d / 2 + 0.75, stone))
  const shelfD = Math.min(26, d - 10)
  const shelves = [counter + 42, counter + 76].filter((y) => y < h - 8)
  for (const y of shelves) {
    g.add(rbox(w - 6, 3, shelfD, 0.5, 0, y, -d / 2 + 1.5 + shelfD / 2, wood))
    // Cups with saucers, and jars of coffee.
    for (let x = -w / 2 + 8; x < w / 2 - 10; x += 9 + rand() * 4) {
      const z = -d / 2 + 4 + shelfD / 2
      if (rand() < 0.35) {
        g.add(cylinder(3.6, 12, x + 3.6, y + 3, z, k.glass(), 1, 3.6, 18))
        g.add(cylinder(3.2, 7, x + 3.6, y + 3.2, z, k.q('#3b2416', 'matte'), 1, 3.2, 14))
        g.add(cylinder(3.8, 1.2, x + 3.6, y + 15, z, black, 1, 3.8, 18))
        x += 3
      } else {
        g.add(cylinder(5, 0.6, x + 4, y + 3, z, k.q('#f5f5f4', 'ceramic'), 1, 5, 20))
        g.add(cylinder(3.4, 6.5, x + 4, y + 3.6, z, k.q(rand() < 0.5 ? '#f5f5f4' : '#1f2937', 'ceramic'), 1, 2.8, 18))
      }
    }
  }
  // A wall cabinet above, if it's tall enough.
  if (h > 200) {
    const y = Math.max(counter + 100, h - 50)
    g.add(rbox(w, h - y, 35, 0.6, 0, y, -d / 2 + 17.5, wood))
    for (let i = 0; i < n; i++) front(k, g, dw - 0.8, h - y - 2, -w / 2 + dw * (i + 0.5), y + 1, -d / 2 + 35 + 0.9, COLORS.woodLight, 'bar', 'middle')
  }
  // The espresso machine: body, group head and portafilter, drip tray, and a grinder beside it.
  const mx = -w / 2 + 22
  const mz = -d / 2 + 18
  g.add(rbox(32, 34, 30, 2, mx, counter, mz, k.q('#d4d4d8', 'metal')))
  g.add(box(30, 2, 12, mx, counter, mz + 19, chrome))
  g.add(cylinder(4, 6, mx, counter + 18, mz + 18, chrome, 1, 3, 16))
  const handle = box(1.6, 1.6, 14, mx + 6, counter + 19, mz + 24, black)
  handle.rotation.y = 0.5
  g.add(handle)
  g.add(cylinder(3, 6, mx, counter + 2, mz + 18, k.q('#f5f5f4', 'ceramic'), 1, 2.6, 16))
  const gx = mx + 26
  g.add(rbox(13, 22, 18, 2, gx, counter, mz, black))
  g.add(cylinder(6, 14, gx, counter + 22, mz, k.tinted(), 1, 3, 18))
  return g
}

/** Where a cabinet's LEDs go, in its own frame: strips (lit lenses) and the spot lights they make. */
export interface CabinetLeds {
  strips: { x: number; y: number; z: number; len: number; axis: 'x' | 'y' }[]
  spots: { x: number; y: number; z: number; angle: number; intensity: number }[]
}

export function cabinetLeds(sym: PlanSymbol): CabinetLeds | null {
  const { width: w, depth: d, height: h } = sym
  if (sym.type === 'wall-cabinet') {
    // Under it, along the front, lighting the counter.
    return { strips: [{ x: 0, y: -0.4, z: d / 2 - 5, len: w - 6, axis: 'x' }], spots: [{ x: 0, y: -1, z: d / 2 - 8, angle: 1.3, intensity: 4 }] }
  }
  if (sym.type === 'range-hood') {
    // Lamps under the canopy, lighting the hob.
    const xs = w >= 80 ? [-w / 4, w / 4] : [0]
    const z = styleOf(sym) === 'built-in' ? d / 2 - 8 : d / 6
    return { strips: xs.map((x) => ({ x, y: -0.5, z, len: 5, axis: 'x' as const })), spots: xs.map((x) => ({ x, y: -1, z, angle: 0.9, intensity: 3 })) }
  }
  if (sym.type === 'shower-niche') {
    // Along the top of the recess, lighting what stands in it.
    const r = nicheDepth(d)
    return { strips: [{ x: 0, y: h - 1.2, z: d / 2 - 1.5, len: w - 2, axis: 'x' }], spots: [{ x: 0, y: h - 2, z: d / 2 - r / 2, angle: 1.2, intensity: 2 }] }
  }
  if (sym.type === 'bath-vanity') {
    // Under the mirror cabinet onto the basin, around a mirror, or (with nothing above) under a wall-hung vanity.
    const above = sym.mirror ?? 'cabinet'
    if (above === 'cabinet') return { strips: [{ x: 0, y: h + 29.5, z: -d / 2 + 11, len: w - 8, axis: 'x' }], spots: [{ x: 0, y: h + 29, z: -d / 2 + 10, angle: 1.2, intensity: 5 }] }
    if (above === 'plain') {
      const mw = Math.min(w, 140)
      return {
        strips: [
          { x: 0, y: h + 108.5, z: -d / 2 + 1, len: mw, axis: 'x' },
          { x: -mw / 2 - 0.5, y: h + 68, z: -d / 2 + 1, len: 80, axis: 'y' },
          { x: mw / 2 + 0.5, y: h + 68, z: -d / 2 + 1, len: 80, axis: 'y' },
        ],
        spots: [{ x: 0, y: h + 100, z: -d / 2 + 6, angle: 1.3, intensity: 3 }],
      }
    }
    const bottom = sym.onFloor ? 10 : 30
    return { strips: [{ x: 0, y: bottom - 0.5, z: d / 2 - 6, len: w - 8, axis: 'x' }], spots: [{ x: 0, y: bottom - 1, z: 0, angle: 1.3, intensity: 2 }] }
  }
  if (sym.type === 'dressing-table') {
    // Around the mirror (its bulbs, for Hollywood style), lighting the face in front of it.
    const m = vanityMirror(sym)
    const z = -d / 2 + 6
    const y0 = h + m.bottom
    const spots = [{ x: 0, y: y0 + m.h * 0.6, z: z + 4, angle: 1.3, intensity: 3 }]
    if (styleOf(sym) === 'hollywood') {
      const strips: CabinetLeds['strips'] = []
      for (let i = 0; i < 5; i++) for (const s of [-1, 1]) strips.push({ x: s * (m.w / 2 - 3), y: y0 + 8 + ((m.h - 16) * i) / 4, z: z + 1, len: 3, axis: 'x' })
      return { strips, spots }
    }
    return {
      strips: [
        { x: 0, y: y0 + m.h + 0.5, z, len: m.w * (m.round ? 0.6 : 1), axis: 'x' },
        { x: -m.w / 2 - 0.5, y: y0 + m.h / 2, z, len: m.h * (m.round ? 0.6 : 1), axis: 'y' },
        { x: m.w / 2 + 0.5, y: y0 + m.h / 2, z, len: m.h * (m.round ? 0.6 : 1), axis: 'y' },
      ],
      spots,
    }
  }
  if (sym.type === 'display-cabinet') {
    // Profiles up the front corners of the vitrine and along under its top.
    const y0 = Math.min(85, h * 0.42) + 2.5
    const y1 = h - 3.5
    return {
      strips: [
        { x: -w / 2 + 3, y: (y0 + y1) / 2, z: d / 2 - 4, len: y1 - y0 - 2, axis: 'y' },
        { x: w / 2 - 3, y: (y0 + y1) / 2, z: d / 2 - 4, len: y1 - y0 - 2, axis: 'y' },
        { x: 0, y: y1 - 1, z: d / 2 - 6, len: w - 8, axis: 'x' },
      ],
      spots: [{ x: 0, y: y1 - 2, z: 0, angle: 1.2, intensity: 6 }],
    }
  }
  if (sym.type === 'sideboard') {
    // Inside under the top behind glass; under the cabinet (onto the floor) when the doors are solid.
    if (hasGlass(sym)) return { strips: [{ x: 0, y: h - 5, z: d / 2 - 5, len: w - 6, axis: 'x' }], spots: [{ x: 0, y: h - 6, z: 0, angle: 1.2, intensity: 5 }] }
    return { strips: [{ x: 0, y: 13.5, z: d / 2 - 6, len: w - 10, axis: 'x' }], spots: [{ x: 0, y: 13, z: 0, angle: 1.3, intensity: 3 }] }
  }
  if (sym.type === 'coffee-corner' && styleOf(sym) === 'modern') {
    // Along the top of the niche, under the upper cabinet.
    const upper = Math.max(90 + 70, h - 55)
    return { strips: [{ x: 0, y: upper - 1, z: d / 2 - 8, len: w - 10, axis: 'x' }], spots: [{ x: 0, y: upper - 2, z: 0, angle: 1.1, intensity: 7 }] }
  }
  if (sym.type === 'coffee-corner' && styleOf(sym) === 'industrial') {
    const ys = [135, 175].filter((y) => y < h - 4)
    return { strips: ys.map((y) => ({ x: 0, y: y - 0.4, z: d / 2 - 4, len: w - 8, axis: 'x' as const })), spots: [{ x: 0, y: (ys[0] ?? 135) - 1, z: 0, angle: 1.1, intensity: 6 }] }
  }
  if (sym.type === 'coffee-corner' && styleOf(sym) === 'cart') {
    const ch = Math.min(h, 88)
    return { strips: [{ x: 0, y: ch - 4, z: d / 2 - 3, len: w - 6, axis: 'x' }], spots: [{ x: 0, y: ch - 5, z: 0, angle: 1.2, intensity: 3 }] }
  }
  if (sym.type === 'coffee-corner') {
    // Under each shelf, lighting the counter and the cups below.
    const z = -d / 2 + 1.5 + Math.min(26, d - 10) - 3
    const ys = [90 + 42, 90 + 76].filter((y) => y < h - 8)
    return {
      strips: ys.map((y) => ({ x: 0, y: y - 0.4, z, len: w - 12, axis: 'x' as const })),
      spots: [{ x: 0, y: (ys[0] ?? 130) - 1, z: z - 4, angle: 1.1, intensity: 6 }],
    }
  }
  return null
}

/** An L-shaped wardrobe: along the back (its corner end blind) and down the left side, facing into the room. */
function cornerWardrobe(k: Kit, w: number, d: number, h: number, o: WardrobeOpts) {
  const g = new THREE.Group()
  const a = cornerArm(w, d)
  const back = wardrobe(k, w, a, h, { ...o, blind: a })
  back.position.set(0, 0, -d / 2 + a / 2)
  g.add(back)
  const run = d - a
  const side = wardrobe(k, run, a, h, o)
  side.rotation.y = Math.PI / 2
  side.position.set(-w / 2 + a / 2, 0, -d / 2 + a + run / 2)
  g.add(side)
  return g
}

function bookshelf(k: Kit, sym: PlanSymbol, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const wood = k.q(COLORS.wood, 'wood')
  const t = 2
  for (const s of [-1, 1]) g.add(box(t, h, d, s * (w / 2 - t / 2), 0, 0, wood))
  g.add(box(w - 2 * t, 6, d - 2, 0, 0, 1, k.q(COLORS.woodDark, 'wood'))) // plinth
  g.add(box(w, t, d, 0, h - t, 0, wood))
  g.add(box(w - 2 * t, h - t, 1, 0, 0, -d / 2 + 0.5, k.q(COLORS.woodDark, 'wood'))) // back
  const shelves = Math.max(2, Math.round((h - 8) / 36))
  const gap = (h - 6 - t) / shelves
  const rand = random(sym.id)
  for (let s = 0; s < shelves; s++) {
    const y = 6 + s * gap
    if (s > 0) g.add(box(w - 2 * t, t, d - 1.5, 0, y - t, 0.75, wood))
    // Books, with the odd gap and a leaning one now and then.
    let x = -w / 2 + t + 1
    const end = w / 2 - t - 1 - rand() * w * 0.25
    while (x < end - 3) {
      const bw = 2.2 + rand() * 3.5
      const bh = Math.min(gap - 4, gap * (0.55 + rand() * 0.33))
      const bd = d * (0.62 + rand() * 0.2)
      const b = box(bw, bh, bd, x + bw / 2, y, -d / 2 + 1 + bd / 2, k.q(COLORS.books[Math.floor(rand() * COLORS.books.length)], 'satin'))
      if (rand() < 0.06 && x + bw + 6 < end) {
        b.rotation.z = -0.28
        b.position.x += 2
        x += 4
      }
      g.add(b)
      x += bw + (rand() < 0.08 ? 6 + rand() * 10 : 0.2)
    }
  }
  return g
}

/** A flat TV, on the wall (with a bracket behind it) or, when it sits low, on its own feet. */
function tv(k: Kit, w: number, d: number, h: number, elevation: number) {
  const g = new THREE.Group()
  const z = d / 2 - 2
  g.add(rbox(w, h, 3, 0.6, 0, 0, z, k.q(COLORS.black, 'satin')))
  g.add(box(w - 2, h - 2, 0.3, 0, 1, z + 1.5, k.q(COLORS.screen, 'gloss')))
  if (elevation > 20) {
    g.add(box(Math.min(40, w * 0.4), Math.min(30, h * 0.5), d - 4, 0, h * 0.3, -1, k.q(COLORS.dark, 'metal'))) // wall bracket
  } else {
    for (const s of [-1, 1]) g.add(box(3, 1.5, 18, s * w * 0.36, -1.5, z, k.q(COLORS.dark, 'metal')))
  }
  return g
}

function tvUnit(k: Kit, w: number, d: number, h: number, withTv = true) {
  const g = new THREE.Group()
  const legH = 10
  for (const [sx, sz] of CORNERS) g.add(leg(sx * (w / 2 - 6), sz * (d / 2 - 5), legH, k.q(COLORS.dark, 'metal'), 1.4, 1.1))
  g.add(rbox(w, h - legH, d - 1, 1, 0, legH, -0.5, k.q(COLORS.woodDark, 'wood')))
  const n = Math.max(2, Math.round(w / 60))
  const fw = w / n
  for (let i = 0; i < n; i++) front(k, g, fw - 0.8, h - legH - 3, -w / 2 + fw * (i + 0.5), legH + 1.5, d / 2 - 0.6, COLORS.woodLight, 'bar')
  if (!withTv) return g
  // Television on its feet.
  const tw = Math.min(w * 0.72, 165)
  const th = tw * 0.5625
  const z = -d / 2 + 10
  for (const s of [-1, 1]) g.add(box(3, 5, 16, s * tw * 0.36, h, z, k.q(COLORS.dark, 'metal')))
  g.add(rbox(tw, th, 3, 0.6, 0, h + 5, z, k.q(COLORS.black, 'satin')))
  g.add(box(tw - 2, th - 2, 0.3, 0, h + 6, z + 1.5, k.q(COLORS.screen, 'gloss')))
  // A soundbar under it.
  g.add(rbox(Math.min(tw * 0.6, 90), 6, 8, 2.5, 0, h, z + 12, k.q(COLORS.dark, 'fabric')))
  return g
}

function desk(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const top = 3
  g.add(rbox(w, top, d, 1, 0, h - top, 0, k.q(COLORS.wood, 'wood')))
  // Drawers on the right, metal legs on the left.
  const pw = Math.min(42, w * 0.32)
  const px = w / 2 - pw / 2 - 1
  g.add(rbox(pw, h - top, d - 4, 0.8, px, 0, -2, k.q(COLORS.white, 'satin')))
  const dh = (h - top - 4) / 3
  for (let i = 0; i < 3; i++) front(k, g, pw - 2, dh - 1, px, 2 + i * dh, d / 2 - 3.1, COLORS.white, 'bar', 'middle')
  for (const sz of [-1, 1]) g.add(box(4, h - top, 4, -w / 2 + 4, 0, sz * (d / 2 - 4), k.q(COLORS.dark, 'metal')))
  g.add(box(3, 3, d - 10, -w / 2 + 4, 8, 0, k.q(COLORS.dark, 'metal')))
  // Monitor, keyboard and mouse.
  const z = -d / 2 + 14
  g.add(rbox(20, 1.5, 14, 0.7, 0, h, z, k.q(COLORS.dark, 'metal')))
  g.add(box(3, 16, 2, 0, h + 1.5, z - 2, k.q(COLORS.dark, 'metal')))
  g.add(rbox(56, 33, 2.5, 0.6, 0, h + 12, z, k.q(COLORS.black, 'satin')))
  g.add(box(54, 31, 0.3, 0, h + 13, z + 1.3, k.q(COLORS.screen, 'gloss')))
  g.add(rbox(42, 1.6, 13, 0.6, -4, h, z + 26, k.q(COLORS.fabric2, 'satin')))
  g.add(rbox(6, 2.4, 10, 1.2, 24, h, z + 27, k.q(COLORS.fabric2, 'satin')))
  g.add(chair(k, -6, d / 2 + 8, 180))
  return g
}

interface KitchenOpts {
  sink?: boolean
  stove?: boolean
  /** The worktop (one of WORKTOPS). */
  top?: string
  /** The cabinets' color (white if left out). */
  color?: string
}

function kitchen(k: Kit, w: number, d: number, h: number, opts: KitchenOpts) {
  const g = new THREE.Group()
  const toe = 10
  const top = 4
  const white = opts.color ?? COLORS.white
  g.add(box(w - 2, toe, d - 10, 0, 0, -5, k.q(COLORS.dark, 'satin'))) // recessed plinth
  g.add(box(w, h - top - toe, d - 4, 0, toe, -2, k.q(white, 'satin'))) // carcass
  const fz = d / 2 - 3.1
  const fh = h - top - toe - 1
  if (opts.stove) {
    // Oven with a window, knobs above it.
    front(k, g, w - 2, fh - 12, 0, toe + 0.5, fz, COLORS.black, 'bar')
    g.add(box((w - 2) * 0.72, fh * 0.34, 0.3, 0, toe + fh * 0.2, fz + 1.05, k.q(COLORS.screen, 'gloss')))
    g.add(box(w - 2, 10.5, 1.8, 0, h - top - 11, fz, k.q(COLORS.metal, 'metal')))
    for (let i = 0; i < 4; i++) {
      const knob = cylinder(1.8, 1.6, -w * 0.3 + i * w * 0.2, 0, 0, k.q(COLORS.dark, 'metal'))
      knob.rotation.x = Math.PI / 2
      knob.position.set(-w * 0.3 + i * w * 0.2, h - top - 5.5, fz + 1.6)
      g.add(knob)
    }
  } else {
    const n = Math.max(1, Math.round(w / 60))
    const fw = w / n
    for (let i = 0; i < n; i++) front(k, g, fw - 0.6, fh, -w / 2 + fw * (i + 0.5), toe + 0.5, fz, white, 'bar')
  }

  const slab = () => k.top(opts.top)
  if (opts.sink) {
    // Worktop around an undermounted steel sink.
    const bw = Math.min(w - 20, 72)
    const bd = Math.min(d - 20, 42)
    const bz = 2
    const side = (w - bw) / 2
    for (const s of [-1, 1]) g.add(box(side, top, d, s * (w / 2 - side / 2), h - top, 0, slab()))
    g.add(box(bw, top, d / 2 - bz - bd / 2, 0, h - top, bz + bd / 2 + (d / 2 - bz - bd / 2) / 2, slab()))
    g.add(box(bw, top, d / 2 + bz - bd / 2, 0, h - top, -d / 2 + (d / 2 + bz - bd / 2) / 2, slab()))
    const steel = k.q(COLORS.metal, 'metal')
    const depth = 20
    g.add(box(bw, 1, bd, 0, h - depth, bz, steel))
    for (const s of [-1, 1]) {
      g.add(box(bw, depth, 0.8, 0, h - depth, bz + s * (bd / 2 - 0.4), steel))
      g.add(box(0.8, depth, bd, s * (bw / 2 - 0.4), h - depth, bz, steel))
    }
    g.add(cylinder(3, 0.3, 0, h - depth + 1, bz, k.q(COLORS.dark, 'metal'))) // drain
    // Gooseneck tap.
    const chrome = k.q(COLORS.chrome, 'chrome')
    const tz = bz - bd / 2 - 5
    g.add(cylinder(2.4, 3, 0, h, tz, chrome))
    g.add(cylinder(1.3, 24, 0, h + 3, tz, chrome, 1, 1.3, 16))
    const arc = mesh(new THREE.TorusGeometry(9, 1.3, 10, 24, Math.PI), chrome)
    arc.rotation.y = Math.PI / 2
    arc.position.set(0, h + 27, tz + 9)
    g.add(arc)
    g.add(cylinder(1.5, 4, 0, h + 23, tz + 18, chrome, 1, 1.5, 16))
    g.add(box(1.2, 1.2, 8, 3.5, h + 10, tz + 2, chrome)) // lever
  } else {
    g.add(box(w, top, d, 0, h - top, 0, slab()))
  }
  if (opts.stove) {
    g.add(rbox(w - 6, 0.8, d - 10, 0.3, 0, h, 0, k.q(COLORS.black, 'gloss'))) // glass cooktop
    for (const [sx, sz, r] of [
      [-1, -1, 8],
      [1, -1, 6.5],
      [-1, 1, 6.5],
      [1, 1, 8],
    ]) {
      const ring = mesh(new THREE.TorusGeometry(r, 0.35, 6, 32), k.q(COLORS.dark, 'satin'))
      ring.rotation.x = Math.PI / 2
      ring.position.set(sx * w * 0.22, h + 0.85, sz * d * 0.2)
      g.add(ring)
    }
  }
  return g
}

/**
 * A corner unit: base cabinets in an L round an inside corner (the corner at the back left), two doors meeting at
 * its inside corner opening onto a carousel, an L of worktop over it.
 */
function kitchenCorner(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const toe = 10
  const top = 4
  const a = Math.min(60, w - 10, d - 10)
  const L = -w / 2
  const B = -d / 2
  const white = k.q(COLORS.white, 'satin')
  const plinth = k.q(COLORS.dark, 'satin')
  // Along the back, and down the left side.
  g.add(box(w - 2, toe, a - 10, 0, 0, B + (a - 10) / 2, plinth))
  g.add(box(a - 10, toe, d - a, L + (a - 10) / 2, 0, B + a + (d - a) / 2 - 1, plinth))
  g.add(box(w, h - top - toe, a - 4, 0, toe, B + (a - 4) / 2, white))
  g.add(box(a - 4, h - top - toe, d - a, L + (a - 4) / 2, toe, B + a + (d - a) / 2, white))
  const fh = h - top - toe - 1
  // A door on each face of the inside corner, hinged together (a bi-fold onto the carousel).
  front(k, g, w - a - 0.6, fh, (L + a + w / 2) / 2, toe + 0.5, B + a - 2.1, COLORS.white, 'bar')
  const side = new THREE.Group()
  side.rotation.y = Math.PI / 2
  side.position.set(L + a - 2.1, 0, B + a + (d - a) / 2)
  front(k, side, d - a - 0.6, fh, 0, toe + 0.5, 0, COLORS.white, 'none')
  g.add(side)
  // The worktop, in an L.
  g.add(box(w, top, a, 0, h - top, B + a / 2, k.top()))
  g.add(box(a, top, d - a, L + a / 2, h - top, B + a + (d - a) / 2, k.top()))
  return g
}

/** A dishwasher under the worktop: a panel like the doors around it (built in), or its own steel or black door. */
function dishwasher(k: Kit, sym: PlanSymbol, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const toe = 10
  const top = 4
  const color = frameOf(sym)?.hex ?? '#f4f3ef'
  g.add(box(w - 2, toe, d - 10, 0, 0, -5, k.q(COLORS.dark, 'satin')))
  g.add(box(w, h - top - toe, d - 4, 0, toe, -2, k.q(COLORS.white, 'satin')))
  const fz = d / 2 - 3.1
  const fh = h - top - toe - 1
  if (color.toLowerCase() === '#f4f3ef') front(k, g, w - 2, fh, 0, toe + 0.5, fz, color, 'bar')
  else {
    const steel = color.toLowerCase() === '#c9ccd0'
    g.add(rbox(w - 2, fh - 8, 1.8, 0.5, 0, toe + 0.5, fz, k.q(color, steel ? 'metal' : 'gloss')))
    g.add(rbox(w - 2, 7.5, 1.8, 0.5, 0, toe + fh - 7.5, fz, k.q('#27272a', 'gloss'))) // controls
    g.add(box(9, 2, 0.3, w / 2 - 12, toe + fh - 4.8, fz + 1.05, k.q('#38bdf8', 'gloss')))
    g.add(box(w * 0.6, 1.4, 2, 0, toe + fh - 13, fz + 2, k.q(COLORS.chrome, 'chrome')))
  }
  g.add(box(w, top, d, 0, h - top, 0, k.top()))
  return g
}

/**
 * A washing machine: a round door of smoked glass in a chrome ring, a control strip with the detergent drawer, a
 * display and a dial; under a worktop, under a dryer, or loaded from the top.
 */
function washingMachine(k: Kit, sym: PlanSymbol, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const color = frameOf(sym)?.hex ?? '#f4f4f2'
  const body = k.q(color, color.toLowerCase() === '#c9ccd0' ? 'metal' : 'gloss')
  const panel = k.q(color.toLowerCase() === '#2c2c2e' ? '#3f3f46' : '#e4e4e1', 'satin')
  const chrome = k.q(COLORS.chrome, 'chrome')
  const fz = d / 2 - 2
  const dial = (x: number, y: number) => {
    const m = mesh(new THREE.CylinderGeometry(3, 3, 2, 24), chrome)
    m.rotation.x = Math.PI / 2
    m.position.set(x, y, fz + 1)
    g.add(m)
  }
  /** One machine from y0, uh tall (a dryer has no detergent drawer). */
  const unit = (y0: number, uh: number, dryer: boolean) => {
    g.add(rbox(w, uh - 0.4, d - 2, 1.5, 0, y0, -1, body))
    g.add(box(w - 3, 11, 0.6, 0, y0 + uh - 12.5, fz + 0.3, panel))
    if (!dryer) g.add(box(w * 0.3, 6, 0.8, -w * 0.29, y0 + uh - 10, fz + 0.7, k.q('#d4d4d8', 'satin')))
    g.add(box(10, 3.5, 0.3, w * 0.05, y0 + uh - 8.5, fz + 0.7, k.q(COLORS.screen, 'gloss')))
    dial(w * 0.3, y0 + uh - 7)
    const r = Math.min(w, uh - 14) * 0.33
    const cy = y0 + (uh - 14) / 2 + 1
    const ring = mesh(new THREE.TorusGeometry(r, 2, 12, 40), chrome)
    ring.position.set(0, cy, fz + 1.2)
    g.add(ring)
    const glass = mesh(new THREE.CircleGeometry(r - 0.5, 40), k.tinted())
    glass.position.set(0, cy, fz + 0.8)
    g.add(glass)
  }
  switch (styleOf(sym)) {
    case 'top':
      g.add(rbox(w, h - 10, d - 2, 1.5, 0, 0, -1, body))
      g.add(box(w - 6, 1.2, d - 22, 0, h - 10, 4, k.q('#e4e4e1', 'satin'))) // lid
      g.add(rbox(w, 10, 14, 1, 0, h - 10, -d / 2 + 7, panel)) // controls along the back
      dial(w * 0.25, h - 5)
      break
    case 'stacked':
      unit(0, Math.min(85, h / 2), false)
      unit(Math.min(85, h / 2), h - Math.min(85, h / 2), true)
      break
    case 'built-in':
      unit(0, h - 4, false)
      g.add(box(w, 4, d, 0, h - 4, 0, k.top()))
      break
    default:
      unit(0, h, false)
  }
  return g
}

/** A built-in oven's front, h tall from y: black glass with a window, its display and a bar handle. */
function ovenFront(k: Kit, g: THREE.Group, w: number, y: number, h: number, z: number) {
  g.add(rbox(w, h, 1.8, 0.5, 0, y, z, k.q(COLORS.black, 'gloss')))
  g.add(box(w * 0.74, h * 0.48, 0.3, 0, y + h * 0.12, z + 1.05, k.q(COLORS.screen, 'gloss')))
  g.add(box(10, 2.2, 0.3, 0, y + h - 5.5, z + 1.05, k.q('#f59e0b', 'gloss')))
  g.add(box(w - 8, 1.6, 2, 0, y + h - 12, z + 2.2, k.q(COLORS.metal, 'metal')))
}

/** A built-in microwave's front: black glass, the window to one side, a handle at the other. */
function microwaveFront(k: Kit, g: THREE.Group, w: number, y: number, h: number, z: number) {
  g.add(rbox(w, h, 1.8, 0.5, 0, y, z, k.q(COLORS.black, 'gloss')))
  g.add(box(w * 0.58, h * 0.62, 0.3, -w * 0.1, y + h * 0.19, z + 1.05, k.q(COLORS.screen, 'gloss')))
  g.add(box(1.6, h * 0.55, 2, w / 2 - 7, y + h * 0.22, z + 2.2, k.q(COLORS.metal, 'metal')))
}

/** A tall oven housing: two drawers, an oven at eye level, a microwave or second oven above it, a cupboard on top. */
function ovenTower(k: Kit, sym: PlanSymbol, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const color = frameOf(sym)?.hex ?? '#f4f3ef'
  const wood = ['#c19a6b', '#6e4b33'].includes(color.toLowerCase())
  const toe = 10
  g.add(box(w - 2, toe, d - 10, 0, 0, -5, k.q(COLORS.dark, 'satin')))
  g.add(box(w, h - toe, d - 4, 0, toe, -2, k.q(color, wood ? 'wood' : 'satin')))
  const fz = d / 2 - 3.1
  const fw = w - 1
  const start = 75
  const dh = (start - toe - 1) / 2
  for (let j = 0; j < 2; j++) front(k, g, fw, dh - 0.6, 0, toe + 0.5 + j * dh, fz, color, 'bar', 'top')
  let y = start
  const units = sym.appliances === 'oven' ? ['oven'] : sym.appliances === 'two-ovens' ? ['oven', 'oven'] : ['oven', 'microwave']
  for (const u of units) {
    const uh = u === 'oven' ? 60 : 38
    if (y + uh > h - 2) break
    if (u === 'oven') ovenFront(k, g, fw, y, uh - 0.6, fz)
    else microwaveFront(k, g, fw, y, uh - 0.6, fz)
    y += uh
  }
  if (h - y > 8) front(k, g, fw, h - y - 0.6, 0, y, fz, color, 'bar', 'bottom')
  return g
}

/** A bar stool: a round oak seat on a post, a footrest ring, a steel base. */
function barStool(k: Kit, g: THREE.Group, x: number, z: number, seat = 66) {
  const metal = k.q('#3f3f46', 'metal')
  g.add(cylinder(19, 1.5, x, 0, z, metal))
  g.add(cylinder(2.4, seat - 4, x, 1.5, z, metal))
  const ring = mesh(new THREE.TorusGeometry(15, 0.9, 8, 28), metal)
  ring.rotation.x = Math.PI / 2
  ring.position.set(x, 24, z)
  g.add(ring)
  g.add(cylinder(18, 4, x, seat - 4, z, k.q(COLORS.wood, 'wood')))
}

/**
 * A kitchen island: base cabinets facing its back (the cooking side), with a hob or a sink if it has one, the
 * worktop running on over the seating side, stools along it.
 */
function kitchenIsland(k: Kit, sym: PlanSymbol, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const over = islandOverhang(d)
  const work = d - over
  const cabinets = kitchen(k, w, work, h, { sink: sym.islandTop === 'sink', stove: sym.islandTop === 'hob', color: frameOf(sym)?.hex, top: sym.top })
  cabinets.rotation.y = Math.PI
  cabinets.position.z = -d / 2 + work / 2
  g.add(cabinets)
  g.add(box(w, 4, over + 0.2, 0, h - 4, d / 2 - over / 2, k.top()))
  if (sym.stool !== false) for (const x of islandStools(w)) barStool(k, g, x, d / 2 + 8)
  return g
}

function fridge(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const body = k.q(COLORS.metal, 'metal')
  for (const sx of [-1, 1]) g.add(box(4, 2, 4, sx * (w / 2 - 5), 0, d / 2 - 6, k.q(COLORS.dark, 'satin')))
  g.add(rbox(w, h - 2, d - 3, 1.5, 0, 2, -1.5, body))
  const split = (h - 2) * 0.36
  g.add(rbox(w - 0.6, split - 0.8, 3, 1.2, 0, 2, d / 2 - 1.5, body))
  g.add(rbox(w - 0.6, h - 2 - split - 0.8, 3, 1.2, 0, 2 + split + 0.4, d / 2 - 1.5, body))
  const chrome = k.q(COLORS.chrome, 'chrome')
  g.add(box(2, 30, 2.4, w / 2 - 6, split - 34, d / 2 + 1, chrome))
  g.add(box(2, 40, 2.4, w / 2 - 6, split + 8, d / 2 + 1, chrome))
  return g
}

function toilet(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const white = k.q(COLORS.ceramic, 'gloss')
  const tankD = Math.min(20, d * 0.3)
  const zb = -d / 2 + tankD + (d - tankD) * 0.42
  const s = (d - tankD) / w // bowl stretch front to back
  g.add(cylinder(w * 0.2, 26, 0, 0, zb - 2, white, s, w * 0.24)) // pedestal
  const bowl = mesh(new THREE.SphereGeometry(w * 0.46, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), white)
  bowl.rotation.x = Math.PI // upside-down dome
  bowl.scale.set(1, 0.6, s * 0.95)
  bowl.position.set(0, 41, zb)
  g.add(bowl)
  const seat = mesh(new THREE.TorusGeometry(w * 0.33, 2.4, 10, 32), k.q(COLORS.white, 'satin'))
  seat.rotation.x = Math.PI / 2
  seat.scale.set(1, s * 1.05, 0.7)
  seat.position.set(0, 42.5, zb + 1)
  g.add(seat)
  g.add(cylinder(w * 0.42, 2, 0, 43.5, zb + 1, k.q(COLORS.white, 'satin'), s * 1.05)) // closed lid
  const tankTop = Math.max(70, h)
  g.add(rbox(w * 0.92, tankTop - 36, tankD, 3, 0, 36, -d / 2 + tankD / 2, white))
  g.add(cylinder(2.6, 0.8, 0, tankTop, -d / 2 + tankD / 2, k.q(COLORS.chrome, 'chrome')))
  return g
}

function washbasin(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  // Wall-hung vanity with a stone top, a bowl basin, a tall tap and a mirror.
  const bottom = 32
  const top = 3
  g.add(rbox(w, h - top - bottom, d - 2, 1, 0, bottom, -1, k.q(COLORS.woodDark, 'wood')))
  const n = w >= 80 ? 2 : 1
  const fw = w / n
  for (let i = 0; i < n; i++) {
    front(k, g, fw - 0.8, h - top - bottom - 2, -w / 2 + fw * (i + 0.5), bottom + 1, d / 2 - 2.1, COLORS.wood, 'post', 'side', n === 2 ? (i === 0 ? 1 : -1) : 1)
  }
  g.add(rbox(w, top, d, 0.6, 0, h - top, 0, k.q(COLORS.stone, 'satin')))
  const r = Math.min(w, d) * 0.38
  g.add(lathe([[0.1, 0.5], [r * 0.45, 0], [r * 0.9, 5], [r, 12], [r - 1.2, 12], [r * 0.82, 6], [r * 0.38, 1.6], [0.1, 1.6]], 0, h, 2, k.q(COLORS.ceramic, 'ceramic')))
  const chrome = k.q(COLORS.chrome, 'chrome')
  const tz = 2 - r - 4
  g.add(cylinder(1.8, 26, 0, h, tz, chrome, 1, 2.2, 16))
  g.add(box(2.4, 2.4, 13, 0, h + 23, tz + 6, chrome))
  g.add(box(1, 1, 7, 2.6, h + 24, tz + 2, chrome)) // lever
  g.add(rbox(Math.min(w, 90), 75, 2, 1, 0, h + 30, -d / 2 + 1, k.q(COLORS.mirror, 'gloss')))
  return g
}

/** A slab t thick, w × d, with oval holes cut through it (a countertop with built-in basins). */
function slabWithHoles(w: number, d: number, t: number, holes: { x: number; z: number; rx: number; rz: number }[], mat: Mat) {
  const shape = new THREE.Shape()
  shape.moveTo(-w / 2, -d / 2)
  shape.lineTo(w / 2, -d / 2)
  shape.lineTo(w / 2, d / 2)
  shape.lineTo(-w / 2, d / 2)
  shape.closePath()
  for (const o of holes) {
    const p = new THREE.Path()
    p.absellipse(o.x, -o.z, o.rx, o.rz, 0, Math.PI * 2, false, 0)
    shape.holes.push(p)
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 32 })
  geo.rotateX(-Math.PI / 2) // extruded up; the shape's y becomes -z
  return mesh(geo, mat)
}

/**
 * A bathroom vanity: hung on the wall or standing on a plinth, drawers in its finish, one or two basins (built into
 * the top, or bowls on it) with their taps, and above it a mirror cabinet, a mirror or nothing.
 */
function bathVanity(k: Kit, sym: PlanSymbol, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const color = frameOf(sym)?.hex ?? '#f4f3ef'
  const wood = ['#c19a6b', '#6e4b33'].includes(color.toLowerCase())
  const body = k.q(color, wood ? 'wood' : 'satin')
  const ceramic = k.q(COLORS.ceramic, 'ceramic')
  const chrome = k.q(COLORS.chrome, 'chrome')
  const bottom = sym.onFloor ? 10 : 30
  const top = 3
  const vessel = styleOf(sym) === 'vessel'
  const s = vanitySinks(sym)
  // Built-in basins dip into the cabinet: its top stops under them, its sides and back carry on up to the top.
  const sunk = vessel ? 0 : 15
  g.add(rbox(w, h - top - bottom - sunk, d - 2, 1, 0, bottom, -1, body))
  if (sunk) {
    for (const sx of [-1, 1]) g.add(box(1.8, sunk, d - 2, sx * (w / 2 - 0.9), h - top - sunk, -1, body))
    g.add(box(w, sunk, 1.8, 0, h - top - sunk, -d / 2 + 0.9, body))
  }
  if (sym.onFloor) g.add(box(w - 6, bottom, d - 8, 0, 0, -4, k.q('#2a2a2a', 'satin'))) // recessed plinth
  // Drawers: a column under each basin (or two on a wide single), two drawers each.
  const cols = s.xs.length === 2 || w >= 90 ? 2 : 1
  const fw = w / cols
  const fh = (h - top - bottom - 2) / 2
  for (let i = 0; i < cols; i++) {
    const x = -w / 2 + fw * (i + 0.5)
    for (let j = 0; j < 2; j++) front(k, g, fw - 0.8, fh - 0.8, x, bottom + 1 + j * fh, d / 2 - 2.1, color, 'bar', 'top')
  }
  // The top, and the basins in or on it.
  if (vessel) {
    g.add(rbox(w, top, d, 0.6, 0, h - top, 0, k.top()))
    for (const x of s.xs) {
      const r = Math.min(s.rx, s.rz) * 1.15
      g.add(lathe([[0.1, 0.5], [r * 0.45, 0], [r * 0.9, 5], [r, 12], [r - 1.2, 12], [r * 0.82, 6], [r * 0.38, 1.6], [0.1, 1.6]], x, h, s.z, ceramic))
    }
  } else {
    const slab = slabWithHoles(w, d, top, s.xs.map((x) => ({ x, z: s.z, rx: s.rx, rz: s.rz })), k.q(COLORS.ceramic, 'gloss'))
    slab.position.y = h - top
    g.add(slab)
    for (const x of s.xs) {
      const bowl = mesh(new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), ceramic)
      bowl.scale.set(s.rx, 13, s.rz)
      bowl.position.set(x, h - 0.4, s.z)
      g.add(bowl)
      g.add(cylinder(1.6, 0.4, x, h - 13.2, s.z, chrome)) // drain
    }
  }
  // A tap behind each basin.
  const tall = vessel ? 26 : 15
  for (const x of s.xs) {
    const tz = s.z - s.rz - 4
    g.add(cylinder(1.6, tall, x, h, tz, chrome, 1, 2, 16))
    g.add(box(2.2, 2.2, 11, x, h + tall - 3, tz + 5.5, chrome))
    g.add(box(1, 1, 6, x + 2.4, h + tall - 2, tz + 1.5, chrome)) // lever
  }
  // Above it.
  const above = sym.mirror ?? 'cabinet'
  if (above === 'cabinet') {
    const cy = h + 30
    const ch = 70
    const cd = 14
    g.add(rbox(w, ch, cd, 1, 0, cy, -d / 2 + cd / 2, k.q('#e7e7e4', 'satin')))
    const n = w < 70 ? 1 : w < 130 ? 2 : 3
    for (let i = 0; i < n; i++) g.add(box(w / n - 0.8, ch - 1, 0.8, -w / 2 + (w / n) * (i + 0.5), cy + 0.5, -d / 2 + cd + 0.4, k.q(COLORS.mirror, 'gloss')))
  } else if (above === 'plain') {
    g.add(rbox(Math.min(w, 140), 80, 2, 1, 0, h + 28, -d / 2 + 1, k.q(COLORS.mirror, 'gloss')))
  }
  return g
}

function bathtub(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const white = k.q(COLORS.ceramic, 'gloss')
  const t = 8
  for (const s of [-1, 1]) {
    g.add(rbox(w, h, t, 3, 0, 0, s * (d / 2 - t / 2), white)) // long sides
    g.add(rbox(t * 1.4, h, d, 3, s * (w / 2 - t * 0.7), 0, 0, white)) // ends
  }
  g.add(box(w - 2 * t, h - 16, d - 2 * t, 0, 0, 0, white)) // basin floor (inside at h - 16)
  g.add(cylinder(2.5, 0.3, -w / 2 + t * 1.4 + 8, h - 16, 0, k.q(COLORS.chrome, 'chrome'))) // drain
  const chrome = k.q(COLORS.chrome, 'chrome')
  g.add(cylinder(1.8, 8, -w / 2 + t * 0.7, h, 0, chrome, 1, 2.2, 16))
  g.add(box(10, 2.2, 2.4, -w / 2 + t * 0.7 + 5, h + 6, 0, chrome)) // spout
  for (const s of [-1, 1]) g.add(cylinder(1.6, 3, -w / 2 + t * 0.7, h, s * 8, chrome, 1, 1.6, 12))
  return g
}

/** A shower with glass on the given sides (model frame: +x right, +z front); the others are walls. */
function shower(k: Kit, w: number, d: number, h: number, glass: Mat, sides: Set<Side>, doors: 'hinged' | 'sliding') {
  const g = new THREE.Group()
  const tray = 5
  g.add(rbox(w, tray, d, 1.5, 0, 0, 0, k.q(COLORS.ceramic, 'gloss')))
  g.add(cylinder(4, 0.3, 0, tray, 0, k.q(COLORS.metal, 'metal')))
  const metal = k.q(COLORS.metal, 'metal')
  const chrome = k.q(COLORS.chrome, 'chrome')
  // Each side: its middle, and which way is into the shower.
  const at: Record<Side, { x: number; z: number; nx: number; nz: number; len: number }> = {
    front: { x: 0, z: d / 2, nx: 0, nz: -1, len: w },
    back: { x: 0, z: -d / 2, nx: 0, nz: 1, len: w },
    right: { x: w / 2, z: 0, nx: -1, nz: 0, len: d },
    left: { x: -w / 2, z: 0, nx: 1, nz: 0, len: d },
  }
  // Glass on the open sides, in slim frames; the door in the front if it has glass.
  const door = (['front', 'right', 'left', 'back'] as const).find((s) => sides.has(s))
  for (const s of sides) {
    const { x, z, nx, nz, len } = at[s]
    const along = nz !== 0
    // A thing from u0 to u1 along this side (u from -len/2), `inset` in from its edge.
    const put = (u0: number, u1: number, inset: number, y: number, hh: number, t: number, mat: Mat) => {
      const c = (u0 + u1) / 2
      const l = u1 - u0
      g.add(box(along ? l : t, hh, along ? t : l, x + nx * inset + (along ? c : 0), y, z + nz * inset + (along ? 0 : c), mat))
    }
    put(-len / 2, len / 2, 1, h - 2, 2, 2, metal)
    if (s !== door) {
      put(-len / 2, len / 2, 1, tray, h - tray, 0.8, glass)
      continue
    }
    if (doors === 'sliding') {
      // A fixed pane on the inner track and one sliding on the outer, with rollers and a long bar to pull.
      const pw = len * 0.55
      put(-len / 2, -len / 2 + pw, 2.2, tray, h - tray - 4, 0.8, glass)
      put(len / 2 - pw, len / 2, 0.2, tray, h - tray - 4, 0.8, glass)
      for (const u of [len / 2 - pw + 8, len / 2 - 8]) put(u - 2, u + 2, 0.2, h - 7, 4, 2, chrome)
      put(len / 2 - pw + 4, len / 2 - pw + 5.5, -1.6, 70, 60, 2, chrome)
    } else {
      // A fixed pane, and the door hinged on it, with clamps, swinging out; a pull by its free edge.
      const fixed = len * 0.4
      put(-len / 2, -len / 2 + fixed - 0.4, 1, tray, h - tray - 2, 0.8, glass)
      put(-len / 2 + fixed + 0.4, len / 2, 1, tray + 1, h - tray - 4, 0.8, glass)
      for (const y of [30, h - 45]) put(-len / 2 + fixed - 3, -len / 2 + fixed + 3, 1, y, 8, 2.4, chrome)
      put(len / 2 - 9, len / 2 - 7.6, -1.4, 80, 30, 2.5, chrome)
    }
  }
  // Posts at the corners where glass ends.
  const corner = (a: Side, b: Side, sx: number, sz: number) => {
    if (sides.has(a) || sides.has(b)) g.add(box(2, h - tray, 2, sx * (w / 2 - 1), tray, sz * (d / 2 - 1), metal))
  }
  corner('right', 'front', 1, 1)
  corner('left', 'front', -1, 1)
  corner('right', 'back', 1, -1)
  corner('left', 'back', -1, -1)
  // Rain head on an arm from a wall, and a mixer; with no wall at all, hanging from the frame.
  const wall = (['back', 'left', 'right', 'front'] as const).find((s) => !sides.has(s))
  if (wall) {
    const { x, z, nx, nz } = at[wall]
    const arm = cylinder(1.1, 25, 0, 0, 0, chrome, 1, 1.1, 12)
    if (nz !== 0) arm.rotation.x = Math.PI / 2
    else arm.rotation.z = Math.PI / 2
    arm.position.set(x + nx * 12.5, h - 10, z + nz * 12.5)
    g.add(arm)
    g.add(cylinder(11, 1.6, x + nx * 25, h - 12, z + nz * 25, chrome))
    g.add(rbox(nz !== 0 ? 14 : 4, 8, nz !== 0 ? 4 : 14, 2, x + nx * 2, 105, z + nz * 2, chrome))
  } else {
    g.add(cylinder(1.1, 10, 0, h - 10.4, 0, chrome, 1, 1.1, 12))
    g.add(cylinder(11, 1.6, 0, h - 12, 0, chrome))
  }
  return g
}

/** A curved corner shower: walls on the back and left, a quarter-round glass front with sliding or hinged doors. */
function quadrantShower(k: Kit, w: number, d: number, h: number, glass: Mat, doors: 'hinged' | 'sliding') {
  const g = new THREE.Group()
  const tray = 5
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(w, 0)
  shape.absellipse(0, 0, w, d, 0, Math.PI / 2, false)
  shape.lineTo(0, 0)
  const trayGeo = new THREE.ExtrudeGeometry(shape, { depth: tray, bevelEnabled: false, curveSegments: 24 })
  trayGeo.rotateX(Math.PI / 2)
  trayGeo.translate(-w / 2, tray, -d / 2)
  g.add(mesh(trayGeo, k.q(COLORS.ceramic, 'gloss')))
  g.add(cylinder(4, 0.3, -w / 2 + w * 0.35, tray, -d / 2 + d * 0.35, k.q(COLORS.metal, 'metal')))
  const metal = k.q(COLORS.metal, 'metal')
  const chrome = k.q(COLORS.chrome, 'chrome')
  // Curved glass and its rails: a quarter of a cylinder around the corner, stretched to the tray.
  const curve = (height: number, y: number, mat: Mat, inset: number, from = 0, to = Math.PI / 2) => {
    const m = mesh(new THREE.CylinderGeometry(1, 1, height, 32, 1, true, from, to - from), mat)
    m.scale.set(w - inset, 1, d - inset)
    m.position.set(-w / 2, y + height / 2, -d / 2)
    return m
  }
  // A point on the curve at angle a (from the right end), `out` beyond the glass.
  const on = (a: number, out = 1) => ({ x: -w / 2 + (w + out) * Math.sin(a), z: -d / 2 + (d + out) * Math.cos(a) })
  g.add(box(2.5, h - tray, 2.5, w / 2 - 1.25, tray, -d / 2 + 1.25, metal))
  g.add(box(2.5, h - tray, 2.5, -w / 2 + 1.25, tray, d / 2 - 1.25, metal))
  if (doors === 'hinged') {
    // Two curved doors hinged on the end posts, meeting in the middle.
    const mid = Math.PI / 4
    g.add(curve(h - tray - 4, tray + 2, glass, 1.5, 0.03, mid - 0.01))
    g.add(curve(h - tray - 4, tray + 2, glass, 1.5, mid + 0.01, Math.PI / 2 - 0.03))
    for (const a of [0.06, Math.PI / 2 - 0.06]) {
      for (const y of [30, h - 45]) {
        const p = on(a, 0)
        g.add(box(3, 8, 3, p.x, y, p.z, chrome))
      }
    }
    for (const a of [mid - 0.05, mid + 0.05]) {
      const p = on(a, 1.5)
      g.add(box(1.4, 26, 1.4, p.x, 85, p.z, chrome))
    }
  } else {
    g.add(curve(h - tray - 4, tray + 2, glass, 1.5))
    g.add(curve(2.5, tray, metal, 1))
    g.add(curve(2.5, h - 2.5, metal, 1))
    // Pulls on the two sliding doors, meeting in the middle of the curve.
    for (const a of [Math.PI / 4 - 0.12, Math.PI / 4 + 0.12]) {
      const p = on(a)
      g.add(box(1.4, 30, 1.4, p.x, 90, p.z, chrome))
    }
  }
  // Rain head on an arm from the back wall, near the corner, and a mixer.
  const hx = -w / 2 + w * 0.32
  const arm = cylinder(1.1, 25, 0, 0, 0, chrome, 1, 1.1, 12)
  arm.rotation.x = Math.PI / 2
  arm.position.set(hx, h - 10, -d / 2 + 12.5)
  g.add(arm)
  g.add(cylinder(11, 1.6, hx, h - 12, -d / 2 + 25, chrome))
  g.add(rbox(14, 8, 4, 2, hx, 105, -d / 2 + 2, chrome))
  return g
}

/**
 * A panel of fabric hanging in folds from x0 to x1 (z its middle), from just off the floor up to `top`: the same
 * fabric for its width, so it folds deeper when gathered.
 */
function drape(x0: number, x1: number, z: number, top: number, fabric: number, mat: Mat) {
  const w = Math.max(2, Math.abs(x1 - x0))
  const n = Math.max(2, Math.round(fabric / 14))
  const amp = drapeAmp(fabric, w)
  const h = top - 1.5
  const geo = new THREE.PlaneGeometry(w, h, n * 6, 1)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getX(i) + w / 2) / w
    pos.setZ(i, amp * Math.sin(u * n * Math.PI * 2))
  }
  geo.computeVertexNormals()
  const m = mesh(geo, mat)
  m.position.set((x0 + x1) / 2, 1.5 + h / 2, z)
  return m
}

/**
 * A vertical gradient, bright at the top and fading down: a strip light's wash on what it lights (walls, ceilings
 * and curtains), as a color map or an emissive one.
 */
let washTexture: THREE.Texture | null = null
export function washMap() {
  if (washTexture) return washTexture
  const c = document.createElement('canvas')
  c.width = 2
  c.height = 128
  const ctx = c.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 0, 128)
  grad.addColorStop(0, 'rgb(255,255,255)')
  grad.addColorStop(0.12, 'rgb(190,190,190)')
  grad.addColorStop(0.4, 'rgb(70,70,70)')
  grad.addColorStop(1, 'rgb(0,0,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 2, 128)
  washTexture = new THREE.CanvasTexture(c)
  washTexture.colorSpace = THREE.SRGBColorSpace
  return washTexture
}

/** Curtains lit from a curtain pocket above: the light's color, and who to tell about the glowing fabric. */
export interface CurtainWash {
  color: THREE.Color
  add: (m: THREE.MeshStandardMaterial) => void
}

/**
 * Curtains on tracks near the ceiling, a layer on each: from the window out, a sheer, a blackout and a curtain, two
 * panels each, or one across for curtains that open to one side. Their panels gather toward the ends as they open
 * (see poseDoor); a sheer stays drawn unless it's alone. Lit from a curtain pocket, the fabric glows from the top.
 */
function curtain(k: Kit, sym: PlanSymbol, w: number, d: number, top: number, wash?: CurtainWash) {
  const g = new THREE.Group()
  const color = frameOf(sym)?.hex ?? '#d9cfbf'
  const layers = curtainLayers(sym)
  const designed = sym.open ?? 0.7
  const openTo = designed > 0.05 ? designed : 0.8
  const step = Math.max(4, (d - 4) / layers.length)
  layers.forEach((l, i) => {
    const z = -d / 2 + 3 + step * (i + 0.5)
    g.add(box(w, 2.5, 2.5, 0, top - 2.5, z, k.q('#d4d4d8', 'metal')))
    let mat = l === 'sheer' ? k.sheer(i === layers.length - 1 && layers.length === 1 ? color : '#f8f6f1', 0.34) : k.q(l === 'blackout' && layers.includes('curtain') ? '#8b8378' : color, 'cloth')
    if (wash) {
      const lit = (mat as THREE.MeshStandardMaterial).clone()
      lit.emissive = wash.color.clone()
      lit.emissiveMap = washMap()
      lit.emissiveIntensity = 0
      wash.add(lit)
      mat = lit
    }
    const moves = l !== 'sheer' || layers.length === 1
    for (const { end, span } of curtainPanels(sym, w)) {
      // Built shut, hanging from its end of the track toward the other; the part gathers it toward its end.
      const part = new THREE.Group()
      part.position.set((end * w) / 2, 0, z)
      part.add(drape(0, -end * span, 0, top - 3, span * 2, mat))
      if (moves) part.userData.door = { gather: { span, fabric: span * 2, openTo }, startOpen: !startsShut(sym) } satisfies DoorPart
      g.add(part)
    }
  })
  return g
}

/** A roller blind: a cassette at the top and the fabric let down as far as it's not rolled up. */
function blind(k: Kit, sym: PlanSymbol, w: number, d: number, h: number, top: number) {
  const g = new THREE.Group()
  const color = frameOf(sym)?.hex ?? '#f4f4f2'
  const z = -d / 2 + d / 2
  g.add(rbox(w, 7, Math.min(d, 8), 1, 0, top - 7, z, k.q('#e7e5e4', 'satin')))
  // Built let all the way down; rolling it up shortens the fabric from the top and lifts the bar (see poseDoor).
  const full = Math.max(2, Math.min(h, top - 8))
  const designed = sym.open ?? 0
  const roll = { full, openTo: designed > 0.05 ? designed : 0.9 }
  const startOpen = !startsShut(sym)
  const mat = sym.fabric === 'blackout' ? k.q(color, 'cloth') : k.sheer(color, 0.8)
  const fabric = new THREE.Group()
  fabric.position.y = top - 7
  fabric.add(box(w - 3, full, 0.3, 0, -full, z + 1, mat))
  fabric.userData.door = { roll, startOpen } satisfies DoorPart
  g.add(fabric)
  const bar = new THREE.Group()
  bar.add(box(w - 3, 2.2, 1.6, 0, top - 7 - full - 2.2, z + 1, k.q('#d4d4d8', 'metal')))
  bar.userData.door = { roll: { ...roll, bar: true }, startOpen } satisfies DoorPart
  g.add(bar)
  return g
}

/** A column built into a wall, floor to ceiling, with skirting along its three exposed faces. */
function wallPost(k: Kit, w: number, d: number, floorH: number) {
  const g = new THREE.Group()
  g.add(box(w, floorH, d, 0, 0, 0, k.q(COLORS.wall)))
  const skirt = k.q(COLORS.white, 'satin')
  // Its skirting (left off when its wall's tiles come down to the floor; see buildScene).
  const skirts = [box(w + 2.4, 8, 1.2, 0, 0, d / 2 + 0.6, skirt), ...[-1, 1].map((s) => box(1.2, 8, d, s * (w / 2 + 0.6), 0, 0, skirt))]
  for (const s of skirts) g.add(Object.assign(s, { userData: { skirt: true } }))
  return g
}

/** A shower niche's own parts (the recess itself is cut into the wall): a stone sill, and a glass shelf if it has one. */
function showerNiche(k: Kit, sym: PlanSymbol, w: number, h: number, wallT: number) {
  const g = new THREE.Group()
  const r = nicheDepth(wallT)
  g.add(box(w + 1, 1.5, r + 1.5, 0, -1.2, wallT / 2 - r / 2 + 0.75, k.q(COLORS.stone, 'satin')))
  if (sym.shelf) g.add(box(w - 0.6, 0.8, r - 0.6, 0, h / 2, wallT / 2 - r / 2, k.glass()))
  return g
}

/** A towel rail: two posts from the wall and the bar, a towel folded over it. */
function towelRail(k: Kit, sym: PlanSymbol, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const chrome = k.q(COLORS.chrome, 'chrome')
  const y = h / 2
  for (const s of [-1, 1]) {
    g.add(cylinder(2.2, 0.8, s * (w / 2 - 3), y, -d / 2 + 0.4, chrome))
    g.add(box(1.4, 1.4, d - 2, s * (w / 2 - 3), y - 0.7, -d / 2 + (d - 2) / 2, chrome))
  }
  const bar = mesh(new THREE.CylinderGeometry(1, 1, w - 2, 16), chrome)
  bar.rotation.z = Math.PI / 2
  bar.position.set(0, y, d / 2 - 2)
  g.add(bar)
  if (sym.towel !== false) {
    const towel = k.q(frameOf(sym)?.hex ?? '#f4f2ee', 'cloth')
    const tw = Math.min(w - 12, 70)
    const roll = mesh(new THREE.CylinderGeometry(2.2, 2.2, tw, 14), towel)
    roll.rotation.z = Math.PI / 2
    roll.position.set(0, y, d / 2 - 2)
    g.add(roll)
    for (const z of [-2.1, 2.1]) g.add(rbox(tw, 42, 1.2, 0.5, 0, y - 42, d / 2 - 2 + z, towel))
  }
  return g
}

/** A heated towel rail: a ladder of chrome rungs between two uprights, standing off the wall, a towel over it. */
function towelRadiator(k: Kit, sym: PlanSymbol, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const chrome = k.q(COLORS.chrome, 'chrome')
  const z = d / 2 - 3
  for (const s of [-1, 1]) {
    g.add(cylinder(1.6, h, s * (w / 2 - 2), 0, z, chrome))
    for (const y of [h * 0.12, h * 0.88]) g.add(box(1.2, 1.2, d - 3, s * (w / 2 - 2), y, -d / 2 + (d - 3) / 2, chrome))
  }
  const n = Math.max(4, Math.round(h / 8))
  for (let i = 0; i < n; i++) {
    const rung = mesh(new THREE.CylinderGeometry(1.1, 1.1, w - 4, 12), chrome)
    rung.rotation.z = Math.PI / 2
    rung.position.set(0, 4 + ((h - 8) * i) / (n - 1), z)
    g.add(rung)
  }
  if (sym.towel !== false) {
    const towel = k.q(frameOf(sym)?.hex ?? '#f4f2ee', 'cloth')
    const tw = w - 8
    const top = h * 0.72
    for (const dz of [-2, 2.4]) g.add(rbox(tw, 34, 1.2, 0.5, 0, top - 34, z + dz, towel))
    const fold = mesh(new THREE.CylinderGeometry(2.3, 2.3, tw, 14), towel)
    fold.rotation.z = Math.PI / 2
    fold.position.set(0, top, z + 0.2)
    g.add(fold)
  }
  return g
}

/** A kitchen upper cabinet: solid doors with pulls along their bottom, or glass doors or open shelves with crockery. */
function wallCabinet(k: Kit, sym: PlanSymbol, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const color = frameOf(sym)?.hex ?? '#f4f3ef'
  const body = k.q(color, ['#c19a6b', '#6e4b33'].includes(color.toLowerCase()) ? 'wood' : 'satin')
  const t = 1.8
  const n = Math.max(1, Math.round(w / 50))
  const dw = w / n
  if (!sym.fronts) {
    g.add(rbox(w, h, d - 2, 0.5, 0, 0, -1, body))
    for (let i = 0; i < n; i++) front(k, g, dw - 0.6, h - 0.6, -w / 2 + dw * (i + 0.5), 0.3, d / 2 - 1, color, 'bar', 'bottom')
    return g
  }
  // Back, sides, top and bottom, shelves of cups, glasses and jars.
  g.add(box(w, h, t, 0, 0, -d / 2 + t / 2, body))
  for (const s of [-1, 1]) g.add(box(t, h, d - 2, s * (w / 2 - t / 2), 0, -1, body))
  for (const y of [0, h - t]) g.add(box(w, t, d - 2, 0, y, -1, body))
  const rand = random(sym.id)
  const levels = Math.max(1, Math.round((h - 2 * t) / 30))
  const gap = (h - 2 * t) / levels
  for (let i = 0; i < levels; i++) {
    const y = t + i * gap
    if (i > 0) g.add(box(w - 2 * t, t, d - 4, 0, y - t, -1.5, body))
    cupsAndJars(k, g, rand, -w / 2 + t + 2, w / 2 - t - 12, y, -1.5)
  }
  if (sym.fronts === 'glass') {
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + dw * (i + 0.5)
      const fw = dw - 0.6
      const z = d / 2 - 1
      for (const s of [-1, 1]) g.add(box(4, h - 0.6, 1.8, x + s * (fw / 2 - 2), 0.3, z, body))
      for (const y of [0.3, h - 4.3]) g.add(box(fw - 8, 4, 1.8, x, y, z, body))
      g.add(box(fw - 8, h - 8.6, 0.4, x, 4.3, z, k.glass()))
      g.add(box(Math.min(fw * 0.5, 30), 1.2, 1.4, x, 5, z + 1.6, k.q(COLORS.chrome, 'chrome')))
    }
  }
  return g
}

/** A box tapering from w × d at its bottom to tw × td at its top, h up from y, the top's middle at z = tz. */
function frustum(w: number, d: number, tw: number, td: number, h: number, tz: number, y: number, mat: THREE.Material) {
  const geo = new THREE.BoxGeometry(1, 1, 1)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0
    p.setXYZ(i, p.getX(i) * (top ? tw : w), top ? h : 0, top ? tz + p.getZ(i) * td : p.getZ(i) * d)
  }
  geo.computeVertexNormals()
  return mesh(geo, mat).translateY(y)
}

/**
 * A range hood, its bottom at the item's elevation, in one of HOOD_STYLES: its chimney goes on up to the ceiling,
 * `above` cm over its top, unless it's built in under a cabinet. Grease filters underneath.
 */
function rangeHood(k: Kit, sym: PlanSymbol, w: number, d: number, h: number, above: number) {
  const g = new THREE.Group()
  const color = frameOf(sym)?.hex ?? '#c9ccd0'
  const body = k.q(color, color.toLowerCase() === '#c9ccd0' ? 'metal' : 'satin')
  const style = styleOf(sym)
  const cw = Math.min(w * 0.35, 30)
  const cd = Math.min(d * 0.55, 26)
  const cz = style === 'island' ? 0 : -d / 2 + cd / 2
  g.add(box(w - 6, 0.4, d - 6, 0, -0.2, 0, k.q('#52525b', 'metal'))) // filters
  switch (style) {
    case 'built-in':
      g.add(rbox(w, h, d, 0.5, 0, 0, 0, body))
      g.add(box(w - 2, 3.5, 1.2, 0, 0.3, d / 2 + 0.4, k.q('#a1a1aa', 'metal'))) // pull-out visor
      return g
    case 'box':
      g.add(rbox(w, h, d, 0.5, 0, 0, 0, body))
      break
    case 'glass': {
      // A slim steel base, the motor housing at the back, a glass canopy sloping up from the front to it.
      g.add(rbox(w, 5, d, 0.5, 0, 0, 0, body))
      g.add(box(cw + 6, h - 5, cd, 0, 5, cz, body))
      const run = d - cd
      const rise = h - 5
      const glass = mesh(new THREE.BoxGeometry(w - 2, Math.hypot(run, rise), 0.8), k.glass())
      glass.position.set(0, 5 + rise / 2, d / 2 - run / 2)
      glass.rotation.x = -Math.atan2(run, rise)
      g.add(glass)
      break
    }
    case 'mantel': {
      // A painted canopy with a lip and a cornice, a chimney breast above it.
      const bw = w * 0.72
      const bd = d * 0.62
      const bz = -d / 2 + bd / 2
      g.add(rbox(w + 2, 8, d + 1, 0.8, 0, 0, 0.5, body))
      g.add(frustum(w, d, bw, bd, h - 14, bz, 8, body))
      g.add(rbox(bw + 4, 6, bd + 2.5, 0.8, 0, h - 6, bz + 1.25, body))
      if (above > 1) g.add(box(bw, above, bd, 0, h, bz, body))
      return g
    }
    default:
      // Pyramid, against the wall or over an island: a lip, then sloping up to the chimney.
      g.add(box(w, 5, d, 0, 0, 0, body))
      g.add(frustum(w, d, cw, cd, h - 5, cz, 5, body))
  }
  if (above > 1) g.add(box(cw, above, cd, 0, h, cz, body))
  return g
}

function plant(k: Kit, sym: PlanSymbol, w: number, h: number) {
  const g = new THREE.Group()
  const rand = random(sym.id)
  const pr = w * 0.28
  const potH = Math.min(38, Math.max(18, h * 0.3))
  g.add(lathe([[0.1, 0], [pr * 0.75, 0], [pr, potH * 0.92], [pr * 1.1, potH], [pr * 0.96, potH], [pr * 0.9, potH - 1], [0.1, potH - 1]], 0, 0, 0, k.q(COLORS.pot, 'satin')))
  g.add(cylinder(pr * 0.9, 0.5, 0, potH - 2.5, 0, k.q(COLORS.soil, 'fabric')))
  const leaf = () => k.q(COLORS.leaves[Math.floor(rand() * COLORS.leaves.length)], 'leaf')
  if (h > 110) {
    // Small tree: a trunk and a crown of leaf clusters.
    const crown = h * 0.72
    g.add(cylinder(1.6, crown - potH, 0, potH - 2, 0, k.q(COLORS.woodDark, 'wood'), 1, 2.2, 8))
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2
      const r = w * (0.08 + rand() * 0.22)
      g.add(blob(w * (0.2 + rand() * 0.14), Math.cos(a) * r, crown + (rand() - 0.3) * (h - crown) * 0.9, Math.sin(a) * r, leaf(), 1.15))
    }
  } else {
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2
      const r = w * (0.05 + rand() * 0.2)
      const top = Math.max(potH + 8, h - w * 0.2)
      g.add(blob(w * (0.16 + rand() * 0.12), Math.cos(a) * r, potH + 4 + rand() * (top - potH - 4), Math.sin(a) * r, leaf(), 1.2))
    }
  }
  return g
}

function stairs(k: Kit, w: number, d: number, h: number) {
  const g = new THREE.Group()
  const steps = Math.max(2, Math.round(d / 28))
  const rise = h / steps
  const run = d / steps
  const tread = 4
  for (let i = 0; i < steps; i++) {
    const z = d / 2 - (i + 0.5) * run
    g.add(box(w, rise * (i + 1) - tread, run, 0, 0, z, k.q(COLORS.white, 'satin'))) // riser and body
    g.add(rbox(w, tread, run + 3, 1, 0, rise * (i + 1) - tread, z + 1.5, k.q(COLORS.wood, 'wood'))) // tread with nosing
  }
  // Handrail on the +X side, on a post at every other step.
  const x = w / 2 - 4
  const railH = 90
  const metal = k.q(COLORS.dark, 'metal')
  for (let i = 0; i < steps; i += 2) g.add(cylinder(1.2, railH, x, rise * (i + 1), d / 2 - (i + 0.5) * run, metal, 1, 1.2, 10))
  const y0 = rise + railH
  const y1 = h + railH
  const z0 = d / 2 - run / 2
  const z1 = -d / 2 + run / 2
  const len = Math.hypot(y1 - y0, z0 - z1)
  const rail = rbox(5, 4, len + 6, 1.8, 0, -2, 0, k.q(COLORS.wood, 'wood'))
  const holder = new THREE.Group()
  holder.add(rail)
  holder.position.set(x, (y0 + y1) / 2, (z0 + z1) / 2)
  holder.rotation.x = Math.atan2(y1 - y0, z0 - z1)
  g.add(holder)
  return g
}

// ---------- doors and windows ----------

function doorFrame(k: Kit, g: THREE.Group, w: number, h: number, wallT: number) {
  const frame = k.q(COLORS.frame, 'satin')
  const jamb = 3
  const arch = 7
  for (const s of [-1, 1]) {
    g.add(box(jamb, h, wallT + 0.4, s * (w / 2 - jamb / 2), 0, 0, frame))
    for (const face of [-1, 1]) g.add(box(arch, h + arch - 1, 1.5, s * (w / 2 + arch / 2 - 1), 0, face * (wallT / 2 + 0.75), frame))
  }
  g.add(box(w, jamb, wallT + 0.4, 0, h - jamb, 0, frame))
  for (const face of [-1, 1]) g.add(box(w + 2 * arch - 2, arch, 1.5, 0, h - 1, face * (wallT / 2 + 0.75), frame))
}

/**
 * A leaf opened 90° into the room, hinged at `hx`; `side` = +1 when it extends toward +X from the hinge.
 * It turns shut into the frame at the room-side face of the wall.
 */
function doorLeaf(k: Kit, g: THREE.Group, hx: number, leaf: number, side: number, h: number, wallT: number) {
  g.add(hinged(hx, wallT / 2, (side * Math.PI) / 2, (p) => woodLeaf(k, p, hx, leaf, side, h, wallT)))
}

function woodLeaf(k: Kit, g: THREE.Group, hx: number, leaf: number, side: number, h: number, wallT: number) {
  const x = hx + side * 2
  const z0 = wallT / 2
  g.add(rbox(4, h - 4, leaf, 0.6, x, 1, z0 + leaf / 2, k.q(COLORS.door, 'satin')))
  // Two raised panels on each face.
  const panel = k.q(COLORS.door, 'wood')
  for (const face of [-1, 1]) {
    g.add(box(0.6, (h - 4) * 0.42, leaf * 0.64, x + face * 2.2, (h - 4) * 0.52, z0 + leaf / 2, panel))
    g.add(box(0.6, (h - 4) * 0.3, leaf * 0.64, x + face * 2.2, 12, z0 + leaf / 2, panel))
  }
  // Lever handles near the free edge.
  const chrome = k.q(COLORS.chrome, 'chrome')
  const hz = z0 + leaf - 7
  for (const face of [-1, 1]) {
    const rose = cylinder(2.6, 1, 0, 0, 0, chrome)
    rose.rotation.z = Math.PI / 2
    rose.position.set(x + face * 2.5, 100, hz)
    g.add(rose)
    g.add(box(1.6, 1.8, 12, x + face * 4.2, 99, hz - 5, chrome))
  }
}

/**
 * A barn-style sliding door: a wooden panel hung from a steel rail on the room side of the wall,
 * sliding to the left to open.
 */
function barnDoor(k: Kit, w: number, h: number, wallT: number) {
  const g = new THREE.Group()
  const pw = w + 10
  const ph = h + 4
  const pt = 4
  const z = wallT / 2 + 2.5 + pt / 2
  const x = 0
  const wood = k.q(COLORS.barn, 'wood')
  const groove = k.q(COLORS.barnDark, 'wood')
  const steel = k.q(COLORS.metal, 'metal')
  // The panel with its hangers and handles moves; the rail stays.
  const panel = sliding(-(w / 2 + pw / 2 + 2), () => {})
  g.add(panel)
  panel.add(rbox(pw, ph, pt, 0.6, x, 1, z, wood))
  // Boards: a few horizontal joints across both faces.
  for (const f of [0.28, 0.52, 0.76]) {
    for (const face of [-1, 1]) panel.add(box(pw - 1, 0.7, 0.3, x, 1 + ph * f, z + face * (pt / 2 + 0.05), groove))
  }
  // Rail: long enough for the door to open fully to the left, on brackets from the wall.
  const railY = 1 + ph + 12
  const x0 = -w / 2 - pw - 5
  const x1 = w / 2 + 12
  const rail = cylinder(1.3, x1 - x0, 0, 0, 0, steel, 1, 1.3, 16)
  rail.rotation.z = Math.PI / 2
  rail.position.set((x0 + x1) / 2, railY, z)
  g.add(rail)
  for (const bx of [x0 + 4, (x0 + x1) / 2, x1 - 4]) {
    const bracket = cylinder(1, z - wallT / 2, 0, 0, 0, steel, 1, 1, 10)
    bracket.rotation.x = Math.PI / 2
    bracket.position.set(bx, railY, wallT / 2 + (z - wallT / 2) / 2)
    g.add(bracket)
  }
  for (const sx of [x0 + 1, x1 - 1]) {
    const stop = cylinder(2.2, 3, 0, 0, 0, steel, 1, 2.2, 14)
    stop.rotation.z = Math.PI / 2
    stop.position.set(sx, railY, z)
    g.add(stop)
  }
  // Hangers: straps bolted to the top of the panel, each with a wheel riding on the rail.
  for (const s of [-1, 1]) {
    const hx = x + s * pw * 0.3
    for (const face of [-1, 1]) panel.add(box(4, 20, 0.8, hx, 1 + ph - 8, z + face * (pt / 2 + 0.4), steel))
    const wheel = cylinder(4.5, 2.2, 0, 0, 0, steel, 1, 4.5, 20)
    wheel.rotation.x = Math.PI / 2
    wheel.position.set(hx, railY + 3.2, z)
    panel.add(wheel)
  }
  // A bar handle on each face, at the edge that closes the opening.
  const hx = x + pw / 2 - 9
  for (const face of [-1, 1]) {
    panel.add(cylinder(1.1, 32, hx, 86, z + face * (pt / 2 + 3.2), steel, 1, 1.1, 12))
    for (const y of [89, 113]) {
      const post = cylinder(0.7, 3, 0, 0, 0, steel, 1, 0.7, 8)
      post.rotation.x = Math.PI / 2
      post.position.set(hx, y, z + face * (pt / 2 + 1.6))
      panel.add(post)
    }
  }
  return g
}

function slidingDoor(k: Kit, w: number, h: number, wallT: number, glass: Mat) {
  const g = new THREE.Group()
  const alu = k.q(COLORS.dark, 'metal')
  g.add(box(w, 5, wallT * 0.7, 0, h - 5, 0, alu))
  g.add(box(w, 2, wallT * 0.7, 0, 0, 0, alu))
  const pw = w * 0.55
  for (const [s, z] of [
    [-1, -2.2],
    [1, 2.2],
  ]) {
    const x = s * (w / 2 - pw / 2)
    // The room-side panel slides over the other one to open.
    const p = s === 1 ? sliding(-(w - pw), () => {}) : g
    if (p !== g) g.add(p)
    p.add(box(pw - 8, h - 15, 1, x, 7, z, glass))
    for (const e of [-1, 1]) p.add(box(4, h - 7, 3, x + e * (pw / 2 - 2), 2, z, alu))
    for (const y of [2, h - 9]) p.add(box(pw, 4, 3, x, y, z, alu))
    p.add(box(1.4, 40, 2, x - s * (pw / 2 - 8), 85, z + s * 2.5, k.q(COLORS.chrome, 'chrome')))
  }
  return g
}

/** An aluminium door frame set in the middle of the wall. */
function aluFrame(g: THREE.Group, w: number, h: number, wallT: number, alu: Mat) {
  const fd = Math.min(wallT, 8)
  for (const s of [-1, 1]) g.add(box(5, h, fd, s * (w / 2 - 2.5), 0, 0, alu))
  g.add(box(w, 5, fd, 0, h - 5, 0, alu))
}

/** A glazed aluminium leaf, hinged at `hx` like `doorLeaf`: slim frame, kick rail, a middle rail, glass above and below. */
function aluLeaf(k: Kit, g: THREE.Group, hx: number, leaf: number, side: number, h: number, wallT: number, alu: Mat, glass: Mat) {
  const z0 = wallT / 2
  g.add(
    hinged(hx, z0, (side * Math.PI) / 2, (p) => {
      const x = hx + side * 2.25
      const t = 4.5
      const st = 6
      const zc = z0 + leaf / 2
      const inner = leaf - 2 * st
      for (const z of [z0 + st / 2, z0 + leaf - st / 2]) p.add(box(t, h, st, x, 0, z, alu))
      p.add(box(t, 14, inner, x, 0, zc, alu))
      p.add(box(t, 6, inner, x, 95, zc, alu))
      p.add(box(t, 6, inner, x, h - 6, zc, alu))
      p.add(box(0.8, 95 - 14, inner, x, 14, zc, glass))
      p.add(box(0.8, h - 6 - 101, inner, x, 101, zc, glass))
      // Lever handles near the free edge.
      const chrome = k.q(COLORS.chrome, 'chrome')
      const hz = z0 + leaf - 3
      for (const face of [-1, 1]) {
        p.add(box(1.2, 16, 3, x + face * 2.8, 92, hz, alu))
        p.add(box(1.6, 1.8, 12, x + face * 4.4, 99, hz - 6, chrome))
      }
    }),
  )
}

/** Two glazed aluminium panels on two tracks; the room-side one slides over the other to open. */
function aluSliding(k: Kit, w: number, h: number, wallT: number, alu: Mat, glass: Mat) {
  const g = new THREE.Group()
  const fd = Math.min(wallT, 9)
  for (const s of [-1, 1]) g.add(box(4, h, fd, s * (w / 2 - 2), 0, 0, alu))
  g.add(box(w, 6, fd, 0, h - 6, 0, alu))
  g.add(box(w, 2.5, fd, 0, 0, 0, alu))
  const span = w - 8
  const pw = span / 2 + 4
  const y0 = 2.5
  const ph = h - 6 - y0 - 0.5
  const panel = (p: THREE.Group, x: number, z: number, handleSide: number) => {
    const t = 3.2
    for (const e of [-1, 1]) p.add(box(6, ph, t, x + e * (pw / 2 - 3), y0, z, alu))
    p.add(box(pw - 12, 9, t, x, y0, z, alu))
    p.add(box(pw - 12, 6, t, x, y0 + ph - 6, z, alu))
    p.add(box(pw - 12, ph - 15, 0.8, x, y0 + 9, z, glass))
    // A slim pull on the outer stile.
    p.add(box(1.2, 30, 2, x + handleSide * (pw / 2 - 3), 85, z + Math.sign(z) * 2.4, k.q(COLORS.chrome, 'chrome')))
  }
  const xL = -span / 2 + pw / 2
  const xR = span / 2 - pw / 2
  panel(g, xL, -2, -1)
  g.add(sliding(xL - xR, (p) => panel(p, xR, 2, 1)))
  return g
}

function windowUnit(k: Kit, w: number, h: number, wallT: number, glass: Mat, wide: boolean) {
  const g = new THREE.Group()
  const frame = k.q(COLORS.frame, 'satin')
  const f = 6
  const fd = 7
  for (const s of [-1, 1]) g.add(box(f, h, fd, s * (w / 2 - f / 2), 0, 0, frame))
  g.add(box(w, f, fd, 0, 0, 0, frame))
  g.add(box(w, f, fd, 0, h - f, 0, frame))
  const sashes = wide || w >= 110 ? 2 : 1
  if (sashes === 2) g.add(box(f, h, fd, 0, 0, 0, frame))
  const inner = (w - f * (sashes + 1)) / sashes
  for (let i = 0; i < sashes; i++) {
    const x = -w / 2 + f + inner / 2 + i * (inner + f)
    // Sash frame around the glass.
    for (const s of [-1, 1]) g.add(box(3.5, h - 2 * f, 4.5, x + s * (inner / 2 - 1.75), f, 1, frame))
    for (const y of [f, h - f - 3.5]) g.add(box(inner, 3.5, 4.5, x, y, 1, frame))
    g.add(box(inner - 7, h - 2 * f - 7, 0.8, x, f + 3.5, 1, glass))
    // Handle on the inside, by the middle post.
    const hx = sashes === 2 ? (i === 0 ? x + inner / 2 - 4 : x - inner / 2 + 4) : x + inner / 2 - 4
    g.add(box(1.4, 11, 1.6, hx, h / 2 - 6, 4.2, k.q(COLORS.chrome, 'chrome')))
  }
  g.add(rbox(w + 8, 3, wallT / 2 + 4, 0.8, 0, -3, wallT / 4 + 2, k.q(COLORS.white, 'satin'))) // inside sill
  g.add(box(w + 4, 3, wallT / 2 + 4, 0, -4, -(wallT / 4 + 2), k.q(COLORS.stone, 'satin'))) // outside sill
  return g
}

// ---------- balconies ----------

/**
 * A balcony's railing along the given runs (its open edges), in world position. Glass panels on a
 * metal shoe, metal balusters, or a solid parapet with a coping stone.
 */
export function railingModel(room: Room, runs: { a: Point; b: Point }[], mats: Materials, hl: boolean, base: number): THREE.Group {
  const g = new THREE.Group()
  const style = room.railing?.style ?? 'glass'
  if (style === 'none') return g
  const h = room.railing?.height ?? 105
  const t = room.wallThickness
  const sa = signedArea(room.points)
  const q = (color: string, finish?: Finish) => mats.get(color, hl, finish)
  for (const { a, b } of runs) {
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    if (L < 2) continue
    // Centered on the railing band, which lies just outside the balcony's edge.
    const n = inwardNormal(a, b, sa)
    const seg = new THREE.Group()
    seg.position.set((a.x + b.x) / 2 - (n.x * t) / 2, base, (a.y + b.y) / 2 - (n.y * t) / 2)
    seg.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x)
    if (style === 'glass') {
      seg.add(box(L, 8, t, 0, 0, 0, q(COLORS.dark, 'metal')))
      seg.add(box(L - 0.5, h - 13, 1.2, 0, 8, 0, mats.glass()))
      seg.add(rbox(L, 4.5, t + 1, 1.8, 0, h - 5, 0, q(COLORS.chrome, 'chrome')))
    } else if (style === 'metal') {
      const metal = q(COLORS.dark, 'metal')
      seg.add(rbox(L, 4, t + 1, 1.5, 0, h - 4, 0, metal))
      seg.add(box(L, 3, 3, 0, 8, 0, metal))
      for (const e of [-1, 1]) seg.add(box(4, h - 4, 4, e * (L / 2 - 2), 0, 0, metal))
      const count = Math.max(1, Math.round(L / 12))
      for (let i = 1; i < count; i++) seg.add(box(1.6, h - 15, 1.6, -L / 2 + (i * L) / count, 11, 0, metal))
    } else {
      seg.add(box(L, h - 5, t, 0, 0, 0, q(COLORS.wall)))
      seg.add(rbox(L + 1, 5, t + 5, 1, 0, h - 5, 0, q(COLORS.stone, 'satin')))
    }
    g.add(seg)
  }
  return g.children.length ? compact(g) : g
}

// ---------------------------------------------------------------------------

/** The 3D model for a symbol (not light fixtures), in its local frame. Empty for symbols without one. */
export function symbolModel(
  sym: PlanSymbol,
  mats: Materials,
  hl: boolean,
  wallT: number,
  floorH: number,
  hasDef: boolean,
  rooms: Room[] = [],
  ceilingH = floorH,
  wash?: CurtainWash,
): THREE.Group {
  const k: Kit = {
    q: (color, finish) => mats.get(color, hl, finish),
    glass: () => mats.glass(),
    tinted: () => mats.tinted(),
    sheer: (color, opacity) => mats.sheer(color, opacity),
    top: (id) => worktopMaterial(worktopOf({ top: id ?? sym.top }), hl),
  }
  const w = sym.width
  const d = sym.depth
  const h = sym.height
  let g = new THREE.Group()

  switch (sym.type) {
    case 'door':
      doorFrame(k, g, w, h, wallT)
      doorLeaf(k, g, -w / 2 + 3, w - 6, 1, h - 3, wallT)
      break
    case 'door-double':
      doorFrame(k, g, w, h, wallT)
      doorLeaf(k, g, -w / 2 + 3, w / 2 - 3, 1, h - 3, wallT)
      doorLeaf(k, g, w / 2 - 3, w / 2 - 3, -1, h - 3, wallT)
      break
    case 'door-sliding':
      g = slidingDoor(k, w, h, wallT, k.glass())
      break
    case 'door-barn':
      g = barnDoor(k, w, h, wallT)
      break
    case 'door-alu':
    case 'door-alu-double':
    case 'door-alu-sliding': {
      const fr = frameOf(sym)!
      const alu = k.q(fr.hex, fr.metal ? 'metal' : 'satin')
      if (sym.type === 'door-alu-sliding') {
        g = aluSliding(k, w, h, wallT, alu, k.glass())
        break
      }
      aluFrame(g, w, h, wallT, alu)
      if (sym.type === 'door-alu') aluLeaf(k, g, -w / 2 + 5, w - 10, 1, h - 5, wallT, alu, k.glass())
      else {
        aluLeaf(k, g, -w / 2 + 5, w / 2 - 5, 1, h - 5, wallT, alu, k.glass())
        aluLeaf(k, g, w / 2 - 5, w / 2 - 5, -1, h - 5, wallT, alu, k.glass())
      }
      break
    }
    case 'window':
    case 'window-wide':
      g = windowUnit(k, w, h, wallT, k.glass(), sym.type === 'window-wide')
      break
    case 'sofa':
      // Longer sofas get more seats; arms and back keep their size.
      g = sofa(k, w, d, h, seatsAlong(w - 2 * Math.min(SOFA.arm, w * 0.09)))
      break
    case 'sofa-corner':
      g = cornerSofa(k, w, d, h)
      break
    case 'armchair':
      g = sofa(k, w, d, h, 1)
      break
    case 'coffee-table':
      g = coffeeTable(k, w, d, h)
      break
    case 'sofa-table':
      g = sofaTable(k, w, d, h)
      break
    case 'dressing-table':
      g = dressingTable(k, sym, w, d, h)
      break
    case 'ac-split':
      g = acSplit(k, w, d, h)
      break
    case 'ac-cassette':
      g = acCassette(k, w, d, ceilingH)
      break
    case 'ac-slot':
      g = acSlot(k, w, d, ceilingH)
      break
    case 'ac-floor':
      g = acFloor(k, w, d, h)
      break
    case 'ac-outdoor':
      g = acOutdoor(k, w, d, h)
      break
    case 'desk':
      g = desk(k, w, d, h)
      break
    case 'dining-table': {
      g = table(k, w, d, h)
      const n = chairsAlong(w)
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (w * (i + 0.5)) / n
        g.add(chair(k, x, -d / 2 - 10, 0), chair(k, x, d / 2 + 10, 180))
      }
      break
    }
    case 'round-table': {
      g.add(cylinder(w / 2, 3.5, 0, h - 3.5, 0, k.q(COLORS.wood, 'wood'), d / w, w / 2 - 0.8, 48))
      const base = Math.min(28, w * 0.3)
      g.add(lathe([[0.1, 0], [base, 0], [base, 1.5], [base * 0.5, 4], [4.5, 10], [3.5, h - 12], [9, h - 4], [0.1, h - 4]], 0, 0, 0, k.q(COLORS.woodDark, 'wood')))
      g.add(chair(k, 0, -d / 2 - 8, 0), chair(k, 0, d / 2 + 8, 180))
      g.add(chair(k, -w / 2 - 8, 0, -90), chair(k, w / 2 + 8, 0, 90))
      break
    }
    case 'chair':
      g.add(chair(k, 0, 0, 0, w, d))
      break
    case 'plant':
      g = plant(k, sym, w, h)
      break
    case 'bed-double':
      g = bed(k, w, d, h, 2)
      break
    case 'bed-single':
      g = bed(k, w, d, h, 1)
      break
    case 'bathtub':
      g = bathtub(k, w, d, h)
      break
    case 'shower': {
      // Glass where chosen, or on the sides not against a wall; the model is mirrored by flips, the sides with it.
      const flip = (s: Side): Side =>
        sym.flipX && (s === 'left' || s === 'right') ? (s === 'left' ? 'right' : 'left') : sym.flipY && (s === 'front' || s === 'back') ? (s === 'front' ? 'back' : 'front') : s
      g = shower(k, w, d, h, k.glass(), new Set((sym.screens ?? openSides(sym, rooms)).map(flip)), sym.doors ?? 'hinged')
      break
    }
    case 'shower-quadrant':
      g = quadrantShower(k, w, d, h, k.glass(), sym.doors ?? 'sliding')
      break
    case 'wall-post':
      g = wallPost(k, w, d, floorH)
      break
    case 'curtain':
      g = curtain(k, sym, w, d, ceilingH, wash)
      break
    case 'display-cabinet':
      g = displayCabinet(k, sym, w, d, h)
      break
    case 'sideboard':
      g = sideboard(k, sym, w, d, h)
      break
    case 'coffee-corner':
      g = coffeeCorner(k, sym, w, d, h)
      break
    case 'blind':
      g = blind(k, sym, w, d, h, ceilingH)
      break
    case 'toilet':
      g = toilet(k, w, d, h)
      break
    case 'washbasin':
      g = washbasin(k, w, d, h)
      break
    case 'bath-vanity':
      g = bathVanity(k, sym, w, d, h)
      break
    case 'shower-niche':
      g = showerNiche(k, sym, w, h, wallT)
      break
    case 'towel-rail':
      g = towelRail(k, sym, w, d, h)
      break
    case 'towel-radiator':
      g = towelRadiator(k, sym, w, d, h)
      break
    case 'wall-cabinet':
      g = wallCabinet(k, sym, w, d, h)
      break
    case 'range-hood':
      g = rangeHood(k, sym, w, d, h, ceilingH - (sym.elevation ?? 155) - h)
      break
    case 'counter':
      g = kitchen(k, w, d, h, { top: sym.top })
      break
    case 'kitchen-corner':
      g = kitchenCorner(k, w, d, h)
      break
    case 'kitchen-sink':
      g = kitchen(k, w, d, h, { sink: true, top: sym.top })
      break
    case 'stove':
      g = kitchen(k, w, d, h, { stove: true, top: sym.top })
      break
    case 'fridge':
      g = fridge(k, w, d, h)
      break
    case 'dishwasher':
      g = dishwasher(k, sym, w, d, h)
      break
    case 'washing-machine':
      g = washingMachine(k, sym, w, d, h)
      break
    case 'oven-tower':
      g = ovenTower(k, sym, w, d, h)
      break
    case 'kitchen-island':
      g = kitchenIsland(k, sym, w, d, h)
      break
    case 'tv-unit':
      g = tvUnit(k, w, d, h)
      break
    case 'tv-stand':
      g = tvUnit(k, w, d, h, false)
      break
    case 'tv':
      g = tv(k, w, d, h, sym.elevation ?? 100)
      break
    case 'wardrobe':
      g = wardrobe(k, w, d, h, { doors: sym.doors ?? 'hinged', glass: !!sym.glass })
      break
    case 'wardrobe-corner':
      g = cornerWardrobe(k, w, d, h, { doors: sym.doors ?? 'hinged', glass: !!sym.glass })
      break
    case 'bookshelf':
      g = bookshelf(k, sym, w, d, h)
      break
    case 'nightstand':
      g = nightstand(k, w, d, h)
      break
    case 'stairs':
      g = stairs(k, w, d, h)
      break
    case 'column':
      g.add(rbox(w, floorH, d, 1, 0, 0, 0, k.q(COLORS.wall)))
      break
    case 'outlet': {
      // Plate on the wall behind the symbol, at its mounting height.
      const y = h || 30
      g.add(rbox(8.5, 8.5, 1, 0.5, 0, y - 4.25, -d / 2 + 0.5, k.q(COLORS.white, 'satin')))
      for (const s of [-1, 1]) g.add(box(0.8, 0.8, 0.4, s * 1.6, y - 0.4, -d / 2 + 1.1, k.q(COLORS.dark)))
      break
    }
    case 'light':
      g.add(cylinder(w / 2, 3, 0, floorH - 3, 0, mats.emissive(COLORS.light)))
      break
    case 'opening':
    case 'label':
    case 'switch':
      break
    default:
      if (hasDef) g.add(rbox(w, h || 50, d, 2, 0, 0, 0, k.q(COLORS.fabric2)))
  }
  return g.children.length ? compactModel(g) : g
}
