/**
 * The plans kept in this browser, and the deleted ones kept a while to put back.
 *
 * They're in IndexedDB (storage-idb), with room for far more than localStorage and each photo stored once. Plans that
 * earlier versions kept in localStorage move across by themselves each time the app starts; where IndexedDB can't be
 * opened, plans stay in localStorage as before (storage-local).
 *
 * Everything here is asynchronous, and done one thing at a time, in the order asked: a save asked for before a delete
 * is made before it.
 */
import { isProject } from '../model/migrate'
import type { Project, ProjectAccess } from '../model/types'
import { idbBackend, pack } from './storage-idb'
import type { IdbBackend } from './storage-idb'
import { localBackend, PROJECT_KEY, readList, TRASH_KEY, TRASHED_KEY, INDEX_KEY } from './storage-local'

/** How long a deleted plan is kept, to be put back. */
export const TRASH_DAYS = 30
const DAY = 24 * 3600 * 1000
const LAST_KEY = 'fp.lastProject'
/** Set once plans are in IndexedDB: if it can't be opened later, they're there, out of reach for now. */
const MOVED_KEY = 'fp.storage'
/** A plan as it was when the page was left, before its save was known to be made: id → a Note (see saveOnLeave). */
const UNSAVED = 'fp.unsaved.'
/** Images nothing used at the last start (they go if nothing uses them at the next either). */
const UNUSED_KEY = 'fp.unusedImages'

/** A plan noted as the page was left: the plan, and when the stored copy it was made from was changed. */
interface Note {
  plan: Project
  base?: number
}

export interface ProjectMeta {
  id: string
  name: string
  updatedAt: number
  /** Someone else's plan, shared with this user. */
  shared?: ProjectAccess
}

/** A deleted plan, kept a while so it can be put back. */
export interface TrashedMeta {
  id: string
  name: string
  updatedAt: number
  deletedAt: number
  /** It was in the account too (put back, it goes up there again). */
  cloud?: boolean
  /** Not deleted: another version of a plan, kept when a different copy of it took its place (as plans moved across). */
  other?: boolean
}

/** Where plans are kept. */
export interface Backend {
  kind: 'idb' | 'local'
  list(): Promise<ProjectMeta[]>
  load(id: string): Promise<Project | null>
  /** A plan and its entry in the list, making room in the trash if need be (never `keep`). False if refused. */
  put(p: Project, keep?: string): Promise<boolean>
  remove(id: string): Promise<void>
  listTrash(): Promise<TrashedMeta[]>
  /** Out of the list, into the trash (`data`: the copy to keep, if not this browser's). False if it couldn't be kept. */
  trash(id: string, data: Project | null | undefined, cloud: boolean): Promise<boolean>
  /** Out of the trash, into the list (as a copy beside it, if its id is taken). Null if it's gone, or there's no room. */
  restore(id: string): Promise<Project | null>
  purge(id: string): Promise<void>
  clear(): Promise<void>
}

/**
 * Plans deleted (or left) in this session: a save that was still on its way (the autosave, or the plan saved as it's
 * closed) doesn't bring them back.
 */
const gone = new Set<string>()

const ls = {
  get(key: string) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
      return true
    } catch {
      return false
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Storage blocked.
    }
  },
  keys(): string[] {
    const keys: string[] = []
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k !== null) keys.push(k)
      }
    } catch {
      // Storage blocked.
    }
    return keys
  },
}

// ---------------------------------------------------------------------------
// Opening

let backend: Backend | null = null
let opening: Promise<Backend> | null = null
/** Plans were moved to IndexedDB, and it couldn't be opened this time. */
let outOfReach = false
/** Plans (or notes of them) left in localStorage that couldn't be brought into IndexedDB this time. */
let leftBehind = 0

/** Open the plans (once): in IndexedDB, those left in localStorage moved across first; or in localStorage. */
export const openStorage = () => start().then(() => undefined)

function start(): Promise<Backend> {
  return (opening ??= choose())
}

