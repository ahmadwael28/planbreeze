/**
 * Cloud sign-in and autosave.
 *
 * The app stays local-first: every change is saved on the device right away (see App). When
 * signed in, the open project is also saved to the cloud shortly after each change. Each
 * project carries a version number; a save only succeeds if the cloud is still at the version
 * this device last saw, so edits made on another device are detected instead of overwritten.
 *
 * Plans can be shared: with people by email (to view or edit), and with anyone who has the view
 * link. Someone else's plan opened this way carries `access`; editors save over the owner's plan
 * (with the same version check), viewers never save.
 */
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { toast } from 'sonner'
import { t } from '@/i18n'
import { uid } from '@/model/project'
import { sampleProject } from '@/model/sample'
import type { Project, ProjectAccess } from '@/model/types'
import { useEditor } from '@/store/editor'
import { clearPlans, deleteProject, isGone, listProjects, loadProject, saveProject, storeProject } from '@/store/storage'
import { AlreadyExistsError, memoryBackend, memorySharing, sharingBackend, supabaseBackend } from './backend'
import type { CloudBackend, CloudMeta, CloudRow, SharedPlan, SharingBackend } from './backend'
import { cloudConfig, useCloud } from './store'
import type { CloudUser } from './store'

export type OAuthProvider = 'google' | 'github'

let supabase: SupabaseClient | null = null
let backend: CloudBackend | null = null
let sharing: SharingBackend | null = null
const me = () => useCloud.getState().user?.id

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
  if (p.access && p.access.role !== 'editor') return
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
  if (p.access && p.access.role !== 'editor') return
  if (isGone(p.id)) return
  const meta = synced[p.id]
  if (meta && p.updatedAt <= meta.updatedAt) {
    set({ saveState: 'saved', error: null })
    return
  }
  inFlight = true
  set({ saveState: 'saving' })
  try {
    let version: number | null
    if (p.access) {
      // Someone else's plan: only ever saved over theirs.
      const owner = p.access.owner
      version = meta ? await backend.update(p, meta.version, owner) : null
      if (version === null) {
        if ((await backend.version(p.id, owner)) !== null) return await showConflict(p)
        return lostAccess(p)
      }
    } else if (!meta) {
      try {
        version = await backend.insert(p)
      } catch (e) {
        if (e instanceof AlreadyExistsError) return await showConflict(p)
        throw e
      }
    } else {
      version = await backend.update(p, meta.version)
      if (version === null) {
        // Either changed elsewhere, or deleted elsewhere (then just recreate it, unless it was deleted here).
        if ((await backend.version(p.id)) !== null) return await showConflict(p)
        if (isGone(p.id)) return
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
  const remote = await backend!.get(p.id, p.access?.owner)
  if (!remote) return
  if (p.access) remote.data = { ...remote.data, access: p.access }
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
    void saveProject(c.remote.data)
    useEditor.getState().loadProject(c.remote.data)
  }
}

/**
 * Check the open project against the cloud: upload it if it isn't there, pull newer changes
 * made on another device, or ask when both sides changed.
 */
export async function reconcile(): Promise<void> {
  if (!backend || !useCloud.getState().user) return
  const p = useEditor.getState().project
  if (p.access) return reconcileShared(p)
  const meta = synced[p.id]
  try {
    const remoteVersion = await backend.version(p.id)
    if (remoteVersion === null) return schedule(0)
    // A copy here older than the one this device last synced (put back from a backup) is no longer in step with it.
    const stale = !!meta && p.updatedAt < meta.updatedAt
    if (meta && meta.version === remoteVersion && !stale) return schedule(0)
    const remote = await backend.get(p.id)
    if (!remote) return schedule(0)
    const unsynced = !meta || stale || p.updatedAt > meta.updatedAt
    if (!meta && remote.data.updatedAt === p.updatedAt) {
      synced[p.id] = { version: remote.version, updatedAt: p.updatedAt }
      persistSynced()
      set({ saveState: 'saved', lastSaved: remote.updatedAt })
    } else if (!unsynced) {
      synced[p.id] = { version: remote.version, updatedAt: remote.data.updatedAt }
      persistSynced()
      void saveProject(remote.data)
      useEditor.getState().loadProject(remote.data)
      set({ saveState: 'saved', lastSaved: remote.updatedAt })
      toast(t('Loaded the latest version of this plan from your account.'))
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
  } else if (!user) {
    synced = {}
    set({ user: null, ready: true, saveState: 'local', conflict: null, error: null, lastSaved: null })
  } else {
    loadSynced(user.id)
    set({ user, ready: true, saveState: 'saving', signInOpen: false, signInNote: null })
    await reconcile()
    if (sessionStorage.getItem(JUST_SIGNED_IN)) {
      sessionStorage.removeItem(JUST_SIGNED_IN)
      await welcome(user)
    }
  }
  await openPendingShare()
}

/** After signing in: say where work is saved, and offer to upload plans kept only on this device. */
async function welcome(user: CloudUser) {
  let local: Awaited<ReturnType<typeof listProjects>> = []
  try {
    const inCloud = new Set((await backend!.list()).map((m) => m.id))
    const open = useEditor.getState().project.id
    local = (await listProjects()).filter((m) => !inCloud.has(m.id) && m.id !== open && !m.shared)
  } catch {
    // listing failed; skip the offer
  }
  const who = user.name || user.email || t('your account')
  if (local.length) {
    toast.success(t('Signed in as {who}. This plan now saves to your account.', { who }), {
      duration: 12000,
      description: local.length === 1 ? t('1 other plan is only on this device.') : t('{n} other plans are only on this device.', { n: local.length }),
      action: { label: t('Upload them'), onClick: () => void uploadLocal(local.map((m) => m.id)) },
    })
  } else {
    toast.success(t('Signed in as {who}. Your plans now save to your account.', { who }))
  }
}

function redirectUrl() {
  // Come back to the same page (e.g. https://user.github.io/planbreeze/), without query or hash.
  return window.location.origin + window.location.pathname
}

export async function signInWithProvider(provider: OAuthProvider) {
  if (!supabase) throw new Error(t('Cloud sign-in is not configured.'))
  sessionStorage.setItem(JUST_SIGNED_IN, '1')
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: redirectUrl() } })
  if (error) {
    sessionStorage.removeItem(JUST_SIGNED_IN)
    throw new Error(error.message)
  }
}

