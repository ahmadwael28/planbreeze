/**
 * Backups: every plan in one file, to keep somewhere safe or take to another browser, and the plans put back from it.
 * The same file opens from "Open project file…", and the error screen can save one without the rest of the app.
 */
import { toast } from 'sonner'
import { t } from '@/i18n'
import { uid } from '@/model/project'
import type { Project } from '@/model/types'
import { fetchCloudProject, listCloud } from '@/cloud/sync'
import { useCloud } from '@/cloud/store'
import { useEditor } from './editor'
import { listProjects, listTrash, loadProject, storeProject } from './storage'
import { useUi } from './ui'

export interface Backup {
  app: 'planbreeze'
  kind: 'backup'
  version: 1
  createdAt: number
  projects: Project[]
}

export const isBackup = (x: unknown): x is Backup => !!x && typeof x === 'object' && (x as Backup).kind === 'backup' && Array.isArray((x as Backup).projects)

/** Whether it looks like a plan: floors, each with its rooms and items. */
function isProject(x: unknown): x is Project {
  const p = x as Project
  return !!p && typeof p === 'object' && Array.isArray(p.floors) && p.floors.length > 0 && p.floors.every((f) => !!f && Array.isArray(f.rooms) && Array.isArray(f.symbols))
}

const backup = (projects: Project[]): Backup => ({ app: 'planbreeze', kind: 'backup', version: 1, createdAt: Date.now(), projects })

/**
 * This browser's own plans (not those others shared, which stay theirs), and the open one as it is now (even if it
 * couldn't be saved here: the browser's full).
 */
function localPlans(): Map<string, Project> {
  const plans = new Map<string, Project>()
  for (const m of listProjects()) {
    if (m.shared) continue
    const p = loadProject(m.id)
    if (p) plans.set(p.id, p)
  }
  const open = useEditor.getState().project
  if (!open.access) plans.set(open.id, open)
  return plans
}

/** A backup of this browser's plans, straight away (the error screen's). */
export const localBackup = () => backup([...localPlans().values()])

/**
 * A backup of every plan of this user's: this browser's, and the account's when signed in (each plan as last changed,
 * here or there). `missed`: plans in the account that couldn't be fetched, so aren't in it; `unlisted`: the account
 * couldn't be reached at all (offline), so it has this browser's plans only.
 */
export async function fullBackup(): Promise<{ backup: Backup; missed: number; unlisted: boolean }> {
  const plans = localPlans()
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
  return { backup: backup([...plans.values()]), missed, unlisted }
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
export function restoreBackup(b: Backup): Restored {
  const r: Restored = { added: 0, copies: 0, same: 0 }
  const trashed = new Set(listTrash().map((m) => m.id))
  for (const p of b.projects) {
    if (!isProject(p) || typeof p.id !== 'string') continue
    const here = loadProject(p.id)
    if (here && here.updatedAt === p.updatedAt) {
      r.same++
      continue
    }
    const clash = !!here || trashed.has(p.id)
    const plan: Project = clash ? { ...p, id: uid(), name: t('{name} (restored)', { name: p.name }), access: undefined } : { ...p, access: undefined }
    if (!storeProject(plan)) {
      throw new Error(t("There isn't room in this browser for every plan in the backup: {n} of them were put back.", { n: r.added + r.copies }))
    }
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
      toast.success(restoredNote(restoreBackup(data)))
      useUi.getState().openProjects(true)
    } else {
      useEditor.getState().loadProject(projectFromFile(data))
      toast.success(t('Opened “{name}”', { name: file.name }))
    }
  } catch (e) {
    toast.error((e as Error).message)
  }
}
