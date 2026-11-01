/**
 * Plans in IndexedDB: room for far more than localStorage, and each photo or tracing image stored once, as a file,
 * however many plans (and deleted plans) use it. A plan is kept with its images as references (`ref:<key>`, the key
 * made from the image itself), and they're put back in as it's opened.
 *
 * Every change is one transaction, so it's made whole or not at all: a plan and its entry in the list, a plan moved to
 * the trash. An image goes when nothing uses it any more.
 */
import { uid } from '../model/project'
import type { Project } from '../model/types'
import type { Backend, ProjectMeta, TrashedMeta } from './storage'
import { isFull } from './storage-local'

const NAME = 'planbreeze'
const VERSION = 1
/** Plans: id → { data } (the plan, its images as references). */
const PLANS = 'plans'
/** Their entries in the list: id → ProjectMeta and the images the plan uses. */
const LIST = 'list'
/** Deleted plans, kept a while: id → { data }. */
const TRASH = 'trash'
/** Their entries: id → TrashedMeta and the images. */
const TRASH_LIST = 'trashList'
/** The images: key → { head, bytes } (a data URL's head, `data:image/jpeg;base64`, and its bytes). */
const IMAGES = 'images'
const STORES = [PLANS, LIST, TRASH, TRASH_LIST, IMAGES]

interface PlanRecord {
  data: Project
}
type Listed = ProjectMeta & { images: string[] }
type TrashListed = TrashedMeta & { images: string[] }
interface ImageFile {
  head: string
  bytes: ArrayBuffer
}

// ---------------------------------------------------------------------------
// Images as files

const REF = 'ref:'

/** A 53-bit hash of text (cyrb53). */
function hash(s: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** Whether an image can be kept as a file: a base64 data URL that reads back exactly as it is. */
function storable(src: string): boolean {
  const comma = src.indexOf(',')
  if (!src.startsWith('data:') || comma < 0 || !src.slice(0, comma).endsWith(';base64')) return false
  try {
    const b64 = src.slice(comma + 1)
    return btoa(atob(b64)) === b64
  } catch {
    return false
  }
}

/** Images met so far, and their keys (null: kept inside the plan, as it is). */
const seen = new Map<string, string | null>()

/** An image's key, made from the image (the same image, the same key); null for one that's kept inside the plan. */
export function imageKey(src: string): string | null {
  let k = seen.get(src)
  if (k === undefined) {
    k = storable(src) ? `${src.length.toString(36)}-${hash(src, 1)}${hash(src, 2)}` : null
    if (seen.size > 2000) seen.clear()
    seen.set(src, k)
  }
  return k
}

function toFile(src: string): ImageFile {
  const comma = src.indexOf(',')
  const bin = atob(src.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { head: src.slice(0, comma), bytes: bytes.buffer }
}

function fromFile(f: ImageFile): string {
  const bytes = new Uint8Array(f.bytes)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `${f.head},${btoa(bin)}`
}

/** The plan with each of its images (photos, tracing images) changed by `f`. */
function mapImages(p: Project, f: (src: string) => string): Project {
  const floors = p.floors.map((fl) => (fl.underlay ? { ...fl, underlay: { ...fl.underlay, src: f(fl.underlay.src) } } : fl))
  return p.images ? { ...p, floors, images: p.images.map((i) => ({ ...i, src: f(i.src) })) } : { ...p, floors }
}

export interface Packed {
  /** The plan, its images as references (but those kept inside it). */
  data: Project
  /** The images it refers to. */
  refs: string[]
  /** Those it brings, to store if they aren't yet: key → data URL. */
  files: Map<string, string>
}

/** A plan as it's stored: its images as references. `inline`: images to leave inside it all the same. */
export function pack(p: Project, inline?: (key: string) => boolean): Packed {
  const refs = new Set<string>()
  const files = new Map<string, string>()
  const data = mapImages(p, (src) => {
    if (src.startsWith(REF)) {
      refs.add(src.slice(REF.length))
      return src
    }
    const key = imageKey(src)
    if (!key || inline?.(key)) return src
    refs.add(key)
    files.set(key, src)
    return REF + key
  })
  return { data, refs: [...refs], files }
}

/** The images a stored plan refers to. */
function refsOf(data: Project): string[] {
  const refs = new Set<string>()
  mapImages(data, (src) => {
    if (src.startsWith(REF)) refs.add(src.slice(REF.length))
    return src
  })
  return [...refs]
}

// ---------------------------------------------------------------------------
// The database

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })

