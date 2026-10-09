/**
 * 3D gypsum ceilings and light fixtures.
 *
 * Everything is built in plan centimeters (X = x, Y = up, Z = plan y); the viewer scales the
 * scene to meters so three.js' physically based light falloff behaves realistically.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { inwardNormal, offsetEdges, pointInPolygon, projectOnSegment, signedArea } from '@/model/geometry'
import { bandEdge, ceilingDropAt, ceilingHeightAt, ceilingLight, ceilingOutline, ceilingRoom, ceilingZones, COVE_WIDTH, coveRuns, gapDrops, hiddenLightInGap, lightHex, onCeilingJoin, SHADOW_GAP } from '@/model/lighting'
import { symbolPose } from '@/model/project'
import { frameOf, styleOf } from '@/model/symbols'
import type { FixtureKind } from '@/model/symbols'
import type { Floor, PlanSymbol, Point, Room } from '@/model/types'
import { washMap } from './furniture'
import type { VirtualLight } from './lightPool'

const CM = 0.01 // RectAreaLight sizes ignore parent scale, so they're given in meters

/** Lets the viewer switch a fixture on/off and dim it without rebuilding the scene. */
export interface LightHandle {
  floorId: string
  id: string
  /** Its lights: virtual ones, lent a real light by the viewer's light pool when they matter (see lightPool). */
  lights: VirtualLight[]
  emissive: THREE.MeshStandardMaterial[]
  /** Glow halos while building; `bakeGlows` then turns them into points of one shared cloud (`glowAt`, with colors). */
  glows: THREE.Sprite[]
  glowAt: number[]
  glowColors: THREE.Color[]
  /** Soft washes of light on what it lights (strip lights), and how strong at full brightness. */
  washes?: { m: THREE.Material; base: number }[]
}

export interface SwitchHandle {
  floorId: string
  id: string
  indicator: THREE.MeshStandardMaterial
}

// ---------------------------------------------------------------------------
// Ceilings

const gypsum = () => new THREE.MeshStandardMaterial({ color: '#f5f5f4', roughness: 0.95 })

/** Downward-facing plane (visible from below only) covering `outer` minus `inner`, at height y. */
function ceilingPlane(outer: Point[], inner: Point[] | undefined, y: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x, p.y)))
  if (inner) shape.holes.push(new THREE.Path(inner.map((p) => new THREE.Vector2(p.x, p.y))))
  const g = new THREE.ShapeGeometry(shape)
  g.deleteAttribute('uv') // match the vertical bands so everything merges into one mesh
  g.rotateX(Math.PI / 2) // normal now points down
  g.translate(0, y, 0)
  return g
}

/**
 * Vertical faces along a polygon between heights y0 and y1, facing into (or out of) the polygon; only along the sides
 * `keep` keeps, if given.
 */
