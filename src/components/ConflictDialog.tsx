import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useCloud } from '@/cloud/store'
import { resolveConflict } from '@/cloud/sync'
import type { Project } from '@/model/types'
import { useEditor } from '@/store/editor'

function summary(p: Project) {
  const rooms = p.floors.reduce((n, f) => n + f.rooms.length, 0)
  const items = p.floors.reduce((n, f) => n + f.symbols.length, 0)
  return `${p.floors.length} floor${p.floors.length === 1 ? '' : 's'} · ${rooms} rooms · ${items} items · edited ${new Date(p.updatedAt).toLocaleString()}`
}

/** Shown when the open plan was changed both here and on another device. */
export function ConflictDialog() {
  const conflict = useCloud((s) => s.conflict)
  const mine = useEditor((s) => s.project)
  if (!conflict) return null
  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>This plan was changed on another device</AlertDialogTitle>
          <AlertDialogDescription>
            “{mine.name}” has changes here that aren't in your account, and your account has a newer version from another device.
            Which one do you want to keep?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 text-sm">
          <div className="rounded-lg border p-3">
            <div className="font-medium">This device</div>
            <div className="text-xs text-muted-foreground">{summary(mine)}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="font-medium">Your account</div>
            <div className="text-xs text-muted-foreground">{summary(conflict.remote.data)}</div>
          </div>
        </div>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => void resolveConflict('theirs')}>
            Use the version from my account
          </Button>
          <Button onClick={() => void resolveConflict('mine')}>Keep this device's version</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