export async function signInWithEmail(email: string) {
  if (!supabase) throw new Error(t('Cloud sign-in is not configured.'))
  sessionStorage.setItem(JUST_SIGNED_IN, '1')
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl() } })
  if (error) throw new Error(error.message)
}

/**
 * Sign out. With `clearDevice`, also remove this user's plans from this browser (shared computers): the deleted ones
 * kept to be put back too, and the rest of theirs kept here (the AI key, a plan link waiting for sign-in, design
 * choices); only once every change to their account's plans is in the account, so nothing's lost. If the server can't
 * be reached, signed out on this device all the same.
 */
export async function signOut(clearDevice = false) {
  const uid = useCloud.getState().user?.id
  for (let i = 0; inFlight && i < 40; i++) await new Promise((r) => setTimeout(r, 250))
  clearTimeout(timer)
  await saveNow().catch(() => {})
  if (clearDevice && uid) {
    // This device's copies changed since they were last saved to the account.
    const behind = (await listProjects()).filter((m) => !m.shared && synced[m.id] && m.updatedAt > synced[m.id].updatedAt)
    if (behind.length || useCloud.getState().conflict) {
      toast.error(
        t("Some changes here aren't in your account yet, so nothing was removed and you're still signed in. Check your connection, then try again."),
        { duration: 10000 },
      )
      return
    }
  }
  let forget = false
  if (supabase) {
    const { error } = await supabase.auth.signOut()
    forget = !!error
  }
  await onSession(null)
  if (forget) {
    // The server couldn't be told: the session goes from this browser all the same.
    for (const k of Object.keys(localStorage)) if (/^sb-.+-auth-token/.test(k)) localStorage.removeItem(k)
  }
  if (clearDevice) {
    await clearPlans()
    for (const k of ['fp.anthropicKey', PENDING_SHARE, 'planbreeze.design']) localStorage.removeItem(k)
    if (uid) localStorage.removeItem(syncedKey(uid))
    await saveProject(sampleProject())
  }
  // Nothing of theirs left in memory either (the session, the AI key in the import wizard, design choices).
  if (forget || clearDevice) window.location.assign(window.location.origin + window.location.pathname)
}

// ---------------------------------------------------------------------------
// Project list helpers (Projects dialog)

export async function listCloud(): Promise<CloudMeta[]> {
  if (!backend || !useCloud.getState().user) return []
  return backend.list()
}