function band(poly: Point[], y0: number, y1: number, facing: 'in' | 'out', keep?: (a: Point, b: Point) => boolean): THREE.BufferGeometry {
  const inward = signedArea(poly) >= 0
  const flip = (facing === 'in') !== inward
  const pos: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (keep && !keep(a, b)) continue
    const A0 = [a.x, y0, a.y]
    const B0 = [b.x, y0, b.y]
    const B1 = [b.x, y1, b.y]
    const A1 = [a.x, y1, a.y]
    const tris = flip ? [A0, B1, B0, A0, A1, B1] : [A0, B0, B1, A0, B1, A1]
    for (const v of tris) pos.push(...v)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

export function buildCeilings(floor: Floor, base: number): THREE.Object3D[] {
  const H = base + floor.height
  const geos: THREE.BufferGeometry[] = []
  const gapGeos: THREE.BufferGeometry[] = []
  for (const plain of floor.rooms) {
    // Balconies are open to the sky.
    if (plain.points.length < 3 || plain.kind) continue
    // Around the columns in its walls.
    const room = ceilingRoom(plain, floor)
    const c = room.ceiling
    // Shadow gaps: the ceiling that meets the wall stops short of it, leaving a dark groove. Curtain pockets: it stops
    // further short, leaving a pocket up to the slab for the curtain track.
    const gaps = room.shadowGaps?.filter((i) => i < room.points.length) ?? []
    const wallCeiling = !c || c.style === 'floating' ? 'structure' : 'gypsum'
    // Curtain pockets and a hidden light's gap: open up to the slab.
    const pockets = wallCeiling === 'gypsum' ? [...new Set([...(room.curtainPockets ?? []), ...(room.hiddenGaps ?? [])])].filter((i) => i < room.points.length) : []
    const cut = wallCeiling === 'gypsum' ? ceilingOutline(room) : gaps.length ? offsetEdges(room.points, room.points.map((_, i) => (gaps.includes(i) ? -SHADOW_GAP.width : undefined))) : room.points
    geos.push(ceilingPlane(wallCeiling === 'structure' ? cut : room.points, undefined, H - 0.2))
    if (gaps.length) {
      const surface = wallCeiling === 'structure' ? H - 0.2 : H - c!.drop
      const top = Math.min(surface + SHADOW_GAP.depth, H - 0.1)
      for (const i of gaps) {
        if (pockets.includes(i)) continue
        const j = (i + 1) % room.points.length
        gapGeos.push(ceilingPlane([room.points[i], room.points[j], cut[j], cut[i]], undefined, top))
        if (top > surface + 0.5) geos.push(band([cut[i], cut[j]], surface, top, 'in'))
      }
    }
    for (const i of pockets) {
      const j = (i + 1) % room.points.length
      geos.push(band([cut[i], cut[j]], H - c!.drop, H - 0.2, 'in'))
    }
    // Open to the next room: wherever its ceiling is lower along the line, a gypsum face closes the step up to the
    // other's (none where they're level: one ceiling).
    for (const i of room.openEdges ?? []) {
      const a = room.points[i]
      const b = room.points[(i + 1) % room.points.length]
      if (!a || !b) continue
      const n = inwardNormal(a, b, signedArea(room.points))
      const L = Math.hypot(b.x - a.x, b.y - a.y)
      const at = (t: number, side: number) => ({ x: a.x + ((b.x - a.x) * t) / L + n.x * side, y: a.y + ((b.y - a.y) * t) / L + n.y * side })
      const mid = at(L / 2, -1)
      const plainOther = floor.rooms.find((r) => r.id !== plain.id && !r.kind && r.points.length >= 3 && pointInPolygon(mid, r.points))
      const other = plainOther && ceilingRoom(plainOther, floor)
      // Each centimetre along it: how low each side's ceiling is; a face over each stretch where this side's is lower.
      let run: { t: number; mine: number; theirs: number } | null = null
      const close = (t: number) => {
        if (run && run.mine > run.theirs + 0.5 && t - run.t > 0.5) geos.push(band([at(run.t, 0), at(t, 0)], H - run.mine, H - run.theirs, 'in'))
      }
      for (let t = 0.5; t < L; t += 1) {
        const mine = ceilingDropAt(room, at(t, 1))
        const theirs = other ? ceilingDropAt(other, at(t, -1)) : 0
        if (!run || run.mine !== mine || run.theirs !== theirs) {
          close(Math.max(0, t - 0.5))
          run = { t: Math.max(0, t - 0.5), mine, theirs }
        }
      }
      close(L)
    }
    if (!c) continue
    ceilingZones(room).forEach((z) => geos.push(ceilingPlane(z.outer, z.inner, H - z.drop)))
    const keep = (p: Point, q: Point) => !onCeilingJoin(room, p, q)
    switch (c.style) {
      case 'tray':
        geos.push(band(bandEdge(room), H - c.drop, H, 'in', keep))
        break
      case 'stepped':
        geos.push(band(bandEdge(room), H - c.drop, H - c.drop / 2, 'in', keep))
        geos.push(band(bandEdge(room, 2), H - c.drop / 2, H, 'in', keep))
        break
      case 'cove':
        // A lip at the edge of the band hides the LED; behind it the trough rises to the ceiling.
        geos.push(band(bandEdge(room), H - c.drop, H - c.drop + 8, 'in', keep))
        geos.push(band(bandEdge(room, 1, -COVE_WIDTH), H - c.drop + 1, H, 'in', keep))
        break
      case 'floating':
        geos.push(band(bandEdge(room), H - c.drop, H - c.drop + 6, 'out', keep))
        break
    }
  }
  const out: THREE.Object3D[] = []
  if (gapGeos.length) {
    const merged = mergeGeometries(gapGeos.map((g) => g.toNonIndexed()))
    gapGeos.forEach((g) => g.dispose())
    if (merged) out.push(new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: '#1c1917', roughness: 1 })))
  }
  if (geos.length) {
    const merged = mergeGeometries(geos.map((g) => g.toNonIndexed()))
    geos.forEach((g) => g.dispose())
    if (merged) {
      merged.computeVertexNormals()
      const m = new THREE.Mesh(merged, gypsum())
      m.receiveShadow = true
      out.push(m)
    }
  }
  // Free-standing gypsum boxes (e.g. over a kitchen counter) and beams. The top is hidden so the view from above stays
  // clear.
  for (const s of floor.symbols) {
    if (s.type !== 'gypsum-box' && s.type !== 'beam') continue
    const drop = s.height || 30
    const hidden = new THREE.MeshBasicMaterial({ visible: false })
    const mat = gypsum()
    const box = new THREE.Mesh(new THREE.BoxGeometry(s.width, drop, s.depth), [mat, mat, hidden, mat, mat, mat])
    box.position.set(s.x, H - drop / 2, s.y)
    box.rotation.y = (-s.rotation * Math.PI) / 180
    box.userData.pick = { floorId: floor.id, kind: 'symbol', id: s.id }
    out.push(box)
  }
  return out
}

// ---------------------------------------------------------------------------
// Fixtures

let glowTexture: THREE.Texture | null = null
function glowMap() {
  if (glowTexture) return glowTexture
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  glowTexture = new THREE.CanvasTexture(c)
  glowTexture.colorSpace = THREE.SRGBColorSpace
  return glowTexture
}

interface Ctx {
  color: THREE.Color
  brightness: number
  handle: LightHandle
  /** The room the fixture is in. */
  room?: string
}

function lens(ctx: Ctx, geo: THREE.BufferGeometry) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: ctx.color, emissiveIntensity: 0, roughness: 0.4 })
  m.userData.lens = true // lit by the light state, so it's left alone when highlighting a selection
  ctx.handle.emissive.push(m)
  return new THREE.Mesh(geo, m)
}

function glow(ctx: Ctx, size: number, x: number, y: number, z: number) {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowMap(), color: ctx.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  )
  s.scale.set(size, size, 1)
  s.position.set(x, y, z)
  ctx.handle.glows.push(s)
  return s
}

/** Overall calibration of fixture output against the day/night ambient light. */
const OUTPUT = 0.7

/** A fixture's light, as a virtual light at (x, y, z) in the group's frame (see lightPool). */
function virtual(ctx: Ctx, g: THREE.Object3D, kind: VirtualLight['kind'], x: number, y: number, z: number, base: number, more: Partial<VirtualLight> = {}) {
  const anchor = new THREE.Object3D()
  anchor.position.set(x, y, z)
  g.add(anchor)
  const b = base * ctx.brightness * OUTPUT
  const v: VirtualLight = { kind, anchor, color: ctx.color, base: b, intensity: b, room: ctx.room, ...more }
  ctx.handle.lights.push(v)
  return v
}

/** Spot light shining straight down. */
function spotLight(ctx: Ctx, g: THREE.Group, x: number, y: number, z: number, intensity: number, angle: number) {
  virtual(ctx, g, 'spot', x, y, z, intensity, { angle, penumbra: 0.65 })
}

