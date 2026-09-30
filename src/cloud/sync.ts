/**
 * Cloud sign-in and autosave.
 *
 * The app stays local-first: every change is saved on the device right away (see App). When
 * signed in, the open project is also saved to the cloud shortly after each change. Each
 * project carries a version number; a save only succeeds if the cloud is still at the version
 * this device last saw, so edits made on another device are detected instead of overwritten.
 */
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { toast } from 'sonner'
import { sampleProject } from '@/model/sample'
import type { Project } from '@/model/types'
import { useEditor } from '@/store/editor'
import { listProjects, loadProject, saveProject } from '@/store/storage'
import { AlreadyExistsError, memoryBackend, supabaseBackend } from './backend'
import type { CloudBackend, CloudMeta } from './backend'
import { cloudConfig, useCloud } from './store'
import type { CloudUser } from './store'

export type OAuthProvider = 'google' | 'github'

let supabase: SupabaseClient | null = null
let backend: CloudBackend | null = null

/** What this device last synced for each project: cloud version and the local updatedAt it matched. */
type Synced = Record<string, { version: number; updatedAt: number }>
let synced: Synced = {}
const syncedKey = (uid: string) => `fp.cloud.${uid}`
const JUST_SIGNED_IN = 'fp.justSignedIn'
const SAVE_DELAY = 1500

function loadSynced(uid: string) {
  try {
    synced = JSON.parse(localStorage.getItem(syncedKey(uid)) || '{}') as Synced
  } catch {
    synced = {}
  }
}
function persistSynced() {
  const uid = useCloud.getState().user?.id
  if (!uid) return
  try {
    localStorage.setItem(syncedKey(uid), JSON.stringify(synced))
  } catch {
    // storage full: sync still works for this session
  }
}

const set = useCloud.setState
const isNetworkError = (e: unknown) => !navigator.onLine || (e instanceof TypeError && /fetch|network/i.test(e.message))

function fail(e: unknown) {
  if (isNetworkError(e)) set({ saveState: 'offline', error: null })
  else set({ saveState: 'error', error: e instanceof Error ? e.message : String(e) })
}

function toUser(session: Session | null): CloudUser | null {
  const u = session?.user
  if (!u) return null
  const m = u.user_metadata ?? {}
  return {
    id: u.id,
    email: u.email,
    name: (m.full_name as string) || (m.name as string) || (m.user_name as string) || undefined,
    avatar: (m.avatar_url as string) || (m.picture as string) || undefined,
    provider: u.app_metadata?.provider as string | undefined,
  }
}

// ---------------------------------------------------------------------------
// Saving

let timer: ReturnType<typeof setTimeout> | undefined
let inFlight = false
let again = false

function schedule(delay = SAVE_DELAY) {
  if (!backend || !useCloud.getState().user) return
  const { saveState, conflict } = useCloud.getState()
  if (conflict) return
  // Nothing new since the last cloud save (e.g. a plan was just loaded from the cloud).
  const p = useEditor.getState().project
  const meta = synced[p.id]
  if (meta && p.updatedAt <= meta.updatedAt) {
    if (saveState === 'saving') set({ saveState: 'saved' })
    return
  }
  if (saveState !== 'offline' || navigator.onLine) set({ saveState: 'saving' })
  clearTimeout(timer)
  timer = setTimeout(() => void saveNow(), delay)
}

/** Save the open project to the cloud if it has changes the cloud doesn't. */
export async function saveNow(): Promise<void> {
  if (!backend || !useCloud.getState().user || useCloud.getState().conflict) return
  if (inFlight) {
    again = true
    return
  }
  const p = useEditor.getState().project
  const meta = synced[p.id]
  if (meta && p.updatedAt <= meta.updatedAt) {
    set({ saveState: 'saved', error: null })
    return
  }
  inFlight = true
  set({ saveState: 'saving' })
  try {
    let version: number | null
    if (!meta) {
      try {
        version = await backend.insert(p)
      } catch (e) {
        if (e instanceof AlreadyExistsError) return await showConflict(p)
        throw e
      }
    } else {
      version = await backend.update(p, meta.version)
      if (version === null) {
        // Either changed elsewhere, or deleted elsewhere (then just recreate it).
        if ((await backend.version(p.id)) !== null) return await showConflict(p)
        version = await backend.insert(p)
      }
    }
    synced[p.id] = { version, updatedAt: p.updatedAt }
    persistSynced()
    set({ saveState: 'saved', lastSaved: Date.now(), error: null })
  } catch (e) {
    fail(e)
  } finally {
    inFlight = false
    if (again) {
      again = false
      schedule(300)
    }
  }
}

