import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Armchair,
  BrickWall,
  Cable,
  Fence,
  Hand,
  Maximize,
  MousePointer2,
  Pentagon,
  PencilLine,
  Plus,
  RectangleHorizontal,
  Ruler,
  ScanLine,
  Scissors,
  SlidersHorizontal,
  SquareDashedBottom,
  SquareDashedMousePointer,
  Trees,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLayout } from '@/hooks/use-layout'
import { cn } from '@/lib/utils'
import type { Tool } from '@/model/types'
import { addLShapeRoomAtCenter, addRectRoomAtCenter, isViewOnly, useEditor } from '@/store/editor'
import { togglePanel, useUi } from '@/store/ui'
import { isRtl, t } from '@/i18n'

const TOOLS: { tool: Tool; icon: LucideIcon; label: string; key: string }[] = [
  { tool: 'select', icon: MousePointer2, label: 'Select & move (Shift + click to add)', key: 'V' },
  { tool: 'area', icon: SquareDashedMousePointer, label: 'Select several (drag a box)', key: 'M' },
  { tool: 'room', icon: Pentagon, label: 'Draw room (click corners)', key: 'P' },
  { tool: 'rect', icon: RectangleHorizontal, label: 'Draw rectangular room (drag)', key: 'R' },
  { tool: 'balcony', icon: Fence, label: 'Draw balcony (drag)', key: 'B' },
  { tool: 'terrace', icon: Trees, label: 'Draw terrace (drag)', key: 'T' },
  { tool: 'divide', icon: Scissors, label: 'Divide a room in two, with no wall between', key: 'S' },
  { tool: 'partition', icon: BrickWall, label: 'Draw a wall on its own (click its two ends)', key: 'L' },
  { tool: 'dimension', icon: Ruler, label: 'Dimension line', key: 'D' },
  { tool: 'pan', icon: Hand, label: 'Pan', key: 'H' },
]