/** Open it (made the first time), or fail: blocked, or no answer in `wait` ms (a browser where it hangs). */
export function openDb(wait = 5000): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let over = false
    const timer = setTimeout(() => {
      over = true
      reject(new Error("IndexedDB didn't open"))
    }, wait)
    let r: IDBOpenDBRequest
    try {
      r = indexedDB.open(NAME, VERSION)
    } catch (e) {
      clearTimeout(timer)
      return reject(e)
    }
    r.onupgradeneeded = () => {
      for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s)
    }
    r.onsuccess = () => {
      clearTimeout(timer)
      if (over) r.result.close()
      else resolve(r.result)
    }
    r.onerror = () => {
      clearTimeout(timer)
      reject(r.error)
    }
  })
}

/** The connection was lost (Safari, after a while in the background), or closed: open it again and try once more. */
const lost = (e: unknown) => e instanceof DOMException && (e.name === 'InvalidStateError' || e.name === 'UnknownError')

/** A plan's entry in the list, from the plan. */
const entryOf = (p: Project, images: string[]): Listed => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, shared: p.access, images })

const metaOf = <T extends { images?: string[] }>({ images: _images, ...m }: T) => m

export interface IdbBackend extends Backend {
  kind: 'idb'
  /** Whether an image is stored with the plan as this tab last stored or opened it (so a note of the plan can refer to it). */
  has(id: string, key: string): boolean
  /** When the copy of a plan this tab last stored or opened was changed (what a note of it is made from). */
  base(id: string): number | undefined
  /**
   * A plan brought in from elsewhere (localStorage, a note). The newer of it and the copy here is the plan; the other is
   * kept in Recently deleted as another version, as it may hold changes the newer one doesn't. Not when they're the same
   * save, nor when the copy here is the one it was made from (`base`: a note's). Nothing, if the plan was deleted here
   * after this copy was made (and isn't back).
   */
  adopt(p: Project, base?: number): Promise<void>
  /** A deleted plan brought in from elsewhere, unless a copy as new is in the trash already. */
  adoptTrashed(meta: TrashedMeta, data: Project): Promise<void>
  /** A plan stored elsewhere with references to images stored here (a note): those images put back in. */
  withImages(p: Project): Promise<Project>
  /** How many other versions `adopt` has kept in Recently deleted. */
  keptApart(): number
  /**
   * Images nothing uses any more go, if nothing used them at the last sweep either (`unused`, as it returned): so one
   * that's just been left out of a plan, and may be noted to come back, waits for the next start. Returns those unused.
   */
  sweep(unused: Set<string>): Promise<Set<string>>
}

/**
 * Plans in IndexedDB, opened. `keep`: images still wanted though no stored plan uses them (notes of plans not saved yet,
 * see storage).
 */
