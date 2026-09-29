import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as RPointerEvent } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import { DoorOpen, Keyboard, Lightbulb, LightbulbOff, Moon, RotateCcw, SquareDashed, Sun, X } from 'lucide-react'
import { Kbd } from '@/components/ui/kbd'
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
import { SYMBOL_MAP } from '@/model/symbols'
import type { LightColor } from '@/model/types'
import { currentFloor, draftFloor, useEditor, useFloor } from '@/store/editor'
import { buildProjectGroup, SLAB } from '@/three/buildScene'
import type { FloorFilter, PickInfo } from '@/three/buildScene'
import { KEY_HELP, KeyboardNav, NUMPAD_HELP } from '@/three/keyboardNav'
import { applyLightState } from '@/three/lighting3d'

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
      <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">Tip: click a switch on a wall to flip it.</p>
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
  const setSettings = useEditor((s) => s.setSettings)
  const theme = usePlanTheme()
  const [built, setBuilt] = useState(0)

  // ---------- one-time setup ----------
  useEffect(() => {
    RectAreaLightUniformsLib.init()
    const host = hostRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
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

    const ctx: Ctx = { renderer, scene, world, camera, controls, sun, hemi, ground, content: null, dirty: true, fitted: false, wallTop: -Infinity }
    ctxRef.current = ctx
    controls.addEventListener('change', () => (ctx.dirty = true))

    // Walk with the keyboard; mouse orbiting keeps working alongside.
    const nav = new KeyboardNav(camera, controls, {
      obstacles: () => (ctx.content?.userData.walls as THREE.Object3D[] | undefined) ?? [],
      collideBelow: () => ctx.wallTop,
      // Allow looking up at ceilings while walking.
      onStart: () => (controls.maxPolarAngle = Math.PI - 0.05),
    })
    const detachKeys = nav.attach()
    if (import.meta.env.DEV) Object.assign(window, { __viewer: { ctx, nav } })
    const clock = new THREE.Clock()

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      ctx.dirty = true
    }
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    resize()

    renderer.setAnimationLoop(() => {
      if (nav.update(clock.getDelta())) ctx.dirty = true
      controls.update()
      if (ctx.dirty) {
        ctx.dirty = false
        renderer.render(scene, camera)
      }
    })

    return () => {
      renderer.setAnimationLoop(null)
      detachKeys()
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

  // ---------- rebuild scene content ----------
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.content?.userData.dispose?.()
    if (ctx.content) ctx.world.remove(ctx.content)
    const content = buildProjectGroup(project, { floorId, filter, selection, theme, showCeilings })
    ctx.world.add(content)
    ctx.content = content

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
    ctx.dirty = true
    setBuilt((n) => n + 1)
  }, [project, floorId, filter, selection, theme, showCeilings, frame])

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
    ctx.dirty = true
  }, [built, project, lightStates, daylight, theme])

  // ---------- click to select / flip switches ----------
  const down = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (e: RPointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY }
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
    st.select({ kind: pick.kind, id: pick.id })
  }

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="absolute inset-0" onPointerDown={onPointerDown} onPointerUp={onPointerUp} />
      <LightingPanel onInside={walkInside} />
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
            <Button variant="ghost" size="icon-sm" onClick={() => frame('top')} aria-label="Top view">
              <SquareDashed />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Top view</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={() => frame('perspective')} aria-label="Reset camera">
              <RotateCcw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reset camera</TooltipContent>
        </Tooltip>
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
          </PopoverContent>
        </Popover>
      </div>
      <div className="pointer-events-none absolute bottom-16 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-foreground/80 px-3 py-1.5 text-xs whitespace-nowrap text-background max-md:hidden">
        <Keyboard className="size-3.5" />
        WASD / arrows to walk · numpad to look around · Q / E down / up · Shift faster
      </div>
    </div>
  )
}