async function showConflict(p: Project) {
  const remote = await backend!.get(p.id)
  if (!remote) return
  set({ saveState: 'conflict', conflict: { projectId: p.id, remote } })
}

/** Resolve an edit conflict: keep this device's version, or take the cloud's. */
export async function resolveConflict(keep: 'mine' | 'theirs') {
  const c = useCloud.getState().conflict
  if (!c) return
  if (keep === 'mine') {
    synced[c.projectId] = { version: c.remote.version, updatedAt: 0 }
    set({ conflict: null })
    await saveNow()
  } else {
    synced[c.projectId] = { version: c.remote.version, updatedAt: c.remote.data.updatedAt }
    persistSynced()
    set({ conflict: null, saveState: 'saved', lastSaved: Date.now() })
    saveProject(c.remote.data)
    useEditor.getState().loadProject(c.remote.data)
  }
}

/**
 * Check the open project against the cloud: upload it if it isn't there, pull newer changes
 * made on another device, or ask when both sides changed.
 */
export async function reconcile() {
  if (!backend || !useCloud.getState().user) return
  const p = useEditor.getState().project
  const meta = synced[p.id]
  try {
    const remoteVersion = await backend.version(p.id)
    if (remoteVersion === null) return schedule(0)
    if (meta && meta.version === remoteVersion) return schedule(0)
    const remote = await backend.get(p.id)
    if (!remote) return schedule(0)
    const unsynced = !meta || p.updatedAt > meta.updatedAt
    if (!meta && remote.data.updatedAt === p.updatedAt) {
      synced[p.id] = { version: remote.version, updatedAt: p.updatedAt }
      persistSynced()
      set({ saveState: 'saved', lastSaved: remote.updatedAt })
    } else if (!unsynced) {
      synced[p.id] = { version: remote.version, updatedAt: remote.data.updatedAt }
      persistSynced()
      saveProject(remote.data)
      useEditor.getState().loadProject(remote.data)
      set({ saveState: 'saved', lastSaved: remote.updatedAt })
      toast('Loaded the latest version of this plan from your account.')
    } else {
      set({ saveState: 'conflict', conflict: { projectId: p.id, remote } })
    }
  } catch (e) {
    fail(e)
  }
}

function startAutosave() {
  useEditor.subscribe((s, prev) => {
    if (s.project === prev.project) return
    if (s.project.id !== prev.project.id) {
      if (useCloud.getState().conflict?.projectId === prev.project.id) set({ conflict: null })
      void reconcile()
    } else {
      schedule()
    }
  })
  window.addEventListener('online', () => {
    if (useCloud.getState().user) void reconcile()
  })
  window.addEventListener('offline', () => {
    if (useCloud.getState().user) set({ saveState: 'offline' })
  })
  // Push pending changes when the tab is hidden (switching apps, closing the laptop).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timer) {
      clearTimeout(timer)
      void saveNow()
    }
  })
}

// ---------------------------------------------------------------------------
// Auth

async function onSession(session: Session | null) {
  const user = toUser(session)
  const prev = useCloud.getState().user
  if (user?.id === prev?.id) {
    set({ ready: true })
    return
  }
  if (!user) {
    synced = {}
    set({ user: null, ready: true, saveState: 'local', conflict: null, error: null, lastSaved: null })
    return
  }
  loadSynced(user.id)
  set({ user, ready: true, saveState: 'saving', signInOpen: false })
  await reconcile()
  if (sessionStorage.getItem(JUST_SIGNED_IN)) {
    sessionStorage.removeItem(JUST_SIGNED_IN)
    await welcome(user)
  }
}

/** After signing in: say where work is saved, and offer to upload plans kept only on this device. */
async function welcome(user: CloudUser) {
  let local: ReturnType<typeof listProjects> = []
  try {
    const inCloud = new Set((await backend!.list()).map((m) => m.id))
    const open = useEditor.getState().project.id
    local = listProjects().filter((m) => !inCloud.has(m.id) && m.id !== open)
  } catch {
    // listing failed; skip the offer
  }
  const who = user.name || user.email || 'your account'
  if (local.length) {
    toast.success(`Signed in as ${who}. This plan now saves to your account.`, {
      duration: 12000,
      description: `${local.length} other plan${local.length === 1 ? ' is' : 's are'} only on this device.`,
      action: { label: 'Upload them', onClick: () => void uploadLocal(local.map((m) => m.id)) },
    })
  } else {
    toast.success(`Signed in as ${who}. Your plans now save to your account.`)
  }
}

function redirectUrl() {
  // Come back to the same page (e.g. https://user.github.io/planbreeze/), without query or hash.
  return window.location.origin + window.location.pathname
}

