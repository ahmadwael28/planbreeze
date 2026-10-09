import { t } from '@/i18n'
import { useState } from 'react'
import { Check, Cloud, CloudUpload, Eye, FilePlus2, HardDrive, Pencil, Trash2, UserMinus, Users } from 'lucide-react'
import { Loader } from '@/components/ui/loader'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useCloud } from '@/cloud/store'
import type { SharedPlan, ShareRole } from '@/cloud/backend'
import { deleteCloudProject, leaveSharedProject, listCloud, listSharedWithMe, openCloudProject, openSharedProject, renameCloudProject, uploadLocal } from '@/cloud/sync'
import { newProject } from '@/model/project'
import { useEditor } from '@/store/editor'
import { deleteProject, listProjects, loadProject, saveProject } from '@/store/storage'
import { useUi } from '@/store/ui'
import { ConfirmDialog } from './ConfirmDialog'

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

function merge(local: ReturnType<typeof listProjects>, cloud: Awaited<ReturnType<typeof listCloud>>): Entry[] {
  const map = new Map<string, Entry>()
  for (const m of local) if (!m.shared) map.set(m.id, { id: m.id, name: m.name, updatedAt: m.updatedAt, local: true, cloud: false })
  for (const c of cloud) {
    const e = map.get(c.id)
    if (e) {
      e.cloud = true
      e.updatedAt = Math.max(e.updatedAt, c.updatedAt)
    } else map.set(c.id, { id: c.id, name: c.name, updatedAt: c.updatedAt, local: false, cloud: true })
  }
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

function mergeShared(local: ReturnType<typeof listProjects>, cloud: SharedPlan[]): SharedEntry[] {
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

  const refresh = async () => {
    saveProject(useEditor.getState().project)
    const local = listProjects()
    setEntries(merge(local, []))
    setShared(mergeShared(local, []))
    if (!useCloud.getState().user) return
    setLoadingCloud(true)
    try {
      // Plans shared with this user are a bonus: the list works without them (e.g. before sharing is set up).
      const [mine, theirs] = await Promise.all([listCloud(), listSharedWithMe().catch(() => [] as SharedPlan[])])
      setEntries(merge(listProjects(), mine))
      setShared(mergeShared(listProjects(), theirs))
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
      const local = e.local ? loadProject(e.id) : null
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
      const local = loadProject(e.id)
      if (user) await openSharedProject(e.owner, e.id, e.key)
      else if (local) useEditor.getState().loadProject(local)
      else throw new Error(t('Sign in to open this plan.'))
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
      if (e.id === current.id) {
        const next = listProjects()[0]
        const p = (next && loadProject(next.id)) || newProject()
        saveProject(p)
        useEditor.getState().loadProject(p)
      }
    } catch (err) {
      toast.error(t("Couldn't remove it: {error}", { error: (err as Error).message }))
    }
    await refresh()
  }
  const create = () => {
    close()
    useUi.getState().openStart(true)
  }
  const remove = async (e: Entry) => {
    try {
      if (e.cloud) await deleteCloudProject(e.id)
      if (e.local) deleteProject(e.id)
      if (e.id === current.id) {
        const next = listProjects()[0]
        const p = (next && loadProject(next.id)) || newProject()
        saveProject(p)
        useEditor.getState().loadProject(p)
      }
    } catch (err) {
      toast.error(t("Couldn't delete: {error}", { error: (err as Error).message }))
    }
    await refresh()
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
        const p = loadProject(e.id)
        if (p) saveProject({ ...p, name, updatedAt: Date.now() })
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
        <DialogContent className="sm:max-w-lg">
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
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    {busyId === p.id && <Loader className="size-4" label={t('Opening')} />}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {p.id === current.id ? `${t('Open now')} · ` : ''}
                    {new Date(p.updatedAt).toLocaleString()}
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
                  <Button variant="ghost" size="icon-sm" aria-label={t('Rename {name}', { name: p.name })} onClick={() => setRenaming({ id: p.id, name: p.name })}>
                    <Pencil />
                  </Button>
                )}
                <Button variant="ghost" size="icon-sm" aria-label={t('Delete {name}', { name: p.name })} onClick={() => setToDelete(p)}>
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
                        <span className="truncate text-sm font-medium">{p.name}</span>
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
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('Delete “{name}”?', { name: toDelete?.name ?? '' })}
        description={
          toDelete?.cloud
            ? t('This permanently removes the plan from your account and from this browser. It cannot be undone.')
            : t('This permanently removes the project from this browser. It cannot be undone.')
        }
        onConfirm={() => toDelete && void remove(toDelete)}
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
