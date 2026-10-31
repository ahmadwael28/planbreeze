import { uid } from '../model/project'
import type { Project, ProjectAccess } from '../model/types'

const INDEX_KEY = 'fp.projects'
const PROJECT_KEY = (id: string) => `fp.project.${id}`
const LAST_KEY = 'fp.lastProject'
const TRASH_KEY = 'fp.trash'
const TRASHED_KEY = (id: string) => `fp.trash.${id}`
/** How long a deleted plan is kept, to be put back. */
export const TRASH_DAYS = 30
const DAY = 24 * 3600 * 1000

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
}

/**
 * Plans deleted (or left) in this session: a save that was still on its way (the autosave, or the plan saved as it's
 * closed) doesn't bring them back.
 */
const gone = new Set<string>()

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (e) {
    console.error('Failed to save', key, e)
    return false
  }
}

const isFull = (e: unknown) => e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22)

/**
 * Store it, making room if the browser's full: the plans deleted longest ago go for good, one by one (never `keep`), as
 * many as it takes. If even all of them wouldn't make room, they all stay. `value` can be worked out afresh each time
 * (a list that changes as plans go).
 */
function writeRoomy(key: string, value: string | (() => string), keep?: string): boolean {
  const attempt = () => {
    try {
      localStorage.setItem(key, typeof value === 'string' ? value : value())
      return true
    } catch (e) {
      if (!isFull(e)) console.error('Failed to save', key, e)
      return isFull(e) ? false : null
    }
  }
  const first = attempt()
  if (first !== false) return !!first
  const held: { meta: TrashedMeta; raw: string | null }[] = []
  for (;;) {
    const oldest = listTrash()
      .filter((m) => m.id !== keep)
      .pop()
    if (!oldest) break
    held.push({ meta: oldest, raw: localStorage.getItem(TRASHED_KEY(oldest.id)) })
    purgeTrashed(oldest.id)
    const again = attempt()
    if (again !== false) return !!again
  }
  // Not room enough even so: the trash as it was (it fitted before).
  try {
    for (const h of held) if (h.raw !== null) localStorage.setItem(TRASHED_KEY(h.meta.id), h.raw)
    write(TRASH_KEY, [...listTrash(), ...held.map((h) => h.meta)])
  } catch (e) {
    console.error('Failed to put the trash back', e)
  }
  console.error('Failed to save', key, 'the browser is full')
  return false
}

/** A list as stored, its entries checked: a damaged one is left out, a name that isn't text made text. */
function readList<T extends { id: string; name: string }>(key: string): T[] {
  const list = read<unknown>(key, [])
  if (!Array.isArray(list)) return []
  return list
    .filter((m): m is T => !!m && typeof m === 'object' && typeof (m as T).id === 'string')
    .map((m) => (typeof m.name === 'string' ? m : { ...m, name: String(m.name ?? '') }))
}

