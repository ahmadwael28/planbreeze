import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as RPointerEvent } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import { toast } from 'sonner'
import { Aperture, BookmarkPlus, Camera, DoorClosed, DoorOpen, Keyboard, Lightbulb, LightbulbOff, Moon, RotateCcw, SquareDashed, Sun, X } from 'lucide-react'
import { ViewpointBar, ViewpointMarkers } from '@/components/Viewpoints'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { Loader } from '@/components/ui/loader'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { usePlanTheme } from '@/hooks/use-plan-theme'
import { cn } from '@/lib/utils'
import { bbox, labelPoint, pointInPolygon } from '@/model/geometry'
import { isLightOn, LIGHT_COLORS, OTHER_LIGHTS, switchesFor, WIRE_COLORS } from '@/model/lighting'
import { symbolPose, uid } from '@/model/project'
import { startsShut, SYMBOL_MAP } from '@/model/symbols'
import { refsOf } from '@/model/items'
import type { LightColor, Selection } from '@/model/types'
import { currentFloor, draftFloor, useEditor, useFloor } from '@/store/editor'
import { useUi } from '@/store/ui'
import { buildProjectGroup, SLAB } from '@/three/buildScene'
import type { FloorFilter, PickInfo } from '@/three/buildScene'
import { KEY_HELP, KeyboardNav, NUMPAD_HELP } from '@/three/keyboardNav'
import { poseDoor } from '@/three/furniture'
import { applyLightState, DETAIL_DISTANCE } from '@/three/lighting3d'
import type { LightHandle } from '@/three/lighting3d'
import { LightPool } from '@/three/lightPool'
import type { PoolRoom, VirtualLight } from '@/three/lightPool'
import { computeViewpoints, floorBase, LENSES, planFlight, stepFlight, verticalFov } from '@/three/viewpoints'
import type { Flight, Lens, Viewpoint } from '@/three/viewpoints'

/** The scene is modeled in cm and shown in meters, so light falloff is physically plausible. */
const WORLD_SCALE = 0.01

interface Ctx {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  world: THREE.Group
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  ground: THREE.Mesh
  content: THREE.Group | null
  dirty: boolean
  fitted: boolean
  /** Top of the visible walls (m): keyboard walking collides with walls below this. */
  wallTop: number
  nav: KeyboardNav | null
  lens: Lens
  /** Set while showing viewpoints: their markers are positioned after each render. */
  tour: { points: Viewpoint[]; active: string | null } | null
  markers: Map<string, HTMLElement>
  flight: Flight | null
  /** Doors swinging or sliding open or shut: the part, from and to (0 shut … 1 open), and when it started (ms). */
  doorAnims: { part: THREE.Object3D; from: number; to: number; t0: number }[]
  /** The few real lights, lent to the fixtures that matter from where the camera is; handed out again when it moves. */
  pool: LightPool
  poolDirty: boolean
  poolAt: number
  /** Shaders are being compiled in the background (first build): nothing is drawn meanwhile. */
  compiling: boolean
  /** Shown (3D mode); hidden, it stays alive but doesn't draw, listen to keys or rebuild. */
  visible: boolean
  /** The selection's meshes, showing highlighted copies of their materials (originals in userData.baseMat). */
  highlighted: THREE.Mesh[]
  hlMats: Map<THREE.Material, THREE.Material>
  /** The project last built, to frame a newly opened one. */
  projectId: string | null
  /** The door in reach (see doorInReach), and who to tell when it changes. */
  nearDoor: string | null
  onNearDoor: (id: string | null) => void
  /** When the camera last moved (ms), and whether frames were slow while it moved: then it moves at a lower resolution. */
  movedAt: number
  frameMs: number
  slow: boolean
}

/** Pixel ratio at rest, and while moving on a slow machine (sharp again as soon as the camera stops). */
const fullRatio = () => Math.min(window.devicePixelRatio, 2)
const movingRatio = () => Math.max(0.75, fullRatio() * 0.5)

/** Hand out the real lights again, when the camera has moved or lights changed (at most every so often). */
const POOL_EVERY_MS = 150

/** Whether a door, curtain or blind is shut now: as toggled in 3D, or else as designed. */
function isShut(id: string) {
  const st = useEditor.getState()
  const known = st.doorsClosed[id]
  if (known !== undefined) return known
  const sym = st.project.floors.flatMap((f) => f.symbols).find((s) => s.id === id)
  return !!sym && startsShut(sym)
}

/** What Space would do to a door, curtain or blind. */
function nearLabel(id: string, shut: boolean) {
  const type = currentFloor(useEditor.getState()).symbols.find((s) => s.id === id)?.type
  if (type === 'curtain') return shut ? 'Open the curtains' : 'Close the curtains'
  if (type === 'blind') return shut ? 'Raise the blind' : 'Lower the blind'
  return shut ? 'Open the door' : 'Close the door'
}

/** Swing or slide these doors open or shut. */
function swingDoors(ctx: Ctx | null, ids: string[], closed: boolean) {
  useEditor.getState().setDoorsClosed(ids, closed)
  if (!ctx?.content) return
  const which = new Set(ids)
  const t0 = performance.now()
  ctx.content.traverse((o) => {
    if (!o.userData.door || !which.has(pickedId(o))) return
    ctx.doorAnims = ctx.doorAnims.filter((a) => a.part !== o)
    ctx.doorAnims.push({ part: o, from: (o.userData.open as number | undefined) ?? 1, to: closed ? 0 : 1, t0 })
  })
  ctx.dirty = true
}

/** Within this distance (m) of a door, in front of you, Space opens or closes it. */
const DOOR_REACH = 1.8

