/**
 * A path traced picture's grain smoothed away with no AI, the way renderers have long done it (an "à-trous" filter
 * guided by the scene, after Dammertz et al. 2010 and Schied et al. 2017). The scene is drawn the quick way first, as
 * guides: each pixel's own color (its albedo), which way what's there faces and how far it is (in a mirror: what's
 * seen in it). The light falling on each pixel (what it shows, its own color taken out) is then blended with its
 * neighbours', further and further out, but only with those on the same surface (facing the same way, in the same
 * plane) and lit about the same (by how grainy it is round there): the grain goes, the edges and the shadows stay. Its
 * own color is then put back, from guides drawn at the picture's full size: so the light can be traced at a smaller
 * size (much quicker), the textures and edges still sharp.
 */
import * as THREE from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

/** What each pixel shows, drawn the quick way (see drawGuides). */
export interface Guides {
  /** The surface's own color. */
  albedo: THREE.WebGLRenderTarget
  /** xyz: which way it faces (as the camera sees it); w: how far it is (0: nothing there, the sky). */
  geo: THREE.WebGLRenderTarget
  width: number
  height: number
  dispose: () => void
}

const target = (width: number, height: number, depth = false, type: THREE.TextureDataType = THREE.HalfFloatType) =>
  new THREE.WebGLRenderTarget(width, height, {
    type,
    format: THREE.RGBAFormat,
    depthBuffer: depth,
    stencilBuffer: depth,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  })

const quadVertex = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`

const shared = /* glsl */ `
  #define EPS 0.02
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  vec3 dir(vec4 g) { return dot(g.xyz, g.xyz) > 1e-6 ? normalize(g.xyz) : vec3(0.0); }
  // Where a pixel's point is, from how far it is (as the camera sees it).
  uniform vec2 frustum;
  vec3 at(ivec2 p, ivec2 size, float z) {
    vec2 uv = (vec2(p) + 0.5) / vec2(size);
    return vec3((uv * 2.0 - 1.0) * frustum * z, -z);
  }
`

/** Which way it faces, and how far, as the camera sees it. */
const geoMaterial = () =>
  new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      #include <clipping_planes_pars_vertex>
      varying vec3 vN;
      varying float vZ;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vZ = -mvPosition.z;
        vN = normalMatrix * normal;
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <clipping_planes_pars_fragment>
      varying vec3 vN;
      varying float vZ;
      void main() {
        #include <clipping_planes_fragment>
        vec3 n = dot(vN, vN) > 1e-12 ? normalize(vN) : vec3(0.0, 0.0, 1.0);
        gl_FragColor = vec4(gl_FrontFacing ? n : -n, vZ);
      }
    `,
    side: THREE.DoubleSide,
    clipping: true,
  })

const halton = (i: number, b: number) => {
  let f = 1
  let r = 0
  while (i > 0) {
    f /= b
    r += f * (i % b)
    i = Math.floor(i / b)
  }
  return r
}

/** Their own color, each material's. */
export function albedoMaterials() {
  const made = new Map<THREE.Material, THREE.MeshBasicMaterial>()
  const of = (m: THREE.Material) => {
    let a = made.get(m)
    if (a) return a
    const s = m as THREE.MeshStandardMaterial
    a = new THREE.MeshBasicMaterial({
      color: s.color ?? 0xffffff,
      map: s.map ?? null,
      alphaMap: s.alphaMap ?? null,
      alphaTest: s.alphaMap || (s.map && s.transparent) ? 0.5 : 0,
      vertexColors: s.vertexColors,
      side: s.side,
      toneMapped: false,
    })
    made.set(m, a)
    return a
  }
  return { of, all: () => [...made.values()], dispose: () => made.forEach((m) => m.dispose()) }
}

/**
 * The flat mirrors seen (see Kit.mirror): each one's plane, its face toward the camera (the side of it with the most
 * area facing it); mirrors in the same plane (a cabinet's doors) share one.
 */
