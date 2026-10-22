/**
 * What a realistic render (see render.ts) is made of, as the 3D view has it: kept apart from the path tracer, which is
 * only loaded to render.
 */
import type * as THREE from 'three'
import type { VirtualLight } from './lightPool'

export interface RenderSource {
  /** What's shown: the rooms and everything in them, and the ground round them. */
  objects: THREE.Object3D[]
  /** The fixtures' lights (on, or off: at 0). */
  lights: VirtualLight[]
  camera: THREE.PerspectiveCamera
  /** The room the camera's in (walking inside), or what it looks at from outside; and where that is (world). */
  room: string | null
  inside: boolean
  focus: THREE.Vector3
  sun: THREE.DirectionalLight
  /** 0 at night … 1 by day. */
  daylight: number
  toneMapping: THREE.ToneMapping
  /** Takes the selection's highlight off while the scene's copied; what it returns puts it back. */
  plain: () => () => void
}

let source: (() => RenderSource) | null = null

/** The 3D view says how to render it while it's there (null when it goes). */
export function setRenderSource(fn: (() => RenderSource) | null) {
  source = fn
}

/** What to render now, if the 3D view is there. */
export const renderSource = () => source?.() ?? null

/** The view's shape (width over height), to render it as it's seen. */
export const viewAspect = () => source?.().camera.aspect ?? 16 / 9