/** Area light facing down (or up), `w` × `h` cm, centered at (x, y, z) in the group's frame. */
function areaLight(ctx: Ctx, g: THREE.Group, w: number, h: number, x: number, y: number, z: number, intensity: number, up = false) {
  const v = virtual(ctx, g, 'rect', x, y, z, intensity, { width: Math.max(w, 1) * CM, height: Math.max(h, 1) * CM })
  v.anchor.rotation.x = up ? Math.PI / 2 : -Math.PI / 2
}

/** Light shining all around. */
function pointLight(ctx: Ctx, g: THREE.Group, x: number, y: number, z: number, intensity: number) {
  virtual(ctx, g, 'point', x, y, z, intensity)
}

const dark = () => new THREE.MeshStandardMaterial({ color: '#27272a', roughness: 0.5, metalness: 0.3 })
const white = () => new THREE.MeshStandardMaterial({ color: '#fafafa', roughness: 0.6 })
/** The fixture's chosen frame finish (painted, or shiny metal), or `fallback` for fixtures without a choice. */
function frameMat(sym: PlanSymbol, fallback: () => THREE.MeshStandardMaterial) {
  const f = frameOf(sym)
  if (!f) return fallback()
  return new THREE.MeshStandardMaterial({ color: f.hex, roughness: f.metal ? 0.3 : 0.55, metalness: f.metal ? 0.85 : 0 })
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  return m
}

/** Flat ring lying in the ceiling plane. */
function ring(r: number, tube: number, mat: THREE.Material, x: number, y: number, z: number) {
  const m = mesh(new THREE.TorusGeometry(r, tube, 8, 40), mat, x, y, z)
  m.rotation.x = Math.PI / 2
  return m
}

/** Thin rod from a to b. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const len = a.distanceTo(b)
  const m = mesh(new THREE.CylinderGeometry(r, r, len, 8), mat)
  m.position.copy(a).add(b).multiplyScalar(0.5)
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
  return m
}

/** A shadow gap's LED: high in the groove where the ceiling stops short of the walls, washing the walls below. */
/** How bright every hidden LED strip is (cove, shadow gap, curtain pocket), and its wash. */
const STRIP_OUTPUT = 18
const STRIP_WASH = 0.45

/** A quad with corners p0…p3 (world), its texture's top (v = 1) along p0–p1. */
function quad(p: THREE.Vector3[]) {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([p[0], p[1], p[2], p[0], p[2], p[3]].flatMap((v) => [v.x, v.y, v.z]), 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0], 2))
  return geo
}

/**
 * A room's hidden LED strip, whichever it is (cove, hidden light, shadow gap or curtain pocket light): the same strip
 * and output, and when it shines down, a soft wash down the wall below, so it shows lit from anywhere, whether or not
 * it has one of the few real lights at the moment (see lightPool).
 */