function mirrorPlanes(meshes: THREE.Mesh[], eye: THREE.Vector3) {
  const planes: THREE.Plane[] = []
  const of = new Map<THREE.Mesh, number>()
  const [a, b, c, ab, ac] = [0, 0, 0, 0, 0].map(() => new THREE.Vector3())
  for (const mesh of meshes) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (!mats.some((m) => m.userData.mirror)) continue
    const pos = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.getIndex()
    const count = index ? index.count : pos.count
    const faces = new Map<string, { n: THREE.Vector3; p: THREE.Vector3; area: number }>()
    for (let i = 0; i + 2 < count; i += 3) {
      const at = (k: number, v: THREE.Vector3) => v.fromBufferAttribute(pos, index ? index.getX(i + k) : i + k).applyMatrix4(mesh.matrixWorld)
      at(0, a)
      at(1, b)
      at(2, c)
      const n = ab.subVectors(b, a).cross(ac.subVectors(c, a))
      const area = n.length() / 2
      if (area < 1e-9) continue
      n.normalize()
      if (n.dot(ac.subVectors(eye, a)) <= 0) continue
      const key = `${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}`
      const f = faces.get(key)
      if (f) f.area += area
      else faces.set(key, { n: n.clone(), p: a.clone(), area })
    }
    let best: { n: THREE.Vector3; p: THREE.Vector3; area: number } | undefined
    for (const f of faces.values()) if (!best || f.area > best.area) best = f
    if (!best) continue
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(best.n, best.p)
    let id = planes.findIndex((q) => q.normal.dot(plane.normal) > 0.999 && Math.abs(q.constant - plane.constant) < 0.005)
    if (id < 0) {
      if (planes.length >= 8) continue
      id = planes.push(plane) - 1
    }
    of.set(mesh, id + 1)
  }
  return { planes, of }
}

/** The scene seen in a mirror: everything turned over its plane. */
function reflection(p: THREE.Plane) {
  const { x, y, z } = p.normal
  const d = p.constant
  // prettier-ignore
  return new THREE.Matrix4().set(
    1 - 2 * x * x, -2 * x * y, -2 * x * z, -2 * x * d,
    -2 * x * y, 1 - 2 * y * y, -2 * y * z, -2 * y * d,
    -2 * x * z, -2 * y * z, 1 - 2 * z * z, -2 * z * d,
    0, 0, 0, 1,
  )
}

/**
 * A camera (`cam`) as `from` is, moved a little: by `jitter` (pixels), and to a point on its lens (`at`: two numbers
 * from 0 to 1, round the lens), looking at the same plane in focus.
 */
function look(cam: THREE.PerspectiveCamera, from: THREE.PerspectiveCamera, width: number, height: number, jitter: [number, number], at?: [number, number] | false, lens?: Lens) {
  const near = from.near
  const top = (near * Math.tan(THREE.MathUtils.DEG2RAD * 0.5 * from.fov)) / from.zoom
  const h = 2 * top
  const w = from.aspect * h
  let [lx, ly] = [0, 0]
  if (at && lens) {
    const r = lens.radius * Math.sqrt(at[0])
    lx = r * Math.cos(2 * Math.PI * at[1])
    ly = r * Math.sin(2 * Math.PI * at[1])
  }
  const sx = (jitter[0] * w) / width - (lens ? (lx * near) / lens.focus : 0)
  const sy = (jitter[1] * h) / height - (lens ? (ly * near) / lens.focus : 0)
  cam.projectionMatrix.makePerspective(-w / 2 + sx, w / 2 + sx, top + sy, top - h + sy, near, from.far)
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert()
  cam.position.copy(from.position).add(new THREE.Vector3(lx, ly, 0).applyQuaternion(from.quaternion))
  cam.updateMatrixWorld()
}

/** A camera's lens, for depth of field: how wide it's open (its radius), and how far away what's sharp is (m). */
export interface Lens {
  radius: number
  focus: number
}

/**
 * The guides (see Guides) at a size, as the path tracer sees the scene: each pixel's an average over it (the camera
 * moved a little each time, as the path tracer's rays are), so edges are as soft as its; with a lens, from all over
 * it too, so what's out of focus is as blurred as the path tracer has it. Glass and glows are left out, what's behind
 * them shown; in a mirror, what's seen in it (the scene turned over the mirror's plane, drawn only where the mirror is,
 * and only what's in front of it).
 */
