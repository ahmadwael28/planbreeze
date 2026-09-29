import { useEffect, useRef, useState } from 'react'
import { Recognizer } from './recognize'
import type { Recognition, RecognizeParams } from './recognize'
import type { WorkerRequest } from './recognize.worker'

/**
 * Runs recognition off the main thread (on it if workers aren't available). Only the newest
 * request matters: while one runs, later ones replace each other and the last is run next.
 */
class RecognitionClient {
  private worker: Worker | null = null
  private local: Recognizer | null = null
  private seq = 0
  private busy = false
  private next: { params: RecognizeParams; done: (r: Recognition) => void } | null = null
  private current: ((r: Recognition) => void) | null = null

  constructor() {
    try {
      this.worker = new Worker(new URL('./recognize.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<{ id: number; result?: Recognition; error?: string }>) => {
        if (e.data.id !== this.seq) return
        this.finish(e.data.result ?? { kind: 'sketch', rooms: [], doors: [], windows: [], angle: 0 })
      }
      this.worker.onerror = () => this.fallBack()
    } catch {
      this.fallBack()
    }
  }

  private fallBack() {
    this.worker?.terminate()
    this.worker = null
    this.local ??= new Recognizer()
  }

  setImage(img: ImageData) {
    if (this.worker) this.worker.postMessage({ type: 'image', img } satisfies WorkerRequest)
    else (this.local ??= new Recognizer()).setImage(img)
  }

  request(params: RecognizeParams, done: (r: Recognition) => void) {
    this.next = { params, done }
    if (!this.busy) this.start()
  }

  private start() {
    const job = this.next
    if (!job) return
    this.next = null
    this.busy = true
    this.current = job.done
    const id = ++this.seq
    if (this.worker) {
      this.worker.postMessage({ type: 'run', id, params: job.params } satisfies WorkerRequest)
    } else {
      // Let the "Detecting…" indicator paint before the main thread is busy.
      setTimeout(() => this.finish(this.local!.run(job.params)), 30)
    }
  }

  private finish(result: Recognition) {
    this.busy = false
    const done = this.current
    this.current = null
    // A newer request supersedes this result.
    if (this.next) this.start()
    else done?.(result)
  }

  dispose() {
    this.worker?.terminate()
  }
}

/** Rooms recognized in `work` (null to stay idle), re-run when the parameters change. */
export function useRecognition(work: ImageData | null, params: RecognizeParams) {
  const client = useRef<RecognitionClient | null>(null)
  const [state, setState] = useState<{ for: ImageData | null; result: Recognition | null; busy: boolean }>({
    for: null,
    result: null,
    busy: false,
  })

  useEffect(() => () => client.current?.dispose(), [])

  useEffect(() => {
    if (!work) return
    const c = (client.current ??= new RecognitionClient())
    c.setImage(work)
  }, [work])

  const { gap, sensitivity, kind } = params
  useEffect(() => {
    if (!work) return
    let live = true
    const t = setTimeout(() => {
      setState((s) => ({ ...s, busy: true }))
      client.current?.request({ gap, sensitivity, kind }, (result) => {
        if (live) setState({ for: work, result, busy: false })
      })
    }, 60)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [work, gap, sensitivity, kind])

  // A result for a previous image doesn't count.
  return { result: state.for === work ? state.result : null, busy: !!work && (state.busy || state.for !== work) }
}
