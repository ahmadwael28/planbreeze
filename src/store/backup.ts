/**
 * Backups: every plan in one file, to keep somewhere safe or take to another browser, and the plans put back from it.
 * The same file opens from "Open project file…", and the error screen can save one without the rest of the app.
 */
import { toast } from 'sonner'
import { t } from '@/i18n'
import { isProject } from '@/model/migrate'
import { uid } from '@/model/project'
import type { Project } from '@/model/types'
import { fetchCloudProject, listCloud } from '@/cloud/sync'
import { useCloud } from '@/cloud/store'
import { useEditor } from './editor'
import { leftBehindPlans, listProjects, listTrash, loadProject, plansOutOfReach, storeProject } from './storage'
import { useUi } from './ui'

export interface Backup {
  app: 'planbreeze'
  kind: 'backup'
  version: 1
  createdAt: number
  projects: Project[]
}

export const isBackup = (x: unknown): x is Backup => !!x && typeof x === 'object' && (x as Backup).kind === 'backup' && Array.isArray((x as Backup).projects)

const backup = (projects: Project[]): Backup => ({ app: 'planbreeze', kind: 'backup', version: 1, createdAt: Date.now(), projects })

/**
 * This browser's own plans (not those others shared, which stay theirs), and the open one as it is now (even if it
 * couldn't be saved here: the browser's full). `unread`: plans listed here that couldn't be read, so aren't in it. If
 * the plans can't be listed at all, it fails; `openOnly`, it has the open plan all the same (the error screen's).
 */
async function localPlans(openOnly = false): Promise<{ plans: Map<string, Project>; unread: number }> {
  const plans = new Map<string, Project>()
  const open = useEditor.getState().project
  let unread = 0
  let listed: Awaited<ReturnType<typeof listProjects>> = []
  try {
    // Out of reach, this browser's plans wouldn't be in it: better no backup than one that looks whole.
    if (plansOutOfReach()) throw new Error(t("Your plans in this browser can't be opened just now. Reload the page, then make the backup."))
    listed = await listProjects()
    // Those that couldn't be moved to the browser's new storage yet are in it too.
    for (const p of await leftBehindPlans()) if (!p.access) plans.set(p.id, p)
  } catch (e) {
    if (!openOnly) throw e
    console.error("Couldn't list the plans for the backup", e)
  }
  for (const m of listed) {
    if (m.shared || m.id === open.id) continue
    try {
      const p = await loadProject(m.id)
      if (p && (plans.get(p.id)?.updatedAt ?? -Infinity) < p.updatedAt) plans.set(p.id, p)
    } catch (e) {
      console.error("Couldn't read a plan for the backup", m.id, e)
      unread++
    }
  }
  if (!open.access) plans.set(open.id, open)
  return { plans, unread }
}

/** A backup of this browser's plans (the error screen's). */
export const localBackup = async () => backup([...(await localPlans(true)).plans.values()])

/**
 * A backup of every plan of this user's: this browser's, and the account's when signed in (each plan as last changed,
 * here or there). `missed`: plans in the account that couldn't be fetched, so aren't in it; `unlisted`: the account
 * couldn't be reached at all (offline), so it has this browser's plans only; `unread`: plans in this browser that
 * couldn't be read.
 */
export async function fullBackup(): Promise<{ backup: Backup; missed: number; unlisted: boolean; unread: number }> {
  const { plans, unread } = await localPlans()
  let missed = 0
  let unlisted = false
  if (useCloud.getState().user) {
    let account: Awaited<ReturnType<typeof listCloud>> = []
    try {
      account = await listCloud()
    } catch {
      unlisted = true
    }
    for (const c of account) {
      try {
        const p = await fetchCloudProject(c.id)
        const here = plans.get(c.id)
        if (p && (!here || p.updatedAt > here.updatedAt)) plans.set(p.id, p)
      } catch {
        missed++
      }
    }
  }
  return { backup: backup([...plans.values()]), missed, unlisted, unread }
}

export const backupName = () => `planbreeze-backup-${new Date().toISOString().slice(0, 10)}.json`

/** A plan's name as a file name (letters, digits, dashes and underscores). */
export const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'floorplan'

/** Hand a file over as a download (with nothing else of the app needed, for the error screen). */
export function download(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Save a backup: on a phone through its share sheet (to Files, or sent on), else as a download. */
export async function saveBackup(b: Backup) {
  const blob = new Blob([JSON.stringify(b)], { type: 'application/json' })
  try {
    const m = await import('@/utils/export')
    await m.saveBlob(blob, backupName())
  } catch {
    download(b, backupName())
  }
}

export interface Restored {
  /** Back as they were. */
  added: number
  /** Beside a different plan of the same id here, as copies. */
  copies: number
  /** Here already, unchanged. */
  same: number
}

/**
 * Put a backup's plans back in the list. One that isn't here comes back as it was (the same id, so the account knows
 * it); one that's here unchanged is left as it is; one that's here but different comes in beside it as a copy, so
 * nothing is overwritten.
 */
export async function restoreBackup(b: Backup): Promise<Restored> {
  const r: Restored = { added: 0, copies: 0, same: 0 }
  const trashed = new Set((await listTrash()).map((m) => m.id))
  const listed = new Map((await listProjects()).map((m) => [m.id, m]))
  for (const p of b.projects) {
    if (!isProject(p) || typeof p.id !== 'string') continue
    const here = listed.get(p.id)
    if (here && here.updatedAt === p.updatedAt) {
      r.same++
      continue
    }
    const clash = !!here || trashed.has(p.id)
    const plan: Project = clash ? { ...p, id: uid(), name: t('{name} (restored)', { name: p.name }), access: undefined } : { ...p, access: undefined }
    if (!(await storeProject(plan))) {
      throw new Error(t("There isn't room in this browser for every plan in the backup: {n} of them were put back.", { n: r.added + r.copies }))
    }
    listed.set(plan.id, { id: plan.id, name: plan.name, updatedAt: plan.updatedAt })
    if (clash) r.copies++
    else r.added++
  }
  return r
}

/** What a restore did, in words. */
export function restoredNote(r: Restored): string {
  const back = r.added + r.copies
  if (!back) return t('Every plan in this backup is here already.')
  const note = back === 1 ? t('1 plan put back from the backup.') : t('{n} plans put back from the backup.', { n: back })
  if (!r.copies) return note
  return `${note} ${r.copies === 1 ? t('1 came in as a copy, beside a different version that was here.') : t('{n} came in as copies, beside different versions that were here.', { n: r.copies })}`
}

/** A project file's plan, as a new plan (so nothing is overwritten), the opener's own. */
export function projectFromFile(data: unknown): Project {
  if (!isProject(data)) throw new Error(t('Not a valid floor plan file.'))
  const now = Date.now()
  return {
    ...data,
    id: uid(),
    access: undefined,
    units: data.units === 'imperial' ? 'imperial' : 'metric',
    defaultWallThickness: data.defaultWallThickness || 10,
    createdAt: now,
    updatedAt: now,
  }
}

/** A file opened: a project file (opened, as a new plan) or a backup (its plans put back in the list). */
export async function openProjectFile(file: File) {
  try {
    let data: unknown
    try {
      data = JSON.parse(await file.text())
    } catch {
      throw new Error(t('Not a valid floor plan file.'))
    }
    if (isBackup(data)) {
      toast.success(restoredNote(await restoreBackup(data)))
      useUi.getState().openProjects(true)
    } else {
      useEditor.getState().loadProject(projectFromFile(data))
      toast.success(t('Opened “{name}”', { name: file.name }))
    }
  } catch (e) {
    toast.error((e as Error).message)
  }
}