/** The door you're standing close to and facing, walking on the current floor (for Space to open or close it). */
function doorInReach(ctx: Ctx): string | null {
  const st = useEditor.getState()
  const floor = currentFloor(st)
  const cam = ctx.camera.position
  const h = cam.y / WORLD_SCALE - floorBase(st.project, floor.id)
  if (h < 0 || h > floor.height) return null
  const ahead = ctx.camera.getWorldDirection(new THREE.Vector3())
  const flat = Math.hypot(ahead.x, ahead.z) || 1
  let best: string | null = null
  let bestD = DOOR_REACH
  for (const s of floor.symbols) {
    if (!SYMBOL_MAP.get(s.type)?.opens) continue
    const p = symbolPose(s, floor.rooms)
    const dx = p.x * WORLD_SCALE - cam.x
    const dz = p.y * WORLD_SCALE - cam.z
    const d = Math.hypot(dx, dz)
    // Close enough, and roughly in front (right next to it, any way you face).
    if (d >= bestD || (d > 0.5 && (dx * ahead.x + dz * ahead.z) / (d * flat) < 0.4)) continue
    best = s.id
    bestD = d
  }
  return best
}

/**
 * Give the pool's real lights to the fixtures that matter most from where the camera is: fading over as it moves,
 * at once for a new scene or a switch flipped (`instant`).
 */
function updatePool(ctx: Ctx, instant = false) {
  ctx.poolDirty = false
  ctx.poolAt = performance.now()
  const content = ctx.content
  if (!content) return ctx.pool.clear()
  // The same list for the same scene, so the pool can tell a new scene from the camera moving.
  const lights = (content.userData.poolLights ??= ((content.userData.lightHandles ?? []) as LightHandle[]).flatMap((h) => h.lights)) as VirtualLight[]
  const rooms = (content.userData.poolRooms ?? []) as PoolRoom[]
  const st = useEditor.getState()
  const floor = currentFloor(st)
  const base = floorBase(st.project, floor.id)
  const roomAt = (v: THREE.Vector3, anyHeight: boolean) => {
    const h = v.y / WORLD_SCALE - base
    if (!anyHeight && (h < 0 || h > floor.height)) return undefined
    return floor.rooms.find((r) => pointInPolygon({ x: v.x / WORLD_SCALE, y: v.z / WORLD_SCALE }, r.points))
  }
  // Walking in a room: light around the camera. Looking at the home from outside: around what it looks at.
  const inside = roomAt(ctx.camera.position, false)
  const focus = inside ? ctx.camera.position : ctx.controls.target
  ctx.pool.retarget(lights, rooms, focus, (inside ?? roomAt(ctx.controls.target, true))?.id ?? null, instant)
  const door = inside ? doorInReach(ctx) : null
  if (door !== ctx.nearDoor) {
    ctx.nearDoor = door
    ctx.onNearDoor(door)
  }
  // Small fixture parts only near the camera; once shown, they stay a little further, so they don't blink at the edge.
  const at = new THREE.Vector3()
  for (const g of (content.userData.detailed ?? []) as THREE.Object3D[]) {
    const dist = g.getWorldPosition(at).distanceTo(ctx.camera.position)
    const near = dist < DETAIL_DISTANCE || (g.userData.near === true && dist < DETAIL_DISTANCE + 1.5)
    if (near === g.userData.near) continue
    g.userData.near = near
    for (const d of g.userData.details as THREE.Object3D[]) d.visible = near
  }
  ctx.dirty = true
}

/** Show the selected items highlighted, by swapping in highlighted copies of their materials (no rebuild needed). */
function highlight(ctx: Ctx, sel: Selection | null) {
  for (const m of ctx.highlighted) m.material = m.userData.baseMat as THREE.Material
  ctx.highlighted = []
  const keys = new Set(refsOf(sel).map((r) => `${r.kind}:${r.id}`))
  if (!keys.size || !ctx.content) return
  ctx.content.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const pick = o.userData.pick as PickInfo | undefined
    const mat = o.material
    if (!pick || !keys.has(`${pick.kind}:${pick.id}`) || !(mat instanceof THREE.MeshStandardMaterial) || mat.userData.lens) return
    let hl = ctx.hlMats.get(mat)
    if (!hl) {
      const copy = mat.clone()
      copy.emissive = new THREE.Color('#2563eb')
      copy.emissiveIntensity = 0.45
      ctx.hlMats.set(mat, (hl = copy))
    }
    o.userData.baseMat = mat
    o.material = hl
    ctx.highlighted.push(o)
  })
}

const DOOR_MS = 650

/** The symbol a 3D object belongs to. */
const pickedId = (o: THREE.Object3D) => (o.userData.pick as PickInfo | undefined)?.id ?? ''

/** The camera's current spot as a saved view (plan cm, heights above the floor's level). */
function captureView(ctx: Ctx, base: number) {
  const r = (n: number) => Math.round(n * 10) / 10
  const cam = ctx.camera.position
  const dir = ctx.controls.target.clone().sub(cam).normalize()
  const eye = { x: r(cam.x * 100), y: r(cam.z * 100), h: r(cam.y * 100 - base) }
  const look = { x: r(eye.x + dir.x * 100), y: r(eye.y + dir.z * 100), h: r(eye.h + dir.y * 100) }
  return { eye, look }
}

function walls(ctx: Ctx) {
  return (ctx.content?.userData.walls as THREE.Object3D[] | undefined) ?? []
}

function applyLens(ctx: Ctx) {
  ctx.camera.fov = verticalFov(ctx.lens, ctx.camera.aspect)
  ctx.camera.updateProjectionMatrix()
  // At a viewpoint the scene follows the pointer while dragging, like a panorama.
  ctx.controls.rotateSpeed = ctx.tour ? -THREE.MathUtils.degToRad(ctx.camera.fov) / (2 * Math.PI) : 1
  ctx.dirty = true
}

