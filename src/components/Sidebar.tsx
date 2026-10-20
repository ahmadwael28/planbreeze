import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as RPointerEvent } from 'react'
import { Copy, Eye, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { makeOwnCopy } from '@/cloud/sync'
import { useLayout } from '@/hooks/use-layout'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'
import { isViewOnly, useEditor } from '@/store/editor'
import { useUi } from '@/store/ui'
import type { SidebarTab } from '@/store/ui'
import { LibraryPanel } from './LibraryPanel'
import { PropertiesPanel } from './PropertiesPanel'
import { SummaryPanel } from './SummaryPanel'

/** For a plan shared to view: why nothing can be changed, and the way to a copy that can. */
function ViewOnlyNote() {
  return (
    <div className="m-3 space-y-2 rounded-lg border bg-muted/50 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <Eye className="size-4" /> {t('Shared with you to view')}
      </p>
      <p className="text-xs text-muted-foreground">{t('You can look around, measure and walk through it in 3D. To change it, make your own copy.')}</p>
      <Button size="sm" variant="outline" onClick={makeOwnCopy}>
        <Copy /> {t('Make a copy')}
      </Button>
    </div>
  )
}

/**
 * The sheet's grip: drag it up for the whole screen, down to half or away; tap it to switch between half and full.
 * While dragging, the sheet follows the finger (`onDrag`, a height in px, or null when let go).
 */
function Grip({ onDrag }: { onDrag: (h: number | null) => void }) {
  const start = useRef<{ y: number; h: number; moved: boolean } | null>(null)
  const full = useUi((s) => s.sheetFull)
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    const sheet = e.currentTarget.parentElement!
    start.current = { y: e.clientY, h: sheet.getBoundingClientRect().height, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const s = start.current
    if (!s) return
    const dy = e.clientY - s.y
    if (!s.moved && Math.abs(dy) < 4) return
    s.moved = true
    onDrag(Math.max(80, s.h - dy))
  }
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    const s = start.current
    start.current = null
    onDrag(null)
    if (!s) return
    const ui = useUi.getState()
    if (!s.moved) {
      ui.setSheetFull(!full)
      return
    }
    // Where it was let go: away below a third of the way, the whole screen above two thirds, else half.
    const parent = e.currentTarget.parentElement!.parentElement!.getBoundingClientRect().height
    const h = s.h - (e.clientY - s.y)
    if (h < parent * 0.3) ui.setSidebarOpen(false)
    else ui.setSheetFull(h > parent * 0.7)
  }
  return (
    <div
      className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      role="separator"
      aria-label={full ? t('Show half the panel') : t('Show the whole panel')}
    >
      <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
    </div>
  )
}

/**
 * The panel: properties of what's picked, the library and the summary. Beside the plan on wide screens; over it on
 * smaller landscape ones (a drawer from the side) and from the bottom on portrait ones (a sheet that leaves the plan
 * its full width, half the screen or all of it).
 */
export function Sidebar({ open }: { open: boolean }) {
  const tab = useUi((s) => s.sidebarTab)
  const setTab = useUi((s) => s.setSidebarTab)
  const setOpen = useUi((s) => s.setSidebarOpen)
  const sheetFull = useUi((s) => s.sheetFull)
  const viewOnly = useEditor((s) => isViewOnly(s.project))
  const { panel } = useLayout()
  const [dragH, setDragH] = useState<number | null>(null)

  // Jump to properties when something gets selected.
  useEffect(() => {
    const key = (s: ReturnType<typeof useEditor.getState>) =>
      s.selection ? (s.selection.kind === 'multi' ? `multi:${s.selection.items.length}` : `${s.selection.kind}:${s.selection.id}`) : ''
    return useEditor.subscribe((s, prev) => {
      const k = key(s)
      if (k && k !== key(prev)) useUi.getState().setSidebarTab('properties')
    })
  }, [])

  const sheet = panel === 'sheet'
  const overlay = panel !== 'docked'

  return (
    <aside
      className={cn(
        'flex flex-col bg-background',
        panel === 'docked' && 'w-80 shrink-0 border-s',
        panel === 'drawer' && 'absolute inset-y-0 end-0 z-20 w-[min(360px,85vw)] border-s shadow-xl',
        sheet && 'absolute inset-x-0 bottom-0 z-20 mx-auto w-full max-w-160 rounded-t-2xl border-x border-t shadow-[0_-8px_30px_rgb(0_0_0/0.18)]',
        sheet && dragH === null && 'transition-[height] duration-200',
        !open && 'hidden',
      )}
      style={sheet ? { height: dragH ?? (sheetFull ? '100%' : '50%') } : undefined}
      data-sheet={sheet || undefined}
      data-tour="sidebar"
    >
      {sheet && <Grip onDrag={setDragH} />}
      <Tabs value={tab} onValueChange={(v) => setTab(v as SidebarTab)} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className={cn('flex items-center gap-1 border-b p-2', sheet && 'pt-0')}>
          <TabsList className="min-w-0 flex-1">
            <TabsTrigger value="properties">{t('Properties')}</TabsTrigger>
            <TabsTrigger value="library">{t('Library')}</TabsTrigger>
            <TabsTrigger value="summary">{t('Summary')}</TabsTrigger>
          </TabsList>
          {overlay && (
            <Button
              variant="ghost"
              size="icon"
              className={cn('shrink-0', sheet && 'size-[30px]! min-h-0! min-w-0! rounded-full bg-foreground/8 text-muted-foreground [&_svg]:size-[18px]')}
              onClick={() => setOpen(false)}
              aria-label={t('Close')}
            >
              <X />
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <TabsContent value="properties">
            {viewOnly && <ViewOnlyNote />}
            {/* Shared to view: every field shows, none can be changed. */}
            <fieldset disabled={viewOnly} className="m-0 min-w-0 border-0 p-0">
              <PropertiesPanel />
            </fieldset>
          </TabsContent>
          <TabsContent value="library">{viewOnly ? <ViewOnlyNote /> : <LibraryPanel />}</TabsContent>
          <TabsContent value="summary">
            <SummaryPanel />
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  )
}
