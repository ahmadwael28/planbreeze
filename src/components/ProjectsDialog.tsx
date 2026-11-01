import { t } from '@/i18n'

/** When a plan was last changed: today or yesterday and the time, else the date (no seconds). */
function when(at: number) {
  const lang = document.documentElement.lang || undefined
  const d = new Date(at)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(new Date()) - day(d)) / 86400000)
  const time = d.toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' })
  if (days === 0) return t('Today, {time}', { time })
  if (days === 1) return t('Yesterday, {time}', { time })
  return d.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined })
}
import { useRef, useState } from 'react'
import { ArchiveRestore, Check, ChevronDown, Cloud, CloudUpload, Download, Eye, FilePlus2, HardDrive, Pencil, RotateCcw, Trash2, UserMinus, Users } from 'lucide-react'
import { Loader } from '@/components/ui/loader'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useCloud } from '@/cloud/store'
import type { SharedPlan, ShareRole } from '@/cloud/backend'
import {
  deleteCloudProject,
  fetchCloudProject,
  isSynced,
  leaveSharedProject,
  listCloud,
  listSharedWithMe,
  openCloudProject,
  openSharedProject,
  renameCloudProject,
  uploadLocal,
} from '@/cloud/sync'
import { newProject } from '@/model/project'
import type { Project } from '@/model/types'
import { fullBackup, openProjectFile, saveBackup } from '@/store/backup'
import { useEditor } from '@/store/editor'
import { listProjects, listTrash, loadProject, purgeTrashed, restoreProject, saveProject, storeProject, trashProject, TRASH_DAYS } from '@/store/storage'
import type { ProjectMeta, TrashedMeta } from '@/store/storage'
import { useUi } from '@/store/ui'
import { ConfirmDialog } from './ConfirmDialog'
import { StorageMeter } from './StorageMeter'

interface Entry {
  id: string
  name: string
  updatedAt: number
  local: boolean
  cloud: boolean
}

/** A plan someone else shared with this user: in their account, on this device, or both. */
interface SharedEntry {
  id: string
  owner: string
  ownerEmail?: string
  name: string
  role: ShareRole
  updatedAt: number
  /** Its view link's key, if it was opened with one. */
  key?: string
  local: boolean
}