function stripFixture(ctx: Ctx, room: Room, floor: Floor, base: number, sym: PlanSymbol): THREE.Group {
  const g = new THREE.Group()
  const { runs, up, drop } = coveRuns(room, sym)
  const H = base + floor.height
  const y = H - drop
  // From a gap or pocket (or a hidden light's gap) the light comes out at its mouth.
  const inGroove = sym.type === 'gap-light' || sym.type === 'pocket-light' || hiddenLightInGap(room, sym)
  const mouth = inGroove ? gapDrops(room, sym).mouth : drop
  const pts = room.points
  const sa = signedArea(pts)
  const washes = (ctx.handle.washes ??= [])
  const washMat = () => {
    const m = new THREE.MeshBasicMaterial({ color: ctx.color, map: washMap(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    washes.push({ m, base: STRIP_WASH * ctx.brightness })
    return m
  }
  for (const { a, b, edge } of runs) {
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 5) continue
    const seg = new THREE.Group()
    seg.position.set((a.x + b.x) / 2, y, (a.y + b.y) / 2)
    seg.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x)
    seg.add(lens(ctx, new THREE.BoxGeometry(len, 1, 1.5)))
    areaLight(ctx, seg, len, 4, 0, up ? 1 : -(mouth - drop) - 1, 0, STRIP_OUTPUT, up)
    g.add(seg)
    const wa = pts[edge]
    const wb = pts[(edge + 1) % pts.length]
    if (!wa || !wb) continue
    const n = inwardNormal(wa, wb, sa)
    const V = (p: { x: number; y: number }, h: number, out = 0) => new THREE.Vector3(p.x + n.x * out, h, p.y + n.y * out)
    if (!up) {
      // Down the wall below, from where the light comes out.
      const pa = projectOnSegment(a, wa, wb).point
      const pb = projectOnSegment(b, wa, wb).point
      const top = H - mouth
      g.add(new THREE.Mesh(quad([V(pa, top, 0.5), V(pb, top, 0.5), V(pb, top - 75, 0.5), V(pa, top - 75, 0.5)]), washMat()))
    }
  }
  return g
}

const brass = () => new THREE.MeshStandardMaterial({ color: '#b08d57', metalness: 0.8, roughness: 0.3 })
const twoSided = <T extends THREE.Mesh>(m: T) => {
  ;(m.material as THREE.Material).side = THREE.DoubleSide
  return m
}

/** A pendant light in one of its styles (see PENDANT_STYLES): radius r, shade height h, its bottom at `hang`. */
function pendant(ctx: Ctx, g: THREE.Group, style: string, r: number, h: number, hang: number, top: number) {
  const cord = (y: number, x = 0, z = 0) => g.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, Math.max(1, top - y), 6), dark(), x, (top + y) / 2, z))
  const metal = style === 'drum' || style === 'lantern' || style === 'bell' ? brass() : dark()
  g.add(mesh(new THREE.CylinderGeometry(5, 5, 2, 24), metal, 0, top - 1, 0)) // ceiling canopy
  switch (style) {
    case 'dome': {
      // A smooth metal half sphere, open at the bottom.
      cord(hang + h)
      const shell = twoSided(mesh(new THREE.SphereGeometry(r, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2), metal, 0, hang, 0))
      shell.scale.y = h / r
      g.add(shell)
      g.add(lens(ctx, new THREE.SphereGeometry(3.5, 16, 12)).translateY(hang + h * 0.3))
      g.add(glow(ctx, r * 2.2, 0, hang + 1, 0))
      spotLight(ctx, g, 0, hang + h * 0.25, 0, 10, 0.8)
      pointLight(ctx, g, 0, hang + h * 0.3, 0, 2)
      break
    }
    case 'globe': {
      // A frosted glass sphere glowing all over, on a small cap.
      cord(hang + 2 * r)
      g.add(mesh(new THREE.CylinderGeometry(2.5, 3.5, 3, 20), brass(), 0, hang + 2 * r - 1, 0))
      g.add(lens(ctx, new THREE.SphereGeometry(r, 32, 20)).translateY(hang + r))
      g.add(glow(ctx, r * 3, 0, hang + r, 0))
      pointLight(ctx, g, 0, hang + r, 0, 5)
      break
    }
    case 'ring': {
      // A glowing ring on three thin wires.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2
        g.add(rod(new THREE.Vector3(0, top - 2, 0), new THREE.Vector3(Math.cos(a) * (r - 1.5), hang + 1.5, Math.sin(a) * (r - 1.5)), 0.12, dark()))
      }
      g.add(ring(r - 1.5, 1.6, dark(), 0, hang + 1.5, 0))
      const glowRing = lens(ctx, new THREE.TorusGeometry(r - 1.5, 0.9, 10, 64))
      glowRing.rotation.x = Math.PI / 2
      glowRing.position.y = hang + 0.6
      g.add(glowRing)
      g.add(glow(ctx, r * 2.4, 0, hang, 0))
      spotLight(ctx, g, 0, hang, 0, 10, 1)
      pointLight(ctx, g, 0, hang + 1, 0, 3)
      break
    }
    case 'cluster': {
      // Small globes on cords of different lengths.
      const drops = [0, 14, 6, 22, 10]
      drops.forEach((drop, i) => {
        const a = (i / drops.length) * Math.PI * 2
        const x = Math.cos(a) * r * 0.55
        const z = Math.sin(a) * r * 0.55
        const b = Math.max(6, r * 0.25)
        const y = hang + drop
        cord(y + 2 * b, x, z)
        g.add(lens(ctx, new THREE.SphereGeometry(b, 20, 14)).translateX(x).translateY(y + b).translateZ(z))
        g.add(glow(ctx, b * 3, x, y + b, z))
      })
      pointLight(ctx, g, 0, hang + 15, 0, 5)
      spotLight(ctx, g, 0, hang + 5, 0, 6, 1)
      break
    }
    case 'drum': {
      // A fabric drum shade lit from inside, with rims at the top and bottom.
      cord(hang + h)
      g.add(twoSided(lens(ctx, new THREE.CylinderGeometry(r, r, h, 48, 1, true)).translateY(hang + h / 2)))
      for (const y of [hang, hang + h]) g.add(ring(r, 0.4, metal, 0, y, 0))
      g.add(glow(ctx, r * 2.6, 0, hang + h / 2, 0))
      pointLight(ctx, g, 0, hang + h / 2, 0, 4)
      spotLight(ctx, g, 0, hang + 2, 0, 7, 0.9)
      break
    }
    case 'lantern': {
      // A square frame with glass panes and a pointed cap, a light inside.
      cord(hang + h + 8)
      const s = r * 1.6
      for (const [x, z] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        g.add(mesh(new THREE.BoxGeometry(1.2, h, 1.2), metal, (x * s) / 2, hang + h / 2, (z * s) / 2))
      }
      g.add(mesh(new THREE.BoxGeometry(s + 2, 1.5, s + 2), metal, 0, hang, 0))
      const cap = mesh(new THREE.ConeGeometry(s * 0.78, 9, 4), metal, 0, hang + h + 4.5, 0)
      cap.rotation.y = Math.PI / 4
      g.add(cap)
      g.add(lens(ctx, new THREE.BoxGeometry(s - 1.5, h - 3, s - 1.5)).translateY(hang + h / 2))
      g.add(glow(ctx, s * 2, 0, hang + h / 2, 0))
      pointLight(ctx, g, 0, hang + h / 2, 0, 4)
      break
    }
    case 'bell': {
      // A glass bell with a brass cap, the bulb showing through.
      cord(hang + h + 3)
      const profile = [
        [r, 0],
        [r * 0.96, h * 0.12],
        [r * 0.78, h * 0.4],
        [r * 0.5, h * 0.75],
        [r * 0.32, h * 0.95],
        [r * 0.3, h],
      ].map(([x, y]) => new THREE.Vector2(x, y))
      g.add(twoSided(lens(ctx, new THREE.LatheGeometry(profile, 40)).translateY(hang)))
      g.add(mesh(new THREE.CylinderGeometry(r * 0.3, r * 0.34, 4, 24), metal, 0, hang + h + 1, 0))
      g.add(ring(r, 0.35, metal, 0, hang, 0))
      g.add(glow(ctx, r * 2.4, 0, hang + h * 0.4, 0))
      spotLight(ctx, g, 0, hang + h * 0.4, 0, 9, 0.85)
      pointLight(ctx, g, 0, hang + h * 0.45, 0, 3)
      break
    }
    default: {
      // Cone: an industrial metal cone, the bulb inside.
      cord(hang + h)
      g.add(twoSided(mesh(new THREE.CylinderGeometry(4, r, h, 32, 1, true), dark(), 0, hang + h / 2, 0)))
      g.add(lens(ctx, new THREE.SphereGeometry(4, 16, 12)).translateY(hang + h * 0.35))
      g.add(glow(ctx, r * 2.2, 0, hang + 2, 0))
      spotLight(ctx, g, 0, hang + h * 0.3, 0, 10, 0.75)
      pointLight(ctx, g, 0, hang + h * 0.3, 0, 2.5)
    }
  }
}

/**
 * A light fixture (or switch) with its three.js lights. Returns the object in world position,
 * or null for things that have no 3D form.
 */
