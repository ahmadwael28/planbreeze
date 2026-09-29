import { useState } from 'react'
import { FilePlus2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { newProject } from '@/model/project'
import { useEditor } from '@/store/editor'
import { deleteProject, listProjects, loadProject, saveProject } from '@/store/storage'
import type { ProjectMeta } from '@/store/storage'
import { useUi } from '@/store/ui'
import { ConfirmDialog } from './ConfirmDialog'

export function ProjectsDialog() {
  const open = useUi((s) => s.projectsOpen)
  const onOpenChange = useUi((s) => s.openProjects)
  const current = useEditor((s) => s.project)
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [toDelete, setToDelete] = useState<ProjectMeta | null>(null)

  // Refresh the list each time the dialog opens (saving first so it reflects the open project).
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      saveProject(current)
      setProjects(listProjects())
    }
  }

  const close = () => onOpenChange(false)
  const openProject = (id: string) => {
    const p = loadProject(id)
    if (p) useEditor.getState().loadProject(p)
    close()
  }
  const create = () => {
    close()
    useUi.getState().openStart(true)
  }
  const remove = (meta: ProjectMeta) => {
    deleteProject(meta.id)
    if (meta.id === current.id) {
      const next = listProjects()[0]
      const p = (next && loadProject(next.id)) || newProject()
      saveProject(p)
      useEditor.getState().loadProject(p)
    }
    setProjects(listProjects())
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Projects</DialogTitle>
            <DialogDescription>
              Projects are saved automatically in this browser. Use Export → “Save project” to back up or move a plan.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button onClick={create}>
              <FilePlus2 /> New project
            </Button>
          </div>
          <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
            {projects.map((p) => (
              <li key={p.id} className={cn('flex items-center pr-2', p.id === current.id && 'bg-primary/10')}>
                <button
                  className="flex flex-1 flex-col items-start gap-0.5 px-3 py-2.5 text-left outline-none focus-visible:bg-muted"
                  onClick={() => openProject(p.id)}
                >
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.id === current.id ? 'Open now · ' : ''}
                    {new Date(p.updatedAt).toLocaleString()}
                  </span>
                </button>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${p.name}`} onClick={() => setToDelete(p)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete “${toDelete?.name}”?`}
        description="This permanently removes the project from this browser. It cannot be undone."
        onConfirm={() => toDelete && remove(toDelete)}
      />
    </>
  )
}
