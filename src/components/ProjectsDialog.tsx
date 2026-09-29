import { useState } from 'react'
import { Cloud, CloudUpload, FilePlus2, HardDrive, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useCloud } from '@/cloud/store'
import { deleteCloudProject, listCloud, openCloudProject, uploadLocal } from '@/cloud/sync'
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

function merge(local: ReturnType<typeof listProjects>, cloud: Awaited<ReturnType<typeof listCloud>>): Entry[] {
  const map = new Map<string, Entry>()
  for (const m of local) map.set(m.id, { id: m.id, name: m.name, updatedAt: m.updatedAt, local: true, cloud: false })
  for (const c of cloud) {
    const e = map.get(c.id)
    if (e) {
      e.cloud = true
      e.updatedAt = Math.max(e.updatedAt, c.updatedAt)
    } else map.set(c.id, { id: c.id, name: c.name, updatedAt: c.updatedAt, local: false, cloud: true })
  }
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function ProjectsDialog() {
  const open = useUi((s) => s.projectsOpen)
  const onOpenChange = useUi((s) => s.openProjects)
  const current = useEditor((s) => s.project)
  const user = useCloud((s) => s.user)
  const [entries, setEntries] = useState<Entry[]>([])
  const [loadingCloud, setLoadingCloud] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [toDelete, setToDelete] = useState<Entry | null>(null)

  const refresh = async () => {
    saveProject(useEditor.getState().project)
    const local = listProjects()
    setEntries(merge(local, []))
    if (!useCloud.getState().user) return
    setLoadingCloud(true)
    try {
      setEntries(merge(listProjects(), await listCloud()))
    } catch (e) {
      toast.error(`Couldn't load your cloud plans: ${(e as Error).message}`)
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
      toast.error(`Couldn't delete: ${(err as Error).message}`)
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
            <DialogTitle>Projects</DialogTitle>
            <DialogDescription>
              {user
                ? 'Your plans save to your account automatically, and a copy stays in this browser for offline use.'
                : 'Plans save automatically in this browser. Sign in to keep them in the cloud and open them on any device.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Button onClick={create}>
              <FilePlus2 /> New project
            </Button>
            {user && localOnly.length > 0 && (
              <Button variant="outline" onClick={uploadAll} disabled={uploading}>
                {uploading ? <Loader2 className="animate-spin" /> : <CloudUpload />}
                Upload {localOnly.length} plan{localOnly.length === 1 ? '' : 's'} from this device
              </Button>
            )}
            {!user && useCloud.getState().configured && (
              <Button variant="outline" onClick={() => useCloud.getState().openSignIn(true)}>
                <Cloud /> Sign in to save to the cloud
              </Button>
            )}
          </div>
          <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
            {entries.map((p) => (
              <li key={p.id} className={cn('flex items-center pr-2', p.id === current.id && 'bg-primary/10')}>
                <button
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-3 py-2.5 text-left outline-none focus-visible:bg-muted"
                  onClick={() => void openEntry(p)}
                  disabled={busyId !== null}
                >
                  <span className="flex w-full min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    {busyId === p.id && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {p.id === current.id ? 'Open now · ' : ''}
                    {new Date(p.updatedAt).toLocaleString()}
                    {user && (
                      <Badge variant="secondary" className="h-4.5 gap-1 px-1.5 text-[10px]">
                        {p.cloud ? <Cloud className="size-3" /> : <HardDrive className="size-3" />}
                        {p.cloud ? (p.local ? 'Account' : 'Account only') : 'This device'}
                      </Badge>
                    )}
                  </span>
                </button>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${p.name}`} onClick={() => setToDelete(p)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
            {loadingCloud && (
              <li className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Loading plans from your account…
              </li>
            )}
          </ul>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete “${toDelete?.name}”?`}
        description={
          toDelete?.cloud
            ? 'This permanently removes the plan from your account and from this browser. It cannot be undone.'
            : 'This permanently removes the project from this browser. It cannot be undone.'
        }
        onConfirm={() => toDelete && void remove(toDelete)}
      />
    </>
  )
}
