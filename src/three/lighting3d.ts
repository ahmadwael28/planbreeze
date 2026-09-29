/**
 * 3D gypsum ceilings and light fixtures.
 *
 * Everything is built in plan centimeters (X = x, Y = up, Z = plan y); the viewer scales the
 * scene to meters so three.js' physically based light falloff behaves realistically.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { signedArea } from '@/model/geometry'
import { ceilingHeightAt, ceilingZones, COVE_WIDTH, covePath, inset, LIGHT_COLORS } from '@/model/lighting'
import { symbolPose } from '@/model/project'
import type { FixtureKind } from '@/model/symbols'
import type { Floor, PlanSymbol, Point, Room } from '@/model/types'

const CM = 0.01 // RectAreaLight sizes ignore parent scale, so they're given in meters

/** Lets the viewer switch a fixture on/off and dim it without rebuilding the scene. */
export interface LightHandle {
  floorId: string
  id: string
  lights: { light: THREE.Light; base: number }[]
  emissive: THREE.MeshStandardMaterial[]
  glows: THREE.Sprite[]
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

/** Vertical faces along a polygon between heights y0 and y1, facing into (or out of) the polygon. */
function band(poly: Point[], y0: number, y1: number, facing: 'in' | 'out'): THREE.BufferGeometry {
  const inward = signedArea(poly) >= 0
  const flip = (facing === 'in') !== inward
  const pos: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
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
  for (const room of floor.rooms) {
    if (room.points.length < 3) continue
    geos.push(ceilingPlane(room.points, undefined, H - 0.2))
    const c = room.ceiling
    if (!c) continue
    for (const z of ceilingZones(room)) geos.push(ceilingPlane(z.outer, z.inner, H - z.drop))
    switch (c.style) {
      case 'tray':
        geos.push(band(inset(room, c.band), H - c.drop, H, 'in'))
        break
      case 'stepped':
        geos.push(band(inset(room, c.band), H - c.drop, H - c.drop / 2, 'in'))
        geos.push(band(inset(room, c.band * 2), H - c.drop / 2, H, 'in'))
        break
      case 'cove':
        // A lip at the edge of the band hides the LED; behind it the trough rises to the ceiling.
        geos.push(band(inset(room, c.band), H - c.drop, H - c.drop + 8, 'in'))
        geos.push(band(inset(room, c.band - COVE_WIDTH), H - c.drop + 1, H, 'in'))
        break
      case 'floating':
        geos.push(band(inset(room, c.band), H - c.drop, H - c.drop + 6, 'out'))
        break
    }
  }
  const out: THREE.Object3D[] = []
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
  // Free-standing gypsum boxes (e.g. over a kitchen counter). The top is hidden so the view from above stays clear.
  for (const s of floor.symbols) {
    if (s.type !== 'gypsum-box') continue
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
}

function lens(ctx: Ctx, geo: THREE.BufferGeometry) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: ctx.color, emissiveIntensity: 0, roughness: 0.4 })
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

function add<T extends THREE.Light>(ctx: Ctx, light: T, base: number): T {
  ctx.handle.lights.push({ light, base: base * ctx.brightness * OUTPUT })
  return light
}

function spotLight(ctx: Ctx, g: THREE.Group, x: number, y: number, z: number, intensity: number, angle: number) {
  const light = add(ctx, new THREE.SpotLight(ctx.color, intensity, 0, angle, 0.65, 2), intensity)
  light.position.set(x, y, z)
  light.target.position.set(x, y - 100, z)
  g.add(light, light.target)
}

/** Area light facing down (or up), `w` × `h` cm, centered at (x, y, z) in the group's frame. */
function areaLight(ctx: Ctx, g: THREE.Group, w: number, h: number, x: number, y: number, z: number, intensity: number, up = false) {
  const light = add(ctx, new THREE.RectAreaLight(ctx.color, intensity, Math.max(w, 1) * CM, Math.max(h, 1) * CM), intensity)
  light.position.set(x, y, z)
  light.rotation.x = up ? Math.PI / 2 : -Math.PI / 2
  g.add(light)
}

const dark = () => new THREE.MeshStandardMaterial({ color: '#27272a', roughness: 0.5, metalness: 0.3 })
const white = () => new THREE.MeshStandardMaterial({ color: '#fafafa', roughness: 0.6 })

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  return m
}