export function buildFixture(
  sym: PlanSymbol,
  kind: FixtureKind,
  floor: Floor,
  base: number,
  handles: { lights: LightHandle[]; switches: SwitchHandle[] },
): THREE.Object3D | null {
  const pose = symbolPose(sym, floor.rooms)
  const pick = { floorId: floor.id, kind: 'symbol' as const, id: sym.id }

  if (kind === 'switch') {
    const g = new THREE.Group()
    const plate = mesh(new RoundedBoxGeometry(8.5, 12.5, 1.2, 2, 0.45), white())
    const indicator = new THREE.MeshStandardMaterial({ color: '#22c55e', emissive: '#22c55e', emissiveIntensity: 1 })
    plate.add(mesh(new RoundedBoxGeometry(5.2, 7.6, 1, 2, 0.35), white(), 0, -0.8, 0.5)) // rocker
    plate.add(mesh(new THREE.BoxGeometry(1.2, 1.2, 0.6), indicator, 0, 4.6, 0.8))
    g.add(plate)
    g.position.set(pose.x, base + (sym.height || 110), pose.y)
    // Local +Z is the symbol's local +y, which points into the room; the plate sits on the wall behind.
    g.rotation.y = (-pose.rotation * Math.PI) / 180
    plate.position.z = -(sym.depth / 2 - 0.6)
    g.traverse((o) => (o.userData.pick = pick))
    handles.switches.push({ floorId: floor.id, id: sym.id, indicator })
    return g
  }

  const handle: LightHandle = { floorId: floor.id, id: sym.id, lights: [], emissive: [], glows: [], glowAt: [], glowColors: [] }
  const ctx: Ctx = {
    color: new THREE.Color(lightHex(sym.light)),
    brightness: sym.light?.brightness ?? 1,
    handle,
    room: kind === 'cove' || kind === 'gap' ? sym.room : floor.rooms.find((r) => pointInPolygon(pose, r.points))?.id,
  }
  handles.lights.push(handle)

  if (kind === 'cove' || kind === 'gap') {
    const plain = floor.rooms.find((r) => r.id === sym.room)
    if (!plain) return null
    const room = ceilingRoom(plain, floor)
    const g = stripFixture(ctx, room, floor, base, ceilingLight(sym, room))
    g.traverse((o) => (o.userData.pick = pick))
    return g
  }

  const top = base + ceilingHeightAt(floor, pose)
  const g = new THREE.Group()
  g.position.set(pose.x, 0, pose.y)
  g.rotation.y = (-pose.rotation * Math.PI) / 180
  const w = sym.width
  const d = sym.depth
  const hang = base + (sym.elevation ?? 170)

  switch (kind) {
    case 'spot': {
      // Sized by its diameter (16 cm by default), in the chosen frame finish.
      const s = (w || 16) / 16
      const trim = frameMat(sym, white)
      g.add(mesh(new THREE.CylinderGeometry(5 * s, 5 * s, 1.2, 24), trim, 0, top - 0.6, 0))
      g.add(ring(4.6 * s, 0.45, trim, 0, top - 1.2, 0)) // trim
      g.add(mesh(new THREE.CylinderGeometry(3.6 * s, 2.8 * s, 2.2, 24, 1, true), dark(), 0, top - 1.6, 0)) // recessed reflector
      g.add(lens(ctx, new THREE.CylinderGeometry(3.4 * s, 3.4 * s, 0.4, 24)).translateY(top - 1.3))
      g.add(glow(ctx, 22 * s, 0, top - 3, 0))
      spotLight(ctx, g, 0, top - 2, 0, 12, 0.5)
      break
    }
    case 'profile': {
      g.add(mesh(new THREE.BoxGeometry(w, 2, d), new THREE.MeshStandardMaterial({ color: '#a1a1aa', metalness: 0.6, roughness: 0.35 }), 0, top - 1, 0))
      g.add(lens(ctx, new THREE.BoxGeometry(w - 2, 0.4, d - 2)).translateY(top - 2.2))
      areaLight(ctx, g, w, d, 0, top - 2.6, 0, 40)
      break
    }
    case 'track': {
      // Track and module housings in the track's color.
      const body = frameMat(sym, dark)
      g.add(mesh(new THREE.BoxGeometry(w, 3, d), body, 0, top - 1.5, 0))
      for (const m of sym.modules ?? []) {
        const x = m.offset - w / 2
        if (m.kind === 'spot') {
          g.add(mesh(new THREE.CylinderGeometry(3, 3, 11, 20), body, x, top - 9, 0))
          g.add(lens(ctx, new THREE.CylinderGeometry(2.4, 2.4, 0.4, 20)).translateX(x).translateY(top - 14.7))
          g.add(glow(ctx, 16, x, top - 16, 0))
          spotLight(ctx, g, x, top - 15, 0, 14, 0.38)
        } else if (m.kind === 'linear') {
          g.add(mesh(new THREE.BoxGeometry(36, 4, 5), body, x, top - 5, 0))
          g.add(lens(ctx, new THREE.BoxGeometry(34, 0.4, 3.6)).translateX(x).translateY(top - 7.2))
          areaLight(ctx, g, 34, 3.6, x, top - 7.5, 0, 45)
        } else {
          g.add(mesh(new THREE.BoxGeometry(28, 6, 8), body, x, top - 6, 0))
          for (const o of [-8, 0, 8]) g.add(lens(ctx, new THREE.CylinderGeometry(2, 2, 0.4, 16)).translateX(x + o).translateY(top - 9.2))
          spotLight(ctx, g, x, top - 10, 0, 16, 0.6)
        }
      }
      break
    }
    case 'pendant':
      pendant(ctx, g, sym.style ?? 'cone', w / 2, sym.height || 30, hang, top)
      break
    case 'linear-pendant': {
      const h = sym.height || 8
      for (const x of [-w / 2 + 10, w / 2 - 10]) {
        g.add(mesh(new THREE.CylinderGeometry(3, 3, 1.5, 16), dark(), x, top - 0.75, 0))
        g.add(mesh(new THREE.CylinderGeometry(0.25, 0.25, Math.max(1, top - (hang + h)), 6), dark(), x, (top + hang + h) / 2, 0))
      }
      g.add(mesh(new THREE.BoxGeometry(w, h, d), dark(), 0, hang + h / 2, 0))
      g.add(lens(ctx, new THREE.BoxGeometry(w - 4, 0.4, d - 4)).translateY(hang - 0.2))
      areaLight(ctx, g, w - 4, d - 4, 0, hang - 0.5, 0, 45)
      break
    }
    case 'chandelier': {
      const h = sym.height || 60
      const style = styleOf(sym)
      if (style !== 'classic') {
        chandelier(ctx, g, style, w / 2, h, hang, top)
        break
      }
      const r = (w / 2) * 0.75
      const brass = new THREE.MeshStandardMaterial({ color: '#b08d57', metalness: 0.8, roughness: 0.3 })
      g.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, Math.max(1, top - (hang + h)), 8), brass, 0, (top + hang + h) / 2, 0))
      g.add(mesh(new THREE.CylinderGeometry(6, 6, 2, 24), brass, 0, top - 1, 0)) // canopy
      g.add(mesh(new THREE.SphereGeometry(3, 16, 12), brass, 0, hang + h * 0.3, 0)) // hub
      g.add(mesh(new THREE.ConeGeometry(2, 5, 12), brass, 0, hang + h * 0.3 - 5, 0).rotateX(Math.PI)) // finial
      g.add(mesh(new THREE.CylinderGeometry(0.8, 0.8, h * 0.7, 8), brass, 0, hang + h * 0.55, 0))
      const ring = mesh(new THREE.TorusGeometry(r, 0.8, 8, 48), brass, 0, hang + h * 0.3, 0)
      ring.rotation.x = Math.PI / 2
      g.add(ring)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        // Curved-looking arm from the hub, a candle cup and a bulb.
        const hub = new THREE.Vector3(0, hang + h * 0.3, 0)
        const elbow = new THREE.Vector3(x * 0.55, hang + h * 0.3 - 6, z * 0.55)
        g.add(rod(hub, elbow, 0.5, brass), rod(elbow, new THREE.Vector3(x, hang + h * 0.3, z), 0.5, brass))
        g.add(mesh(new THREE.CylinderGeometry(2.4, 1.4, 3, 12), brass, x, hang + h * 0.3 + 1.5, z))
        g.add(lens(ctx, new THREE.SphereGeometry(3, 12, 10)).translateX(x).translateY(hang + h * 0.3 + 5).translateZ(z))
        g.add(glow(ctx, 18, x, hang + h * 0.3 + 5, z))
      }
      pointLight(ctx, g, 0, hang + h * 0.35, 0, 9)
      break
    }
    case 'ceiling': {
      g.add(mesh(new THREE.CylinderGeometry(w / 2, w / 2, 5, 32), white(), 0, top - 2.5, 0))
      g.add(ring(w / 2 - 0.6, 0.7, white(), 0, top - 5, 0)) // rim
      g.add(lens(ctx, new THREE.CylinderGeometry(w / 2 - 2, w / 2 - 2, 0.4, 32)).translateY(top - 5.2))
      g.add(glow(ctx, w * 1.6, 0, top - 8, 0))
      pointLight(ctx, g, 0, top - 15, 0, 6)
      break
    }
    case 'wall': {
      const h = sym.height || 25
      g.add(mesh(new RoundedBoxGeometry(w * 0.6, h, 4, 2, 1), dark(), 0, hang + h / 2, -d / 2 + 2))
      // Half cylinder bulging into the room (+Z).
      g.add(lens(ctx, new THREE.CylinderGeometry(w / 2, w / 2, h * 0.8, 24, 1, false, -Math.PI / 2, Math.PI)).translateY(hang + h / 2).translateZ(-d / 2 + 3))
      g.add(glow(ctx, 40, 0, hang + h / 2, 4))
      pointLight(ctx, g, 0, hang + h / 2, 12 - d / 2, 3)
      break
    }
  }
  g.traverse((o) => (o.userData.pick = pick))
  // A spot's trim and housing only show up close by; further away its lit lens and glow are all there is to see.
  if (kind === 'spot') {
    const details: THREE.Object3D[] = []
    g.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o.material as THREE.Material).userData.lens) details.push(o)
    })
    g.userData.details = details
  }
  return g
}

