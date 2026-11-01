/**
 * Plans in localStorage, as every version kept them before IndexedDB: each plan one key, its photos inside it. Used only
 * where IndexedDB can't be opened (see storage), and read once more as plans move across from it.
 */
import { uid } from '../model/project'
import type { Project } from '../model/types'
import type { Backend, ProjectMeta, TrashedMeta } from './storage'

export const INDEX_KEY = 'fp.projects'
export const PROJECT_KEY = (id: string) => `fp.project.${id}`
export const TRASH_KEY = 'fp.trash'
export const TRASHED_KEY = (id: string) => `fp.trash.${id}`

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

export const isFull = (e: unknown) => e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22)

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
export function readList<T extends { id: string; name: string }>(key: string): T[] {
  const list = read<unknown>(key, [])
  if (!Array.isArray(list)) return []
  return list
    .filter((m): m is T => !!m && typeof m === 'object' && typeof (m as T).id === 'string')
    .map((m) => (typeof m.name === 'string' ? m : { ...m, name: String(m.name ?? '') }))
}

function listProjects(): ProjectMeta[] {
  return readList<ProjectMeta>(INDEX_KEY)
}

function loadProject(id: string): Project | null {
  return read<Project | null>(PROJECT_KEY(id), null)
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

function deleteProject(id: string) {
  localStorage.removeItem(PROJECT_KEY(id))
  write(
    INDEX_KEY,
    listProjects().filter((m) => m.id !== id),
  )
}

function listTrash(): TrashedMeta[] {
  return readList<TrashedMeta>(TRASH_KEY).sort((a, b) => b.deletedAt - a.deletedAt)
}

function trashProject(id: string, data?: Project | null, cloud = false): boolean {
  try {
    const listed = listProjects()
    const local = localStorage.getItem(PROJECT_KEY(id))
    const before = localStorage.getItem(TRASHED_KEY(id))
    let raw = data ? JSON.stringify(data) : local
    if (!raw) {
      // Nothing of it here to keep (only its entry): just out of the list.
      write(
        INDEX_KEY,
        listed.filter((m) => m.id !== id),
      )
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
    return true
  } catch (e) {
    console.error('Failed to delete', id, e)
    return false
  }
}

function restoreProject(id: string): Project | null {
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
  if (!put(back, id)) {
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

function purgeTrashed(id: string) {
  localStorage.removeItem(TRASHED_KEY(id))
  write(
    TRASH_KEY,
    listTrash().filter((m) => m.id !== id),
  )
}

function clearPlans() {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && (k.startsWith('fp.project.') || k.startsWith('fp.trash.'))) keys.push(k)
  }
  for (const k of [...keys, INDEX_KEY, TRASH_KEY]) localStorage.removeItem(k)
}

/** The plans kept as before, one key each in localStorage. */
export function localBackend(): Backend {
  return {
    kind: 'local',
    list: async () => listProjects(),
    load: async (id) => loadProject(id),
    put: async (p, keep) => put(p, keep),
    remove: async (id) => deleteProject(id),
    listTrash: async () => listTrash(),
    trash: async (id, data, cloud) => trashProject(id, data, cloud),
    restore: async (id) => restoreProject(id),
    purge: async (id) => purgeTrashed(id),
    clear: async () => clearPlans(),
  }
}