const _p = new THREE.Vector3()
const _ray = new THREE.Raycaster()

/** Put each viewpoint marker over its spot, hiding it when it's behind the camera or a wall. */
function placeMarkers(ctx: Ctx) {
  if (!ctx.tour) return
  const { camera } = ctx
  const { clientWidth: w, clientHeight: h } = ctx.renderer.domElement
  const inside = camera.position.y < ctx.wallTop
  const ws = walls(ctx)
  for (const vp of ctx.tour.points) {
    const el = ctx.markers.get(vp.id)
    if (!el) continue
    const dist = camera.position.distanceTo(vp.marker)
    // Markers floating above the walls (outside views) would only confuse from inside a room.
    let show = !ctx.flight && vp.id !== ctx.tour.active && dist > 0.3 && !(inside && vp.marker.y > ctx.wallTop)
    if (show) {
      _p.copy(vp.marker).project(camera)
      show = _p.z < 1 && Math.abs(_p.x) < 1.05 && Math.abs(_p.y) < 1.05
    }
    if (show && inside && ws.length) {
      _ray.set(camera.position, vp.marker.clone().sub(camera.position).normalize())
      _ray.far = dist - 0.05
      show = !_ray.intersectObjects(ws, false).length
    }
    el.style.visibility = show ? 'visible' : 'hidden'
    if (show) el.style.transform = `translate(${((_p.x + 1) / 2) * w}px, ${((1 - _p.y) / 2) * h}px) translate(-50%, -20px)`
  }
}

const mix = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t)

function setLightColor(ids: string[], color: LightColor) {
  useEditor.getState().commit((d) => {
    for (const s of draftFloor(d).symbols) if (ids.includes(s.id) && s.light) s.light = { ...s.light, color }
  })
}

