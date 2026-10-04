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

/**
 * The signed-in user's plans in the cloud. `owner` reaches a plan someone else shared with them (by default, their
 * own).
 */
export interface CloudBackend {
  list(): Promise<CloudMeta[]>
  get(id: string, owner?: string): Promise<CloudRow | null>
  /** Current version, or null if the project isn't in the cloud (or not shared with this user). */
  version(id: string, owner?: string): Promise<number | null>
  /** Create; returns the new version. Throws AlreadyExistsError if the id is taken. */
  insert(p: Project): Promise<number>
  /** Save if the cloud is still at `expected`; returns the new version, or null if it moved on (or is gone). */
  update(p: Project, expected: number, owner?: string): Promise<number | null>
  remove(id: string): Promise<void>
}

/** A plan as stored in the cloud: without who it was opened by. */
function stored(p: Project): Project {
  const { access: _access, ...rest } = p
  return rest
}

export type ShareRole = 'viewer' | 'editor'

/** Someone a plan is shared with. */
export interface Share {
  email: string
  role: ShareRole
}

/** A plan someone else shared with the signed-in user. */
export interface SharedPlan {
  owner: string
  ownerEmail?: string
  id: string
  name: string
  role: ShareRole
  updatedAt: number
}

const toMeta = (r: { id: string; name: string; version: number; updated_at: string }): CloudMeta => ({
  id: r.id,
  name: r.name,
  version: r.version,
  updatedAt: Date.parse(r.updated_at),
})

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message)
}

/** `me`: the signed-in user's id. */
export function supabaseBackend(sb: SupabaseClient, me: () => string | undefined): CloudBackend {
  const table = () => sb.from('projects')
  return {
    async list() {
      const { data, error } = await table().select('id, name, version, updated_at').eq('user_id', me()!).order('updated_at', { ascending: false })
      fail(error)
      return (data ?? []).map(toMeta)
    },
    async get(id, owner = me()) {
      const { data, error } = await table().select('id, name, version, updated_at, data').eq('user_id', owner!).eq('id', id).maybeSingle()
      fail(error)
      return data ? { ...toMeta(data), data: data.data as Project } : null
    },
    async version(id, owner = me()) {
      const { data, error } = await table().select('version').eq('user_id', owner!).eq('id', id).maybeSingle()
      fail(error)
      return data ? (data.version as number) : null
    },
    async insert(p) {
      const { error } = await table().insert({ id: p.id, name: p.name, data: stored(p), version: 1, updated_at: new Date().toISOString() })
      if (error?.code === '23505') throw new AlreadyExistsError(error.message) // unique violation
      fail(error)
      return 1
    },
    async update(p, expected, owner = me()) {
      const { data, error } = await table()
        .update({ name: p.name, data: stored(p), version: expected + 1, updated_at: new Date().toISOString() })
        .eq('user_id', owner!)
        .eq('id', p.id)
        .eq('version', expected)
        .select('version')
      fail(error)
      return data && data.length ? (data[0].version as number) : null
    },
    async remove(id) {
      const { error } = await table().delete().eq('user_id', me()!).eq('id', id)
      fail(error)
    },
  }
}

/** Sharing plans: who the owner shares each with, and the plans shared with the signed-in user. */
export function sharingBackend(sb: SupabaseClient, me: () => string | undefined) {
  const shares = () => sb.from('project_shares')
  return {
    /** Plans other people shared with this user. */
    async sharedWithMe(): Promise<SharedPlan[]> {
      const { data, error } = await shares()
        .select('owner_id, project_id, role, owner_email, projects(name, updated_at)')
        .neq('owner_id', me()!)
      fail(error)
      return (data ?? []).flatMap((r) => {
        const p = (Array.isArray(r.projects) ? r.projects[0] : r.projects) as { name: string; updated_at: string } | null
        if (!p) return []
        return [
          {
            owner: r.owner_id as string,
            ownerEmail: (r.owner_email as string | null) ?? undefined,
            id: r.project_id as string,
            name: p.name,
            role: r.role as ShareRole,
            updatedAt: Date.parse(p.updated_at),
          },
        ]
      })
    },
    /** What this user may do with someone else's plan (null: it isn't shared with them). */
    async roleFor(owner: string, id: string): Promise<{ role: ShareRole; ownerEmail?: string } | null> {
      const { data, error } = await shares().select('role, owner_email').eq('owner_id', owner).eq('project_id', id).maybeSingle()
      fail(error)
      return data ? { role: data.role as ShareRole, ownerEmail: (data.owner_email as string | null) ?? undefined } : null
    },
    /** The people one of this user's plans is shared with. */
    async list(id: string): Promise<Share[]> {
      const { data, error } = await shares().select('email, role').eq('owner_id', me()!).eq('project_id', id).order('created_at')
      fail(error)
      return (data ?? []).map((r) => ({ email: r.email as string, role: r.role as ShareRole }))
    },
    async share(id: string, email: string, role: ShareRole) {
      const { error } = await shares().upsert({ owner_id: me(), project_id: id, email: email.toLowerCase(), role }, { onConflict: 'owner_id,project_id,email' })
      fail(error)
    },
    async unshare(id: string, email: string) {
      const { error } = await shares().delete().eq('owner_id', me()!).eq('project_id', id).eq('email', email)
      fail(error)
    },
    /** Stop seeing a plan someone shared with this user. */
    async leave(owner: string, id: string) {
      const { error } = await shares().delete().eq('owner_id', owner).eq('project_id', id)
      fail(error)
    },
    /** The key of a plan's view link (null: the link is off). */
    async linkKey(id: string): Promise<string | null> {
      const { data, error } = await sb.from('projects').select('share_token').eq('user_id', me()!).eq('id', id).maybeSingle()
      fail(error)
      return (data?.share_token as string | null) ?? null
    },
    async setLinkKey(id: string, key: string | null) {
      const { error } = await sb.from('projects').update({ share_token: key }).eq('user_id', me()!).eq('id', id)
      fail(error)
    },
    /** A plan opened with its view link: anyone with the link can view it, signed in or not. */
    async byLink(owner: string, id: string, key: string): Promise<CloudRow | null> {
      const { data, error } = await sb.rpc('shared_project', { owner, project: id, token: key })
      fail(error)
      const r = (Array.isArray(data) ? data[0] : data) as { id: string; name: string; version: number; updated_at: string; data: Project } | undefined
      return r ? { ...toMeta(r), data: r.data } : null
    },
  }
}