/**
 * A cabinet's LED lighting (display cabinet, sideboard, coffee corner): lit strips and the spot lights they make, in
 * the cabinet's frame, switched like any light (see applyLightState).
 */
export function cabinetLights(
  sym: PlanSymbol,
  leds: { strips: { x: number; y: number; z: number; len: number; axis: 'x' | 'y' }[]; spots: { x: number; y: number; z: number; angle: number; intensity: number }[] },
  floor: Floor,
  room: string | undefined,
  handles: { lights: LightHandle[] },
): THREE.Group {
  const handle: LightHandle = { floorId: floor.id, id: sym.id, lights: [], emissive: [], glows: [], glowAt: [], glowColors: [] }
  const ctx: Ctx = { color: new THREE.Color(lightHex(sym.light)), brightness: sym.light?.brightness ?? 1, handle, room }
  handles.lights.push(handle)
  const g = new THREE.Group()
  for (const s of leds.strips) {
    const geo = s.axis === 'x' ? new THREE.BoxGeometry(s.len, 0.6, 1) : new THREE.BoxGeometry(1, s.len, 0.6)
    g.add(lens(ctx, geo).translateX(s.x).translateY(s.y).translateZ(s.z))
  }
  for (const p of leds.spots) spotLight(ctx, g, p.x, p.y, p.z, p.intensity, p.angle)
  return g
}

/**
 * A chandelier in one of its other styles (see CHANDELIER_STYLES): radius r, h tall, its bottom at `hang`. Many small
 * parts (crystals, tubes) are merged into one mesh each, to keep it cheap to draw.
 */
