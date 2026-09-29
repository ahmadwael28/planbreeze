import { useMemo } from 'react'
import { ArrowRight, PenLine, ScanLine } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { usePlanTheme } from '@/hooks/use-plan-theme'
import { bbox } from '@/model/geometry'
import { floorBounds, floorStats, newProject } from '@/model/project'
import { projectFromTemplate, TEMPLATES } from '@/model/templates'
import type { Template } from '@/model/templates'
import { formatArea } from '@/model/units'
import type { Floor } from '@/model/types'
import { useEditor } from '@/store/editor'
import { saveProject } from '@/store/storage'
import { useUi } from '@/store/ui'
import { PlanLayers } from './PlanLayers'

function Thumbnail({ floor }: { floor: Floor }) {
  const theme = usePlanTheme()
  const b = bbox(floorBounds(floor))
  const m = 40
  return (
    <svg
      viewBox={`${b.minX - m} ${b.minY - m} ${b.maxX - b.minX + m * 2} ${b.maxY - b.minY + m * 2}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <PlanLayers floor={floor} units="metric" theme={theme} scale={1} showLabels={false} />
    </svg>
  )
}

function openProjectNow(p: ReturnType<typeof newProject>) {
  saveProject(p)
  useEditor.getState().loadProject(p)
}

export function StartDialog() {
  const isOpen = useUi((s) => s.startOpen)
  const openStart = useUi((s) => s.openStart)
  const openImport = useUi((s) => s.openImport)
  const units = useEditor((s) => s.project.units)
  const previews = useMemo(
    () =>
      TEMPLATES.map((t) => {
        const floor = t.build()
        return { t, floor, area: floorStats(floor).interiorArea }
      }),
    [],
  )

  const pickTemplate = (t: Template) => {
    openProjectNow(projectFromTemplate(t))
    openStart(false)
  }
  const blank = () => {
    openProjectNow(newProject('My plan'))
    useEditor.getState().setTool('rect')
    openStart(false)
  }
  const fromDrawing = () => {
    openStart(false)
    openImport('new')
  }

  return (
    <Dialog open={isOpen} onOpenChange={openStart}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Start a new plan</DialogTitle>
          <DialogDescription>Pick the quickest way in. You can change everything afterwards.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={fromDrawing}
            className="group relative flex flex-col gap-3 overflow-hidden rounded-xl border-2 border-primary/40 bg-primary/5 p-5 text-left transition-colors hover:border-primary hover:bg-primary/10"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
              <ScanLine className="size-5.5" />
            </span>
            <span>
              <span className="flex items-center gap-2 text-base font-semibold">
                From a drawing or photo
                <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary-foreground uppercase">
                  Fastest
                </span>
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">
                Snap a hand sketch or an existing plan. Rooms are detected for you.
              </span>
            </span>
            <ArrowRight className="absolute top-5 right-5 size-5 text-primary transition-transform group-hover:translate-x-1" />
          </button>
          <button
            onClick={blank}
            className="group relative flex flex-col gap-3 rounded-xl border p-5 text-left transition-colors hover:border-foreground/30 hover:bg-muted/50"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-muted text-foreground">
              <PenLine className="size-5.5" />
            </span>
            <span>
              <span className="text-base font-semibold">Draw it yourself</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                Start empty and drag out rooms. Type sizes for exact walls.
              </span>
            </span>
            <ArrowRight className="absolute top-5 right-5 size-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </button>
        </div>

        <div className="space-y-2.5">
          <h3 className="text-sm font-medium">Or begin with a ready-made layout</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {previews.map(({ t, floor, area }) => (
              <button
                key={t.id}
                onClick={() => pickTemplate(t)}
                className="flex flex-col overflow-hidden rounded-xl border text-left transition-colors hover:border-primary"
              >
                <div className="aspect-[4/3] bg-muted/40 p-2">
                  <Thumbnail floor={floor} />
                </div>
                <div className="border-t px-3 py-2">
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {floor.rooms.length} rooms · {formatArea(area, units)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
