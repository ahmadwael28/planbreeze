/**
 * Realistic renders of the 3D view, path traced (with three-gpu-pathtracer): light followed as it bounces round the
 * rooms, off the walls and floors, through windows and glass and into mirrors, from every light that's on (not only the
 * few near the camera the view lights with), the sun and the sky by the time of day. What's drawn is what the view
 * shows, from where it's seen, at the size asked for, in a renderer of its own so the view carries on as it was. No AI
 * anywhere: the grain left after the samples is smoothed, if asked, by an edge-keeping filter.
 */
import * as THREE from 'three'
import { GradientEquirectTexture, WebGLPathTracer } from 'three-gpu-pathtracer'
import { GrainFilter, albedoMaterials, drawGuides } from './renderFilter'
import type { Guides } from './renderFilter'
import { TUNING, rememberSpeed, tracedSize } from './renderQuality'
import type { RenderTuning } from './renderQuality'
import { renderSource } from './renderSource'
import type { RenderSource } from './renderSource'

export interface RenderProgress {
  /** Getting the scene ready (`prepared`: 0 … 1), drawing it (`samples` so far), or finished. */
  phase: 'preparing' | 'rendering' | 'done'
  prepared: number
  /** Getting the graphics card ready to trace (its program built: the first time, a minute or two). */
  compiling: boolean
  samples: number
  /** How long a sample's taking (ms), once it's known; or 0. */
  perSample: number
}

export interface RenderOptions {
  width: number
  height: number
  /** How many samples (passes over every pixel) to stop at: more, less grain. */
  samples: number
  exposure: number
  /** Smooth out the grain (see renderFilter). */
  smooth: boolean
  /** How it's made (see TUNING), where not as usual. */
  tuning?: Partial<RenderTuning>
  onProgress: (p: RenderProgress) => void
  /** The graphics card gave up on it (its context lost): it's stopped. */
  onLost?: () => void
  /** Called off while it's still getting the scene ready. */
  signal?: AbortSignal
}

export interface RenderJob {
  /** The picture as it's drawn, made small enough to show (the whole of it is what's saved). */
  canvas: HTMLCanvasElement
  setExposure: (e: number) => void
  setSmooth: (on: boolean) => void
  /** Stop drawing, keeping the picture as it is. */
  stop: () => void
  toBlob: () => Promise<Blob>
  dispose: () => void
}

/**
 * A copy of what the view shows, made of what the path tracer draws: its meshes where they are (their geometry
 * shared), in materials it reads (others turned into ones it does: glows that only add light into light-giving,
 * see-through ones; the view's own tricks, its glow sprites and points, left out); its lights, every one that's on, as
 * the view's light pool would place them; the sun; and a sky round it all, by the time of day.
 */