/** The drawing tools, grouped under one button on a phone. */
const DRAW_TOOLS: { tool: Tool; icon: LucideIcon; label: string; key: string }[] = [
  { tool: 'rect', icon: RectangleHorizontal, label: 'Rectangular room (drag)', key: 'R' },
  { tool: 'room', icon: Pentagon, label: 'Room of any shape (corner by corner)', key: 'P' },
  { tool: 'balcony', icon: Fence, label: 'Balcony (drag)', key: 'B' },
  { tool: 'terrace', icon: Trees, label: 'Terrace (drag)', key: 'T' },
  { tool: 'divide', icon: Scissors, label: 'Divide a room in two, with no wall between', key: 'S' },
  { tool: 'partition', icon: BrickWall, label: 'Wall on its own (its two ends)', key: 'L' },
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

/** A button in the bottom bar: an icon with its name under it, big enough for a thumb. */
function BarButton({ label, icon: Icon, active, onClick, tour, ...rest }: { label: string; icon: LucideIcon; active?: boolean; onClick?: () => void; tour?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-tour={tour}
      onClick={onClick}
      {...rest}
      className={cn(
        'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[11px] leading-none font-medium text-muted-foreground transition-colors',
        active ? 'text-primary' : 'active:bg-muted',
      )}
    >
      <span className={cn('grid h-7 w-12 place-items-center rounded-full transition-colors [&>svg]:size-5', active && 'bg-primary/15')}>
        <Icon />
      </span>
      <span className="max-w-full truncate">{label}</span>
    </button>
  )
}

/** The drawing tools in a menu, with the quick rooms and importing a drawing. `trigger` is the button that opens it. */
function DrawMenu({ trigger, side }: { trigger: ReactNode; side: 'top' | 'right' | 'left' }) {
  const setTool = useEditor((s) => s.setTool)
  const touch = useLayout().touch
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={side === 'top' ? 'center' : 'start'} className="w-72">
        <DropdownMenuLabel>{t('Draw')}</DropdownMenuLabel>
        {DRAW_TOOLS.map(({ tool, icon: Icon, label, key }) => (
          <DropdownMenuItem key={tool} onSelect={() => setTool(tool)}>
            <Icon /> {t(label)}
            {!touch && <DropdownMenuShortcut>{key}</DropdownMenuShortcut>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => addRectRoomAtCenter()}>
          <Plus /> {t('Add 4 × 3 m room')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={addLShapeRoomAtCenter}>
          <SquareDashedBottom /> {t('Add L-shaped room')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => useUi.getState().openImport('current')}>
          <ScanLine /> {t('Import a sketch or photo')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The tools along the bottom of a phone held upright. */
export function BottomBar() {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const layer = useEditor((s) => s.layer)
  const viewOnly = useEditor((s) => isViewOnly(s.project))
  const open = useUi((s) => s.sidebarOpen)
  const tab = useUi((s) => s.sidebarTab)
  const drawing = DRAW_TOOLS.find((d) => d.tool === tool)

  return (
    <nav className="flex shrink-0 items-stretch gap-0.5 border-t bg-background px-1" data-tour="tools">
      <BarButton label={t('Select')} icon={MousePointer2} active={tool === 'select'} onClick={() => setTool('select')} />
      {!viewOnly && (
        <>
          <BarButton label={t('Box')} icon={SquareDashedMousePointer} active={tool === 'area'} onClick={() => setTool('area')} />
          <DrawMenu side="top" trigger={<BarButton label={t('Draw')} icon={drawing?.icon ?? PencilLine} active={!!drawing} tour="import" />} />
          <BarButton label={t('Measure')} icon={Ruler} active={tool === 'dimension'} onClick={() => setTool('dimension')} />
          {layer === 'lighting' && <BarButton label={t('Wiring')} icon={Cable} active={tool === 'wire'} onClick={() => setTool('wire')} />}
          <BarButton label={t('Add')} icon={Armchair} active={open && tab === 'library'} onClick={() => togglePanel('library')} />
        </>
      )}
      <BarButton label={t('Properties')} icon={SlidersHorizontal} active={open && tab !== 'library'} onClick={() => togglePanel('properties')} tour="sidebar" />
    </nav>
  )
}

/** The tools down the side: all of them on a tablet or computer; grouped on a phone turned on its side. */
export function Toolbar() {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const requestFit = useEditor((s) => s.requestFit)
  const layer = useEditor((s) => s.layer)
  const { compact, touch } = useLayout()
  // Shared to view: only the tools for looking around.
  const viewOnly = useEditor((s) => isViewOnly(s.project))
  const tools = viewOnly ? TOOLS.filter((x) => x.tool === 'select' || x.tool === 'pan') : TOOLS
  const key = (k: string) => (touch ? '' : ` (${k})`)

  if (compact) {
    const drawing = DRAW_TOOLS.find((d) => d.tool === tool)
    const DrawIcon = drawing?.icon ?? PencilLine
    return (
      <nav className="flex w-13 shrink-0 flex-col items-center gap-1 overflow-y-auto border-e bg-background py-2" data-tour="tools">
        <ToolButton label={t('Select & move')} active={tool === 'select'} onClick={() => setTool('select')}>
          <MousePointer2 />
        </ToolButton>
        {!viewOnly && (
          <>
            <ToolButton label={t('Select several (drag a box)')} active={tool === 'area'} onClick={() => setTool('area')}>
              <SquareDashedMousePointer />
            </ToolButton>
            <DrawMenu
              side={isRtl() ? 'left' : 'right'}
              trigger={
                <Button
                  variant={drawing ? 'secondary' : 'ghost'}
                  size="icon-lg"
                  aria-label={t('Draw')}
                  data-tour="import"
                  className={cn(drawing && 'bg-primary/15 text-primary hover:bg-primary/20 dark:bg-primary/25')}
                >
                  <DrawIcon />
                </Button>
              }
            />
            <ToolButton label={t('Dimension line')} active={tool === 'dimension'} onClick={() => setTool('dimension')}>
              <Ruler />
            </ToolButton>
            {layer === 'lighting' && (
              <ToolButton label={t('Connect switches to lights (W)')} active={tool === 'wire'} onClick={() => setTool('wire')}>
                <Cable />
              </ToolButton>
            )}
            <ToolButton label={t('Add furniture, doors, lights…')} onClick={() => togglePanel('library')}>
              <Armchair />
            </ToolButton>
          </>
        )}
        <Separator className="my-1 w-7!" />
        <ToolButton label={t('Zoom to fit (F)')} onClick={requestFit}>
          <Maximize />
        </ToolButton>
      </nav>
    )
  }

  return (
    <nav className="flex w-13 shrink-0 flex-col items-center gap-1 overflow-y-auto border-e bg-background py-2" data-tour="tools">
      {tools.map(({ tool: id, icon: Icon, label, key: k }) => (
        <ToolButton key={id} label={`${t(label)}${key(k)}`} active={tool === id} onClick={() => setTool(id)}>
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