function chandelier(ctx: Ctx, g: THREE.Group, style: string, r: number, h: number, hang: number, top: number) {
  const chrome = new THREE.MeshStandardMaterial({ color: '#d4d4d8', metalness: 0.9, roughness: 0.2 })
  const gold = brass()
  const black = dark()
  const merged = (geos: THREE.BufferGeometry[], mat: THREE.Material) => {
    const geo = mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x)))
    geos.forEach((x) => x.dispose())
    return new THREE.Mesh(geo!, mat)
  }
  const at = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => geo.translate(x, y, z)
  switch (style) {
    case 'crystal': {
      // Tiers of crystal drops hanging from chrome rings, candle bulbs on top.
      g.add(mesh(new THREE.CylinderGeometry(6, 6, 2, 24), chrome, 0, top - 1, 0))
      g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, Math.max(1, top - (hang + h)), 8), chrome, 0, (top + hang + h) / 2, 0))
      g.add(mesh(new THREE.CylinderGeometry(0.8, 0.8, h, 8), chrome, 0, hang, 0))
      const crystal = new THREE.MeshStandardMaterial({ color: '#f8fafc', metalness: 0.1, roughness: 0.02, transparent: true, opacity: 0.75, emissive: '#ffffff', emissiveIntensity: 0.15 })
      const drops: THREE.BufferGeometry[] = []
      const tiers = [
        [1, h * 0.75],
        [0.72, h * 0.45],
        [0.42, h * 0.15],
      ] as const
      for (const [f, y] of tiers) {
        const rr = r * f
        g.add(ring(rr, 0.5, chrome, 0, hang + y, 0))
        const n = Math.max(10, Math.round(rr * 0.9))
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2
          const len = 6 + (i % 3) * 3
          drops.push(at(new THREE.OctahedronGeometry(1.4), Math.cos(a) * rr, hang + y - len, Math.sin(a) * rr))
          drops.push(at(new THREE.CylinderGeometry(0.15, 0.15, len, 4), Math.cos(a) * rr, hang + y - len / 2, Math.sin(a) * rr))
        }
      }
      g.add(merged(drops, crystal))
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        g.add(mesh(new THREE.CylinderGeometry(1.2, 1.2, 6, 10), chrome, x, hang + h * 0.75 + 3, z))
        g.add(lens(ctx, new THREE.SphereGeometry(2.2, 10, 8)).translateX(x).translateY(hang + h * 0.75 + 8).translateZ(z))
        g.add(glow(ctx, 14, x, hang + h * 0.75 + 8, z))
      }
      pointLight(ctx, g, 0, hang + h * 0.5, 0, 9)
      break
    }
    case 'led-rings':
    case 'led-tilted': {
      // Glowing rings on thin wires: stacked level, or tilted around one another.
      g.add(mesh(new THREE.CylinderGeometry(7, 7, 1.5, 32), black, 0, top - 0.75, 0))
      const rings = [
        [1, 0, 0, 0],
        [0.72, h * 0.35, 0.5, 0.2],
        [0.46, h * 0.65, -0.4, 0.6],
      ] as const
      rings.forEach(([f, dy, tx, tz], i) => {
        const rr = r * f
        const y = hang + (style === 'led-rings' ? dy : h * 0.4)
        const holder = new THREE.Group()
        holder.position.y = y
        if (style === 'led-tilted') holder.rotation.set(tx, i * 1.1, tz)
        const band = new THREE.Mesh(new THREE.TorusGeometry(rr, 1.1, 10, 72), gold)
        band.rotation.x = Math.PI / 2
        holder.add(band)
        const lit = lens(ctx, new THREE.TorusGeometry(rr, 0.7, 8, 72))
        lit.rotation.x = Math.PI / 2
        lit.position.y = -0.9
        holder.add(lit)
        g.add(holder)
        // Wires up to the canopy from three points of the ring.
        holder.updateMatrix()
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + i
          const p = new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr).applyMatrix4(holder.matrix)
          g.add(rod(new THREE.Vector3(Math.cos(a) * 5, top - 1, Math.sin(a) * 5), p, 0.08, black))
        }
      })
      g.add(glow(ctx, r * 2.4, 0, hang + h * 0.3, 0))
      pointLight(ctx, g, 0, hang + h * 0.3, 0, 6)
      spotLight(ctx, g, 0, hang, 0, 8, 1.1)
      break
    }
    case 'led-cascade': {
      // Glowing tubes of different lengths hanging from a round plate, in a spiral.
      g.add(mesh(new THREE.CylinderGeometry(r, r, 2, 48), gold, 0, top - 1, 0))
      const n = Math.max(12, Math.round(r * 0.6))
      const tubes: THREE.BufferGeometry[] = []
      const wires: THREE.BufferGeometry[] = []
      const span = top - hang
      for (let i = 0; i < n; i++) {
        const a = i * 2.4
        const rr = r * 0.9 * Math.sqrt((i + 0.5) / n)
        const x = Math.cos(a) * rr
        const z = Math.sin(a) * rr
        // Longest in the middle, shorter outward.
        const len = Math.max(20, h * (1 - rr / r) + 15)
        const bottom = top - Math.min(span, h + 20) + (h - len) * 0.6
        tubes.push(at(new THREE.CylinderGeometry(0.9, 0.9, len, 8), x, bottom + len / 2, z))
        wires.push(at(new THREE.CylinderGeometry(0.06, 0.06, top - 2 - (bottom + len), 3), x, (top - 2 + bottom + len) / 2, z))
      }
      const lit = lens(ctx, new THREE.BufferGeometry())
      lit.geometry = mergeGeometries(tubes.map((t) => t.toNonIndexed()))!
      tubes.forEach((t) => t.dispose())
      g.add(lit)
      g.add(merged(wires, black))
      g.add(glow(ctx, r * 2.2, 0, hang + h * 0.5, 0))
      pointLight(ctx, g, 0, hang + h * 0.5, 0, 7)
      spotLight(ctx, g, 0, hang, 0, 7, 1.1)
      break
    }
    default: {
      // Sputnik: rods out in all directions from a ball, a bulb on each end.
      const cy = hang + h / 2
      g.add(mesh(new THREE.CylinderGeometry(6, 6, 2, 24), gold, 0, top - 1, 0))
      g.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, Math.max(1, top - cy), 8), gold, 0, (top + cy) / 2, 0))
      g.add(mesh(new THREE.SphereGeometry(4, 20, 14), gold, 0, cy, 0))
      const rods: THREE.BufferGeometry[] = []
      const n = 14
      for (let i = 0; i < n; i++) {
        // Spread evenly over a sphere.
        const yy = 1 - (2 * (i + 0.5)) / n
        const rad = Math.sqrt(1 - yy * yy) * 0.9
        const a = i * 2.4
        const dir = new THREE.Vector3(Math.cos(a) * rad, yy * 0.6, Math.sin(a) * rad).normalize()
        const end = dir.clone().multiplyScalar(r - 4).add(new THREE.Vector3(0, cy, 0))
        const geo = new THREE.CylinderGeometry(0.4, 0.4, r - 6, 6)
        geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir))
        const mid = dir.clone().multiplyScalar((r - 6) / 2).add(new THREE.Vector3(0, cy, 0))
        rods.push(at(geo, mid.x, mid.y, mid.z))
        g.add(lens(ctx, new THREE.SphereGeometry(2.2, 10, 8)).translateX(end.x).translateY(end.y).translateZ(end.z))
      }
      g.add(merged(rods, gold))
      g.add(glow(ctx, r * 2.2, 0, cy, 0))
      pointLight(ctx, g, 0, cy, 0, 8)
    }
  }
}

