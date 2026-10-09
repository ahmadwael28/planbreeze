/**
 * Viewpoints: ready-made camera spots inside each room and around the home, so people can look
 * around the 3D model without steering the camera themselves. Plus the camera lens presets.
 */
import * as THREE from 'three'
import { bbox, labelPoint, pointInPolygon } from '@/model/geometry'
import type { Point, Project } from '@/model/types'
import { SLAB } from '@/three/buildScene'
import { t } from '@/i18n'

/** Plan units (cm) to 3D world units (m). */
const M = 0.01
const EYE = 160 // cm
const UP = new THREE.Vector3(0, 1, 0)
/** Distance from the camera to the orbit target while standing at a viewpoint: turning happens in place. */
export const LOOK_RADIUS = 0.05

export interface Viewpoint {
  id: string
  label: string
  kind: 'room' | 'saved' | 'outside'
  /** For saved views: the id of the SavedView. */
  savedId?: string
  /** Arrow showing which corner of the plan an outside viewpoint is at. */
  arrow?: string
  /** World positions (m). */
  eye: THREE.Vector3
  look: THREE.Vector3
  /** Where its marker is drawn: on the floor inside, at the eye outside. */
  marker: THREE.Vector3
}

/** A spot near the room's deepest corner, looking across the room: the classic "whole room" shot. */
function roomSpot(pts: Point[]): { eye: Point; look: Point } {
  const c = labelPoint(pts)
  let best: Point | null = null
  let bestD = -1
  for (const v of pts) {
    const d = Math.hypot(c.x - v.x, c.y - v.y)
    if (d < 1) continue
    const inset = Math.min(60, d * 0.35)
    const p = { x: v.x + ((c.x - v.x) / d) * inset, y: v.y + ((c.y - v.y) / d) * inset }
    if (d > bestD + 1 && pointInPolygon(p, pts)) {
      best = p
      bestD = d
    }
  }
  if (!best) return { eye: c, look: { x: c.x + 100, y: c.y } }
  return { eye: best, look: c }
}

const CORNERS = [
  { sx: 1, sz: 1, arrow: '↘', name: 'bottom-right', label: 'Outside, bottom-right' },
  { sx: -1, sz: 1, arrow: '↙', name: 'bottom-left', label: 'Outside, bottom-left' },
  { sx: -1, sz: -1, arrow: '↖', name: 'top-left', label: 'Outside, top-left' },
  { sx: 1, sz: -1, arrow: '↗', name: 'top-right', label: 'Outside, top-right' },
] as const

/** Height of a floor's level above the ground floor (cm). */
export function floorBase(project: Project, floorId: string) {
  const idx = Math.max(
    0,
    project.floors.findIndex((f) => f.id === floorId),
  )
  return project.floors.slice(0, idx).reduce((s, f) => s + f.height + SLAB, 0)
}