async function choose(): Promise<Backend> {
  let idb: IdbBackend | null = null
  try {
    if (typeof indexedDB !== 'undefined') idb = await idbBackend(noted)
  } catch (e) {
    console.error("Couldn't open this browser's plan storage (IndexedDB): plans are kept in localStorage", e)
  }
  if (!idb) {
    outOfReach = ls.get(MOVED_KEY) === 'idb'
    return (backend = localBackend())
  }
  // What can't be brought in now stays where it is, for the next start; the plans in IndexedDB are used all the same.
  leftBehind = (await moveIn(idb)) + (await catchUp(idb))
  try {
    let before: string[] = []
    try {
      before = JSON.parse(ls.get(UNUSED_KEY) ?? '[]') as string[]
    } catch {
      // Damaged: nothing goes this time.
    }
    const unused = await idb.sweep(new Set(Array.isArray(before) ? before : []))
    if (unused.size) ls.set(UNUSED_KEY, JSON.stringify([...unused]))
    else ls.remove(UNUSED_KEY)
  } catch (e) {
    console.error("Couldn't clear unused images", e)
  }
  ls.set(MOVED_KEY, 'idb')
  return (backend = idb)
}

/** Whether this browser's plans are out of reach for now (IndexedDB couldn't be opened): a reload may bring them back. */
export const plansOutOfReach = () => outOfReach

/** How many plans (or changes to them) were left in older storage this time, as there wasn't room to bring them in. */
export const plansLeftBehind = () => leftBehind

/** How many other versions of plans this start kept in Recently deleted (copies changed apart, that met as it started). */
export const versionsKeptApart = () => (backend?.kind === 'idb' ? (backend as IdbBackend).keptApart() : 0)

/**
 * Plans left in localStorage this time (they couldn't be brought into IndexedDB): their copies there, and notes of
 * changes to them, for a backup to have them too. Each as it reads there, newest first by plan.
 */
export function leftBehindPlans(): Promise<Project[]> {
  return queue(async (b) => {
    if (b.kind !== 'idb') return []
    const found = new Map<string, Project>()
    for (const k of ls.keys()) {
      let p: Project | null = null
      if (k.startsWith('fp.project.')) p = readPlan(ls.get(k))
      else if (k.startsWith(UNSAVED)) {
        try {
          const n = JSON.parse(ls.get(k) ?? 'null') as Partial<Note> | null
          if (n && isProject(n.plan)) p = await (b as IdbBackend).withImages(n.plan)
        } catch {
          p = null
        }
      }
      if (p && (found.get(p.id)?.updatedAt ?? -Infinity) < p.updatedAt) found.set(p.id, p)
    }
    return [...found.values()]
  })
}

/** Where plans are kept (once opened): IndexedDB, or localStorage where it can't be opened. */
export const storageKind = () => backend?.kind ?? null

/** A key's plan, as it reads now (null: not a plan, or damaged). */
function readPlan(raw: string | null): Project | null {
  try {
    const p = raw ? (JSON.parse(raw) as unknown) : null
    return isProject(p) ? p : null
  } catch {
    return null
  }
}

/**
 * Bring in what a key holds, then take the key out of localStorage: only once IndexedDB has it, and only if the key
 * still holds what was read (a tab of an older version may have saved a newer copy meanwhile: that stays, for the next
 * start). False if it couldn't be brought in (left for the next start too).
 */
async function bringIn(key: string, raw: string, adopt: () => Promise<void>): Promise<boolean> {
  try {
    await adopt()
  } catch (e) {
    console.error("Couldn't bring this plan into IndexedDB yet", key, e)
    return false
  }
  if (ls.get(key) === raw) ls.remove(key)
  return true
}

/**
 * Plans and deleted plans left in localStorage (by earlier versions, or a tab of one still open) move across, one by
 * one. Where IndexedDB has a different copy, the newer is the plan and the other's kept in Recently deleted. How many
 * couldn't.
 */
async function moveIn(idb: IdbBackend): Promise<number> {
  const trashList = new Map(readList<TrashedMeta>(TRASH_KEY).map((m) => [m.id, m]))
  let failed = 0
  for (const k of ls.keys()) {
    const trashed = k.startsWith('fp.trash.')
    if (!trashed && !k.startsWith('fp.project.')) continue
    const raw = ls.get(k)
    const p = readPlan(raw)
    // One that can't be read is left where it is.
    if (!raw || !p || (trashed ? TRASHED_KEY(p.id) : PROJECT_KEY(p.id)) !== k) continue
    const m = trashList.get(p.id)
    const meta: TrashedMeta = { id: p.id, name: m?.name ?? p.name, updatedAt: p.updatedAt ?? 0, deletedAt: m?.deletedAt ?? Date.now(), ...(m?.cloud ? { cloud: true } : {}) }
    if (!(await bringIn(k, raw, () => (trashed ? idb.adoptTrashed(meta, p) : idb.adopt(p))))) failed++
  }
  // Their lists go once they're all across.
  const left = ls.keys()
  if (!left.some((k) => k.startsWith('fp.project.'))) ls.remove(INDEX_KEY)
  if (!left.some((k) => k.startsWith('fp.trash.'))) ls.remove(TRASH_KEY)
  return failed
}