export function drawGuides(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  hidden: THREE.Object3D[],
  albedo: ReturnType<typeof albedoMaterials>,
  lens?: Lens,
): Guides {
  const passes = lens ? 32 : 8
  const out = { albedo: target(width, height), geo: target(width, height) }
  const frame = target(width, height, true)
  const cam = camera.clone()
  const geoMat = geoMaterial()
  const add = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, weight: { value: 1 / passes } },
      vertexShader: quadVertex,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform float weight;
        void main() { gl_FragColor = texelFetch(map, ivec2(gl_FragCoord.xy), 0) * weight; }
      `,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
    }),
  )
  const meshes: THREE.Mesh[] = []
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o)
  })
  const own = meshes.map((m) => m.material)
  const flat = own.map((m) => (Array.isArray(m) ? m.map(albedo.of) : albedo.of(m)))
  // A mirror's own albedo material, its plane's number written where it's seen (in the stencil).
  const mirrors = mirrorPlanes(meshes, camera.getWorldPosition(new THREE.Vector3()))
  const marked = new Map<number, THREE.MeshBasicMaterial>()
  const markOf = (id: number) => {
    let m = marked.get(id)
    if (!m) marked.set(id, (m = new THREE.MeshBasicMaterial({ color: 0xe8eeee, toneMapped: false })))
    return m
  }
  meshes.forEach((m, k) => {
    const id = mirrors.of.get(m)
    if (id) flat[k] = markOf(id)
  })
  const writing = () => [...albedo.all(), ...marked.values()]
  // Where each mirror's seen, its number in the stencil as it's drawn (0 elsewhere, what's drawn over it).
  const marking = () => {
    for (const m of writing()) Object.assign(m, { stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp, stencilRef: 0 })
    marked.forEach((m, id) => (m.stencilRef = id))
  }
  // Then what's drawn only where a mirror is.
  const within = (m: THREE.Material, id: number) =>
    Object.assign(m, { stencilWrite: true, stencilFunc: THREE.EqualStencilFunc, stencilRef: id, stencilZPass: THREE.KeepStencilOp })
  const keep = {
    background: scene.background,
    target: renderer.getRenderTarget(),
    color: renderer.getClearColor(new THREE.Color()),
    alpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
    matrixAutoUpdate: scene.matrixAutoUpdate,
    visible: hidden.map((o) => o.visible),
  }
  const unturned = () => {
    renderer.clippingPlanes = []
    scene.matrix.identity()
    scene.updateMatrixWorld(true)
    scene.matrixAutoUpdate = keep.matrixAutoUpdate
  }
  scene.background = null
  for (const o of hidden) o.visible = false
  renderer.autoClear = false
  // What's seen in each mirror: the scene turned over its plane, only what's then behind the plane (what was in front
  // of the mirror), only where the mirror is.
  const inMirrors = (only: (id: number) => void) => {
    mirrors.planes.forEach((plane, i) => {
      only(i + 1)
      scene.matrixAutoUpdate = false
      scene.matrix.copy(reflection(plane))
      scene.updateMatrixWorld(true)
      renderer.clippingPlanes = [new THREE.Plane(plane.normal.clone().negate(), -plane.constant - 0.002)]
      renderer.clear(false, true, false)
      renderer.render(scene, cam)
    })
    unturned()
  }
  const into = (acc: THREE.WebGLRenderTarget) => {
    ;(add.material as THREE.ShaderMaterial).uniforms.map.value = frame.texture
    renderer.setRenderTarget(acc)
    add.render(renderer)
  }
  try {
    renderer.setClearColor(0x000000, 0)
    for (const acc of [out.albedo, out.geo]) {
      renderer.setRenderTarget(acc)
      renderer.clear()
    }
    for (let i = 0; i < passes; i++) {
      look(cam, camera, width, height, [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5], lens && [halton(i + 1, 5), halton(i + 1, 7)], lens)
      // Their colors (the sky white: its light is its own).
      meshes.forEach((m, k) => (m.material = flat[k]))
      marking()
      renderer.setClearColor(0xffffff, 1)
      renderer.setRenderTarget(frame)
      renderer.clear()
      renderer.render(scene, cam)
      inMirrors((id) => writing().forEach((m) => within(m, id)))
      into(out.albedo)
      meshes.forEach((m, k) => (m.material = own[k]))
      // Which way they face, how far they are (the mirrors' marks kept).
      scene.overrideMaterial = geoMat
      geoMat.stencilWrite = false
      renderer.setClearColor(0x000000, 0)
      renderer.setRenderTarget(frame)
      renderer.clear(true, true, false)
      renderer.render(scene, cam)
      inMirrors((id) => within(geoMat, id))
      scene.overrideMaterial = null
      into(out.geo)
    }
  } finally {
    meshes.forEach((m, k) => (m.material = own[k]))
    for (const m of writing()) m.stencilWrite = false
    scene.overrideMaterial = null
    unturned()
    scene.background = keep.background
    hidden.forEach((o, k) => (o.visible = keep.visible[k]))
    renderer.setClearColor(keep.color, keep.alpha)
    renderer.autoClear = keep.autoClear
    renderer.setRenderTarget(keep.target)
    frame.dispose()
    geoMat.dispose()
    marked.forEach((m) => m.dispose())
    add.dispose()
    ;(add.material as THREE.Material).dispose()
  }
  return {
    ...out,
    width,
    height,
    dispose: () => {
      out.albedo.dispose()
      out.geo.dispose()
    },
  }
}

const pass = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, toneMapped = false) =>
  new FullScreenQuad(
    new THREE.ShaderMaterial({ uniforms, vertexShader: quadVertex, fragmentShader, toneMapped, blending: THREE.NoBlending, depthTest: false, depthWrite: false }),
  )

/**
 * The filter: the light on each pixel (`smooth`), then the picture made of it and the pixels' own colors (`draw`), and
 * how bright it is (`brightness`). `lo` are the guides at the size the light's traced at; `hi` at the picture's.
 */
export class GrainFilter {
  private a: THREE.WebGLRenderTarget
  private b: THREE.WebGLRenderTarget
  private probe: THREE.WebGLRenderTarget
  private demod: FullScreenQuad
  private atrous: FullScreenQuad
  private compose: FullScreenQuad
  private renderer: THREE.WebGLRenderer
  private hi: Guides

  constructor(renderer: THREE.WebGLRenderer, lo: Guides, hi: Guides, camera: THREE.PerspectiveCamera) {
    this.renderer = renderer
    this.hi = hi
    this.a = target(lo.width, lo.height)
    this.b = target(lo.width, lo.height)
    this.probe = target(64, Math.max(8, Math.round((64 * hi.height) / hi.width)), false, THREE.FloatType)
    const frustum = { value: new THREE.Vector2(1 / camera.projectionMatrix.elements[0], 1 / camera.projectionMatrix.elements[5]) }
    const loSize = { value: new THREE.Vector2(lo.width, lo.height) }

    // The light on each pixel: what it shows over its own color. A pixel far brighter than any round it (a speck: a
    // path that found a light by a fluke) is brought down to them. How grainy it is round it goes in alpha.
    this.demod = pass(
      /* glsl */ `
        ${shared}
        uniform sampler2D radiance;
        uniform sampler2D albedo;
        uniform bool despeckle;
        uniform vec2 loSize;
        vec3 light(ivec2 p) { return texelFetch(radiance, p, 0).rgb / max(texelFetch(albedo, p, 0).rgb, vec3(EPS)); }
        void main() {
          ivec2 size = ivec2(loSize);
          ivec2 p = ivec2(gl_FragCoord.xy);
          vec3 c = light(p);
          float l = lum(c);
          float most = 0.0, s = 0.0, s2 = 0.0;
          for (int j = -1; j <= 1; j++)
            for (int i = -1; i <= 1; i++) {
              float lq = lum(light(clamp(p + ivec2(i, j), ivec2(0), size - 1)));
              s += lq;
              s2 += lq * lq;
              if (i != 0 || j != 0) most = max(most, lq);
            }
          if (despeckle && l > 2.0 * most && l > 0.0) c *= 2.0 * most / l;
          float mean = s / 9.0;
          gl_FragColor = vec4(c, max(0.0, s2 / 9.0 - mean * mean));
        }
      `,
      { radiance: { value: null }, albedo: { value: lo.albedo.texture }, despeckle: { value: true }, loSize, frustum },
    )

    // One round of the filter: the light on a pixel blended with its neighbours' `step` pixels apart (a 5 × 5 kernel),
    // each as much as it's on the same surface and lit about the same; the grain left (in alpha) as it now is.
    this.atrous = pass(
      /* glsl */ `
        ${shared}
        uniform sampler2D light;
        uniform sampler2D geo;
        uniform int stepSize;
        uniform float sigma;
        uniform float hold;
        uniform vec2 loSize;
        const float K5[3] = float[3](0.375, 0.25, 0.0625);
        const float K3[2] = float[2](0.5, 0.25);
        void main() {
          ivec2 size = ivec2(loSize);
          ivec2 p = ivec2(gl_FragCoord.xy);
          vec4 c = texelFetch(light, p, 0);
          vec4 g = texelFetch(geo, p, 0);
          float z = g.w;
          vec3 n = dir(g);
          vec3 P = at(p, size, z);
          float v = 0.0;
          for (int j = -1; j <= 1; j++)
            for (int i = -1; i <= 1; i++)
              v += texelFetch(light, clamp(p + ivec2(i, j), ivec2(0), size - 1), 0).a * K3[abs(i)] * K3[abs(j)];
          float lc = lum(c.rgb);
          float spread = sigma * sqrt(v) + 1e-4;
          vec3 sum = vec3(0.0);
          float vs = 0.0, ws = 0.0;
          for (int j = -2; j <= 2; j++)
            for (int i = -2; i <= 2; i++) {
              ivec2 q = p + ivec2(i, j) * stepSize;
              if (any(lessThan(q, ivec2(0))) || any(greaterThanEqual(q, size))) continue;
              vec4 cq = texelFetch(light, q, 0);
              float w = K5[abs(i)] * K5[abs(j)];
              if (i != 0 || j != 0) {
                vec4 gq = texelFetch(geo, q, 0);
                if ((z > 0.0) != (gq.w > 0.0)) continue;
                if (z > 0.0) {
                  w *= pow(max(dot(n, dir(gq)), 0.0), 32.0);
                  float d = abs(dot(n, at(q, size, gq.w) - P));
                  w *= exp(-d / (z * (0.006 + 0.002 * float(stepSize))));
                }
                w *= exp(-abs(lc - lum(cq.rgb)) / spread);
              }
              sum += cq.rgb * w;
              vs += cq.a * w * w;
              ws += w;
            }
          gl_FragColor = vec4(sum / ws, mix(vs / (ws * ws), c.a, hold));
        }
      `,
      { light: { value: null }, geo: { value: lo.geo.texture }, stepSize: { value: 1 }, sigma: { value: 4 }, hold: { value: 1 }, loSize, frustum },
    )

    // The picture: the light on each of its pixels (from the nearest four traced, those on the same surface), times
    // the pixel's own color; then as bright as asked, toned and made ready for the screen.
    this.compose = pass(
      /* glsl */ `
        ${shared}
        uniform sampler2D light;
        uniform sampler2D geoLo;
        uniform sampler2D albedoHi;
        uniform sampler2D geoHi;
        uniform vec2 loSize;
        uniform vec2 hiSize;
        uniform vec2 outSize;
        void main() {
          ivec2 lo = ivec2(loSize), hi = ivec2(hiSize);
          vec2 uv = gl_FragCoord.xy / outSize;
          ivec2 h = min(ivec2(uv * hiSize), hi - 1);
          vec4 a = texelFetch(albedoHi, h, 0);
          vec4 g = texelFetch(geoHi, h, 0);
          float z = g.w;
          vec3 n = dir(g);
          vec3 P = at(h, hi, z);
          vec2 lp = uv * loSize - 0.5;
          ivec2 b = ivec2(floor(lp));
          vec2 f = lp - vec2(b);
          vec3 sum = vec3(0.0), near = vec3(0.0);
          float ws = 0.0, best = 1e9;
          for (int j = 0; j <= 1; j++)
            for (int i = 0; i <= 1; i++) {
              ivec2 q = clamp(b + ivec2(i, j), ivec2(0), lo - 1);
              vec3 c = texelFetch(light, q, 0).rgb;
              vec4 gq = texelFetch(geoLo, q, 0);
              float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
              float d = 0.0;
              if ((z > 0.0) != (gq.w > 0.0)) d = 1e6;
              else if (z > 0.0) d = abs(dot(n, at(q, lo, gq.w) - P)) / (0.02 * z) + (1.0 - max(dot(n, dir(gq)), 0.0)) * 8.0;
              w *= exp(-d);
              sum += c * w;
              ws += w;
              if (d < best) {
                best = d;
                near = c;
              }
            }
          vec3 l = ws > 1e-4 ? sum / ws : near;
          gl_FragColor = vec4(l * max(a.rgb, vec3(EPS)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      {
        light: { value: null },
        geoLo: { value: lo.geo.texture },
        albedoHi: { value: hi.albedo.texture },
        geoHi: { value: hi.geo.texture },
        loSize,
        hiSize: { value: new THREE.Vector2(hi.width, hi.height) },
        outSize: { value: new THREE.Vector2(hi.width, hi.height) },
        frustum,
      },
      true,
    )
  }

  /**
   * The light on each traced pixel, from the path tracer's picture: smoothed (`rounds` of the filter, each blending
   * further out, and one more close by, to blend away the grid the furthest leave), or as it is.
   */
  smooth(radiance: THREE.Texture, rounds: number): THREE.Texture {
    const r = this.renderer
    const keep = r.getRenderTarget()
    const d = (this.demod.material as THREE.ShaderMaterial).uniforms
    d.radiance.value = radiance
    d.despeckle.value = rounds > 0
    r.setRenderTarget(this.a)
    this.demod.render(r)
    const u = (this.atrous.material as THREE.ShaderMaterial).uniforms
    let from = this.a
    let to = this.b
    for (let i = 0; i < (rounds && rounds + 1); i++) {
      u.light.value = from.texture
      u.stepSize.value = i < rounds ? 1 << i : 1
      r.setRenderTarget(to)
      this.atrous.render(r)
      ;[from, to] = [to, from]
    }
    r.setRenderTarget(keep)
    return from.texture
  }

  /**
   * How bright the picture is, as a camera would meter it: the average (over its log, so a few lights don't count for
   * much) of how bright each part is, more toward the middle.
   */
  brightness(light: THREE.Texture) {
    const r = this.renderer
    const { width: w, height: h } = this.probe
    const u = (this.compose.material as THREE.ShaderMaterial).uniforms
    u.light.value = light
    u.outSize.value.set(w, h)
    r.setRenderTarget(this.probe)
    this.compose.render(r)
    const px = new Float32Array(w * h * 4)
    r.readRenderTargetPixels(this.probe, 0, 0, w, h, px)
    r.setRenderTarget(null)
    let sum = 0
    let weights = 0
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
        if (!Number.isFinite(l)) continue
        const dx = (x + 0.5) / w - 0.5
        const dy = (y + 0.5) / h - 0.5
        const k = Math.exp(-(dx * dx + dy * dy) / (2 * 0.3 * 0.3))
        sum += k * Math.log(1e-4 + Math.max(0, l))
        weights += k
      }
    return weights ? Math.exp(sum / weights) : 0
  }

  /**
   * The picture, from the light (see smooth), on the canvas: the whole of it (in strips, a few at a time on the graphics
   * card), or made smaller (`width` × `height`) in its corner (see the render's preview).
   */
  draw(light: THREE.Texture, width = this.hi.width, height = this.hi.height) {
    const r = this.renderer
    const u = (this.compose.material as THREE.ShaderMaterial).uniforms
    u.light.value = light
    u.outSize.value.set(width, height)
    r.setRenderTarget(null)
    const full = r.getSize(new THREE.Vector2())
    r.setViewport(0, 0, width, height)
    r.setScissorTest(true)
    const strip = 256
    for (let y = 0; y < height; y += strip) {
      r.setScissor(0, y, width, Math.min(strip, height - y))
      this.compose.render(r)
    }
    r.setScissorTest(false)
    r.setViewport(0, 0, full.x, full.y)
  }

  dispose() {
    this.a.dispose()
    this.b.dispose()
    this.probe.dispose()
    for (const q of [this.demod, this.atrous, this.compose]) {
      q.dispose()
      ;(q.material as THREE.Material).dispose()
    }
  }
}
