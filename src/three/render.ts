/**
 * Realistic renders of the 3D view, path traced (with three-gpu-pathtracer): light followed as it bounces round the
 * rooms, off the walls and floors, through windows and glass and into mirrors, from every light that's on (not only the
 * few near the camera the view lights with), the sun and the sky by the time of day. What's drawn is what the view
 * shows, from where it's seen, at the size asked for, in a renderer of its own so the view carries on as it was. No AI
 * anywhere: the grain left after the samples is smoothed, if asked, by an edge-keeping filter.
 */
import * as THREE from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { DenoiseMaterial, GradientEquirectTexture, WebGLPathTracer } from 'three-gpu-pathtracer'
import { renderSource } from './renderSource'
import type { RenderSource } from './renderSource'

export interface RenderProgress {
  /** Getting the scene ready (`prepared`: 0 … 1), drawing it (`samples` so far), or finished. */
  phase: 'preparing' | 'rendering' | 'done'
  prepared: number
  samples: number
}

export interface RenderOptions {
  width: number
  height: number
  /** How many samples (passes over every pixel) to stop at: more, less grain. */
  samples: number
  exposure: number
  /** Smooth out the grain (an edge-keeping filter). */
  smooth: boolean
  onProgress: (p: RenderProgress) => void
  /** The graphics card gave up on it (its context lost): it's stopped. */
  onLost?: () => void
  /** Called off while it's still getting the scene ready. */
  signal?: AbortSignal
}

export interface RenderJob {
  /** What it's drawn on, as it's drawn. */
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
function copyScene(src: RenderSource) {
  const scene = new THREE.Scene()
  const made: THREE.Material[] = []
  const mats = new Map<THREE.Material, THREE.Material | null>()
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
              emissive: any.emissive,
              emissiveMap: any.emissiveMap,
              emissiveIntensity: any.emissiveIntensity,
              alphaMap: any.emissiveMap,
              transparent: true,
              side: m.side,
              roughness: 1,
            })
          : null
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
    })
  }

  // The lights that are on near the camera (within a few rooms of it: the path tracer takes one light at random at each
  // bounce, so far ones, which can't light what's seen, only add grain), as the view places its real ones (see
  // lightPool): spots shining straight down, round enough for soft shadows.
  const at = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const eye = src.camera.getWorldPosition(new THREE.Vector3())
  const near = src.lights
    .filter((v) => v.intensity > 0)
    .map((v) => ({ v, d: v.anchor.getWorldPosition(new THREE.Vector3()).distanceTo(eye) }))
    .sort((a, b) => a.d - b.d)
    .filter((x, i) => i < 8 || (x.d < 8 && i < 32))
    .map((x) => x.v)
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
  return { scene, made, sky }
}