export function listProjects(): ProjectMeta[] {
  return readList<ProjectMeta>(INDEX_KEY).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function loadProject(id: string): Project | null {
  return read<Project | null>(PROJECT_KEY(id), null)
}

/**
 * A plan into the list (not opened). False when the browser refused it, even with room made in the trash (but for
 * `keep`).
 */
export function storeProject(p: Project, keep?: string): boolean {
  gone.delete(p.id)
  return put(p, keep)
}

/** The plan, then its entry in the list: never an entry for a plan that isn't there. */
function put(p: Project, keep?: string): boolean {
  const had = localStorage.getItem(PROJECT_KEY(p.id)) !== null
  if (!writeRoomy(PROJECT_KEY(p.id), JSON.stringify(p), keep)) return false
  const entry = { id: p.id, name: p.name, updatedAt: p.updatedAt, shared: p.access }
  if (writeRoomy(INDEX_KEY, () => JSON.stringify([...listProjects().filter((m) => m.id !== p.id), entry]), keep)) return true
  // Not listed: a new plan doesn't stay unlisted (one that was there keeps its entry, and its newer copy).
  if (!had) localStorage.removeItem(PROJECT_KEY(p.id))
  return false
}

/**
 * Save the open plan. Returns false when the browser refused to store it (usually storage is full, and nothing left
 * in the trash to make room).
 */
export function saveProject(p: Project): boolean {
  if (gone.has(p.id)) return true
  const ok = put(p)
  write(LAST_KEY, p.id)
  return ok
}

/** Remove a plan from this browser for good (a shared plan this user left). Deleting a plan is `trashProject`. */
export function deleteProject(id: string) {
  gone.add(id)
  localStorage.removeItem(PROJECT_KEY(id))
  write(
    INDEX_KEY,
    listProjects().filter((m) => m.id !== id),
  )
}

/** Whether a plan was deleted in this session (nothing's saved of it, here or in the account, until it's opened again). */
export const isGone = (id: string) => gone.has(id)

/** A plan opened: saved as usual again, if it was deleted earlier on (and put back, or opened from elsewhere). */
export function opened(id: string) {
  gone.delete(id)
}

export function lastProjectId(): string | null {
  return read<string | null>(LAST_KEY, null)
}

// ---------------------------------------------------------------------------
// Recently deleted

/** The plans in the trash, the last deleted first. */
export function listTrash(): TrashedMeta[] {
  return readList<TrashedMeta>(TRASH_KEY).sort((a, b) => b.deletedAt - a.deletedAt)
}

/**
 * Delete a plan: out of the list, and kept in the trash for TRASH_DAYS (or until the browser needs the room), to be
 * put back. `data`: the plan as it is in the account, when that's newer than this browser's copy or there's none here.
 * A newer copy of it in the trash already (deleted before) stays. False if it couldn't be kept (no room even so): then
 * nothing's deleted.
 */
export function trashProject(id: string, data?: Project | null, cloud = false): boolean {
  try {
    const listed = listProjects()
    const local = localStorage.getItem(PROJECT_KEY(id))
    const before = localStorage.getItem(TRASHED_KEY(id))
    let raw = data ? JSON.stringify(data) : local
    if (!raw) {
      // Nothing of it here to keep (only its entry): just out of the list.
      gone.add(id)
      write(
        INDEX_KEY,
        listed.filter((m) => m.id !== id),
      )
      if (lastProjectId() === id) localStorage.removeItem(LAST_KEY)
      return true
    }
    const parse = (s: string | null): Partial<Project> | null => {
      try {
        return s ? (JSON.parse(s) as Partial<Project>) : null
      } catch {
        return null
      }
    }
    let p = parse(raw) ?? {}
    const trashed = parse(before)
    if (before && trashed && (trashed.updatedAt ?? 0) > (p.updatedAt ?? 0)) {
      raw = before
      p = trashed
    }
    const meta: TrashedMeta = {
      id,
      name: typeof p.name === 'string' ? p.name : (listed.find((m) => m.id === id)?.name ?? ''),
      updatedAt: p.updatedAt ?? 0,
      deletedAt: Date.now(),
      cloud: cloud || undefined,
    }
    // Out of the list first (that only frees room), then into the trash: its copy, then its entry.
    if (local) localStorage.removeItem(PROJECT_KEY(id))
    write(
      INDEX_KEY,
      listed.filter((m) => m.id !== id),
    )
    const kept =
      writeRoomy(TRASHED_KEY(id), raw, id) && writeRoomy(TRASH_KEY, () => JSON.stringify([...listTrash().filter((m) => m.id !== id), meta]), id)
    if (!kept) {
      // No room to keep it even so: all as it was.
      if (before) localStorage.setItem(TRASHED_KEY(id), before)
      else localStorage.removeItem(TRASHED_KEY(id))
      if (local) localStorage.setItem(PROJECT_KEY(id), local)
      write(INDEX_KEY, listed)
      return false
    }
    gone.add(id)
    if (lastProjectId() === id) localStorage.removeItem(LAST_KEY)
    return true
  } catch (e) {
    console.error('Failed to delete', id, e)
    return false
  }
}

/**
 * Put a plan back from the trash, into the list (as a copy beside it, if a plan with its id is back there already, as
 * from a backup). It leaves the trash first, making room for itself. Null if it's gone, or there's no room for it.
 */
export function restoreProject(id: string): Project | null {
  const raw = localStorage.getItem(TRASHED_KEY(id))
  let p: Project | null = null
  try {
    p = raw ? (JSON.parse(raw) as Project) : null
  } catch {
    p = null
  }
  if (!raw || !p) {
    purgeTrashed(id)
    return null
  }
  const back = loadProject(id) ? { ...p, id: uid() } : p
  const trash = listTrash()
  purgeTrashed(id)
  if (!storeProject(back, id)) {
    try {
      localStorage.setItem(TRASHED_KEY(id), raw)
      write(TRASH_KEY, trash)
    } catch (e) {
      console.error('Failed to keep it in the trash', id, e)
    }
    return null
  }
  return back
}

/** Delete a plan in the trash for good. */
export function purgeTrashed(id: string) {
  localStorage.removeItem(TRASHED_KEY(id))
  write(
    TRASH_KEY,
    listTrash().filter((m) => m.id !== id),
  )
}

/** Plans deleted longer ago than TRASH_DAYS go for good (on each start). */
export function purgeOldTrash(now = Date.now()) {
  for (const m of listTrash()) if (now - m.deletedAt > TRASH_DAYS * DAY) purgeTrashed(m.id)
}

/** Every plan, and the trash, gone from this browser (signing out on a shared computer). */
export function clearPlans() {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && (k.startsWith('fp.project.') || k.startsWith('fp.trash.'))) keys.push(k)
  }
  for (const m of listProjects()) gone.add(m.id)
  for (const k of [...keys, INDEX_KEY, LAST_KEY, TRASH_KEY]) localStorage.removeItem(k)
}