function ColorDots({ value, onChange }: { value: LightColor | 'mixed'; onChange: (c: LightColor) => void }) {
  return (
    <div className="flex gap-1.5">
      {(Object.keys(LIGHT_COLORS) as LightColor[]).map((c) => (
        <Tooltip key={c}>
          <TooltipTrigger asChild>
            <button
              onClick={() => onChange(c)}
              aria-label={LIGHT_COLORS[c].label}
              className={cn(
                'size-4.5 rounded-full border border-black/15 transition-transform hover:scale-110',
                value === c && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
              )}
              style={{ background: LIGHT_COLORS[c].hex }}
            />
          </TooltipTrigger>
          <TooltipContent>
            {LIGHT_COLORS[c].label} · {LIGHT_COLORS[c].kelvin} K
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

/** Switches, light colors and time of day. */
function LightingPanel({ onInside }: { onInside: () => void }) {
  const floor = useFloor()
  const states = useEditor((s) => s.lightStates)
  const setLightState = useEditor((s) => s.setLightState)
  const setAllLights = useEditor((s) => s.setAllLights)
  const daylight = useEditor((s) => s.settings.daylight)
  const showCeilings = useEditor((s) => s.settings.showCeilings)
  const setSettings = useEditor((s) => s.setSettings)
  const [open, setOpen] = useState(() => window.innerWidth >= 768)

  const switches = floor.symbols.filter((s) => s.type === 'switch')
  const lights = floor.symbols.filter((s) => {
    const f = SYMBOL_MAP.get(s.type)?.fixture
    return f && f !== 'switch'
  })
  const other = lights.filter((l) => !switchesFor(floor, l.id).length)
  const colorOf = (ids: string[]): LightColor | 'mixed' => {
    const cs = new Set(lights.filter((l) => ids.includes(l.id)).map((l) => l.light?.color ?? 'warm'))
    return cs.size === 1 ? [...cs][0] : 'mixed'
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="absolute top-3 left-3 z-10 shadow-md" onClick={() => setOpen(true)}>
        <Lightbulb /> Lights
      </Button>
    )
  }

  return (
    <div className="absolute top-3 left-3 z-10 flex max-h-[calc(100%-6rem)] w-72 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border bg-background/95 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Lightbulb className="size-4" /> Lighting
        </span>
        <Button variant="ghost" size="icon-xs" onClick={() => setOpen(false)} aria-label="Hide lighting panel">
          <X />
        </Button>
      </div>
      <div className="space-y-2 border-b px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Moon className="size-4 text-muted-foreground" />
          <Slider min={0} max={1} step={0.01} value={[daylight]} onValueChange={([v]) => setSettings({ daylight: v })} />
          <Sun className="size-4 text-muted-foreground" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="xs" onClick={() => setSettings({ daylight: 0.03 })}>
            Evening
          </Button>
          <Button variant="outline" size="xs" onClick={() => setSettings({ daylight: 1 })}>
            Day
          </Button>
          <Button variant="outline" size="xs" onClick={() => setAllLights(true)}>
            <Lightbulb /> All on
          </Button>
          <Button variant="outline" size="xs" onClick={() => setAllLights(false)}>
            <LightbulbOff /> All off
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {switches.length === 0 && other.length === 0 && (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            No lights on this floor yet. Add spots, pendants or a cove light from the Library, then switches to control them.
          </p>
        )}
        {switches.map((sw, i) => {
          const on = states[sw.id] ?? true
          const ids = sw.controls ?? []
          return (
            <div key={sw.id} className="rounded-lg px-2 py-1.5 hover:bg-muted/60">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: WIRE_COLORS[i % WIRE_COLORS.length] }} />
                  <span className="truncate font-medium">{sw.label || `Switch ${i + 1}`}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {ids.length} light{ids.length === 1 ? '' : 's'}
                  </span>
                </span>
                <Switch checked={on} onCheckedChange={(v) => setLightState(sw.id, v)} aria-label={`Switch ${sw.label}`} />
              </div>
              {ids.length > 0 && (
                <div className="mt-1.5 pl-4.5">
                  <ColorDots value={colorOf(ids)} onChange={(c) => setLightColor(ids, c)} />
                </div>
              )}
            </div>
          )
        })}
        {other.length > 0 && (
          <div className="rounded-lg px-2 py-1.5 hover:bg-muted/60">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">
                <span className="font-medium">Not on a switch</span>{' '}
                <span className="text-xs text-muted-foreground">{other.length}</span>
              </span>
              <Switch
                checked={states[OTHER_LIGHTS] ?? true}
                onCheckedChange={(v) => setLightState(OTHER_LIGHTS, v)}
                aria-label="Lights without a switch"
              />
            </div>
            <div className="mt-1.5">
              <ColorDots value={colorOf(other.map((o) => o.id))} onChange={(c) => setLightColor(other.map((o) => o.id), c)} />
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
        <label className="flex items-center gap-2 text-xs">
          <Switch size="sm" checked={showCeilings} onCheckedChange={(v) => setSettings({ showCeilings: v })} />
          Ceilings
        </label>
        <Button variant="secondary" size="xs" onClick={onInside}>
          <DoorOpen /> Walk inside
        </Button>
      </div>
      <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">Tip: click a switch on a wall to flip it, or a door to open or close it.</p>
    </div>
  )
}

export default function Viewer3D() {
  const hostRef = useRef<HTMLDivElement>(null)
  const ctxRef = useRef<Ctx | null>(null)
  const project = useEditor((s) => s.project)
  const floorId = useEditor((s) => s.floorId)
  const selection = useEditor((s) => s.selection)
  const filter = useEditor((s) => s.settings.floors3d)
  const showCeilings = useEditor((s) => s.settings.showCeilings)
  const daylight = useEditor((s) => s.settings.daylight)
  const lightStates = useEditor((s) => s.lightStates)
  const lens = useEditor((s) => s.settings.lens3d)
  const setSettings = useEditor((s) => s.setSettings)
  const theme = usePlanTheme()
  const visible = useEditor((s) => s.viewMode === '3d')
  const [built, setBuilt] = useState(0)
  const [compiling, setCompiling] = useState(true)
  /** What the scene was last built from, so showing the view again doesn't rebuild an unchanged scene. */
  const builtFrom = useRef<unknown[]>([])
  const [tour, setTour] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const viewpoints = useMemo(() => computeViewpoints(project, floorId), [project, floorId])

  // ---------- one-time setup ----------
  useEffect(() => {
    RectAreaLightUniformsLib.init()
    const host = hostRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(fullRatio())
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    // The sun doesn't move with the camera: redraw its shadows only when the scene or daylight changes.
    renderer.shadowMap.autoUpdate = false
    renderer.toneMapping = THREE.NeutralToneMapping
    host.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'

    const scene = new THREE.Scene()
    const world = new THREE.Group()
    world.scale.setScalar(WORLD_SCALE)
    scene.add(world)
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 2000)
    camera.position.set(8, 9, 12)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.maxPolarAngle = Math.PI / 2 - 0.02
    controls.screenSpacePanning = true

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8d8d8d, 2.2)
    scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xffffff, 2.4)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.02
    sun.shadow.radius = 3
    scene.add(sun, sun.target)

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xe5e5e5, roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)

    const pool = new LightPool()
    scene.add(pool.group)

    const ctx: Ctx = {
      renderer,
      scene,
      world,
      camera,
      controls,
      sun,
      hemi,
      ground,
      content: null,
      dirty: true,
      fitted: false,
      wallTop: -Infinity,
      nav: null,
      lens: useEditor.getState().settings.lens3d,
      tour: null,
      markers: new Map(),
      flight: null,
      doorAnims: [],
      pool,
      poolDirty: true,
      poolAt: 0,
      compiling: false,
      visible: false,
      highlighted: [],
      hlMats: new Map(),
      projectId: null,
      movedAt: 0,
      frameMs: 0,
      slow: false,
      nearDoor: null,
      onNearDoor: () => {},
    }
    ctxRef.current = ctx
    controls.addEventListener('change', () => {
      ctx.dirty = true
      ctx.poolDirty = true
      ctx.movedAt = performance.now()
    })

    // Walk with the keyboard; mouse orbiting keeps working alongside.
    const nav = new KeyboardNav(camera, controls, {
      obstacles: () => walls(ctx),
      collideBelow: () => ctx.wallTop,
      // Allow looking up at ceilings while walking.
      onStart: () => {
        if (!ctx.tour) controls.maxPolarAngle = Math.PI - 0.05
      },
    })
    ctx.nav = nav
    if (import.meta.env.DEV) Object.assign(window, { __viewer: { ctx, nav } })
    const clock = new THREE.Clock()

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host
      if (!w || !h) return
      ctx.slow = false
      ctx.frameMs = 0
      renderer.setSize(w, h)
      camera.aspect = w / h
      applyLens(ctx)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    resize()

    renderer.setAnimationLoop(() => {
      const dt = clock.getDelta()
      if (!ctx.visible || ctx.compiling) return
      const now = performance.now()
      if (nav.update(dt)) {
        ctx.dirty = true
        ctx.poolDirty = true
        ctx.movedAt = now
      }
      if (ctx.flight) {
        ctx.poolDirty = true
        ctx.movedAt = now
        if (stepFlight(ctx.flight, camera, controls.target)) {
          ctx.flight = null
          controls.enabled = true
        }
        ctx.dirty = true
      }
      if (ctx.doorAnims.length) {
        const now = performance.now()
        ctx.doorAnims = ctx.doorAnims.filter((a) => {
          const u = Math.min(1, (now - a.t0) / DOOR_MS)
          const eased = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2
          poseDoor(a.part, a.from + (a.to - a.from) * eased)
          return u < 1
        })
        renderer.shadowMap.needsUpdate = true
        ctx.dirty = true
      }
      controls.update()
      if (ctx.poolDirty && now - ctx.poolAt > POOL_EVERY_MS) updatePool(ctx)
      // Lights handed over to other fixtures fade across.
      if (ctx.pool.animating) {
        ctx.pool.step(Math.min(dt, 0.1))
        ctx.dirty = true
      }
      // Frames too slow while moving: move at a lower resolution, sharp again once the camera stops.
      const moving = now - ctx.movedAt < 300
      if (moving && ctx.dirty) ctx.frameMs = ctx.frameMs * 0.8 + Math.min(dt * 1000, 200) * 0.2
      if (moving && ctx.frameMs > 28) ctx.slow = true
      const ratio = moving && ctx.slow ? movingRatio() : fullRatio()
      if (renderer.getPixelRatio() !== ratio) {
        renderer.setPixelRatio(ratio)
        ctx.dirty = true
      }
      if (ctx.dirty) {
        ctx.dirty = false
        renderer.render(scene, camera)
        placeMarkers(ctx)
      }
    })

    return () => {
      renderer.setAnimationLoop(null)
      ro.disconnect()
      controls.dispose()
      ctx.content?.userData.dispose?.()
      ground.geometry.dispose()
      ;(ground.material as THREE.Material).dispose()
      renderer.dispose()
      renderer.domElement.remove()
      ctxRef.current = null
    }
  }, [])

  // ---------- shown or hidden (the view stays alive in 2D, so coming back is instant) ----------
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.visible = visible
    if (!visible) return
    ctx.dirty = true
    ctx.poolDirty = true
    // Walk with the keyboard only while the 3D view is showing.
    return ctx.nav?.attach()
  }, [visible])

  // ---------- camera helpers ----------
  const frame = useCallback((mode: 'perspective' | 'top') => {
    const ctx = ctxRef.current
    if (!ctx?.content) return
    const box = new THREE.Box3().setFromObject(ctx.content)
    ctx.controls.maxPolarAngle = Math.PI / 2 - 0.02
    if (box.isEmpty()) {
      ctx.controls.target.set(0, 0, 0)
      ctx.camera.position.set(8, 9, 12)
    } else {
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      const radius = Math.max(size.x, size.z, size.y) * 0.75 + 1
      const fov = (ctx.camera.fov * Math.PI) / 180
      const distance = radius / Math.sin(fov / 2)
      ctx.controls.target.set(center.x, mode === 'top' ? 0 : size.y * 0.25, center.z)
      if (mode === 'top') ctx.camera.position.set(center.x, distance, center.z + 0.01)
      else ctx.camera.position.set(center.x + distance * 0.45, distance * 0.62, center.z + distance * 0.65)
    }
    ctx.controls.update()
    ctx.dirty = true
  }, [])

  /** Stand inside the selected room (or the biggest one) at eye level. */
  const walkInside = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const st = useEditor.getState()
    const floor = currentFloor(st)
    const sel = st.selection
    const selSym = sel?.kind === 'symbol' ? floor.symbols.find((x) => x.id === sel.id) : undefined
    const byArea = [...floor.rooms].sort((a, b) => {
      const A = bbox(a.points)
      const B = bbox(b.points)
      return (B.maxX - B.minX) * (B.maxY - B.minY) - (A.maxX - A.minX) * (A.maxY - A.minY)
    })
    const room =
      (sel?.kind === 'room' ? floor.rooms.find((r) => r.id === sel.id) : undefined) ??
      (selSym ? floor.rooms.find((r) => pointInPolygon({ x: selSym.x, y: selSym.y }, r.points)) : undefined) ??
      byArea[0]
    if (!room) return
    const idx = st.project.floors.findIndex((f) => f.id === floor.id)
    const base = st.project.floors.slice(0, idx).reduce((s, f) => s + f.height + SLAB, 0)
    const b = bbox(room.points)
    const c = labelPoint(room.points)
    // Stand near a corner, looking across the room.
    const eye = new THREE.Vector3(b.minX + (b.maxX - b.minX) * 0.15, base + 160, b.maxY - (b.maxY - b.minY) * 0.15)
    const look = new THREE.Vector3(c.x, base + 130, c.y)
    ctx.camera.position.copy(eye.multiplyScalar(WORLD_SCALE))
    ctx.controls.target.copy(look.multiplyScalar(WORLD_SCALE))
    ctx.controls.maxPolarAngle = Math.PI - 0.1
    ctx.controls.update()
    ctx.dirty = true
    if (st.settings.daylight > 0.3) setSettings({ daylight: 0.03 })
    if (!st.settings.showCeilings) setSettings({ showCeilings: true })
  }, [setSettings])

  // ---------- viewpoints ----------
  const goTo = useCallback(
    (id: string) => {
      const ctx = ctxRef.current
      const vp = viewpoints.find((v) => v.id === id)
      if (!ctx || !vp) return
      ctx.flight = planFlight(ctx.camera, walls(ctx), ctx.wallTop, vp.eye, vp.look)
      ctx.controls.enabled = false
      ctx.dirty = true
      setActive(id)
    },
    [viewpoints],
  )

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!viewpoints.length) return
      const i = viewpoints.findIndex((v) => v.id === active)
      const next = i < 0 ? (dir > 0 ? 0 : viewpoints.length - 1) : (i + dir + viewpoints.length) % viewpoints.length
      goTo(viewpoints[next].id)
    },
    [viewpoints, active, goTo],
  )

  const startTour = () => {
    setTour(true)
    // Start outside, looking over the whole home with a marker in every room.
    const first = viewpoints.find((v) => v.kind === 'outside') ?? viewpoints[0]
    if (first) goTo(first.id)
  }

  /** Back to free orbiting, keeping the current view. */
  const exitTour = useCallback(() => {
    setTour(false)
    setActive(null)
    setPlaying(false)
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.flight = null
    ctx.controls.enabled = true
    const cam = ctx.camera.position
    const dir = ctx.controls.target.clone().sub(cam).normalize()
    // Orbit around what's in front: the floor when looking down from above, else a few meters ahead.
    const reach = dir.y < -0.15 ? Math.min(30, (cam.y - 1) / -dir.y) : 3
    ctx.controls.target.copy(cam).addScaledVector(dir, Math.max(1, reach))
    ctx.controls.maxPolarAngle = Math.PI - 0.05
    ctx.dirty = true
  }, [])

  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.tour = tour ? { points: viewpoints, active } : null
    ctx.nav?.setLookOnly(tour)
    const c = ctx.controls
    c.enableZoom = c.enablePan = !tour
    c.minPolarAngle = tour ? 0.15 : 0
    if (tour) c.maxPolarAngle = Math.PI - 0.15
    applyLens(ctx)
  }, [tour, viewpoints, active])

  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.lens = lens
    applyLens(ctx)
  }, [lens])

  // Automatic tour: move on to the next viewpoint every few seconds.
  useEffect(() => {
    if (!playing || !visible) return
    const t = setTimeout(() => step(1), active ? 6500 : 0)
    return () => clearTimeout(t)
  }, [playing, active, step, visible])

  // Page Up / Page Down (also what presentation clickers send) step through viewpoints; Esc leaves.
  useEffect(() => {
    if (!tour || !visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [role="dialog"]:not([data-slot="popover-content"]), [role="menu"], [role="listbox"]')) return
      if (e.key === 'Escape') exitTour()
      else if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault()
        step(e.key === 'PageDown' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tour, step, exitTour, visible])

  // ---------- saved views ----------
  const savedActions = {
    onSave: () => {
      const ctx = ctxRef.current
      if (!ctx) return
      const st = useEditor.getState()
      const floor = currentFloor(st)
      const view = captureView(ctx, floorBase(st.project, floor.id))
      const inRoom =
        view.eye.h < floor.height ? floor.rooms.find((r) => pointInPolygon({ x: view.eye.x, y: view.eye.y }, r.points)) : undefined
      const stem = inRoom ? `${inRoom.name.trim() || 'Room'} view` : view.eye.h > floor.height ? "Bird's-eye view" : 'Outside view'
      const taken = new Set((floor.views ?? []).map((v) => v.name))
      let name = stem
      for (let i = 2; taken.has(name); i++) name = `${stem} ${i}`
      const id = uid()
      st.commit((d) => {
        const f = draftFloor(d)
        f.views = [...(f.views ?? []), { id, name, ...view }]
      })
      if (tour) setActive(`saved:${id}`)
      toast.success(`Saved “${name}”`, { description: tour ? undefined : 'Find it under Viewpoints.' })
    },
    onRename: (savedId: string, name: string) =>
      useEditor.getState().commit((d) => {
        const v = draftFloor(d).views?.find((x) => x.id === savedId)
        if (v) v.name = name
      }),
    onUpdate: (savedId: string) => {
      const ctx = ctxRef.current
      if (!ctx) return
      const st = useEditor.getState()
      const view = captureView(ctx, floorBase(st.project, st.floorId))
      st.commit((d) => {
        const v = draftFloor(d).views?.find((x) => x.id === savedId)
        if (v) Object.assign(v, view)
      })
      toast.success('View updated')
    },
    onDelete: (savedId: string) => {
      useEditor.getState().commit((d) => {
        const f = draftFloor(d)
        f.views = (f.views ?? []).filter((x) => x.id !== savedId)
      })
      if (active === `saved:${savedId}`) setActive(null)
    },
  }

  // "Look from here in 3D" on a saved view in the 2D plan: go there once the scene is ready.
  const pendingView = useUi((s) => s.pendingView)
  useEffect(() => {
    if (!pendingView || !built || !visible) return
    const t = setTimeout(() => {
      useUi.getState().setPendingView(null)
      const id = `saved:${pendingView}`
      if (!viewpoints.some((v) => v.id === id)) return
      setTour(true)
      goTo(id)
    })
    return () => clearTimeout(t)
  }, [pendingView, built, viewpoints, goTo, visible])

  const registerMarker = useCallback((id: string, el: HTMLElement | null) => {
    const ctx = ctxRef.current
    if (!ctx) return
    if (el) ctx.markers.set(id, el)
    else ctx.markers.delete(id)
    ctx.dirty = true
  }, [])

  // ---------- rebuild scene content ----------
  useEffect(() => {
    const ctx = ctxRef.current
    // Hidden: rebuild when shown again, and only if something changed.
    if (!ctx || !visible) return
    const from = [project, floorId, filter, theme, showCeilings]
    if (ctx.content && from.every((x, i) => x === builtFrom.current[i])) return
    builtFrom.current = from
    highlight(ctx, null)
    for (const m of ctx.hlMats.values()) m.dispose()
    ctx.hlMats.clear()
    ctx.content?.userData.dispose?.()
    if (ctx.content) ctx.world.remove(ctx.content)
    // Selection is shown by swapping materials (see `highlight`), so selecting doesn't rebuild the scene.
    const content = buildProjectGroup(project, { floorId, filter, selection: null, theme, showCeilings })
    ctx.world.add(content)
    ctx.content = content
    if (ctx.projectId !== project.id) {
      ctx.projectId = project.id
      ctx.fitted = false
    }

    // Fit sun, shadow camera and ground to the content (world units are meters).
    ctx.world.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(content)
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3())
    const size = box.isEmpty() ? new THREE.Vector3(10, 3, 10) : box.getSize(new THREE.Vector3())
    const r = Math.max(size.x, size.z, size.y) * 0.8 + 2
    ctx.sun.position.set(center.x + r * 0.6, r * 1.4, center.z + r * 0.9)
    ctx.sun.target.position.copy(center)
    const cam = ctx.sun.shadow.camera
    cam.left = cam.bottom = -r
    cam.right = cam.top = r
    cam.near = 0.1
    cam.far = r * 5
    cam.updateProjectionMatrix()
    const walls = (content.userData.walls as THREE.Object3D[]) ?? []
    ctx.wallTop = walls.length ? walls.reduce((top, w) => Math.max(top, new THREE.Box3().setFromObject(w).max.y), -Infinity) + 0.05 : -Infinity
    ctx.ground.scale.set(r * 8, r * 8, 1)
    ctx.ground.position.set(center.x, (-SLAB - 0.5) * WORLD_SCALE, center.z)

    if (!ctx.fitted) {
      ctx.fitted = true
      frame('perspective')
    }
    ctx.renderer.shadowMap.needsUpdate = true
    ctx.poolDirty = true
    ctx.poolAt = 0
    // The first time, compile the shaders in the background instead of freezing the page on the first frame.
    if (!ctx.pool.group.userData.compiled) {
      ctx.pool.group.userData.compiled = true
      ctx.compiling = true
      updatePool(ctx, true)
      ctx.renderer
        .compileAsync(ctx.scene, ctx.camera)
        .catch(() => {})
        .finally(() => {
          ctx.compiling = false
          ctx.dirty = true
          setCompiling(false)
        })
    }
    ctx.dirty = true
    setBuilt((n) => n + 1)
  }, [project, floorId, filter, theme, showCeilings, frame, visible])

  // ---------- selection, highlighted without rebuilding ----------
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx?.content) return
    highlight(ctx, selection)
    ctx.dirty = true
  }, [built, selection])

  // ---------- lights on/off and time of day (no rebuild needed) ----------
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx?.content) return
    const floors = new Map(project.floors.map((f) => [f.id, f]))
    applyLightState(
      ctx.content,
      (fid, id) => {
        const f = floors.get(fid)
        return f ? isLightOn(f, id, lightStates) : true
      },
      (id) => lightStates[id] ?? true,
      daylight,
    )
    const t = Math.max(0, Math.min(1, daylight))
    const dayBg = theme.dark ? '#141417' : '#eef2f6'
    ctx.scene.background = mix('#070a12', dayBg, t)
    ;(ctx.ground.material as THREE.MeshStandardMaterial).color.copy(mix('#0d0f14', theme.dark ? '#1f1f23' : '#e7e5e4', t))
    ctx.hemi.intensity = 0.04 + (theme.dark ? 1.6 : 2.2) * t
    ctx.sun.intensity = 2.4 * t * t
    ctx.sun.castShadow = t > 0.15
    ctx.renderer.shadowMap.needsUpdate = true
    updatePool(ctx, true)
  }, [built, project, lightStates, daylight, theme])

  // ---------- doors open or shut, kept as they were across rebuilds ----------
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx?.content) return
    const closed = useEditor.getState().doorsClosed
    ctx.doorAnims = []
    ctx.content.traverse((o) => {
      if (o.userData.door) poseDoor(o, (closed[pickedId(o)] ?? o.userData.door.startOpen === false) ? 0 : 1)
    })
    ctx.renderer.shadowMap.needsUpdate = true
    ctx.dirty = true
  }, [built])

  /** Swing or slide these doors open or shut. */
  const moveDoors = (ids: string[], closed: boolean) => swingDoors(ctxRef.current, ids, closed)
  const doorsClosed = useEditor((s) => s.doorsClosed)
  const doorIds = useMemo(
    () => project.floors.flatMap((f) => f.symbols.filter((s) => SYMBOL_MAP.get(s.type)?.opens && SYMBOL_MAP.get(s.type)?.wall).map((s) => s.id)),
    [project],
  )
  const anyOpen = doorIds.some((id) => !doorsClosed[id])

  // ---------- Space opens or closes the door you're close to, like in a game ----------
  const [nearDoor, setNearDoor] = useState<string | null>(null)
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.onNearDoor = setNearDoor
    return () => {
      ctx.onNearDoor = () => {}
    }
  }, [])
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target instanceof Element && e.target.closest('input, textarea, select, button, [role="dialog"], [role="menu"], [role="listbox"]')) return
      const id = ctxRef.current?.nearDoor
      if (!id) return
      e.preventDefault()
      swingDoors(ctxRef.current, [id], !isShut(id))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible])

  // ---------- click to select / flip switches / open and shut doors ----------
  const down = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (e: RPointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY }
    // Looking around by hand pauses the automatic tour.
    if (playing) setPlaying(false)
  }
  const onPointerUp = (e: RPointerEvent) => {
    const start = down.current
    down.current = null
    const ctx = ctxRef.current
    if (!start || !ctx?.content || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return
    const rect = ctx.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, ctx.camera)
    const hit = ray
      .intersectObject(ctx.content, true)
      .find((h) => h.object.userData.pick && !(h.object instanceof THREE.Sprite))
    const st = useEditor.getState()
    if (!hit) {
      st.select(null)
      return
    }
    const pick = hit.object.userData.pick as PickInfo
    if (pick.floorId !== st.floorId) st.setFloor(pick.floorId)
    const floor = st.project.floors.find((f) => f.id === pick.floorId)
    const sym = pick.kind === 'symbol' ? floor?.symbols.find((s) => s.id === pick.id) : undefined
    if (sym?.type === 'switch') {
      st.setLightState(sym.id, !(st.lightStates[sym.id] ?? true))
      return
    }
    // A door opens or shuts (Alt + click selects it instead).
    if (sym && SYMBOL_MAP.get(sym.type)?.opens && !e.altKey) {
      moveDoors([sym.id], !isShut(sym.id))
      return
    }
    st.select({ kind: pick.kind, id: pick.id })
  }

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="absolute inset-0" onPointerDown={onPointerDown} onPointerUp={onPointerUp} />
      {nearDoor && !compiling && (
        <div className="pointer-events-none absolute bottom-20 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground/85 px-3 py-1.5 text-xs text-background shadow">
          <Kbd className="bg-background/20 text-background">Space</Kbd>
          {nearLabel(nearDoor, isShut(nearDoor))}
        </div>
      )}
      {compiling && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
            <Loader brand className="size-14 text-foreground" label="Preparing the 3D view" />
            Preparing the 3D view…
          </div>
        </div>
      )}
      {tour && <ViewpointMarkers points={viewpoints} onGo={goTo} register={registerMarker} />}
      <LightingPanel
        onInside={() => {
          exitTour()
          walkInside()
        }}
      />
      <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-lg border bg-background/90 p-1 shadow-sm backdrop-blur">
        <Select value={filter} onValueChange={(v) => setSettings({ floors3d: v as FloorFilter })}>
          <SelectTrigger size="sm" className="w-40 border-0 shadow-none max-sm:w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="upToCurrent">Floors up to current</SelectItem>
            <SelectItem value="current">Current floor only</SelectItem>
            <SelectItem value="all">All floors</SelectItem>
          </SelectContent>
        </Select>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                exitTour()
                frame('top')
              }}
              aria-label="Top view"
            >
              <SquareDashed />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Top view</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                exitTour()
                frame('perspective')
              }}
              aria-label="Reset camera"
            >
              <RotateCcw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reset camera</TooltipContent>
        </Tooltip>
        {doorIds.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => moveDoors(doorIds, anyOpen)}
                aria-label={anyOpen ? 'Close all doors' : 'Open all doors'}
              >
                {anyOpen ? <DoorClosed /> : <DoorOpen />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{anyOpen ? 'Close all doors' : 'Open all doors'} (or click a door)</TooltipContent>
          </Tooltip>
        )}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 px-2" aria-label={`Camera lens: ${LENSES[lens].label}`}>
                  <Aperture />
                  <span className="max-lg:hidden">{LENSES[lens].label}</span>
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Camera lens: go wide to see more of a room</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Camera lens</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={lens} onValueChange={(v) => setSettings({ lens3d: v as Lens })}>
              {(Object.keys(LENSES) as Lens[]).map((k) => (
                <DropdownMenuRadioItem key={k} value={k}>
                  <span className="flex flex-col">
                    <span>{LENSES[k].label}</span>
                    <span className="text-xs text-muted-foreground">{LENSES[k].hint}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Keyboard controls">
                  <Keyboard />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Keyboard controls</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-72">
            <div className="mb-2 text-sm font-medium">Walk with the keyboard</div>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
              {KEY_HELP.map(([keys, what]) => (
                <div key={keys} className="contents">
                  <dt className="flex gap-1">
                    {keys.split(' / ').map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </dt>
                  <dd className="text-muted-foreground">{what}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex items-center gap-3 border-t pt-3">
              <div className="grid shrink-0 grid-cols-3 gap-1" aria-hidden>
                {NUMPAD_HELP.map(([key, dir]) => (
                  <Kbd key={key} className="h-7 w-10">
                    {key}
                    <span className="text-foreground/70">{dir}</span>
                  </Kbd>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Numpad</span> looks in any direction. <Kbd>5</Kbd> looks
                straight ahead.
              </p>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Walls stop you when you walk inside; go through doorways. Fly above the walls to move freely. Try{' '}
              <b>Walk inside</b> in the Lighting panel first.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              In <b>Viewpoints</b>, the arrow keys and numpad look around, <Kbd>PgUp</Kbd> / <Kbd>PgDn</Kbd> go to the previous /
              next spot and <Kbd>Esc</Kbd> leaves.
            </p>
          </PopoverContent>
        </Popover>
      </div>
      {tour ? (
        <>
          <ViewpointBar
            points={viewpoints}
            active={active}
            playing={playing}
            onGo={goTo}
            onStep={step}
            onTogglePlay={() => setPlaying((p) => !p)}
            onExit={exitTour}
            saved={savedActions}
          />
          <div className="pointer-events-none absolute bottom-30 left-1/2 -translate-x-1/2 rounded-full bg-foreground/80 px-3 py-1.5 text-xs whitespace-nowrap text-background max-md:hidden">
            Drag to look around · tap a marker or a name to go there
          </div>
        </>
      ) : (
        <>
          <div className="pointer-events-none absolute bottom-16 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-foreground/80 px-3 py-1.5 text-xs whitespace-nowrap text-background max-md:hidden">
            <Keyboard className="size-3.5" />
            WASD / arrows to walk · numpad to look around · Q / E down / up · Shift faster
          </div>
          <div className="absolute right-3 bottom-3 flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="secondary" size="icon-lg" className="rounded-full shadow-lg" onClick={savedActions.onSave} aria-label="Save this view">
                  <BookmarkPlus />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save this view</TooltipContent>
            </Tooltip>
            {viewpoints.length > 0 && (
              <Button size="lg" className="rounded-full shadow-lg" onClick={startTour}>
                <Camera /> Viewpoints
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