/** This device's plans and the account's, together. `inCloud`: which are in the account, before its list arrives. */
function merge(local: ProjectMeta[], cloud: Awaited<ReturnType<typeof listCloud>>, inCloud = (_id: string) => false): Entry[] {
  const map = new Map<string, Entry>()
  for (const m of local) if (!m.shared) map.set(m.id, { id: m.id, name: m.name, updatedAt: m.updatedAt, local: true, cloud: inCloud(m.id) })
  for (const c of cloud) {
    const e = map.get(c.id)
    if (e) {
      e.cloud = true
      e.updatedAt = Math.max(e.updatedAt, c.updatedAt)
    } else map.set(c.id, { id: c.id, name: c.name, updatedAt: c.updatedAt, local: false, cloud: true })
  }
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

function mergeShared(local: ProjectMeta[], cloud: SharedPlan[]): SharedEntry[] {
  const map = new Map<string, SharedEntry>()
  for (const m of local) {
    if (m.shared) map.set(m.id, { id: m.id, name: m.name, updatedAt: m.updatedAt, local: true, ...m.shared })
  }
  for (const c of cloud) {
    const e = map.get(c.id)
    map.set(c.id, { ...c, key: e?.key, local: !!e, updatedAt: Math.max(c.updatedAt, e?.updatedAt ?? 0) })
  }
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Another of this device's plans opened, after the open one is deleted or left: the last changed, or a new one. */
async function openNext() {
  const next = (await listProjects())[0]
  const p = (next && (await loadProject(next.id))) || newProject()
  void saveProject(p)
  useEditor.getState().loadProject(p)
}

export function ProjectsDialog() {
  const open = useUi((s) => s.projectsOpen)
  const onOpenChange = useUi((s) => s.openProjects)
  const current = useEditor((s) => s.project)
  const user = useCloud((s) => s.user)
  const [entries, setEntries] = useState<Entry[]>([])
  const [shared, setShared] = useState<SharedEntry[]>([])
  const [toLeave, setToLeave] = useState<SharedEntry | null>(null)
  const [loadingCloud, setLoadingCloud] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [toDelete, setToDelete] = useState<Entry | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [trash, setTrash] = useState<TrashedMeta[]>([])
  const [showTrash, setShowTrash] = useState(false)
  const [toPurge, setToPurge] = useState<TrashedMeta | null>(null)
  const [emptying, setEmptying] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const restoreRef = useRef<HTMLInputElement>(null)
  /** When a plan was last deleted straight away (a second click straight after asks first: the rows have moved). */
  const lastQuick = useRef(0)

  const refresh = async () => {
    void saveProject(useEditor.getState().project)
    try {
      const local = await listProjects()
      setEntries(merge(local, [], useCloud.getState().user ? isSynced : undefined))
      setShared(mergeShared(local, []))
      setTrash(await listTrash())
    } catch (e) {
      toast.error(t("Couldn't read the plans in this browser: {error}", { error: (e as Error).message }))
    }
    if (!useCloud.getState().user) return
    setLoadingCloud(true)
    try {
      // Plans shared with this user are a bonus: the list works without them (e.g. before sharing is set up).
      const [mine, theirs] = await Promise.all([listCloud(), listSharedWithMe().catch(() => [] as SharedPlan[])])
      // This device's list as it is now (plans may have been deleted or put back while the account answered).
      const local = await listProjects()
      setEntries(merge(local, mine))
      setShared(mergeShared(local, theirs))
    } catch (e) {
      toast.error(t("Couldn't load your cloud plans: {error}", { error: (e as Error).message }))
    } finally {
      setLoadingCloud(false)
    }
  }

  // Refresh the list each time the dialog opens (or the account changes while it's open).
  const key = `${open}:${user?.id ?? ''}`
  const [lastKey, setLastKey] = useState('')
  if (key !== lastKey) {
    setLastKey(key)
    if (open) void refresh()
  }

  const close = () => onOpenChange(false)
  const openEntry = async (e: Entry) => {
    if (e.id === current.id) return close()
    setBusyId(e.id)
    try {
      const local = e.local ? await loadProject(e.id) : null
      if (local) useEditor.getState().loadProject(local)
      else await openCloudProject(e.id)
      close()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }
  /** Someone else's plan: their latest, when signed in (else this device's copy). */
  const openShared = async (e: SharedEntry) => {
    setBusyId(e.id)
    try {
      if (user) await openSharedProject(e.owner, e.id, e.key)
      else {
        const local = await loadProject(e.id)
        if (!local) throw new Error(t('Sign in to open this plan.'))
        useEditor.getState().loadProject(local)
      }
      close()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }
  const leave = async (e: SharedEntry) => {
    try {
      await leaveSharedProject(e.owner, e.id)
      if (e.id === current.id) await openNext()
    } catch (err) {
      toast.error(t("Couldn't remove it: {error}", { error: (err as Error).message }))
    }
    await refresh()
  }
  const create = () => {
    close()
    useUi.getState().openStart(true)
  }
  /**
   * Delete a plan: kept in Recently deleted in this browser, as it was last changed (here, or in the account), to be put
   * back. If it can't be kept, it isn't deleted.
   */
  const remove = async (e: Entry) => {
    setBusyId(e.id)
    try {
      const here = e.id === current.id ? useEditor.getState().project : e.local ? await loadProject(e.id) : null
      const there = e.cloud ? await fetchCloudProject(e.id) : null
      const newest = [here, there].filter((p): p is Project => !!p).sort((a, b) => b.updatedAt - a.updatedAt)[0]
      if (!(await trashProject(e.id, newest, e.cloud))) {
        throw new Error(t("there's no room in this browser to keep it, to put back. Empty Recently deleted or download a backup first"))
      }
      if (e.cloud) {
        try {
          await deleteCloudProject(e.id)
        } catch (err) {
          await restoreProject(e.id)
          throw err
        }
      }
      // The plan open now (another may have been opened while the account was answering).
      if (useEditor.getState().project.id === e.id) await openNext()
      toast(t('“{name}” moved to Recently deleted.', { name: e.name }), { action: { label: t('Undo'), onClick: () => void putBack(e.id) } })
    } catch (err) {
      toast.error(t("Couldn't delete: {error}", { error: (err as Error).message }))
    } finally {
      setBusyId(null)
    }
    await refresh()
  }
  const quickDelete = (e: Entry, now: number) => {
    if (e.cloud || now - lastQuick.current < 800) return setToDelete(e)
    lastQuick.current = now
    void remove(e)
  }
  /** A deleted plan back in the list (and in the account, if it was there and this user's signed in). */
  const putBack = async (id: string) => {
    const was = (await listTrash()).find((m) => m.id === id)
    const p = await restoreProject(id)
    if (!p) {
      toast.error(t("Couldn't put it back: there isn't room in this browser, or it's gone."))
    } else {
      const up = was?.cloud && useCloud.getState().user ? (await uploadLocal([p.id], true)) > 0 : true
      if (up) toast.success(t('“{name}” is back in your plans.', { name: p.name }))
      else toast.warning(t("“{name}” is back on this device, but couldn't go back to your account. Upload it from here once you're online.", { name: p.name }))
    }
    await refresh()
  }
  const purge = async (ids: string[]) => {
    for (const id of ids) await purgeTrashed(id)
    setTrash(await listTrash())
  }
  const backUp = async () => {
    setBackingUp(true)
    try {
      void saveProject(useEditor.getState().project)
      const { backup, missed, unlisted, unread } = await fullBackup()
      await saveBackup(backup)
      if (unread) {
        toast.warning(
          unread === 1
            ? t("1 plan in this browser couldn't be read, so it isn't in the backup.")
            : t("{n} plans in this browser couldn't be read, so they aren't in the backup.", { n: unread }),
        )
      }
      if (unlisted) toast.warning(t("Your account couldn't be reached, so the backup has the plans in this browser only."))
      if (missed) {
        toast.warning(
          missed === 1
            ? t("1 plan in your account couldn't be fetched, so it isn't in the backup.")
            : t("{n} plans in your account couldn't be fetched, so they aren't in the backup.", { n: missed }),
        )
      }
    } catch (err) {
      toast.error(t("Couldn't make the backup: {error}", { error: (err as Error).message }))
    } finally {
      setBackingUp(false)
    }
  }
  const rename = async (e: Entry, raw: string) => {
    setRenaming(null)
    const name = raw.trim()
    if (!name || name === e.name) return
    try {
      if (e.id === current.id) {
        // The open plan: autosave takes it from here (this device and the account).
        useEditor.getState().commit((d) => void (d.name = name))
      } else if (e.cloud) {
        await renameCloudProject(e.id, name)
      } else {
        const p = await loadProject(e.id)
        if (p) await storeProject({ ...p, name, updatedAt: Date.now() })
      }
    } catch (err) {
      toast.error(t("Couldn't rename: {error}", { error: (err as Error).message }))
    }
    await refresh()
  }
  const localOnly = entries.filter((e) => e.local && !e.cloud && e.id !== current.id)
  const uploadAll = async () => {
    setUploading(true)
    try {
      await uploadLocal(localOnly.map((e) => e.id))
    } finally {
      setUploading(false)
      await refresh()
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('Projects')}</DialogTitle>
            <DialogDescription>
              {user
                ? t('Your plans save to your account automatically, and a copy stays in this browser for offline use.')
                : t('Plans save automatically in this browser. Sign in to keep them in the cloud and open them on any device.')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Button onClick={create}>
              <FilePlus2 /> {t('New project')}
            </Button>
            {user && localOnly.length > 0 && (
              <Button variant="outline" onClick={uploadAll} disabled={uploading}>
                {uploading ? <Loader label={t('Uploading')} /> : <CloudUpload />}
                {localOnly.length === 1 ? t('Upload 1 plan from this device') : t('Upload {n} plans from this device', { n: localOnly.length })}
              </Button>
            )}
            {!user && useCloud.getState().configured && (
              <Button variant="outline" onClick={() => useCloud.getState().openSignIn(true)}>
                <Cloud /> {t('Sign in to save to the cloud')}
              </Button>
            )}
          </div>
          <ul className={cn('max-h-80 divide-y overflow-y-auto rounded-lg border', !entries.length && !loadingCloud && 'hidden')}>
            {entries.map((p) => (
              <li key={p.id} className={cn('flex items-center pe-2', p.id === current.id && 'bg-primary/10')}>
                {renaming?.id === p.id ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2"
                    onSubmit={(ev) => {
                      ev.preventDefault()
                      void rename(p, renaming.name)
                    }}
                  >
                    <Input
                      autoFocus
                      aria-label={t('Project name')}
                      value={renaming.name}
                      onChange={(ev) => setRenaming({ id: p.id, name: ev.target.value })}
                      onFocus={(ev) => ev.currentTarget.select()}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Escape') {
                          ev.stopPropagation()
                          setRenaming(null)
                        }
                      }}
                      onBlur={() => void rename(p, renaming.name)}
                      className="h-8"
                    />
                    <Button type="submit" size="icon-sm" aria-label={t('Save name')}>
                      <Check />
                    </Button>
                  </form>
                ) : (
                <button
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-3 py-2.5 text-start outline-none focus-visible:bg-muted"
                  onClick={() => void openEntry(p)}
                  disabled={busyId !== null}
                >
                  <span className="flex w-full min-w-0 items-center gap-2">
                    <span dir="auto" className="truncate text-sm font-medium">{p.name}</span>
                    {busyId === p.id && <Loader className="size-4" label={t('Opening')} />}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {p.id === current.id ? `${t('Open now')} · ` : ''}
                    {when(p.updatedAt)}
                    {user && (
                      <Badge variant="secondary" className="h-4.5 gap-1 px-1.5 text-[10px]">
                        {p.cloud ? <Cloud className="size-3" /> : <HardDrive className="size-3" />}
                        {p.cloud ? (p.local ? t('Account') : t('Account only')) : t('This device')}
                      </Badge>
                    )}
                  </span>
                </button>
                )}
                {renaming?.id !== p.id && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('Rename {name}', { name: p.name })}
                    onClick={() => setRenaming({ id: p.id, name: p.name })}
                    disabled={busyId !== null}
                  >
                    <Pencil />
                  </Button>
                )}
                <Button variant="ghost" size="icon-sm" aria-label={t('Delete {name}', { name: p.name })} onClick={(ev) => quickDelete(p, ev.timeStamp)} disabled={busyId !== null}>
                  <Trash2 />
                </Button>
              </li>
            ))}
            {loadingCloud && (
              <li className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground">
                <Loader className="size-4" label={t('Loading plans')} /> {t('Loading plans from your account…')}
              </li>
            )}
          </ul>
          {shared.length > 0 && (
            <section className="space-y-2">
              <h4 className="text-sm font-medium">{t('Shared with you')}</h4>
              <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
                {shared.map((p) => (
                  <li key={p.id} className={cn('flex items-center pe-2', p.id === current.id && 'bg-primary/10')}>
                    <button
                      className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-3 py-2.5 text-start outline-none focus-visible:bg-muted"
                      onClick={() => void openShared(p)}
                      disabled={busyId !== null}
                    >
                      <span className="flex w-full min-w-0 items-center gap-2">
                        <span dir="auto" className="truncate text-sm font-medium">{p.name}</span>
                        {busyId === p.id && <Loader className="size-4" label={t('Opening')} />}
                      </span>
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {p.id === current.id ? `${t('Open now')} · ` : ''}
                        <span className="truncate">{p.ownerEmail ? t('From {email}', { email: p.ownerEmail }) : t('Shared with a link')}</span>
                        <Badge variant="secondary" className="h-4.5 gap-1 px-1.5 text-[10px]">
                          {p.role === 'editor' ? <Users className="size-3" /> : <Eye className="size-3" />}
                          {p.role === 'editor' ? t('Can edit') : t('Can view')}
                        </Badge>
                      </span>
                    </button>
                    <Button variant="ghost" size="icon-sm" aria-label={t('Remove {name} from your plans', { name: p.name })} onClick={() => setToLeave(p)}>
                      <UserMinus />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {trash.length > 0 && (
            <section className="space-y-2">
              <button
                type="button"
                className="flex items-center gap-1.5 text-start text-sm font-medium outline-none focus-visible:underline"
                onClick={() => setShowTrash(!showTrash)}
                aria-expanded={showTrash}
              >
                <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', !showTrash && '-rotate-90 rtl:rotate-90')} />
                {t('Recently deleted')}
                <span className="font-normal text-muted-foreground">{trash.length}</span>
              </button>
              {showTrash && (
                <>
                  <ul className="max-h-48 divide-y overflow-y-auto rounded-lg border">
                    {trash.map((m) => (
                      <li key={m.id} className="flex items-center gap-1 pe-2">
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2">
                          <span dir="auto" className="truncate text-sm">{m.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {m.other ? t('Another version, kept') : t('Deleted')} · {when(m.deletedAt)}
                          </span>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => void putBack(m.id)}>
                          <RotateCcw /> {t('Put back')}
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={t('Delete {name} for good', { name: m.name })} onClick={() => setToPurge(m)}>
                          <Trash2 />
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    {t('Deleted plans are kept in this browser for {days} days, or until it needs the room.', { days: TRASH_DAYS })}{' '}
                    <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setEmptying(true)}>
                      {t('Empty it now')}
                    </button>
                  </p>
                </>
              )}
            </section>
          )}
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button variant="outline" size="sm" onClick={() => void backUp()} disabled={backingUp}>
              {backingUp ? <Loader label={t('Making the backup')} /> : <Download />}
              {t('Download all my plans')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => restoreRef.current?.click()}>
              <ArchiveRestore /> {t('Restore from a backup…')}
            </Button>
            <input
              ref={restoreRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (ev) => {
                const file = ev.target.files?.[0]
                ev.target.value = ''
                if (!file) return
                await openProjectFile(file)
                await refresh()
              }}
            />
            <StorageMeter version={`${entries.length}:${trash.length}`} />
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('Delete “{name}”?', { name: toDelete?.name ?? '' })}
        description={
          toDelete?.cloud
            ? t("It's removed from your account, and from anyone it's shared with. This browser keeps it in Recently deleted for {days} days, to put back.", {
                days: TRASH_DAYS,
              })
            : t('It goes to Recently deleted, where it’s kept for {days} days, to put back.', { days: TRASH_DAYS })
        }
        onConfirm={() => toDelete && void remove(toDelete)}
      />
      <ConfirmDialog
        open={!!toPurge}
        onOpenChange={(o) => !o && setToPurge(null)}
        title={t('Delete “{name}” for good?', { name: toPurge?.name ?? '' })}
        description={t("It can't be put back after this.")}
        confirmLabel={t('Delete for good')}
        onConfirm={() => toPurge && void purge([toPurge.id])}
      />
      <ConfirmDialog
        open={emptying}
        onOpenChange={setEmptying}
        title={t('Empty Recently deleted?')}
        description={
          trash.length === 1 ? t("The plan in it is deleted for good. It can't be put back.") : t("The {n} plans in it are deleted for good. They can't be put back.", { n: trash.length })
        }
        confirmLabel={t('Delete for good')}
        onConfirm={() => void purge(trash.map((m) => m.id))}
      />
      <ConfirmDialog
        open={!!toLeave}
        onOpenChange={(o) => !o && setToLeave(null)}
        title={t('Remove “{name}” from your plans?', { name: toLeave?.name ?? '' })}
        description={
          toLeave?.ownerEmail
            ? t("You'll stop seeing it here, and {email} would have to share it again. Their plan isn't changed or deleted.", { email: toLeave.ownerEmail })
            : t("You'll stop seeing it here. Their plan isn't changed or deleted.")
        }
        onConfirm={() => toLeave && void leave(toLeave)}
      />
    </>
  )
}
