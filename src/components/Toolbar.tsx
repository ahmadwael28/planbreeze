import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Cable, Fence, Hand, Scissors, SquareDashedMousePointer, Trees, Maximize, MousePointer2, Pentagon, Plus, RectangleHorizontal, Ruler, ScanLine, SquareDashedBottom, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Tool } from '@/model/types'
import { addLShapeRoomAtCenter, addRectRoomAtCenter, isViewOnly, useEditor } from '@/store/editor'
import { useUi } from '@/store/ui'
import { isRtl, t } from '@/i18n'

const TOOLS: { tool: Tool; icon: LucideIcon; label: string; key: string }[] = [
  { tool: 'select', icon: MousePointer2, label: 'Select & move (Shift + click to add)', key: 'V' },
  { tool: 'area', icon: SquareDashedMousePointer, label: 'Select several (drag a box)', key: 'M' },
  { tool: 'room', icon: Pentagon, label: 'Draw room (click corners)', key: 'P' },
  { tool: 'rect', icon: RectangleHorizontal, label: 'Draw rectangular room (drag)', key: 'R' },
  { tool: 'balcony', icon: Fence, label: 'Draw balcony (drag)', key: 'B' },
  { tool: 'terrace', icon: Trees, label: 'Draw terrace (drag)', key: 'T' },
  { tool: 'divide', icon: Scissors, label: 'Divide a room in two, with no wall between', key: 'S' },
  { tool: 'dimension', icon: Ruler, label: 'Dimension line', key: 'D' },
  { tool: 'pan', icon: Hand, label: 'Pan', key: 'H' },
]

export function zoomBy(f: number) {
  const { view, viewport, setView } = useEditor.getState()
  const zoom = Math.min(8, Math.max(0.05, view.zoom * f))
  const cx = viewport.w / 2
  const cy = viewport.h / 2
  setView({ zoom, panX: cx - ((cx - view.panX) * zoom) / view.zoom, panY: cy - ((cy - view.panY) * zoom) / view.zoom })
}

function ToolButton({ label, active, onClick, tour, children }: { label: string; active?: boolean; onClick: () => void; tour?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? 'secondary' : 'ghost'}
          size="icon-lg"
          aria-label={label}
          data-tour={tour}
          aria-pressed={active}
          onClick={onClick}
          className={cn(active && 'bg-primary/15 text-primary hover:bg-primary/20 dark:bg-primary/25')}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={isRtl() ? 'left' : 'right'}>{label}</TooltipContent>
    </Tooltip>
  )
}

export function Toolbar() {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const requestFit = useEditor((s) => s.requestFit)
  const layer = useEditor((s) => s.layer)
  // Shared to view: only the tools for looking around.
  const viewOnly = useEditor((s) => isViewOnly(s.project))
  const tools = viewOnly ? TOOLS.filter((x) => x.tool === 'select' || x.tool === 'pan') : TOOLS

  return (
    <nav className="flex w-13 shrink-0 flex-col items-center gap-1 overflow-y-auto border-e bg-background py-2" data-tour="tools">
      {tools.map(({ tool: id, icon: Icon, label, key }) => (
        <ToolButton key={id} label={`${t(label)} (${key})`} active={tool === id} onClick={() => setTool(id)}>
          <Icon />
        </ToolButton>
      ))}
      {layer === 'lighting' && !viewOnly && (
        <ToolButton label={t('Connect switches to lights (W)')} active={tool === 'wire'} onClick={() => setTool('wire')}>
          <Cable />
        </ToolButton>
      )}
      {!viewOnly && (
        <>
          <Separator className="my-1 w-7!" />
          <ToolButton label={t('Add 4 × 3 m room')} onClick={() => addRectRoomAtCenter()}>
            <Plus />
          </ToolButton>
          <ToolButton label={t('Add L-shaped room')} onClick={addLShapeRoomAtCenter}>
            <SquareDashedBottom />
          </ToolButton>
          <ToolButton label={t('Import a sketch or photo')} onClick={() => useUi.getState().openImport('current')} tour="import">
            <ScanLine />
          </ToolButton>
        </>
      )}
      <Separator className="my-1 w-7!" />
      <ToolButton label={t('Zoom in (+)')} onClick={() => zoomBy(1.25)}>
        <ZoomIn />
      </ToolButton>
      <ToolButton label={t('Zoom out (−)')} onClick={() => zoomBy(0.8)}>
        <ZoomOut />
      </ToolButton>
      <ToolButton label={t('Zoom to fit (F)')} onClick={requestFit}>
        <Maximize />
      </ToolButton>
    </nav>
  )
}