function copyScene(src: RenderSource, tune: RenderTuning) {
  const scene = new THREE.Scene()
  const made: THREE.Material[] = []
  const mats = new Map<THREE.Material, THREE.Material | null>()
  // Glass, glows and what's faint: seen through, so left out of the grain filter's guides (see renderFilter).
  const through = new Set<THREE.Material>()
  const hidden: THREE.Object3D[] = []
  const convert = (m: THREE.Material): THREE.Material | null => {
    if (mats.has(m)) return mats.get(m)!
    const any = m as THREE.Material & Partial<THREE.MeshStandardMaterial> & { shininess?: number }
    let out: THREE.Material | null
    if (!m.visible || m instanceof THREE.ShaderMaterial || !('color' in m)) out = null
    else if (m.blending === THREE.AdditiveBlending) {
      // A glow on what's behind it (a backlit mirror's halo): giving light where it glows, see-through elsewhere.
      out =
        any.emissiveIntensity && any.emissiveMap
          ? new THREE.MeshStandardMaterial({
              color: 0x000000,
              userData: { through: true },
              emissive: any.emissive,
              emissiveMap: any.emissiveMap,
              emissiveIntensity: any.emissiveIntensity,
              alphaMap: any.emissiveMap,
              transparent: true,
              side: m.side,
              roughness: 1,
            })
          : null
    } else if (tune.glass === 'clear' && m.transparent && m.opacity < 0.9 && (any.roughness ?? 1) <= 0.3 && !any.map) {
      // Glass: clear, letting the light through (thin: straight through it), tinted a little by its color.
      out = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(any.color).lerp(new THREE.Color(0xffffff), 0.6),
        transmission: 1,
        roughness: 0.02,
        metalness: 0,
        ior: 1.5,
        thickness: 0,
        side: m.side,
        userData: { through: true },
      })
    } else if (m instanceof THREE.MeshStandardMaterial) out = m
    else {
      out = new THREE.MeshStandardMaterial({
        color: any.color,
        map: any.map ?? null,
        alphaMap: any.alphaMap ?? null,
        emissive: any.emissive ?? 0x000000,
        emissiveMap: any.emissiveMap ?? null,
        emissiveIntensity: any.emissiveIntensity ?? 1,
        transparent: m.transparent,
        opacity: m.opacity,
        side: m.side,
        roughness: any.shininess ? 0.4 : 0.9,
        metalness: 0,
      })
    }
    mats.set(m, out)
    if (out && out !== m) made.push(out)
    if (out && (out.userData.through || (out.transparent && out.opacity < 0.5))) through.add(out)
    return out
  }
  for (const root of src.objects) {
    root.updateWorldMatrix(true, true)
    root.traverseVisible((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material)
      if (!material || (Array.isArray(material) && material.some((x) => !x))) return
      const copy = new THREE.Mesh(o.geometry, material as THREE.Material | THREE.Material[])
      copy.matrixAutoUpdate = false
      copy.matrix.copy(o.matrixWorld)
      scene.add(copy)
      if ((Array.isArray(material) ? material : [material]).some((x) => through.has(x!))) hidden.push(copy)
    })
  }

  // The lights that light what's seen: those on in the room the camera's in (or, from outside, nearest what it looks
  // at), and a few others close by (through a door). The path tracer takes one light at random at each bounce: a light
  // that can't reach what's seen only makes the rest show less often, and the picture grainier. They're placed as the
  // view places its real ones (see lightPool): spots shining straight down, round enough for soft shadows.
  const at = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const on = src.lights
    .filter((v) => v.intensity > 0)
    .map((v) => ({ v, d: v.anchor.getWorldPosition(new THREE.Vector3()).distanceTo(src.focus) }))
    .sort((a, b) => a.d - b.d)
  const mine = src.inside && src.room ? on.filter((x) => x.v.room === src.room) : on
  const others = src.inside && src.room ? on.filter((x) => x.v.room !== src.room && x.d < 3.5).slice(0, 3) : []
  const near = [...mine, ...others].slice(0, tune.maxLights).map((x) => x.v)
  for (const v of near) {
    v.anchor.getWorldPosition(at)
    if (v.kind === 'spot') {
      const l = new THREE.SpotLight(v.color, v.intensity, 0, v.angle ?? 0.5, v.penumbra ?? 0.65, 2)
      l.position.copy(at)
      l.target.position.set(at.x, at.y - 1, at.z)
      Object.assign(l, { radius: 0.05 })
      scene.add(l, l.target)
    } else if (v.kind === 'point') {
      const l = new THREE.PointLight(v.color, v.intensity, 0, 2)
      l.position.copy(at)
      Object.assign(l, { radius: 0.06 })
      scene.add(l)
    } else {
      const l = new THREE.RectAreaLight(v.color, v.intensity, v.width ?? 1, v.height ?? 1)
      l.position.copy(at)
      l.quaternion.copy(v.anchor.getWorldQuaternion(q))
      scene.add(l)
    }
  }

  // The sun, where it is.
  if (src.sun.intensity > 0) {
    const sun = new THREE.DirectionalLight(src.sun.color, src.sun.intensity)
    sun.position.copy(src.sun.getWorldPosition(at))
    sun.target.position.copy(src.sun.target.getWorldPosition(at))
    scene.add(sun, sun.target)
  }

  // The sky: a soft blue over a warm ground by day, dark at night; lighting through the windows, seen through them.
  const t = Math.max(0, Math.min(1, src.daylight))
  const sky = new GradientEquirectTexture(128)
  sky.topColor.set('#0b1020').lerp(new THREE.Color('#a9c6ea'), t)
  sky.bottomColor.set('#08080a').lerp(new THREE.Color('#d9d2c6'), t)
  sky.exponent = 2
  sky.update()
  scene.environment = sky
  scene.background = sky
  scene.environmentIntensity = 0.04 + 0.96 * t
  scene.backgroundIntensity = 0.04 + 0.96 * t

  scene.updateMatrixWorld(true)
  return { scene, made, sky, hidden }
}

