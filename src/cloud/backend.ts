/**
 * Cloud storage backends. The app talks to `CloudBackend`; Supabase is the real one, and an
 * in-memory one exists for trying the sync logic locally.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Project } from '@/model/types'

export interface CloudMeta {
  id: string
  name: string
  version: number
  updatedAt: number
}

export interface CloudRow extends CloudMeta {
  data: Project
}

/** Thrown when inserting a project that already exists in the cloud. */
export class AlreadyExistsError extends Error {}

export interface CloudBackend {
  list(): Promise<CloudMeta[]>
  get(id: string): Promise<CloudRow | null>
  /** Current version, or null if the project isn't in the cloud. */
  version(id: string): Promise<number | null>
  /** Create; returns the new version. Throws AlreadyExistsError if the id is taken. */
  insert(p: Project): Promise<number>
  /** Save if the cloud is still at `expected`; returns the new version, or null if it moved on (or is gone). */
  update(p: Project, expected: number): Promise<number | null>
  remove(id: string): Promise<void>
}

const toMeta = (r: { id: string; name: string; version: number; updated_at: string }): CloudMeta => ({
  id: r.id,
  name: r.name,
  version: r.version,
  updatedAt: Date.parse(r.updated_at),
})

export function supabaseBackend(sb: SupabaseClient): CloudBackend {
  const table = () => sb.from('projects')
  const fail = (error: { message: string } | null) => {
    if (error) throw new Error(error.message)
  }
  return {
    async list() {
      const { data, error } = await table().select('id, name, version, updated_at').order('updated_at', { ascending: false })
      fail(error)
      return (data ?? []).map(toMeta)
    },
    async get(id) {
      const { data, error } = await table().select('id, name, version, updated_at, data').eq('id', id).maybeSingle()
      fail(error)
      return data ? { ...toMeta(data), data: data.data as Project } : null
    },
    async version(id) {
      const { data, error } = await table().select('version').eq('id', id).maybeSingle()
      fail(error)
      return data ? (data.version as number) : null
    },
    async insert(p) {
      const { error } = await table().insert({ id: p.id, name: p.name, data: p, version: 1, updated_at: new Date().toISOString() })
      if (error?.code === '23505') throw new AlreadyExistsError(error.message) // unique violation
      fail(error)
      return 1
    },
    async update(p, expected) {
      const { data, error } = await table()
        .update({ name: p.name, data: p, version: expected + 1, updated_at: new Date().toISOString() })
        .eq('id', p.id)
        .eq('version', expected)
        .select('version')
      fail(error)
      return data && data.length ? (data[0].version as number) : null
    },
    async remove(id) {
      const { error } = await table().delete().eq('id', id)
      fail(error)
    },
  }
}

/** Same contract in memory, for development and tests. */
export function memoryBackend(): CloudBackend & { rows: Map<string, CloudRow>; offline: boolean } {
  const rows = new Map<string, CloudRow>()
  const self = {
    rows,
    offline: false,
    check() {
      if (self.offline) throw new TypeError('Failed to fetch')
    },
    async list() {
      self.check()
      return [...rows.values()].map(({ data: _data, ...m }) => m).sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async get(id: string) {
      self.check()
      const r = rows.get(id)
      return r ? structuredClone(r) : null
    },
    async version(id: string) {
      self.check()
      return rows.get(id)?.version ?? null
    },
    async insert(p: Project) {
      self.check()
      if (rows.has(p.id)) throw new AlreadyExistsError('exists')
      rows.set(p.id, { id: p.id, name: p.name, version: 1, updatedAt: Date.now(), data: structuredClone(p) })
      return 1
    },
    async update(p: Project, expected: number) {
      self.check()
      const r = rows.get(p.id)
      if (!r || r.version !== expected) return null
      rows.set(p.id, { id: p.id, name: p.name, version: expected + 1, updatedAt: Date.now(), data: structuredClone(p) })
      return expected + 1
    },
    async remove(id: string) {
      self.check()
      rows.delete(id)
    },
  }
  return self
}
