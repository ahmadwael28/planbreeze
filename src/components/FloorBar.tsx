import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronUp, Copy, Layers, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLayout } from '@/hooks/use-layout'
import { cn } from '@/lib/utils'
import { addFloor, deleteFloor, duplicateFloor, isViewOnly, useEditor } from '@/store/editor'
import { ConfirmDialog } from './ConfirmDialog'
import { t } from '@/i18n'

export function FloorBar() {
  const floors = useEditor((s) => s.project.floors)
  const floorId = useEditor((s) => s.floorId)
  const setFloor = useEditor((s) => s.setFloor)
  const viewOnly = useEditor((s) => isViewOnly(s.project))
  const selected = useEditor((s) => !!s.selection)
  const { compact, touch, panel } = useLayout()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const current = floors.find((f) => f.id === floorId)

  const confirm = (
    <ConfirmDialog
      open={confirmDelete}
      onOpenChange={setConfirmDelete}
      title={t('Delete “{name}”?', { name: current?.name ?? '' })}
      description={t('All rooms and symbols on this floor will be removed. You can undo this with Ctrl+Z.')}
      onConfirm={() => deleteFloor(floorId)}
    />
  )

  // It makes way for what's picked, along the bottom (see SelectionBar).
  if (selected && (touch || panel !== 'docked')) return confirm

  // On a phone: the floor's name, with the others and what can be done with floors in a menu.
  if (compact) {
    return (
      <div className="absolute start-3 bottom-3" data-tour="floors">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="max-w-48 rounded-full bg-background/95 shadow-md backdrop-blur">
              <Layers className="text-muted-foreground" />
              <span className="truncate">{current?.name}</span>
              <ChevronUp className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-60">
            <DropdownMenuRadioGroup value={floorId} onValueChange={setFloor}>
              {[...floors].reverse().map((f) => (
                <DropdownMenuRadioItem key={f.id} value={f.id}>
                  {f.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {!viewOnly && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={addFloor}>
                  <Plus /> {t('Add floor above')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => duplicateFloor(floorId)}>
                  <Copy /> {t('Duplicate this floor')}
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" disabled={floors.length <= 1} onSelect={() => setConfirmDelete(true)}>
                  <Trash2 /> {t('Delete this floor')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {confirm}
      </div>
    )
  }

  const action = (label: string, onClick: () => void, icon: ReactNode, disabled = false) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size={touch ? 'icon' : 'icon-sm'} onClick={onClick} disabled={disabled} aria-label={label}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )

  return (
    <div
      className="absolute start-3 bottom-3 flex max-w-[calc(100%-1.5rem)] items-center gap-1 overflow-x-auto rounded-full border bg-background/95 py-1 ps-3 pe-1.5 shadow-md backdrop-blur"
      data-tour="floors"
    >
      <Layers className="size-4 shrink-0 text-muted-foreground" />
      {[...floors].reverse().map((f) => (
        <Button
          key={f.id}
          size={touch ? 'default' : 'sm'}
          variant={f.id === floorId ? 'default' : 'ghost'}
          className={cn('rounded-full', f.id !== floorId && 'text-foreground')}
          onClick={() => setFloor(f.id)}
        >
          {f.name}
        </Button>
      ))}
      {!viewOnly && (
        <>
          <Separator orientation="vertical" className="mx-0.5 h-4!" />
          {action(t('Add floor above'), addFloor, <Plus />)}
          {action(t('Duplicate this floor'), () => duplicateFloor(floorId), <Copy />)}
          {action(t('Delete this floor'), () => setConfirmDelete(true), <Trash2 />, floors.length <= 1)}
        </>
      )}
      {confirm}
    </div>
  )
}
