import { Copy, Eye, RefreshCw, Share2, UserMinus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCloud } from '@/cloud/store'
import { leaveSharedProject, makeOwnCopy, reconcile } from '@/cloud/sync'
import { newProject } from '@/model/project'
import { useEditor } from '@/store/editor'
import { listProjects, loadProject, saveProject } from '@/store/storage'
import { useUi } from '@/store/ui'

/** Open another of this device's plans (after the open one is removed). */
function openAnother(except: string) {
  const next = listProjects().find((m) => m.id !== except)
  const p = (next && loadProject(next.id)) || newProject()
  saveProject(p)
  useEditor.getState().loadProject(p)
}

/**
 * Share the open plan (it's this user's), or, for a plan someone shared with them, who shared it and what they can
 * do with it: make their own copy, or remove it from their plans.
 */
export function ShareControls() {
  const configured = useCloud((s) => s.configured)
  const user = useCloud((s) => s.user)
  const access = useEditor((s) => s.project.access)
  if (!configured) return null

  if (!access) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => (user ? useUi.getState().openShare(true) : useCloud.getState().openSignIn(true, 'Sign in to share your plans with other people.'))}
        data-tour="share"
      >
        <Share2 /> <span className="max-md:hidden">Share</span>
      </Button>
    )
  }

  const viewer = access.role === 'viewer'
  const leave = async () => {
    const { id } = useEditor.getState().project
    try {
      await leaveSharedProject(access.owner, id)
      openAnother(id)
      toast.success('Removed from your plans.')
    } catch (e) {
      toast.error(`Couldn't remove it: ${(e as Error).message}`)
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="shrink-0">
          {viewer ? <Eye /> : <Users />} <span className="max-md:hidden">{viewer ? 'View only' : 'Shared'}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium">Shared {access.ownerEmail ? `by ${access.ownerEmail}` : 'with you'}</div>
          <div className="text-xs text-muted-foreground">
            {viewer
              ? 'You can look around this plan, in 2D and 3D, but not change it. Make a copy to change it.'
              : 'You can edit this plan. Your changes save to it, for everyone it is shared with.'}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={makeOwnCopy}>
          <Copy /> Make a copy of my own
        </DropdownMenuItem>
        {user && (
          <DropdownMenuItem onSelect={() => void reconcile()}>
            <RefreshCw /> Get the latest changes
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onSelect={() => void leave()}>
          <UserMinus /> Remove from my plans
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