function coveFixture(ctx: Ctx, room: Room, floor: Floor, base: number): THREE.Group {
  const g = new THREE.Group()
  const { path, up, drop } = covePath(room)
  const y = base + floor.height - drop
  for (let i = 0; i < path.length; i++) {
    const a = path[i]
    const b = path[(i + 1) % path.length]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 5) continue
    const seg = new THREE.Group()
    seg.position.set((a.x + b.x) / 2, y, (a.y + b.y) / 2)
    seg.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x)
    seg.add(lens(ctx, new THREE.BoxGeometry(len, 1, 1.5)))
    areaLight(ctx, seg, len, 4, 0, up ? 1 : -1, 0, 18, up)
    g.add(seg)
  }
  return g
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
    const plate = mesh(new THREE.BoxGeometry(8, 12, 1.2), white())
    const indicator = new THREE.MeshStandardMaterial({ color: '#22c55e', emissive: '#22c55e', emissiveIntensity: 1 })
    plate.add(mesh(new THREE.BoxGeometry(1.2, 1.2, 0.6), indicator, 0, 3.5, 0.8))
    g.add(plate)
    g.position.set(pose.x, base + (sym.height || 110), pose.y)
    // Local +Z is the symbol's local +y, which points into the room; the plate sits on the wall behind.
    g.rotation.y = (-pose.rotation * Math.PI) / 180
    plate.position.z = -(sym.depth / 2 - 0.6)
    g.traverse((o) => (o.userData.pick = pick))
    handles.switches.push({ floorId: floor.id, id: sym.id, indicator })
    return g
  }

  const handle: LightHandle = { floorId: floor.id, id: sym.id, lights: [], emissive: [], glows: [] }
  const ctx: Ctx = {
    color: new THREE.Color(LIGHT_COLORS[sym.light?.color ?? 'warm'].hex),
    brightness: sym.light?.brightness ?? 1,
    handle,
  }
  handles.lights.push(handle)

  if (kind === 'cove') {
    const room = floor.rooms.find((r) => r.id === sym.room)
    if (!room) return null
    const g = coveFixture(ctx, room, floor, base)
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
      g.add(mesh(new THREE.CylinderGeometry(5, 5, 1.2, 24), white(), 0, top - 0.6, 0))
      g.add(lens(ctx, new THREE.CylinderGeometry(3.4, 3.4, 0.4, 24)).translateY(top - 1.3))
      g.add(glow(ctx, 22, 0, top - 3, 0))
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
      g.add(mesh(new THREE.BoxGeometry(w, 3, d), dark(), 0, top - 1.5, 0))
      for (const m of sym.modules ?? []) {
        const x = m.offset - w / 2
        if (m.kind === 'spot') {
          g.add(mesh(new THREE.CylinderGeometry(3, 3, 11, 20), dark(), x, top - 9, 0))
          g.add(lens(ctx, new THREE.CylinderGeometry(2.4, 2.4, 0.4, 20)).translateX(x).translateY(top - 14.7))
          g.add(glow(ctx, 16, x, top - 16, 0))
          spotLight(ctx, g, x, top - 15, 0, 14, 0.38)
        } else if (m.kind === 'linear') {
          g.add(mesh(new THREE.BoxGeometry(36, 4, 5), dark(), x, top - 5, 0))
          g.add(lens(ctx, new THREE.BoxGeometry(34, 0.4, 3.6)).translateX(x).translateY(top - 7.2))
          areaLight(ctx, g, 34, 3.6, x, top - 7.5, 0, 45)
        } else {
          g.add(mesh(new THREE.BoxGeometry(28, 6, 8), dark(), x, top - 6, 0))
          for (const o of [-8, 0, 8]) g.add(lens(ctx, new THREE.CylinderGeometry(2, 2, 0.4, 16)).translateX(x + o).translateY(top - 9.2))
          spotLight(ctx, g, x, top - 10, 0, 16, 0.6)
        }
      }
      break
    }
    case 'pendant': {
      const h = sym.height || 30
      g.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, Math.max(1, top - (hang + h)), 6), dark(), 0, (top + hang + h) / 2, 0))
      const shade = mesh(new THREE.CylinderGeometry(4, w / 2, h, 32, 1, true), dark(), 0, hang + h / 2, 0)
      ;(shade.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
      g.add(shade)
      g.add(lens(ctx, new THREE.SphereGeometry(4, 16, 12)).translateY(hang + h * 0.35))
      g.add(glow(ctx, w * 1.1, 0, hang + 2, 0))
      spotLight(ctx, g, 0, hang + h * 0.3, 0, 10, 0.75)
      const p = add(ctx, new THREE.PointLight(ctx.color, 2.5, 0, 2), 2.5)
      p.position.set(0, hang + h * 0.3, 0)
      g.add(p)
      break
    }
    case 'linear-pendant': {
      const h = sym.height || 8
      for (const x of [-w / 2 + 10, w / 2 - 10]) {
        g.add(mesh(new THREE.CylinderGeometry(0.25, 0.25, Math.max(1, top - (hang + h)), 6), dark(), x, (top + hang + h) / 2, 0))
      }
      g.add(mesh(new THREE.BoxGeometry(w, h, d), dark(), 0, hang + h / 2, 0))
      g.add(lens(ctx, new THREE.BoxGeometry(w - 4, 0.4, d - 4)).translateY(hang - 0.2))
      areaLight(ctx, g, w - 4, d - 4, 0, hang - 0.5, 0, 45)
      break
    }
    case 'chandelier': {
      const h = sym.height || 60
      const r = (w / 2) * 0.75
      const brass = new THREE.MeshStandardMaterial({ color: '#b08d57', metalness: 0.8, roughness: 0.3 })
      g.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, Math.max(1, top - (hang + h)), 8), brass, 0, (top + hang + h) / 2, 0))
      g.add(mesh(new THREE.CylinderGeometry(0.8, 0.8, h * 0.7, 8), brass, 0, hang + h * 0.55, 0))
      const ring = mesh(new THREE.TorusGeometry(r, 0.8, 8, 48), brass, 0, hang + h * 0.3, 0)
      ring.rotation.x = Math.PI / 2
      g.add(ring)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        g.add(lens(ctx, new THREE.SphereGeometry(3, 12, 10)).translateX(x).translateY(hang + h * 0.3 + 5).translateZ(z))
        g.add(glow(ctx, 18, x, hang + h * 0.3 + 5, z))
      }
      const p = add(ctx, new THREE.PointLight(ctx.color, 9, 0, 2), 9)
      p.position.set(0, hang + h * 0.35, 0)
      g.add(p)
      break
    }
    case 'ceiling': {
      g.add(mesh(new THREE.CylinderGeometry(w / 2, w / 2, 5, 32), white(), 0, top - 2.5, 0))
      g.add(lens(ctx, new THREE.CylinderGeometry(w / 2 - 2, w / 2 - 2, 0.4, 32)).translateY(top - 5.2))
      g.add(glow(ctx, w * 1.6, 0, top - 8, 0))
      const p = add(ctx, new THREE.PointLight(ctx.color, 6, 0, 2), 6)
      p.position.set(0, top - 15, 0)
      g.add(p)
      break
    }
    case 'wall': {
      const h = sym.height || 25
      g.add(mesh(new THREE.BoxGeometry(w * 0.6, h, 4), dark(), 0, hang + h / 2, -d / 2 + 2))
      // Half cylinder bulging into the room (+Z).
      g.add(lens(ctx, new THREE.CylinderGeometry(w / 2, w / 2, h * 0.8, 24, 1, false, -Math.PI / 2, Math.PI)).translateY(hang + h / 2).translateZ(-d / 2 + 3))
      g.add(glow(ctx, 40, 0, hang + h / 2, 4))
      const p = add(ctx, new THREE.PointLight(ctx.color, 3, 0, 2), 3)
      p.position.set(0, hang + h / 2, 12 - d / 2)
      g.add(p)
      break
    }
  }
  g.traverse((o) => (o.userData.pick = pick))
  return g
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
  for (const h of lights) {
    const on = isOn(h.floorId, h.id)
    for (const { light, base } of h.lights) light.intensity = on ? base : 0
    for (const m of h.emissive) m.emissiveIntensity = on ? 2.2 : 0
    for (const s of h.glows) {
      s.visible = on
      ;(s.material as THREE.SpriteMaterial).opacity = glowOpacity
    }
  }
  for (const s of switches) {
    const on = switchOn(s.id)
    s.indicator.color.set(on ? '#22c55e' : '#71717a')
    s.indicator.emissive.set(on ? '#22c55e' : '#000000')
  }
}