export async function signInWithProvider(provider: OAuthProvider) {
  if (!supabase) throw new Error('Cloud sign-in is not configured.')
  sessionStorage.setItem(JUST_SIGNED_IN, '1')
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: redirectUrl() } })
  if (error) {
    sessionStorage.removeItem(JUST_SIGNED_IN)
    throw new Error(error.message)
  }
}

export async function signInWithEmail(email: string) {
  if (!supabase) throw new Error('Cloud sign-in is not configured.')
  sessionStorage.setItem(JUST_SIGNED_IN, '1')
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl() } })
  if (error) throw new Error(error.message)
}

/** Sign out. With `clearDevice`, also remove this user's plans from this browser (shared computers). */
export async function signOut(clearDevice = false) {
  const uid = useCloud.getState().user?.id
  clearTimeout(timer)
  await saveNow().catch(() => {})
  if (supabase) await supabase.auth.signOut()
  await onSession(null)
  if (clearDevice) {
    for (const m of listProjects()) localStorage.removeItem(`fp.project.${m.id}`)
    for (const k of ['fp.projects', 'fp.lastProject']) localStorage.removeItem(k)
    if (uid) localStorage.removeItem(syncedKey(uid))
    const p = sampleProject()
    saveProject(p)
    useEditor.getState().loadProject(p)
  }
}

// ---------------------------------------------------------------------------
// Project list helpers (Projects dialog)

export async function listCloud(): Promise<CloudMeta[]> {
  if (!backend || !useCloud.getState().user) return []
  return backend.list()
}

export async function openCloudProject(id: string) {
  if (!backend) return
  const remote = await backend.get(id)
  if (!remote) throw new Error('That plan is no longer in your account.')
  synced[id] = { version: remote.version, updatedAt: remote.data.updatedAt }
  persistSynced()
  saveProject(remote.data)
  useEditor.getState().loadProject(remote.data)
}

export async function deleteCloudProject(id: string) {
  if (!backend) return
  await backend.remove(id)
  delete synced[id]
  persistSynced()
}

/** Rename a plan that isn't open: in the account (and this device's copy, if there is one). */
export async function renameCloudProject(id: string, name: string) {
  if (!backend) return
  const remote = await backend.get(id)
  if (!remote) throw new Error('That plan is no longer in your account.')
  const data = { ...remote.data, name, updatedAt: Date.now() }
  const version = await backend.update(data, remote.version)
  if (version === null) throw new Error('The plan changed on another device. Open it and rename it there.')
  synced[id] = { version, updatedAt: data.updatedAt }
  persistSynced()
  if (loadProject(id)) saveProject(data)
}

/** Upload plans that are only on this device. Returns how many were uploaded. */
export async function uploadLocal(ids: string[]) {
  if (!backend) return 0
  let n = 0
  for (const id of ids) {
    const p = loadProject(id)
    if (!p) continue
    try {
      const version = await backend.insert(p)
      synced[id] = { version, updatedAt: p.updatedAt }
      n++
    } catch (e) {
      if (!(e instanceof AlreadyExistsError)) {
        fail(e)
        break
      }
    }
  }
  persistSynced()
  toast.success(`Uploaded ${n} plan${n === 1 ? '' : 's'} to your account.`)
  return n
}

export const isSynced = (id: string) => !!synced[id]

// ---------------------------------------------------------------------------

let started = false

export async function initCloud() {
  if (started) return
  started = true
  startAutosave()
  if (!cloudConfig) return
  const { createClient } = await import('@supabase/supabase-js')
  supabase = createClient(cloudConfig.url, cloudConfig.key, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  })
  backend = supabaseBackend(supabase)

  // A cancelled or failed sign-in comes back as ?error=…&error_description=…
  const url = new URL(window.location.href)
  const err = url.searchParams.get('error_description') || url.searchParams.get('error')
  if (err) {
    sessionStorage.removeItem(JUST_SIGNED_IN)
    toast.error(`Sign-in didn't complete: ${err}`)
    for (const k of ['error', 'error_code', 'error_description']) url.searchParams.delete(k)
    window.history.replaceState(window.history.state, '', url.toString())
  }

  // Supabase recommends not calling its API inside this callback, so defer the work.
  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => void onSession(session), 0)
  })
}

/** Development only: run the sync engine against an in-memory cloud with a fake user. */
export function connectMemoryCloudForTesting() {
  const mem = memoryBackend()
  backend = mem
  synced = {}
  set({ configured: true, ready: true, user: { id: 'test-user', name: 'Test user' }, saveState: 'saving' })
  void reconcile()
  return mem
}
