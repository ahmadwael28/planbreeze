/**
 * "Design my home": say what each room is for and pick a style, see the suggested design on the plan (furniture laid
 * out around the doors and windows, finishes, ceilings, lights and switches), ask any room for another idea, and
 * apply it all as one step that can be undone.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader } from '@/components/ui/loader'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { usePlanTheme } from '@/hooks/use-plan-theme'
import { cn } from '@/lib/utils'
import { applyDesigns, DESIGN_STYLES, designRoom, isFurnished, ROOM_USES, USE_NAMES } from '@/model/design'
import type { DesignOptions, RoomDesign } from '@/model/design'
import { area, bbox } from '@/model/geometry'
import { floorBounds } from '@/model/project'
import type { RoomUse } from '@/model/types'
import { formatArea } from '@/model/units'
import { useDesign } from '@/store/design'
import { currentFloor, draftFloor, useEditor } from '@/store/editor'
import { PlanLayers } from './PlanLayers'

const INCLUDE: { key: keyof Omit<DesignOptions, 'style'>; label: string; hint: string }[] = [
  { key: 'furniture', label: 'Furniture', hint: 'Laid out around the doors and windows' },
  { key: 'finishes', label: 'Floors and walls', hint: 'Flooring, paint, tiles and an accent wall' },
  { key: 'lighting', label: 'Ceilings and lighting', hint: 'Gypsum ceilings, lights and their switches' },
  { key: 'ac', label: 'Air conditioning', hint: 'In the living room and bedrooms' },
]

export function DesignDialog() {
  const open = useDesign((s) => s.open)
  const close = useDesign((s) => s.close)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[94dvh] flex-col gap-4 overflow-hidden sm:max-w-5xl">{open && <Wizard />}</DialogContent>
    </Dialog>
  )
}

function Wizard() {
  const floor = useEditor((s) => currentFloor(s))
  const units = useEditor((s) => s.project.units)
  const rooms = useDesign((s) => s.rooms)
  const opts = useDesign((s) => s.opts)
  const variants = useDesign((s) => s.variants)
  const [designs, setDesigns] = useState<RoomDesign[] | null>(null)
  const [busy, setBusy] = useState(false)

  const chosen = floor.rooms.filter((r) => rooms[r.id]?.on)
  const uses = useMemo(() => new Map(Object.entries(rooms).map(([id, c]) => [id, c.use])), [rooms])
  const run = (ids: string[], next: Record<string, number>) =>
    floor.rooms.filter((r) => ids.includes(r.id)).map((r) => designRoom(floor, r, rooms[r.id].use, uses, opts, next[r.id] ?? 0))

  const suggest = () => {
    setBusy(true)
    // Let the dialog show it's working before the (short) number crunching.
    window.setTimeout(() => {
      setDesigns(run(chosen.map((r) => r.id), variants))
      setBusy(false)
    }, 30)
  }
  const another = (id: string) => {
    const next = { ...variants, [id]: (variants[id] ?? 0) + 1 }
    useDesign.setState({ variants: next })
    setDesigns((list) => list && list.map((d) => (d.roomId === id ? run([id], next)[0] : d)))
  }
  const apply = () => {
    if (!designs) return
    useEditor.getState().commit((d) => applyDesigns(draftFloor(d), designs))
    // A room's "Another idea" (in its properties) carries on from the one applied.
    useDesign.setState({ variants: Object.fromEntries(designs.map((d) => [d.roomId, d.variant])) })
    useDesign.getState().close()
    toast.success(`Designed ${designs.length} room${designs.length === 1 ? '' : 's'}`, { description: 'Change anything you like, or undo it with Ctrl+Z.' })
  }

  if (designs) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="size-5 text-primary" /> Your design
          </DialogTitle>
          <DialogDescription>Nothing on your plan has changed yet. Ask any room for another idea, then apply it.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[1fr_260px]">
          <Preview designs={designs} />
          <div className="min-h-0 space-y-1.5 overflow-y-auto pr-1">
            {designs.map((d) => {
              const room = floor.rooms.find((r) => r.id === d.roomId)!
              const pieces = d.add.filter((s) => !s.room && !['spot', 'switch', 'wall-light', 'curtain', 'blind', 'shower-niche'].includes(s.type)).length
              return (
                <div key={d.roomId} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{room.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {USE_NAMES[d.use]} · {pieces} item{pieces === 1 ? '' : 's'}
                      {d.variant ? ` · idea ${d.variant + 1}` : ''}
                    </div>
                  </div>
                  <Button variant="outline" size="xs" onClick={() => another(d.roomId)} className="shrink-0">
                    <RefreshCw /> Another idea
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => setDesigns(null)}>
            <ArrowLeft /> Back
          </Button>
          <Button onClick={apply}>
            <Check /> Apply to my plan
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-xl">
          <Sparkles className="size-5 text-primary" /> Design my home
        </DialogTitle>
        <DialogDescription>
          Say what each room is for and pick a style. Furniture is laid out around your doors and windows, with room to walk and
          to open things.
        </DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 flex-1 gap-5 overflow-x-hidden overflow-y-auto md:grid-cols-[1fr_300px]">
        <section className="min-w-0 space-y-2">
          <h3 className="text-sm font-medium">Rooms</h3>
          <div className="space-y-1.5">
            {floor.rooms
              .filter((r) => rooms[r.id])
              .map((r) => {
                const c = rooms[r.id]
                const furnished = isFurnished(floor, r)
                return (
                  <div key={r.id} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2', !c.on && 'opacity-60')}>
                    <Switch size="sm" checked={c.on} onCheckedChange={(on) => useDesign.getState().setRoom(r.id, { on })} aria-label={`Design ${r.name}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatArea(area(r.points), units)}
                        {furnished && c.on && opts.furniture ? ' · its furniture is replaced' : ''}
                      </div>
                    </div>
                    <Select value={c.use} onValueChange={(v) => useDesign.getState().setRoom(r.id, { use: v as RoomUse })}>
                      <SelectTrigger size="sm" className="w-40" aria-label={`What ${r.name} is for`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROOM_USES.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )
              })}
          </div>
        </section>
        <section className="min-w-0 space-y-4">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Style</h3>
            <div className="grid gap-1.5">
              {DESIGN_STYLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => useDesign.getState().setOpts({ style: s.id })}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:border-foreground/30',
                    opts.style === s.id && 'border-primary bg-primary/5 ring-1 ring-primary',
                  )}
                >
                  <span className="flex shrink-0 overflow-hidden rounded-md border">
                    {s.swatches.map((c) => (
                      <span key={c} className="h-8 w-3" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{s.name}</span>
                    <span className="block text-xs leading-snug text-muted-foreground">{s.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Include</h3>
            {INCLUDE.map((i) => (
              <label key={i.key} className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-sm">{i.label}</span>
                  <span className="block text-xs text-muted-foreground">{i.hint}</span>
                </span>
                <Switch size="sm" checked={opts[i.key]} onCheckedChange={(v) => useDesign.getState().setOpts({ [i.key]: v })} />
              </label>
            ))}
          </div>
        </section>
      </div>
      <DialogFooter className="gap-2">
        <Button variant="ghost" onClick={() => useDesign.getState().close()}>
          Cancel
        </Button>
        <Button onClick={suggest} disabled={!chosen.length || busy || !(opts.furniture || opts.finishes || opts.lighting)}>
          {busy ? <Loader className="size-4" /> : <Sparkles />}
          Suggest a design
        </Button>
      </DialogFooter>
    </>
  )
}

/** The plan as it would be with the designs applied. */
function Preview({ designs }: { designs: RoomDesign[] }) {
  const floor = useEditor((s) => currentFloor(s))
  const units = useEditor((s) => s.project.units)
  const images = useEditor((s) => s.project.images)
  const theme = usePlanTheme()
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 600))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const preview = useMemo(() => {
    const f = structuredClone(floor)
    applyDesigns(f, designs)
    return f
  }, [floor, designs])
  const b = bbox(floorBounds(preview))
  const m = 40
  const vw = b.maxX - b.minX + m * 2
  const vh = b.maxY - b.minY + m * 2
  return (
    <div ref={ref} className="min-h-[260px] overflow-hidden rounded-xl border bg-muted/30">
      <svg viewBox={`${b.minX - m} ${b.minY - m} ${vw} ${vh}`} className="h-full max-h-[62dvh] w-full" preserveAspectRatio="xMidYMid meet" aria-label="The plan with the design">
        <PlanLayers floor={preview} units={units} theme={theme} scale={width / vw} showWallLengths={false} showDimensions={false} images={images} />
      </svg>
    </div>
  )
}
