/// <reference lib="webworker" />
import { Recognizer } from './recognize'
import type { RecognizeParams } from './recognize'

export type WorkerRequest = { type: 'image'; img: ImageData } | { type: 'run'; id: number; params: RecognizeParams }

const recognizer = new Recognizer()

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  if (msg.type === 'image') {
    recognizer.setImage(msg.img)
    return
  }
  try {
    self.postMessage({ id: msg.id, result: recognizer.run(msg.params) })
  } catch (err) {
    self.postMessage({ id: msg.id, error: (err as Error).message })
  }
}
