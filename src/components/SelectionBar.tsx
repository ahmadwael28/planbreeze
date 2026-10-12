import type { ReactNode } from 'react'
import { Check, Copy, ListPlus, RotateCw, SlidersHorizontal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useLayout } from '@/hooks/use-layout'
import { cn } from '@/lib/utils'
import { SYMBOL_MAP } from '@/model/symbols'
import { currentFloor, deleteSelection, draftFloor, duplicateSelection, isViewOnly, removeVertices, rotateSelection, useEditor } from '@/store/editor'
import { useUi } from '@/store/ui'
import { t } from '@/i18n'

function Action({ label, onClick, active, danger, children }: { label: string; onClick: () => void; active?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <Button
      variant="ghost"
      size="icon-lg"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn('shrink-0', active && 'bg-primary/15 text-primary', danger && 'text-destructive hover:text-destructive')}
    >
      {children}
    </Button>
  )
}

/**
 * What's picked and what can be done with it, along the bottom: what a keyboard and the panel do on a computer
 * (delete, duplicate, turn, pick more, let go), for touch screens and wherever the panel isn't beside the plan.
 */
export function SelectionBar() {
  const selection = useEditor((s) => s.selection)
  const floor = useEditor(currentFloor)
  const viewOnly = useEditor((s) => isViewOnly(s.project))
  const { touch, panel } = useLayout()
  const open = useUi((s) => s.sidebarOpen)
  const multiPick = useUi((s) => s.multiPick)
  const setMultiPick = useUi((s) => s.setMultiPick)
  const tool = useEditor((s) => s.tool)
  const is2d = useEditor((s) => s.viewMode === '2d')

  if (!selection) return null
  // While drawing by touch, the drawing tool's bar is there instead (see Canvas).
  if (touch && is2d && tool !== 'select') return null
  // With a mouse and the panel beside the plan, the panel and keyboard do all this.
  if (!touch && panel === 'docked') return null
  // The panel over the plan shows it all already.
  if (open && panel !== 'docked') return null

  const done = () => {
    setMultiPick(false)
    useEditor.getState().select(null)
  }

  let title = ''
  let corners: number[] = []
  let turnable = false
  if (selection.kind === 'multi') {
    title = t('{n} items', { n: selection.items.length })
    turnable = true
  } else if (selection.kind === 'room') {
    const room = floor.rooms.find((r) => r.id === selection.id)
    corners = selection.vertices ?? (selection.vertex !== undefined ? [selection.vertex] : [])
    title = room?.name ?? t('Room')
    if (corners.length === 1) title = `${title} · ${t('Corner {n}', { n: corners[0] + 1 })}`
    else if (corners.length > 1) title = `${title} · ${t('{n} corners', { n: corners.length })}`
    else if (selection.edge !== undefined) title = `${title} · ${t('Wall {n}', { n: selection.edge + 1 })}`
  } else if (selection.kind === 'symbol') {
    const sym = floor.symbols.find((s) => s.id === selection.id)
    const def = sym && SYMBOL_MAP.get(sym.type)
    title = sym?.label || (def ? t(def.name) : '')
    turnable = !!sym && !sym.wall && !sym.room
  } else if (selection.kind === 'dimension') {
    title = t('Dimension line')
  } else {
    title = floor.views?.find((v) => v.id === selection.id)?.name ?? t('Saved view')
  }

  const remove = () => {
    if (corners.length && selection.kind === 'room') {
      if (!removeVertices(selection.id, corners)) toast(t('A room needs at least three corners.'))
      return
    }
    setMultiPick(false)
    deleteSelection()
  }
  const turn = () => {
    if (selection.kind === 'multi') return rotateSelection(90)
    if (selection.kind !== 'symbol') return
    const id = selection.id
    useEditor.getState().commit((d) => {
      const s = draftFloor(d).symbols.find((x) => x.id === id)
      if (s && !s.wall) s.rotation = (s.rotation + 90) % 360
    })
  }
  const showPanel = () => {
    useUi.getState().setSidebarTab('properties')
    useUi.getState().setSidebarOpen(true)
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
      <div className="pointer-events-auto flex max-w-full min-w-0 items-center gap-0.5 rounded-2xl border bg-background/95 p-1 shadow-lg backdrop-blur">
        <div className="min-w-0 px-2.5">
          <div className="max-w-44 truncate text-sm font-medium">{title}</div>
          {multiPick && <div className="truncate text-xs text-primary">{t('Tap to add or take out')}</div>}
        </div>
        {!(panel === 'docked' && open) && (
          <Action label={t('Properties')} onClick={showPanel}>
            <SlidersHorizontal />
          </Action>
        )}
        {!viewOnly && (
          <>
            {selection.kind !== 'view' && (
              <Action label={selection.kind === 'room' ? t('Pick several corners or things') : t('Pick several')} active={multiPick} onClick={() => setMultiPick(!multiPick)}>
                <ListPlus />
              </Action>
            )}
            {turnable && (
              <Action label={t('Turn 90°')} onClick={turn}>
                <RotateCw />
              </Action>
            )}
            {!corners.length && selection.kind !== 'view' && (
              <Action label={t('Duplicate')} onClick={duplicateSelection}>
                <Copy />
              </Action>
            )}
            <Action label={corners.length > 1 ? t('Remove {n} corners', { n: corners.length }) : corners.length ? t('Remove corner {n}', { n: corners[0] + 1 }) : t('Delete')} onClick={remove} danger>
              <Trash2 />
            </Action>
          </>
        )}
        <Action label={t('Done')} onClick={done}>
          <Check />
        </Action>
      </div>
    </div>
  )
}