/** Start a render of the 3D view as it's seen now; it goes on drawing (and telling how far it's got) till it's done. */
export async function startRender(opts: RenderOptions): Promise<RenderJob> {
  const src = renderSource()
  if (!src) throw new Error('The 3D view is not open')
  const restore = src.plain()
  let copied: ReturnType<typeof copyScene>
  try {
    copied = copyScene(src)
  } finally {
    restore()
  }
  const { scene, made, sky } = copied
  const camera = src.camera.clone()
  camera.clearViewOffset()
  camera.aspect = opts.width / opts.height
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)

  const canvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(opts.width, opts.height, false)
  renderer.toneMapping = src.toneMapping
  renderer.toneMappingExposure = opts.exposure
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const tracer = new WebGLPathTracer(renderer)
  // Drawn on the canvas here (see show), not after every sample.
  tracer.renderToCanvas = false
  tracer.minSamples = 0
  tracer.fadeDuration = 0
  tracer.renderDelay = 0
  tracer.dynamicLowRes = false
  tracer.renderScale = 1
  tracer.bounces = 5
  tracer.multipleImportanceSampling = true
  // Fewer bright specks (fireflies) from light glancing off glossy surfaces after a bounce.
  tracer.filterGlossyFactor = 0.5
  // Big pictures a tile at a time, so the GPU (and the page) keep up.
  let tiles = opts.width * opts.height > 2_500_000 ? 3 : 2
  tracer.tiles.set(tiles, tiles)

  // The picture on the canvas: as it is, or smoothed (edges kept: the filter only blends neighbouring pixels whose
  // colors are close, how close going down as the samples come in and there's less grain to tell from an edge). It's
  // drawn every so often as the samples come in, and when it's done: each time goes over the whole picture (smoothed,
  // every pixel many times over), too much to do after each sample.
  let smooth = opts.smooth
  const smoother = new FullScreenQuad(
    new DenoiseMaterial({ blending: THREE.NoBlending, premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha }),
  )
  const plain = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: { map: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(map, vUv);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    }),
  )
  let shownAt = 0
  let shownSamples = -1
  const show = () => {
    const texture = tracer.target.texture
    renderer.setRenderTarget(null)
    if (smooth) {
      Object.assign(smoother.material, {
        map: texture,
        sigma: 6,
        threshold: Math.min(0.3, Math.max(0.03, 1.1 / Math.sqrt(Math.max(1, tracer.samples)))),
        kSigma: 1.5,
        opacity: 1,
      })
      smoother.render(renderer)
    } else {
      ;(plain.material as THREE.ShaderMaterial).uniforms.map.value = texture
      plain.render(renderer)
    }
    shownAt = performance.now()
    shownSamples = Math.floor(tracer.samples)
  }

  let running = true
  let frame = 0
  let timer = 0
  let disposed = false
  const report = (phase: RenderProgress['phase'], prepared: number) => opts.onProgress({ phase, prepared, samples: Math.floor(tracer.samples) })
  const cleanUp = () => {
    disposed = true
    running = false
    cancelAnimationFrame(frame)
    clearTimeout(timer)
    tracer.dispose()
    for (const q of [smoother, plain]) {
      q.dispose()
      ;(q.material as THREE.Material).dispose()
    }
    for (const m of made) m.dispose()
    sky.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
  report('preparing', 0)
  try {
    // A moment for "getting ready" to show, then the scene's made ready for the path tracer (its BVH: what's where,
    // to find what each ray hits), here and now: a second or two for a big plan.
    await new Promise((r) => setTimeout(r, 50))
    if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    tracer.setScene(scene, camera)
  } catch (e) {
    cleanUp()
    throw e
  }

  // A sample (or a tile of one) a frame; with no frames coming (a hidden tab, a hidden pane), on a timer instead.
  const next = () => {
    let done = false
    const go = () => {
      if (done) return
      done = true
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      tick()
    }
    frame = requestAnimationFrame(go)
    timer = window.setTimeout(go, 4)
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
    if (performance.now() - sent > 600 && tiles < 6) {
      tiles++
      tracer.tiles.set(tiles, tiles)
    }
    return true
  }
  const tick = () => {
    if (!running || disposed) return
    if (!gpuDone()) return next()
    const n = Math.floor(tracer.samples)
    if (n >= opts.samples) {
      running = false
      show()
      report('done', 1)
      return
    }
    // The picture so far, now and then (the first sample at once).
    if (n > shownSamples && (shownSamples < 1 || performance.now() - shownAt > (smooth ? 2000 : 700))) show()
    tracer.renderSample()
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
  report('rendering', 1)
  next()

  // Drawn again after a change to how it's shown.
  const redraw = () => {
    if (!disposed && tracer.samples >= 1) show()
  }
  return {
    canvas,
    setExposure: (e) => {
      renderer.toneMappingExposure = e
      redraw()
    },
    setSmooth: (on) => {
      smooth = on
      redraw()
    },
    stop: () => {
      if (!running) return
      running = false
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      show()
      report('done', 1)
    },
    toBlob: () => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the picture'))), 'image/png')),
    dispose: () => {
      if (!disposed) cleanUp()
    },
  }
}