export type SharingBackend = ReturnType<typeof sharingBackend>

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
    async get(id: string, _owner?: string) {
      self.check()
      const r = rows.get(id)
      return r ? structuredClone(r) : null
    },
    async version(id: string, _owner?: string) {
      self.check()
      return rows.get(id)?.version ?? null
    },
    async insert(p: Project) {
      self.check()
      if (rows.has(p.id)) throw new AlreadyExistsError('exists')
      rows.set(p.id, { id: p.id, name: p.name, version: 1, updatedAt: Date.now(), data: structuredClone(stored(p)) })
      return 1
    },
    async update(p: Project, expected: number, _owner?: string) {
      self.check()
      const r = rows.get(p.id)
      if (!r || r.version !== expected) return null
      rows.set(p.id, { id: p.id, name: p.name, version: expected + 1, updatedAt: Date.now(), data: structuredClone(stored(p)) })
      return expected + 1
    },
    async remove(id: string) {
      self.check()
      rows.delete(id)
    },
  }
  return self
}

/** Sharing in memory, over a memory backend's plans, for trying the sharing screens locally. */
export function memorySharing(mem: ReturnType<typeof memoryBackend>, me: () => { id: string; email?: string } | undefined): SharingBackend {
  const shares: { owner: string; id: string; email: string; role: ShareRole; ownerEmail?: string }[] = []
  const keys = new Map<string, string>()
  const mine = (owner: string, id: string) => (s: (typeof shares)[number]) => s.owner === owner && s.id === id && s.email === me()?.email
  return {
    async sharedWithMe() {
      return shares
        .filter((s) => s.email === me()?.email && s.owner !== me()?.id && mem.rows.has(s.id))
        .map((s) => ({ owner: s.owner, ownerEmail: s.ownerEmail, id: s.id, name: mem.rows.get(s.id)!.name, role: s.role, updatedAt: mem.rows.get(s.id)!.updatedAt }))
    },
    async roleFor(owner, id) {
      const s = shares.find(mine(owner, id))
      return s ? { role: s.role, ownerEmail: s.ownerEmail } : null
    },
    async list(id) {
      return shares.filter((s) => s.owner === me()?.id && s.id === id).map(({ email, role }) => ({ email, role }))
    },
    async share(id, email, role) {
      const s = shares.find((x) => x.owner === me()?.id && x.id === id && x.email === email)
      if (s) s.role = role
      else shares.push({ owner: me()!.id, id, email, role, ownerEmail: me()?.email })
    },
    async unshare(id, email) {
      const i = shares.findIndex((x) => x.owner === me()?.id && x.id === id && x.email === email)
      if (i >= 0) shares.splice(i, 1)
    },
    async leave(owner, id) {
      const i = shares.findIndex(mine(owner, id))
      if (i >= 0) shares.splice(i, 1)
    },
    async linkKey(id) {
      return keys.get(id) ?? null
    },
    async setLinkKey(id, key) {
      if (key) keys.set(id, key)
      else keys.delete(id)
    },
    async byLink(_owner, id, key) {
      const r = mem.rows.get(id)
      return r && keys.get(id) === key ? structuredClone(r) : null
    },
  }
}
