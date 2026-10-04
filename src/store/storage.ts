import type { Project, ProjectAccess } from '../model/types'

const INDEX_KEY = 'fp.projects'
const PROJECT_KEY = (id: string) => `fp.project.${id}`
const LAST_KEY = 'fp.lastProject'

export interface ProjectMeta {
  id: string
  name: string
  updatedAt: number
  /** Someone else's plan, shared with this user. */
  shared?: ProjectAccess
}

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

export function listProjects(): ProjectMeta[] {
  return read<ProjectMeta[]>(INDEX_KEY, []).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function loadProject(id: string): Project | null {
  return read<Project | null>(PROJECT_KEY(id), null)
}

/** Returns false when the browser refused to store it (usually storage is full). */
export function saveProject(p: Project): boolean {
  const ok = write(PROJECT_KEY(p.id), p)
  const index = listProjects().filter((m) => m.id !== p.id)
  index.push({ id: p.id, name: p.name, updatedAt: p.updatedAt, shared: p.access })
  write(INDEX_KEY, index)
  write(LAST_KEY, p.id)
  return ok
}

export function deleteProject(id: string) {
  localStorage.removeItem(PROJECT_KEY(id))
  write(
    INDEX_KEY,
    listProjects().filter((m) => m.id !== id),
  )
}

export function lastProjectId(): string | null {
  return read<string | null>(LAST_KEY, null)
}
