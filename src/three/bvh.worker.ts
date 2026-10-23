/**
 * The path tracer's BVH (what's where in the scene, for finding what each ray hits) built here, off the page's own
 * thread, so the page doesn't stop while a big plan's made ready for a render (see render.ts, bvhWorker).
 */
import 'three-mesh-bvh/src/workers/generateMeshBVH.worker.js'
