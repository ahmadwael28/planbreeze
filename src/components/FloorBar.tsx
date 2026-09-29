import { useState } from 'react'
import type { ReactNode } from 'react'
import { Copy, Layers, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { addFloor, deleteFloor, duplicateFloor, useEditor } from '@/store/editor'
import { ConfirmDialog } from './ConfirmDialog'

export function FloorBar() {
  const floors = useEditor((s) => s.project.floors)
  const floorId = useEditor((s) => s.floorId)
  const setFloor = useEditor((s) => s.setFloor)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const current = floors.find((f) => f.id === floorId)

  const action = (label: string, onClick: () => void, icon: ReactNode, disabled = false) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={onClick} disabled={disabled} aria-label={label}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )

  return (
    <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-1 overflow-x-auto rounded-full border bg-background/95 py-1 pr-1.5 pl-3 shadow-md backdrop-blur">
      <Layers className="size-4 shrink-0 text-muted-foreground" />
      {[...floors].reverse().map((f) => (
        <Button
          key={f.id}
          size="sm"
          variant={f.id === floorId ? 'default' : 'ghost'}
          className={cn('rounded-full', f.id !== floorId && 'text-foreground')}
          onClick={() => setFloor(f.id)}
        >
          {f.name}
        </Button>
      ))}
      <Separator orientation="vertical" className="mx-0.5 h-4!" />
      {action('Add floor above', addFloor, <Plus />)}
      {action('Duplicate this floor', () => duplicateFloor(floorId), <Copy />)}
      {action('Delete this floor', () => setConfirmDelete(true), <Trash2 />, floors.length <= 1)}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${current?.name}”?`}
        description="All rooms and symbols on this floor will be removed. You can undo this with Ctrl+Z."
        onConfirm={() => deleteFloor(floorId)}
      />
    </div>
  )
}