export async function idbBackend(keep: () => Set<string> = () => new Set()): Promise<IdbBackend> {
  let db: IDBDatabase | null = null
  const connect = async () => {
    if (db) return db
    const d = await openDb()
    // Another tab upgrading it, or the browser closing it: opened again when next needed.
    d.onversionchange = () => {
      d.close()
      if (db === d) db = null
    }
    d.onclose = () => {
      if (db === d) db = null
    }
    return (db = d)
  }
  await connect()
  /** Each plan as this tab last stored or opened it: when it was changed, and its images. */
  const stored = new Map<string, { at: number; images: Set<string> }>()
  const remember = (p: Project, images: Iterable<string>) => stored.set(p.id, { at: p.updatedAt, images: new Set(images) })
  let keptApart = 0

  async function run<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T>, retry = true): Promise<T> {
    let tx: IDBTransaction
    try {
      tx = (await connect()).transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined)
    } catch (e) {
      if (!retry || !lost(e)) throw e
      db = null
      return run(stores, mode, fn, false)
    }
    const finished = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? new DOMException('The change was undone', 'AbortError'))
    })
    finished.catch(() => {})
    try {
      const out = await fn(tx)
      // Sent now, so it's kept even if the page is closing.
      try {
        if (typeof tx.commit === 'function') tx.commit()
      } catch {
        // Committing already.
      }
      await finished
      return out
    } catch (e) {
      try {
        tx.abort()
      } catch {
        // Over already.
      }
      await finished.catch(() => {})
      const err = tx.error ?? e
      if (!retry || !lost(err)) throw err
      db = null
      return run(stores, mode, fn, false)
    }
  }

  const store = (tx: IDBTransaction, name: string) => tx.objectStore(name)

  /** Store the images a plan brings that aren't stored yet. */
  async function storeFiles(tx: IDBTransaction, files: Map<string, string>) {
    const images = store(tx, IMAGES)
    const entries = [...files]
    const have = await Promise.all(entries.map(([k]) => req(images.count(k))))
    entries.forEach(([k, src], i) => {
      if (!have[i]) images.put(toFile(src), k)
    })
  }

  /** Of these images, those no plan or deleted plan uses any more go. */
  async function drop(tx: IDBTransaction, candidates: Iterable<string>) {
    const unused = new Set(candidates)
    if (!unused.size) return
    const [plans, trashed] = await Promise.all([req(store(tx, LIST).getAll() as IDBRequest<Listed[]>), req(store(tx, TRASH_LIST).getAll() as IDBRequest<TrashListed[]>)])
    for (const r of [...plans, ...trashed]) for (const k of r.images ?? []) unused.delete(k)
    for (const k of keep()) unused.delete(k)
    for (const k of unused) store(tx, IMAGES).delete(k)
  }

  /** Deleted plans gone for good, and the images only they used. */
  async function purge(tx: IDBTransaction, ids: string[]) {
    const metas = await Promise.all(ids.map((id) => req(store(tx, TRASH_LIST).get(id) as IDBRequest<TrashListed | undefined>)))
    for (const id of ids) {
      store(tx, TRASH).delete(id)
      store(tx, TRASH_LIST).delete(id)
    }
    await drop(
      tx,
      metas.flatMap((m) => m?.images ?? []),
    )
  }

  /** A stored plan with its images back in (an image that's gone, empty). */
  async function withImages(tx: IDBTransaction, data: Project): Promise<Project> {
    const refs = refsOf(data)
    const images = store(tx, IMAGES)
    const found = await Promise.all(refs.map((k) => req(images.get(k) as IDBRequest<ImageFile | undefined>)))
    const files = new Map<string, string>()
    refs.forEach((k, i) => {
      const f = found[i]
      if (!f) {
        console.warn('An image of this plan is missing', k)
        return
      }
      const src = fromFile(f)
      files.set(k, src)
      seen.set(src, k)
    })
    remember(data, files.keys())
    return mapImages(data, (src) => (src.startsWith(REF) ? (files.get(src.slice(REF.length)) ?? '') : src))
  }

  /** Put a plan and its entry (its images too), inside a transaction. */
  async function putPlan(tx: IDBTransaction, p: Project) {
    const { data, refs, files } = pack(p)
    await storeFiles(tx, files)
    store(tx, PLANS).put({ data } satisfies PlanRecord, p.id)
    store(tx, LIST).put(entryOf(p, refs), p.id)
    return refs
  }

  const listTrash = async () => (await run([TRASH_LIST], 'readonly', (tx) => req(store(tx, TRASH_LIST).getAll() as IDBRequest<TrashListed[]>))).map(metaOf)

  /**
   * A change that may need room: made in one transaction with the deleted plans dropped to make room, so a change that
   * fails still leaves everything as it was. False if it couldn't be made.
   */
  const roomy = <T>(fn: (tx: IDBTransaction) => Promise<T>, keep?: string) =>
    makeRoom(
      (drop) =>
        run(STORES, 'readwrite', async (tx) => {
          if (drop.length) await purge(tx, drop)
          return fn(tx)
        }),
      keep,
      listTrash,
    )

  return {
    kind: 'idb',
    has: (id, key) => !!stored.get(id)?.images.has(key),
    base: (id) => stored.get(id)?.at,
    list: async () => (await run([LIST], 'readonly', (tx) => req(store(tx, LIST).getAll() as IDBRequest<Listed[]>))).map(metaOf),
    load: (id) =>
      run([PLANS, IMAGES], 'readonly', async (tx) => {
        const rec = (await req(store(tx, PLANS).get(id))) as PlanRecord | undefined
        return rec ? withImages(tx, rec.data) : null
      }),
    put: async (p, keep) => {
      const refs = await roomy((tx) => putPlan(tx, p), keep)
      if (!refs) return false
      remember(p, refs)
      return true
    },
    remove: (id) =>
      run(STORES, 'readwrite', async (tx) => {
        const entry = (await req(store(tx, LIST).get(id))) as Listed | undefined
        store(tx, PLANS).delete(id)
        store(tx, LIST).delete(id)
        stored.delete(id)
        await drop(tx, entry?.images ?? [])
      }),
    listTrash,
    trash: async (id, data, cloud) =>
      (await roomy(async (tx) => {
        const [here, entry, before, beforeMeta] = await Promise.all([
          req(store(tx, PLANS).get(id) as IDBRequest<PlanRecord | undefined>),
          req(store(tx, LIST).get(id) as IDBRequest<Listed | undefined>),
          req(store(tx, TRASH).get(id) as IDBRequest<PlanRecord | undefined>),
          req(store(tx, TRASH_LIST).get(id) as IDBRequest<TrashListed | undefined>),
        ])
        // Out of the list, then into the trash: the copy given (as it is in the account), or this browser's.
        store(tx, PLANS).delete(id)
        store(tx, LIST).delete(id)
        let kept: Project | undefined
        let refs: string[] = []
        if (data) {
          const packed = pack(data)
          await storeFiles(tx, packed.files)
          kept = packed.data
          refs = packed.refs
        } else if (here) {
          kept = here.data
          refs = entry?.images ?? refsOf(here.data)
        }
        // Nothing of it here to keep (only its entry): just out of the list.
        if (!kept) return true
        // A newer copy of it in the trash already (deleted before) stays.
        if (before && (before.data.updatedAt ?? 0) > (kept.updatedAt ?? 0)) {
          kept = before.data
          refs = beforeMeta?.images ?? refsOf(before.data)
        }
        const meta: TrashedMeta = {
          id,
          name: typeof kept.name === 'string' ? kept.name : (entry?.name ?? ''),
          updatedAt: kept.updatedAt ?? 0,
          deletedAt: Date.now(),
          cloud: cloud || undefined,
        }
        store(tx, TRASH).put({ data: kept } satisfies PlanRecord, id)
        store(tx, TRASH_LIST).put({ ...meta, images: refs } satisfies TrashListed, id)
        // The images of the copies not kept, unless something else uses them.
        await drop(tx, [...(entry?.images ?? []), ...(beforeMeta?.images ?? [])])
        return true
      }, id)) === true,
    restore: async (id) => {
      const back = await roomy(async (tx) => {
        const [rec, meta, clash] = await Promise.all([
          req(store(tx, TRASH).get(id) as IDBRequest<PlanRecord | undefined>),
          req(store(tx, TRASH_LIST).get(id) as IDBRequest<TrashListed | undefined>),
          req(store(tx, PLANS).count(id)),
        ])
        store(tx, TRASH).delete(id)
        store(tx, TRASH_LIST).delete(id)
        if (!rec?.data || !Array.isArray(rec.data.floors)) {
          await drop(tx, meta?.images ?? [])
          return null
        }
        // As a copy beside it, if a plan with its id is back there already (as from a backup).
        const data = clash ? { ...rec.data, id: uid() } : rec.data
        store(tx, PLANS).put({ data } satisfies PlanRecord, data.id)
        store(tx, LIST).put(entryOf(data, meta?.images ?? refsOf(data)), data.id)
        return withImages(tx, data)
      }, id)
      return back || null
    },
    purge: (id) => run(STORES, 'readwrite', (tx) => purge(tx, [id])),
    clear: () =>
      run(STORES, 'readwrite', async (tx) => {
        for (const s of STORES) store(tx, s).clear()
        stored.clear()
      }),
    adopt: async (p, base) => {
      const done = await roomy(async (tx) => {
        const [here, entry, gone] = await Promise.all([
          req(store(tx, PLANS).get(p.id) as IDBRequest<PlanRecord | undefined>),
          req(store(tx, LIST).get(p.id) as IDBRequest<Listed | undefined>),
          req(store(tx, TRASH_LIST).get(p.id) as IDBRequest<TrashListed | undefined>),
        ])
        const listed = here && entry
        // The same save: nothing to do.
        if (listed ? entry.updatedAt === p.updatedAt : gone?.updatedAt === p.updatedAt) return { refs: null, kept: 0 }
        /**
         * Another version kept in Recently deleted, beside the plan: the user's own (even of a plan shared with them),
         * with an id of its own, to come back as a copy.
         */
        const keepOther = (data: Project, name: string, updatedAt: number, images: string[]) => {
          const id = uid()
          store(tx, TRASH).put({ data: { ...data, id, access: undefined } } satisfies PlanRecord, id)
          store(tx, TRASH_LIST).put({ id, name, updatedAt, deletedAt: Date.now(), other: true, images } satisfies TrashListed, id)
        }
        const keepThis = async () => {
          const packed = pack(p)
          await storeFiles(tx, packed.files)
          keepOther(packed.data, p.name, p.updatedAt, packed.refs)
          return { refs: null, kept: 1 }
        }
        // Deleted here (and not back): it stays deleted, and this copy, different, is kept beside it.
        if (!listed && gone) return keepThis()
        // Made from the copy here (a note of it, even one older: after an undo): it takes its place.
        if (listed && entry.updatedAt === base) return { refs: await putPlan(tx, p), kept: 0 }
        // The copy here is newer: this one's kept beside it.
        if (listed && entry.updatedAt > p.updatedAt) return keepThis()
        if (listed) keepOther(here.data, entry.name, entry.updatedAt, entry.images)
        return { refs: await putPlan(tx, p), kept: listed ? 1 : 0 }
      }, p.id)
      if (!done) throw new Error(`Couldn't bring in plan ${p.id}`)
      keptApart += done.kept
      if (done.refs) remember(p, done.refs)
    },
    adoptTrashed: async (meta, data) => {
      const done = await roomy(async (tx) => {
        const there = (await req(store(tx, TRASH_LIST).get(meta.id))) as TrashListed | undefined
        if (there && there.updatedAt >= meta.updatedAt) return true
        const { data: packed, refs, files } = pack(data)
        await storeFiles(tx, files)
        store(tx, TRASH).put({ data: packed } satisfies PlanRecord, meta.id)
        store(tx, TRASH_LIST).put({ ...meta, images: refs } satisfies TrashListed, meta.id)
        await drop(tx, there?.images ?? [])
        return true
      }, meta.id)
      if (!done) throw new Error(`Couldn't bring in deleted plan ${meta.id}`)
    },
    withImages: (p) => run([IMAGES], 'readonly', (tx) => withImages(tx, p)),
    keptApart: () => keptApart,
    sweep: (before) =>
      run([LIST, TRASH_LIST, IMAGES], 'readwrite', async (tx) => {
        const unused = new Set((await req(store(tx, IMAGES).getAllKeys())) as string[])
        const [plans, trashed] = await Promise.all([req(store(tx, LIST).getAll() as IDBRequest<Listed[]>), req(store(tx, TRASH_LIST).getAll() as IDBRequest<TrashListed[]>)])
        for (const r of [...plans, ...trashed]) for (const k of r.images ?? []) unused.delete(k)
        for (const k of keep()) unused.delete(k)
        for (const k of unused) if (before.has(k)) store(tx, IMAGES).delete(k)
        return new Set([...unused].filter((k) => !before.has(k)))
      }),
  }
}