/** A plan in the account as it's saved there (for a backup, or a copy kept as it's deleted). */
export async function fetchCloudProject(id: string): Promise<Project | null> {
  if (!backend || !useCloud.getState().user) return null
  return (await backend.get(id))?.data ?? null
}

export async function openCloudProject(id: string) {
  if (!backend) return
  const remote = await backend.get(id)
  if (!remote) throw new Error(t('That plan is no longer in your account.'))
  synced[id] = { version: remote.version, updatedAt: remote.data.updatedAt }
  persistSynced()
  void saveProject(remote.data)
  useEditor.getState().loadProject(remote.data)
}

export async function deleteCloudProject(id: string) {
  if (!backend) return
  for (let i = 0; inFlight && i < 40; i++) await new Promise((r) => setTimeout(r, 250))
  if (useEditor.getState().project.id === id) clearTimeout(timer)
  await backend.remove(id)
  delete synced[id]
  persistSynced()
}

/**
 * Rename a plan that isn't open: in the account, and this device's copy if there is one. A copy here with changes the
 * account doesn't have is renamed here only (it goes up with them when the plan's next opened). One that isn't in step
 * with the account (never synced here, as one put back from a backup, or older than what was synced, after an undo)
 * may hold other changes: each copy is renamed, keeping its own, and opening the plan asks which to keep.
 */
export async function renameCloudProject(id: string, name: string) {
  if (!backend) return
  const here = (await listProjects()).find((m) => m.id === id)
  const s = synced[id]
  if (here && s && here.updatedAt > s.updatedAt) {
    const p = await loadProject(id)
    if (p) {
      await storeProject({ ...p, name, updatedAt: Date.now() })
      return
    }
  }
  const remote = await backend.get(id)
  if (!remote) throw new Error(t('That plan is no longer in your account.'))
  const data = { ...remote.data, name, updatedAt: Date.now() }
  const version = await backend.update(data, remote.version)
  if (version === null) throw new Error(t('The plan changed on another device. Open it and rename it there.'))
  if (here && !(s && here.updatedAt === s.updatedAt)) {
    const p = await loadProject(id)
    if (p) await storeProject({ ...p, name })
    return
  }
  synced[id] = { version, updatedAt: data.updatedAt }
  persistSynced()
  if (here) await storeProject(data)
}

/** Upload plans that are only on this device. Returns how many were uploaded. */
export async function uploadLocal(ids: string[], quiet = false) {
  if (!backend) return 0
  let n = 0
  for (const id of ids) {
    let p: Project | null = null
    try {
      p = await loadProject(id)
    } catch (e) {
      // One this browser can't read is left out; the rest go up.
      console.error("Couldn't read a plan to upload", id, e)
      continue
    }
    if (!p || p.access) continue
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
  if (!quiet) toast.success(n === 1 ? t('Uploaded 1 plan to your account.') : t('Uploaded {n} plans to your account.', { n }))
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
  backend = supabaseBackend(supabase, me)
  sharing = sharingBackend(supabase, me)

  // A shared plan's link (?plan=…&owner=…&key=…): opened once sign-in is restored (see openPendingShare).
  const url = new URL(window.location.href)
  const plan = url.searchParams.get('plan')
  const owner = url.searchParams.get('owner')
  if (plan && owner) {
    const link: PendingShare = { id: plan, owner, key: url.searchParams.get('key') || undefined, at: Date.now() }
    try {
      localStorage.setItem(PENDING_SHARE, JSON.stringify(link))
    } catch {
      // storage blocked: the link just won't open
    }
    for (const k of ['plan', 'owner', 'key']) url.searchParams.delete(k)
    window.history.replaceState(window.history.state, '', url.toString())
  }

  // A cancelled or failed sign-in comes back as ?error=…&error_description=…
  const err = url.searchParams.get('error_description') || url.searchParams.get('error')
  if (err) {
    sessionStorage.removeItem(JUST_SIGNED_IN)
    toast.error(t("Sign-in didn't complete: {error}", { error: err }))
    for (const k of ['error', 'error_code', 'error_description']) url.searchParams.delete(k)
    window.history.replaceState(window.history.state, '', url.toString())
  }

  // Supabase recommends not calling its API inside this callback, so defer the work.
  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => void onSession(session), 0)
  })
}

