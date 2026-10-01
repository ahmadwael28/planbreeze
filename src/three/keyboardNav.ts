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
  up: ['KeyE'],
  down: ['KeyQ'],
  // The numpad looks in all eight directions; R / F look up / down on keyboards without one.
  turnLeft: ['ArrowLeft', 'Numpad4', 'Numpad7', 'Numpad1'],
  turnRight: ['ArrowRight', 'Numpad6', 'Numpad9', 'Numpad3'],
  lookUp: ['Numpad8', 'Numpad7', 'Numpad9', 'KeyR'],
  lookDown: ['Numpad2', 'Numpad1', 'Numpad3', 'KeyF'],
  level: ['Numpad5'],
} as const
type Action = keyof typeof ACTIONS
/** A key can do several things at once (Numpad 7 looks up and to the left). */
const CODE_ACTIONS = new Map<string, Action[]>()
for (const a of Object.keys(ACTIONS) as Action[]) {
  for (const c of ACTIONS[a]) CODE_ACTIONS.set(c, [...(CODE_ACTIONS.get(c) ?? []), a])
}
const LOOK_ACTIONS = new Set<Action>(['turnLeft', 'turnRight', 'lookUp', 'lookDown', 'level'])
/** When only looking around, the up / down arrows look up / down instead of walking. */
const LOOK_ONLY_ARROWS: Record<string, Action[]> = { ArrowUp: ['lookUp'], ArrowDown: ['lookDown'] }

const UP = new THREE.Vector3(0, 1, 0)
const WALK = 1.6 // m/s
const RUN = 4.5 // m/s with Shift
const TURN = 1.6 // rad/s
const LOOK = 1.0 // rad/s
const BODY = 0.3 // m kept between the camera and a wall
const TAP = 0.12 // s of movement for a quick tap released before the next frame

/** Ignore keys while the user is typing or adjusting a control. */
function isEditing(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [role="tablist"], [role="radiogroup"], [role="combobox"], [role="dialog"]:not([data-slot="popover-content"]), [role="menu"], [role="listbox"]')
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
  /** Key codes held down. */
  private held = new Set<string>()
  /** Pressed since the last frame, so a quick tap still moves a little. */
  private pressed = new Set<string>()
  private fast = false
  private ray = new THREE.Raycaster()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private opts: KeyboardNavOptions
  private lookOnly = false

  constructor(camera: THREE.PerspectiveCamera, controls: OrbitControls, opts: KeyboardNavOptions) {
    this.camera = camera
    this.controls = controls
    this.opts = opts
  }

  /** Only look around (turn and tilt) without moving, e.g. while standing at a viewpoint. */
  setLookOnly(on: boolean) {
    this.lookOnly = on
    this.held.clear()
    this.pressed.clear()
  }

  private actionsFor(code: string): Action[] | undefined {
    if (!this.lookOnly) return CODE_ACTIONS.get(code)
    const look = LOOK_ONLY_ARROWS[code] ?? CODE_ACTIONS.get(code)?.filter((a) => LOOK_ACTIONS.has(a))
    return look?.length ? look : undefined
  }

  /** Start listening; returns a function that stops. */
  attach() {
    const down = (e: KeyboardEvent) => {
      this.fast = e.shiftKey
      if (!this.actionsFor(e.code) || e.ctrlKey || e.metaKey || e.altKey || isEditing(e.target)) return
      e.preventDefault() // no page scrolling on arrow keys
      if (!this.held.size) this.opts.onStart?.()
      this.held.add(e.code)
      this.pressed.add(e.code)
    }
    const up = (e: KeyboardEvent) => {
      this.fast = e.shiftKey
      this.held.delete(e.code)
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
    const codes = new Set([...this.held, ...this.pressed])
    const tapped = [...this.pressed].some((c) => !this.held.has(c))
    this.pressed.clear()
    if (!codes.size) return false
    const h = new Set([...codes].flatMap((c) => this.actionsFor(c) ?? []))
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
    const level = h.has('level')
    if (level) offset.copy(forward).multiplyScalar(offset.length()) // look straight ahead
    const turn = (h.has('turnLeft') ? 1 : 0) - (h.has('turnRight') ? 1 : 0)
    if (turn) offset.applyAxisAngle(UP, turn * TURN * dt)
    const look = (h.has('lookUp') ? 1 : 0) - (h.has('lookDown') ? 1 : 0)
    if (look) {
      const pitch = Math.asin(THREE.MathUtils.clamp(offset.y / offset.length(), -1, 1))
      const next = THREE.MathUtils.clamp(pitch + look * LOOK * dt, -1.4, 1.4)
      offset.applyAxisAngle(new THREE.Vector3().crossVectors(offset, UP).normalize(), next - pitch)
    }
    if (turn || look || level) target.copy(cam).add(offset)
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
  ['R / F', 'Look up / down'],
  ['Shift', 'Move faster'],
  ['Space', 'Open or close the door in front of you'],
]

/** Numpad keys in their physical layout, with the direction each one looks. */
export const NUMPAD_HELP: [string, string][] = [
  ['7', '↖'],
  ['8', '↑'],
  ['9', '↗'],
  ['4', '←'],
  ['5', '•'],
  ['6', '→'],
  ['1', '↙'],
  ['2', '↓'],
  ['3', '↘'],
]