/**
 * Make a change, making room if the browser's full: `attempt` drops the deleted plans it's given (the longest deleted,
 * never `keep`, nor versions kept apart, which nobody deleted) in the same transaction as the change, one more each
 * time, as many as it takes. A failed attempt
 * changes nothing, so if even all of them wouldn't make room, they're all still there. False if it couldn't be done.
 */
export async function makeRoom<T>(attempt: (drop: string[]) => Promise<T>, keep: string | undefined, listTrash: () => Promise<TrashedMeta[]>): Promise<T | false> {
  const full = (e: unknown) => {
    if (!isFull(e)) console.error('Failed to save', e)
    return isFull(e)
  }
  try {
    return await attempt([])
  } catch (e) {
    if (!full(e)) return false
  }
  let oldest: string[] = []
  try {
    oldest = (await listTrash())
      .filter((m) => m.id !== keep && !m.other)
      .sort((a, b) => a.deletedAt - b.deletedAt)
      .map((m) => m.id)
  } catch (e) {
    console.error("Couldn't list the trash to make room", e)
  }
  for (let n = 1; n <= oldest.length; n++) {
    try {
      return await attempt(oldest.slice(0, n))
    } catch (e) {
      if (!full(e)) return false
    }
  }
  console.error('Failed to save: the browser is full')
  return false
}