// ---------------------------------------------------------------------------
// Sharing

const PENDING_SHARE = 'fp.pendingShare'
/** How long a shared link waits for its user to sign in (e.g. through an email link, in another tab). */
const PENDING_FOR = 24 * 3600 * 1000

interface PendingShare {
  owner: string
  id: string
  key?: string
  at: number
}

/** The sharing API, for the signed-in user. */
export function sharingApi(): SharingBackend {
  if (!sharing || !me()) throw new Error(t('Sign in to share plans.'))
  return sharing
}

/** The link to one of this user's plans: for the people it's shared with, and with the view key, for anyone. */
export function shareLink(id: string, key?: string | null) {
  const u = new URL(redirectUrl())
  u.searchParams.set('plan', id)
  u.searchParams.set('owner', me() ?? '')
  if (key) u.searchParams.set('key', key)
  return u.toString()
}

/** Make sure the open plan is saved in the account (it has to be there to be shared). */
export async function ensureInCloud() {
  if (!backend || !me()) throw new Error(t('Sign in to share plans.'))
  if (useCloud.getState().conflict) throw new Error(t('First choose which version of this plan to keep.'))
  for (let i = 0; inFlight && i < 40; i++) await new Promise((r) => setTimeout(r, 250))
  clearTimeout(timer)
  await saveNow()
  const id = useEditor.getState().project.id
  if (!synced[id]) throw new Error(useCloud.getState().error ?? t("This plan isn't saved to your account yet. Check your connection and try again."))
}

/** Change what this user may do with the open plan (no undo step, and nothing to save). */
function setAccess(access: ProjectAccess | undefined) {
  useEditor.setState((s) => ({ project: { ...s.project, access } }))
}

/** The open plan isn't shared with this user any more: it stays on this device, to view. */
function lostAccess(p: Project) {
  if (p.access?.role !== 'viewer') setAccess(p.access && { ...p.access, role: 'viewer' })
  set({ saveState: 'error', error: t("this plan isn't shared with you any more") })
  toast.error(t("This plan isn't shared with you any more. Your copy stays on this device to view; make a copy to keep working on it."), {
    duration: 10000,
  })
}

/** Someone else's plan, opened: pick up the owner's latest changes, and what this user may do with it now. */
async function reconcileShared(p: Project): Promise<void> {
  const a = p.access!
  if (!backend || !sharing) return
  if (a.owner === me()) {
    // This user's own plan, opened with its link before signing in.
    setAccess(undefined)
    return reconcile()
  }
  try {
    let found = await sharing.roleFor(a.owner, p.id)
    let version = found ? await backend.version(p.id, a.owner) : null
    let byLink: CloudRow | null = null
    if (version === null && a.key) {
      byLink = await sharing.byLink(a.owner, p.id, a.key)
      if (byLink) {
        found = { role: 'viewer', ownerEmail: a.ownerEmail }
        version = byLink.version
      }
    }
    if (!found || version === null) return lostAccess(p)
    const access: ProjectAccess = { ...a, role: found.role, ownerEmail: found.ownerEmail ?? a.ownerEmail }
    const meta = synced[p.id]
    const unsynced = !!meta && p.updatedAt > meta.updatedAt && access.role === 'editor'
    if (meta && meta.version === version) {
      if (access.role !== a.role || access.ownerEmail !== a.ownerEmail) setAccess(access)
      set({ saveState: 'saved', error: null })
      if (unsynced) schedule(0)
      return
    }
    const remote = byLink ?? (await backend.get(p.id, a.owner))
    if (!remote) return lostAccess(p)
    const data: Project = { ...remote.data, access }
    if (unsynced) {
      set({ saveState: 'conflict', conflict: { projectId: p.id, remote: { ...remote, data } } })
      return
    }
    synced[p.id] = { version: remote.version, updatedAt: data.updatedAt }
    persistSynced()
    void saveProject(data)
    useEditor.getState().loadProject(data)
    set({ saveState: 'saved', lastSaved: remote.updatedAt, error: null })
  } catch (e) {
    fail(e)
  }
}

/**
 * Open a plan someone shared: with this user by email (to view or edit), or with anyone who has its view link (`key`).
 * This user's own plans just open.
 */