/**
 * Notes of plans left before their save was made (the page closed straight after a change): saved now, each if it's
 * newer than what's stored. How many couldn't be.
 */
async function catchUp(idb: IdbBackend): Promise<number> {
  let failed = 0
  for (const k of ls.keys()) {
    if (!k.startsWith(UNSAVED)) continue
    const raw = ls.get(k)
    let note: Partial<Note> | null = null
    try {
      note = raw ? (JSON.parse(raw) as Partial<Note>) : null
    } catch {
      // Damaged: left where it is.
    }
    if (!raw || !note || !isProject(note.plan)) continue
    const { plan, base } = note
    if (!(await bringIn(k, raw, () => idb.adopt(plan, typeof base === 'number' ? base : undefined)))) failed++
  }
  return failed
}

/** Images the notes of unsaved plans refer to (kept, though no stored plan uses them). */
function noted(): Set<string> {
  const refs = new Set<string>()
  for (const k of ls.keys()) {
    if (!k.startsWith(UNSAVED)) continue
    for (const m of (ls.get(k) ?? '').matchAll(/"ref:([^"]+)"/g)) refs.add(m[1])
  }
  return refs
}

// ---------------------------------------------------------------------------
// One thing at a time

let chain: Promise<unknown> = Promise.resolve()

function queue<T>(f: (b: Backend) => Promise<T>): Promise<T> {
  const next = chain.then(start).then(f)
  chain = next.catch(() => {})
  return next
}

/** Notes this tab made as the page was left, by plan: when the plan was changed, and the note as written. */
const notes = new Map<string, { at: number; raw: string }>()

/** This tab's note of a plan, no longer needed (its save, or a later one, is made): unless another tab's replaced it. */
function forgetNote(id: string, upTo = Infinity) {
  const n = notes.get(id)
  if (!n || n.at > upTo) return
  notes.delete(id)
  if (ls.get(UNSAVED + id) === n.raw) ls.remove(UNSAVED + id)
}

// ---------------------------------------------------------------------------
// Plans

export const listProjects = () => queue(async (b) => (await b.list()).sort((a, c) => c.updatedAt - a.updatedAt))

export const loadProject = (id: string) => queue((b) => b.load(id))

/**
 * A plan into the list (not opened). False when the browser refused it, even with room made in the trash (but for
 * `keep`).
 */
export function storeProject(p: Project, keep?: string): Promise<boolean> {
  return queue((b) => {
    gone.delete(p.id)
    return b.put(p, keep)
  })
}

/**
 * Save the open plan. False when the browser refused to store it (usually storage is full, and nothing left in the
 * trash to make room).
 */
export function saveProject(p: Project): Promise<boolean> {
  return queue(async (b) => {
    if (gone.has(p.id)) return true
    const ok = await b.put(p)
    ls.set(LAST_KEY, JSON.stringify(p.id))
    if (ok) forgetNote(p.id, p.updatedAt)
    return ok
  })
}

/**
 * The open plan as the page is left (or hidden: a phone may close it unseen): saved, and noted in localStorage at once
 * as well (its images by reference, those not stored yet inside it), in case the page goes before the save is made.
 * The next start saves the note if it's newer than what's stored.
 */
export function saveOnLeave(p: Project): Promise<boolean> {
  if (backend?.kind === 'idb' && !gone.has(p.id)) {
    const idb = backend as IdbBackend
    try {
      const note: Note = { plan: pack(p, (key) => !idb.has(p.id, key)).data, base: idb.base(p.id) }
      const raw = JSON.stringify(note)
      if (ls.set(UNSAVED + p.id, raw)) notes.set(p.id, { at: p.updatedAt, raw })
    } catch (e) {
      console.error("Couldn't note the plan", e)
    }
  }
  return saveProject(p)
}