/** Within this distance of the camera (m), spots show their trim and housing. */
export const DETAIL_DISTANCE = 8

const glowVertex = `
attribute float size;
attribute vec3 color;
uniform float halfHeight;
varying vec3 vColor;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // Sized in model units, like the sprites these replace.
  gl_PointSize = size * length(modelMatrix[0].xyz) * projectionMatrix[1][1] * halfHeight / -mv.z;
}`

const glowFragment = `
uniform float opacity;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d >= 1.0 || dot(vColor, vColor) == 0.0) discard;
  float a = d < 0.25 ? mix(1.0, 0.55, d / 0.25) : mix(0.55, 0.0, (d - 0.25) / 0.75);
  gl_FragColor = vec4(vColor, a * opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

/**
 * All the fixtures' glow halos as one cloud of points: one draw call instead of one per sprite. Each light handle
 * keeps the indices of its points and their colors, to switch them with its lights (see applyLightState).
 */
export function bakeGlows(root: THREE.Object3D, handles: LightHandle[]) {
  root.updateMatrixWorld(true)
  const pos: number[] = []
  const size: number[] = []
  const p = new THREE.Vector3()
  const inv = root.matrixWorld.clone().invert()
  for (const h of handles) {
    for (const s of h.glows) {
      s.getWorldPosition(p).applyMatrix4(inv)
      h.glowAt.push(size.length)
      h.glowColors.push((s.material as THREE.SpriteMaterial).color.clone())
      pos.push(p.x, p.y, p.z)
      size.push(s.scale.x)
      s.removeFromParent()
      ;(s.material as THREE.Material).dispose()
    }
    h.glows = []
  }
  if (!size.length) return
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(size.length * 3), 3))
  geo.setAttribute('size', new THREE.Float32BufferAttribute(size, 1))
  const material = new THREE.ShaderMaterial({
    uniforms: { opacity: { value: 0.5 }, halfHeight: { value: 400 } },
    vertexShader: glowVertex,
    fragmentShader: glowFragment,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
  const cloud = new THREE.Points(geo, material)
  const buf = new THREE.Vector2()
  cloud.onBeforeRender = (renderer) => (material.uniforms.halfHeight.value = renderer.getDrawingBufferSize(buf).y / 2)
  root.add(cloud)
  root.userData.glowCloud = cloud
}

/** Apply on/off states and the daylight level to the lights in a built scene. */
export function applyLightState(
  root: THREE.Object3D,
  isOn: (floorId: string, id: string) => boolean,
  switchOn: (id: string) => boolean,
  daylight: number,
) {
  const lights = (root.userData.lightHandles ?? []) as LightHandle[]
  const switches = (root.userData.switchHandles ?? []) as SwitchHandle[]
  const glowOpacity = 0.25 + 0.6 * (1 - daylight)
  const cloud = root.userData.glowCloud as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | undefined
  const colors = cloud?.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
  for (const h of lights) {
    const on = isOn(h.floorId, h.id)
    for (const v of h.lights) v.intensity = on ? v.base : 0
    for (const m of h.emissive) m.emissiveIntensity = on ? 2.2 : 0
    h.glowAt.forEach((i, k) => {
      const c = h.glowColors[k]
      if (on) colors?.setXYZ(i, c.r, c.g, c.b)
      else colors?.setXYZ(i, 0, 0, 0)
    })
  }
  if (cloud && colors) {
    colors.needsUpdate = true
    cloud.material.uniforms.opacity.value = glowOpacity
  }
  // Strip lights' washes, and curtains lit from a pocket: stronger at night.
  const night = 0.35 + 0.65 * (1 - daylight)
  for (const h of lights) {
    const on = isOn(h.floorId, h.id)
    for (const w of h.washes ?? []) {
      ;(w.m as THREE.MeshBasicMaterial).opacity = on ? w.base * night : 0
      w.m.visible = on
    }
  }
  for (const w of (root.userData.curtainWashes ?? []) as { floorId: string; lightId: string; m: THREE.MeshStandardMaterial; base: number }[]) {
    w.m.emissiveIntensity = isOn(w.floorId, w.lightId) ? w.base * night : 0
  }
  for (const s of switches) {
    const on = switchOn(s.id)
    s.indicator.color.set(on ? '#22c55e' : '#71717a')
    s.indicator.emissive.set(on ? '#22c55e' : '#000000')
  }
}