export async function openSharedProject(owner: string, id: string, key?: string) {
  if (!backend || !sharing) throw new Error(t('Cloud sign-in is not configured.'))
  const user = useCloud.getState().user
  if (user && owner === user.id) return openCloudProject(id)
  // This device already has it as its own plan (e.g. its owner, signed out, followed its link): open that.
  const own = await loadProject(id)
  if (own && !own.access) return useEditor.getState().loadProject(own)
  let found = user ? await sharing.roleFor(owner, id) : null
  let remote = found ? await backend.get(id, owner) : null
  if (!remote && key) {
    remote = await sharing.byLink(owner, id, key)
    found = remote ? { role: 'viewer' } : null
  }
  if (!remote || !found) {
    throw new Error(
      user
        ? t("This plan isn't shared with {who}. Ask its owner to share it with that address, or sign in with the one they used.", { who: user.email ?? t('your account') })
        : t('Sign in to open this plan.'),
    )
  }
  const access: ProjectAccess = { owner, ownerEmail: found.ownerEmail, role: found.role, ...(key ? { key } : {}) }
  const data: Project = { ...remote.data, access }
  if (user) {
    synced[id] = { version: remote.version, updatedAt: data.updatedAt }
    persistSynced()
  }
  void saveProject(data)
  useEditor.getState().loadProject(data)
}

/** Open the shared plan whose link brought the user here, once sign-in is restored (or after they sign in). */
async function openPendingShare() {
  let link: PendingShare | null = null
  try {
    link = JSON.parse(localStorage.getItem(PENDING_SHARE) || 'null') as PendingShare | null
  } catch {
    link = null
  }
  if (!link) return
  if (Date.now() - link.at > PENDING_FOR) return localStorage.removeItem(PENDING_SHARE)
  if (!useCloud.getState().user && !link.key) {
    // Shared with people by email: they sign in first, and the link waits for them.
    useCloud.getState().openSignIn(true, t('Sign in with the email address this plan was shared with to open it.'))
    return
  }
  localStorage.removeItem(PENDING_SHARE)
  try {
    await openSharedProject(link.owner, link.id, link.key)
    const p = useEditor.getState().project
    if (p.access) {
      const who = p.access.ownerEmail
      const view = p.access.role === 'viewer'
      toast.success(
        who
          ? view
            ? t('Opened “{name}”, shared by {email} for you to view.', { name: p.name, email: who })
            : t('Opened “{name}”, shared by {email}. Your changes save to it.', { name: p.name, email: who })
          : view
            ? t('Opened “{name}”, shared for you to view.', { name: p.name })
            : t('Opened “{name}”, shared with you. Your changes save to it.', { name: p.name }),
      )
    }
  } catch (e) {
    toast.error((e as Error).message, { duration: 10000 })
  }
}

/** Forget a shared plan's link that's waiting for sign-in, unless a sign-in is under way (e.g. an email link). */
export function dismissPendingShare() {
  if (!sessionStorage.getItem(JUST_SIGNED_IN)) localStorage.removeItem(PENDING_SHARE)
}

/** Plans other people shared with this user. */
export async function listSharedWithMe(): Promise<SharedPlan[]> {
  if (!sharing || !useCloud.getState().user) return []
  return sharing.sharedWithMe()
}

/** Stop seeing a plan someone shared (it's removed from this device too). */
export async function leaveSharedProject(owner: string, id: string) {
  if (sharing && useCloud.getState().user) await sharing.leave(owner, id)
  await deleteProject(id)
  delete synced[id]
  persistSynced()
}

/** Make the open plan this user's own: a copy of it, opened (e.g. to change a plan shared to view). */
export function makeOwnCopy() {
  const p = useEditor.getState().project
  const now = Date.now()
  const { access: _access, ...rest } = structuredClone(p)
  const copy: Project = { ...rest, id: uid(), name: t('{name} (copy)', { name: p.name }), createdAt: now, updatedAt: now }
  void saveProject(copy)
  useEditor.getState().loadProject(copy)
  toast.success(t("Made a copy: “{name}”. It's yours to change.", { name: copy.name }))
}

/** Development only: run the sync engine against an in-memory cloud with a fake user. */
export function connectMemoryCloudForTesting() {
  const mem = memoryBackend()
  backend = mem
  sharing = memorySharing(mem, () => useCloud.getState().user ?? undefined)
  synced = {}
  set({ configured: true, ready: true, user: { id: 'test-user', name: 'Test user', email: 'owner@example.com' }, saveState: 'saving' })
  void reconcile()
  return mem
}