/** Remove a plan from this browser for good (a shared plan this user left). Deleting a plan is `trashProject`. */
export function deleteProject(id: string): Promise<void> {
  gone.add(id)
  forgetNote(id)
  return queue((b) => b.remove(id))
}

/** Whether a plan was deleted in this session (nothing's saved of it, here or in the account, until it's opened again). */
export const isGone = (id: string) => gone.has(id)

/** A plan opened: saved as usual again, if it was deleted earlier on (and put back, or opened from elsewhere). */
export function opened(id: string) {
  gone.delete(id)
}

export function lastProjectId(): string | null {
  const raw = ls.get(LAST_KEY)
  try {
    return raw ? (JSON.parse(raw) as string) : null
  } catch {
    return raw
  }
}

// ---------------------------------------------------------------------------
// Recently deleted

/** The plans in the trash, the last deleted first. */
export const listTrash = () => queue(async (b) => (await b.listTrash()).sort((a, c) => c.deletedAt - a.deletedAt))

/**
 * Delete a plan: out of the list, and kept in the trash for TRASH_DAYS (or until the browser needs the room), to be
 * put back. `data`: the plan as it is in the account, when that's newer than this browser's copy or there's none here.
 * A newer copy of it in the trash already (deleted before) stays. False if it couldn't be kept (no room even so): then
 * nothing's deleted.
 */
export function trashProject(id: string, data?: Project | null, cloud = false): Promise<boolean> {
  return queue(async (b) => {
    try {
      if (!(await b.trash(id, data, cloud))) return false
    } catch (e) {
      console.error('Failed to delete', id, e)
      return false
    }
    gone.add(id)
    forgetNote(id)
    if (lastProjectId() === id) ls.remove(LAST_KEY)
    return true
  })
}

/**
 * Put a plan back from the trash, into the list (as a copy beside it, if a plan with its id is back there already, as
 * from a backup). It leaves the trash first, making room for itself. Null if it's gone, or there's no room for it.
 */
export function restoreProject(id: string): Promise<Project | null> {
  return queue(async (b) => {
    const p = await b.restore(id)
    if (p) gone.delete(p.id)
    return p
  })
}

/** Delete a plan in the trash for good. */
export const purgeTrashed = (id: string) => queue((b) => b.purge(id))

/** Plans deleted longer ago than TRASH_DAYS go for good (on each start). */
export function purgeOldTrash(now = Date.now()) {
  return queue(async (b) => {
    for (const m of await b.listTrash()) if (now - m.deletedAt > TRASH_DAYS * DAY) await b.purge(m.id)
  })
}

/** Every plan, and the trash, gone from this browser (signing out on a shared computer). */
export function clearPlans() {
  return queue(async (b) => {
    for (const m of await b.list()) gone.add(m.id)
    await b.clear()
    ls.remove(LAST_KEY)
    for (const k of ls.keys()) if (k.startsWith(UNSAVED)) ls.remove(k)
    notes.clear()
  })
}

// ---------------------------------------------------------------------------
// Room, and keeping plans safe

export interface StorageUse {
  /** Bytes used by this site, and what the browser allows it. */
  used: number
  quota: number
  /** The browser won't clear the site's storage to make room (it was asked to keep it, and agreed). */
  kept: boolean
}

/** How much room plans take here, and whether the browser keeps them for sure. Null where the browser doesn't say. */
export async function storageUse(): Promise<StorageUse | null> {
  const s = typeof navigator !== 'undefined' ? navigator.storage : undefined
  if (!s?.estimate) return null
  try {
    const [{ usage = 0, quota = 0 }, kept] = await Promise.all([s.estimate(), s.persisted ? s.persisted() : Promise.resolve(false)])
    return { used: usage, quota, kept }
  } catch {
    return null
  }
}

/** Ask the browser to keep this site's plans until the user removes them (not clear them to make room). */
export async function keepPlans(): Promise<boolean> {
  try {
    const s = navigator.storage
    if (!s?.persist) return false
    return (await s.persisted?.()) || (await s.persist())
  } catch {
    return false
  }
}

let asked = false

/**
 * Once a session, after a change is made: ask the browser to keep the plans. Most decide by themselves; Firefox asks
 * the user, so there it's asked only from the storage meter (when they choose to).
 */
export function askToKeepPlans() {
  if (asked || /firefox\//i.test(navigator.userAgent)) return
  asked = true
  void keepPlans()
}