/** Viewpoints for the given floor: one per room, the user's saved views, then four around the outside. */
export function computeViewpoints(project: Project, floorId: string): Viewpoint[] {
  const floor = project.floors.find((f) => f.id === floorId) ?? project.floors[0]
  if (!floor) return []
  const base = floorBase(project, floor.id)
  const rooms = floor.rooms.filter((r) => r.points.length >= 3)
  const out: Viewpoint[] = rooms.map((room, i) => {
    const { eye, look } = roomSpot(room.points)
    return {
      id: `room:${room.id}`,
      label: room.name.trim() || t('Room {n}', { n: i + 1 }),
      kind: 'room',
      eye: new THREE.Vector3(eye.x * M, (base + EYE) * M, eye.y * M),
      look: new THREE.Vector3(look.x * M, (base + 125) * M, look.y * M),
      marker: new THREE.Vector3(eye.x * M, (base + 3) * M, eye.y * M),
    }
  })
  for (const v of floor.views ?? []) {
    const eye = new THREE.Vector3(v.eye.x * M, (base + v.eye.h) * M, v.eye.y * M)
    const inside = v.eye.h < floor.height
    out.push({
      id: `saved:${v.id}`,
      savedId: v.id,
      label: v.name,
      kind: 'saved',
      eye,
      look: new THREE.Vector3(v.look.x * M, (base + v.look.h) * M, v.look.y * M),
      marker: inside ? new THREE.Vector3(eye.x, (base + 3) * M, eye.z) : eye.clone(),
    })
  }
  if (!rooms.length) return out

  const b = bbox(rooms.flatMap((r) => r.points))
  const w = b.maxX - b.minX
  const d = b.maxY - b.minY
  const r = Math.max(w, d, 300)
  const cx = (b.minX + b.maxX) / 2
  const cz = (b.minY + b.maxY) / 2
  const look = new THREE.Vector3(cx * M, (base + floor.height * 0.3) * M, cz * M)
  for (const c of CORNERS) {
    const eye = new THREE.Vector3(
      (cx + c.sx * (w / 2 + r * 0.6)) * M,
      (base + floor.height + r * 0.75) * M,
      (cz + c.sz * (d / 2 + r * 0.6)) * M,
    )
    out.push({ id: `out:${floor.id}:${c.name}`, label: t(c.label), kind: 'outside', arrow: c.arrow, eye, look: look.clone(), marker: eye })
  }
  return out
}

// ---------- camera flights ----------

export interface Flight {
  fromPos: THREE.Vector3
  toPos: THREE.Vector3
  fromQ: THREE.Quaternion
  toQ: THREE.Quaternion
  /** How far to rise mid-flight, to hop over walls instead of passing through them. */
  lift: number
  start: number
  duration: number
}

export function planFlight(camera: THREE.Camera, walls: THREE.Object3D[], wallTop: number, eye: THREE.Vector3, look: THREE.Vector3): Flight {
  const from = camera.position.clone()
  const dist = from.distanceTo(eye)
  let lift = 0
  if (walls.length && dist > 0.01) {
    const ray = new THREE.Raycaster(from, eye.clone().sub(from).normalize(), 0, dist)
    if (ray.intersectObjects(walls, false).length) lift = Math.max(0, wallTop + 0.8 - Math.min(from.y, eye.y))
  }
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  return {
    fromPos: from,
    toPos: eye.clone(),
    fromQ: camera.quaternion.clone(),
    toQ: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, look, UP)),
    lift,
    start: performance.now(),
    duration: reduceMotion ? 0 : THREE.MathUtils.clamp(500 + dist * 90, 700, 1600),
  }
}

/** Move the camera along a flight. Returns true when it has arrived. */
export function stepFlight(f: Flight, camera: THREE.Camera, target: THREE.Vector3): boolean {
  const t = f.duration ? Math.min(1, (performance.now() - f.start) / f.duration) : 1
  const e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
  camera.position.lerpVectors(f.fromPos, f.toPos, e)
  camera.position.y += Math.sin(Math.PI * e) * f.lift
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(f.fromQ.clone().slerp(f.toQ, e))
  target.copy(camera.position).addScaledVector(forward, t < 1 ? 1 : LOOK_RADIUS)
  return t >= 1
}

// ---------- lens ----------

export type Lens = 'normal' | 'wide' | 'ultra'

/** Horizontal field of view of each lens, in degrees. */
export const LENSES: Record<Lens, { label: string; hint: string; fov: number }> = {
  normal: { label: 'Normal', hint: 'Like your eyes', fov: 75 },
  wide: { label: 'Wide', hint: 'See more of the room', fov: 100 },
  ultra: { label: 'Ultra-wide', hint: 'Most of the room at once', fov: 120 },
}

/** three.js wants a vertical field of view; keep it sensible on tall phone screens. */
export function verticalFov(lens: Lens, aspect: number) {
  const h = LENSES[lens].fov
  const v = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(h) / 2) / aspect))
  return THREE.MathUtils.clamp(v, 30, Math.min(h, 105))
}
