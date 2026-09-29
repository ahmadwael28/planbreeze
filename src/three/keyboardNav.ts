/**
 * First-person keyboard navigation for the 3D view, working alongside OrbitControls:
 * moving shifts both the camera and the orbit target; turning swings the target around the camera.
 *
 * Keys use physical positions (KeyboardEvent.code), so WASD sits in the same place on AZERTY etc.
 */
import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const ACTIONS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA'],
  right: ['KeyD'],
  turnLeft: ['ArrowLeft'],
  turnRight: ['ArrowRight'],
  up: ['KeyE'],
  down: ['KeyQ'],
  lookUp: ['PageUp'],
  lookDown: ['PageDown'],
} as const
type Action = keyof typeof ACTIONS
const CODE_TO_ACTION = new Map<string, Action>(
  (Object.keys(ACTIONS) as Action[]).flatMap((a) => ACTIONS[a].map((c) => [c, a] as const)),
)

const UP = new THREE.Vector3(0, 1, 0)
const WALK = 1.6 // m/s
const RUN = 4.5 // m/s with Shift
const TURN = 1.6 // rad/s
const LOOK = 1.0 // rad/s
const BODY = 0.3 // m kept between the camera and a wall
const TAP = 0.12 // s of movement for a quick tap released before the next frame

/** Ignore keys while the user is typing or adjusting a control. */
function isEditing(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [role="tablist"], [role="radiogroup"], [role="combobox"], [role="dialog"], [role="menu"], [role="listbox"]')
}

export interface KeyboardNavOptions {
  /** Meshes the camera can't walk through (walls). */
  obstacles: () => THREE.Object3D[]
  /** Collide only below this height (world units); above the walls you can fly freely. */
  collideBelow: () => number
  /** Called when a key starts moving the camera (e.g. to relax orbit limits). */
  onStart?: () => void
}

export class KeyboardNav {
  private held = new Set<Action>()
  /** Pressed since the last frame, so a quick tap still moves a little. */
  private pressed = new Set<Action>()
  private fast = false
  private ray = new THREE.Raycaster()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private opts: KeyboardNavOptions

  constructor(camera: THREE.PerspectiveCamera, controls: OrbitControls, opts: KeyboardNavOptions) {
    this.camera = camera
    this.controls = controls
    this.opts = opts
  }

  /** Start listening; returns a function that stops. */
  attach() {
    const down = (e: KeyboardEvent) => {
      this.fast = e.shiftKey
      const action = CODE_TO_ACTION.get(e.code)
      if (!action || e.ctrlKey || e.metaKey || e.altKey || isEditing(e.target)) return
      e.preventDefault() // no page scrolling on arrows / Page Up / Page Down
      if (!this.held.size) this.opts.onStart?.()
      this.held.add(action)
      this.pressed.add(action)
    }
    const up = (e: KeyboardEvent) => {
      this.fast = e.shiftKey
      const action = CODE_TO_ACTION.get(e.code)
      if (action) this.held.delete(action)
    }
    const release = () => {
      this.held.clear()
      this.pressed.clear()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
    }
  }

  private blocked(from: THREE.Vector3, dir: THREE.Vector3, distance: number) {
    const obstacles = this.opts.obstacles()
    if (!obstacles.length || from.y > this.opts.collideBelow()) return false
    // Check at eye level and near the knees, so window sills block as well as walls.
    for (const dy of [0, -1]) {
      const origin = from.clone()
      origin.y += dy
      this.ray.set(origin, dir)
      this.ray.far = distance + BODY
      if (this.ray.intersectObjects(obstacles, false).length) return true
    }
    return false
  }

  /** Horizontal movement with wall collision; slides along a wall instead of stopping dead. */
  private collide(from: THREE.Vector3, move: THREE.Vector3) {
    const len = Math.hypot(move.x, move.z)
    if (len === 0 || !this.blocked(from, new THREE.Vector3(move.x, 0, move.z).normalize(), len)) return move
    const out = new THREE.Vector3()
    if (Math.abs(move.x) > 1e-6 && !this.blocked(from, new THREE.Vector3(Math.sign(move.x), 0, 0), Math.abs(move.x))) out.x = move.x
    else if (Math.abs(move.z) > 1e-6 && !this.blocked(from, new THREE.Vector3(0, 0, Math.sign(move.z)), Math.abs(move.z))) out.z = move.z
    return out
  }

  /** Advance by `dt` seconds. Returns true if the camera moved. */
  update(dt: number): boolean {
    const h = new Set([...this.held, ...this.pressed])
    const tapped = [...this.pressed].some((a) => !this.held.has(a))
    this.pressed.clear()
    if (!h.size) return false
    dt = tapped ? Math.max(dt, TAP) : Math.min(dt, 0.1) // don't jump after a stall
    const cam = this.camera.position
    const target = this.controls.target
    const offset = target.clone().sub(cam)

    // Faster when the camera is far from what it looks at (overview), walking pace up close.
    const scale = THREE.MathUtils.clamp(offset.length() / 3, 1, 8)
    const speed = (this.fast ? RUN : WALK) * scale * dt

    const forward = new THREE.Vector3(offset.x, 0, offset.z)
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion).setY(0)
    forward.normalize()
    const right = new THREE.Vector3().crossVectors(forward, UP).normalize()

    const move = new THREE.Vector3()
    if (h.has('forward')) move.add(forward)
    if (h.has('back')) move.sub(forward)
    if (h.has('right')) move.add(right)
    if (h.has('left')) move.sub(right)
    if (move.lengthSq()) move.normalize().multiplyScalar(speed)
    const step = this.collide(cam, move)
    if (h.has('up')) step.y += speed
    if (h.has('down')) step.y -= speed
    if (cam.y + step.y < 0.2) step.y = 0.2 - cam.y // stay above the ground
    cam.add(step)
    target.add(step)

    // Turning and looking swing the target around the camera.
    const turn = (h.has('turnLeft') ? 1 : 0) - (h.has('turnRight') ? 1 : 0)
    if (turn) offset.applyAxisAngle(UP, turn * TURN * dt)
    const look = (h.has('lookUp') ? 1 : 0) - (h.has('lookDown') ? 1 : 0)
    if (look) {
      const pitch = Math.asin(THREE.MathUtils.clamp(offset.y / offset.length(), -1, 1))
      const next = THREE.MathUtils.clamp(pitch + look * LOOK * dt, -1.4, 1.4)
      offset.applyAxisAngle(new THREE.Vector3().crossVectors(offset, UP).normalize(), next - pitch)
    }
    if (turn || look) target.copy(cam).add(offset)
    return true
  }
}

/** Key reference shown in the UI. */
export const KEY_HELP: [string, string][] = [
  ['W / ↑', 'Move forward'],
  ['S / ↓', 'Move back'],
  ['A / D', 'Step left / right'],
  ['← / →', 'Turn left / right'],
  ['Q / E', 'Move down / up'],
  ['PgUp / PgDn', 'Look up / down'],
  ['Shift', 'Move faster'],
]