/** How big the picture's shown as it's drawn (its longer side, px), at most. */
const PREVIEW = 1280
/** Rounds of the grain filter: blending out to 2⁵ = 32 traced pixels away. */
const ROUNDS = 5
/** The most light a path brings back after its first bounce (see the path tracer's program, below). */
const FIREFLY = 5
/** How bright a picture's made (its metered brightness, see GrainFilter.brightness), before it's made brighter or darker. */
const KEY = 0.2

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Start a render of the 3D view as it's seen now; it goes on drawing (and telling how far it's got) till it's done. */
export async function startRender(opts: RenderOptions): Promise<RenderJob> {
  const src = renderSource()
  if (!src) throw new Error('The 3D view is not open')
  const tune = { ...TUNING, ...opts.tuning }
  const restore = src.plain()
  let copied: ReturnType<typeof copyScene>
  try {
    copied = copyScene(src, tune)
  } finally {
    restore()
  }
  const { scene, made, sky, hidden } = copied
  const { width, height } = opts
  const camera = src.camera.clone()
  camera.clearViewOffset()
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)

  // The whole picture's drawn here, when it's done; as it's drawn, a smaller one's shown (see show).
  const canvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  renderer.toneMapping = src.toneMapping
  renderer.toneMappingExposure = opts.exposure
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const k = Math.min(1, PREVIEW / Math.max(width, height))
  const preview = document.createElement('canvas')
  preview.width = Math.round(width * k)
  preview.height = Math.round(height * k)
  const shown = preview.getContext('2d')!
  shown.imageSmoothingQuality = 'high'

  // The light's traced at a smaller size than the picture's, when it's big (see RenderTuning.pixels).
  const traced = tracedSize(width, height, tune.pixels)
  const tracer = new WebGLPathTracer(renderer)
  // (Its program being built: not in its types.)
  const compiling = () => Boolean((tracer as unknown as { isCompiling?: boolean }).isCompiling)
  // Drawn on the canvas here (see show), not after every sample.
  tracer.renderToCanvas = false
  tracer.minSamples = 0
  tracer.fadeDuration = 0
  tracer.renderDelay = 0
  tracer.dynamicLowRes = false
  tracer.renderScale = traced.scale
  tracer.bounces = tune.bounces
  tracer.transmissiveBounces = 4
  tracer.textureSize.set(tune.textureSize, tune.textureSize)
  tracer.multipleImportanceSampling = true
  // Fewer bright specks (fireflies) from light glancing off glossy surfaces after a bounce.
  tracer.filterGlossyFactor = 0.5
  // Glowing parts (a fixture's lens, an LED strip) glow where they're seen (straight on, in a mirror, through glass)
  // but light nothing: the fixture's own light does that, as in the view. Their light, found only by chance off what
  // it lights, is most of a render's grain, and of the blotches smoothing it leaves. And what a path brings back after
  // its first bounce is kept to FIREFLY: one that finds something small and bright by a fluke can bring back a
  // thousand times what the rest do, a speck no number of samples hides.
  const program = (tracer as unknown as { _pathTracer?: { material?: THREE.ShaderMaterial } })._pathTracer?.material
  const patches: [string, string][] = [
    ['state.transmissiveTraversals = transmissiveBounces;', '$& float glowSeen = 1.0; vec3 firstHit = vec3( 0.0 ); bool bounced = false;'],
    [
      'state.firstRay = i == 0 && state.transmissiveTraversals == transmissiveBounces;',
      '$& if ( ! state.firstRay && ! bounced ) { firstHit = gl_FragColor.rgb; bounced = true; }',
    ],
    [
      'gl_FragColor.rgb += ( surf.emission * state.throughputColor );',
      'if ( glowSeen > 0.5 ) $& if ( surf.roughness > 0.25 || ( surf.metalness < 0.5 && surf.transmission < 0.5 ) ) glowSeen = 0.0;',
    ],
    [
      'gl_FragColor.a *= opacity;',
      `if ( bounced ) { vec3 rest = gl_FragColor.rgb - firstHit; float l = luminance( rest ); if ( l > ${FIREFLY.toFixed(1)} ) gl_FragColor.rgb = firstHit + rest * ( ${FIREFLY.toFixed(1)} / l ); } $&`,
    ],
  ]
  if (program && patches.every(([m]) => program.fragmentShader.split(m).length === 2)) {
    for (const [m, r] of patches) program.fragmentShader = program.fragmentShader.replace(m, r)
    program.needsUpdate = true
  }
  // A tile at a time, each small enough to take the GPU a moment (see gpuDone), so the page keeps being drawn too.
  let tiles = Math.min(8, Math.max(1, Math.ceil(Math.sqrt((traced.width * traced.height) / 400_000))))
  tracer.tiles.set(tiles, tiles)

  const albedo = albedoMaterials()
  let guides: Guides[] = []
  let filter: GrainFilter | null = null
  let running = true
  let frame = 0
  let timer = 0
  let disposed = false
  let firstAt = 0
  let firstSamples = 0
  let perSample = 0
  const report = (phase: RenderProgress['phase'], prepared: number) =>
    opts.onProgress({ phase, prepared, compiling: compiling(), samples: Math.floor(tracer.samples), perSample })
  const cleanUp = () => {
    disposed = true
    running = false
    cancelAnimationFrame(frame)
    clearTimeout(timer)
    tracer.dispose()
    filter?.dispose()
    new Set(guides).forEach((g) => g.dispose())
    albedo.dispose()
    for (const m of made) m.dispose()
    sky.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
  report('preparing', 0)
  try {
    // A moment for "getting ready" to show, then the scene's made ready for the path tracer (its BVH: what's where,
    // to find what each ray hits), here and now: a second or two for a big plan. Then the grain filter's guides, at
    // the picture's size and the traced one's.
    await wait(50)
    if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    tracer.setScene(scene, camera)
    report('preparing', 0.8)
    await wait(30)
    if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const hi = drawGuides(renderer, scene, camera, width, height, hidden, albedo)
    const lo = traced.scale < 1 ? drawGuides(renderer, scene, camera, traced.width, traced.height, hidden, albedo) : hi
    guides = [hi, lo]
    filter = new GrainFilter(renderer, lo, hi, camera)
  } catch (e) {
    cleanUp()
    throw e
  }

  // The picture so far: the light traced, smoothed (or not), each pixel's own color put back (see renderFilter); the
  // whole of it, or (as it's drawn) small, to show.
  let smooth = opts.smooth
  let exposure = opts.exposure
  let light: THREE.Texture | null = null
  let lightOf = ''
  // As bright as a camera would make it (see GrainFilter.brightness), then as asked.
  let metered = 1
  let whole = false
  let shownAt = 0
  let shownSamples = -1
  const show = (all: boolean) => {
    if (!filter) return
    const of = `${tracer.samples}|${smooth}`
    if (!light || lightOf !== of) {
      light = filter.smooth(tracer.target.texture, smooth ? ROUNDS : 0)
      lightOf = of
      const b = filter.brightness(light)
      if (b > 0) metered = Math.min(3, Math.max(0.6, KEY / b))
    }
    renderer.toneMappingExposure = metered * exposure
    if (all) {
      filter.draw(light)
      shown.drawImage(canvas, 0, 0, width, height, 0, 0, preview.width, preview.height)
    } else {
      filter.draw(light, preview.width, preview.height)
      shown.drawImage(canvas, 0, height - preview.height, preview.width, preview.height, 0, 0, preview.width, preview.height)
    }
    whole = all
    shownAt = performance.now()
    shownSamples = Math.floor(tracer.samples)
  }
  // Done (or stopped): the whole picture, and how quick this device was, for the next one's estimate.
  const finish = () => {
    running = false
    cancelAnimationFrame(frame)
    clearTimeout(timer)
    show(true)
    if (perSample > 0 && tracer.samples >= 3) rememberSpeed(tune.bounces, (perSample * 1000) / (traced.width * traced.height))
    report('done', 1)
  }

  // A sample (or a tile of one) a frame; with no frames coming (a hidden tab, a hidden pane), on a timer instead.
  const next = (ms = 4) => {
    let done = false
    const go = () => {
      if (done) return
      done = true
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      tick()
    }
    if (ms <= 4) frame = requestAnimationFrame(go)
    timer = window.setTimeout(go, ms)
  }
  // One piece of work on the graphics card at a time: the next sample (or tile) is only asked for once the last is
  // done (a fence in its queue says so), or the queue would grow far past what's been drawn and the browser, waiting
  // on it, give up on the card. A tile that takes long, and they're made smaller.
  const gl = renderer.getContext() as WebGL2RenderingContext
  let fence: WebGLSync | null = null
  let sent = 0
  const gpuDone = () => {
    if (!fence) return true
    if (gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) return false
    gl.deleteSync(fence)
    fence = null
    // Smaller tiles when one took long (the page waits on it), bigger when they're quick (each has its cost).
    const took = performance.now() - sent
    const next = took > 150 ? Math.min(12, tiles + 1) : took < 30 ? Math.max(1, tiles - 1) : tiles
    if (next !== tiles) {
      tiles = next
      tracer.tiles.set(tiles, tiles)
    }
    return true
  }
  const tick = () => {
    if (!running || disposed) return
    if (!gpuDone()) return next()
    const n = tracer.samples
    if (n >= opts.samples) return finish()
    // How long a sample takes, from the first one on (the first waits on the graphics card getting ready).
    const now = performance.now()
    if (n >= 1 && !firstAt) {
      firstAt = now
      firstSamples = n
    } else if (firstAt && n - firstSamples >= 0.5) perSample = (now - firstAt) / (n - firstSamples)
    // The picture so far, now and then (the first sample at once).
    if (Math.floor(n) > shownSamples && (shownSamples < 1 || now - shownAt > 1500)) show(false)
    tracer.renderSample()
    if (compiling()) {
      // Its program's still being built (in the graphics card's own time): asked again in a while.
      report('preparing', 1)
      return next(100)
    }
    fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    gl.flush()
    sent = performance.now()
    report('rendering', 1)
    next()
  }
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    if (disposed) return
    running = false
    opts.onLost?.()
  })
  next()

  // Drawn again after a change to how it's shown.
  const redraw = () => {
    if (!disposed && tracer.samples >= 1) show(!running)
  }
  return {
    canvas: preview,
    setExposure: (e) => {
      exposure = e
      redraw()
    },
    setSmooth: (on) => {
      smooth = on
      redraw()
    },
    stop: () => {
      if (running) finish()
    },
    toBlob: () => {
      if (!whole && !disposed) show(true)
      return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the picture'))), 'image/png'))
    },
    dispose: () => {
      if (!disposed) cleanUp()
    },
  }
}
