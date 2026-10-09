import { t } from '@/i18n'
/**
 * "Design my home": say what each room is for and pick a style, see the suggested design on the plan (furniture laid
 * out around the doors and windows, finishes, ceilings, lights and switches), ask any room for another idea, and
 * apply it all as one step that can be undone.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ArrowLeft, Check, Eye, Maximize, RefreshCw, Sparkles, ZoomIn, ZoomOut } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader } from '@/components/ui/loader'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { usePlanTheme } from '@/hooks/use-plan-theme'
import { cn } from '@/lib/utils'
import { applyDesigns, DESIGN_STYLES, designRoom, ideaOf, isFurnished, nextIdea, ROOM_USES, USE_NAMES } from '@/model/design'
import type { DesignOptions, RoomDesign } from '@/model/design'
import { area, bbox, pointInPolygon, polygonPath } from '@/model/geometry'
import type { Point } from '@/model/types'
import { floorBounds } from '@/model/project'
import type { Floor, RoomUse } from '@/model/types'
import { formatArea } from '@/model/units'
import { useDesign } from '@/store/design'
import { currentFloor, draftFloor, useEditor } from '@/store/editor'
import { PlanLayers } from './PlanLayers'

type Toggle = 'floors' | 'walls' | 'ceilings' | 'lighting' | 'curtains' | 'ac'

/** What a design may change; switched off, the room's own stays as it is. */
const INCLUDE: { key: Toggle; label: string; hint: string }[] = [
  { key: 'floors', label: 'Floors', hint: 'Tiles, planks or carpet for each room' },
  { key: 'walls', label: 'Walls', hint: 'Paint, tiles, and an accent wall' },
  { key: 'ceilings', label: 'Gypsum ceilings', hint: 'With hidden LED strips and curtain pockets' },
  { key: 'lighting', label: 'Lights and switches', hint: 'Spots, pendants, bedside lights, wired up' },
  { key: 'curtains', label: 'Curtains and blinds', hint: 'Over windows and glass doors' },
  { key: 'ac', label: 'Air conditioning', hint: 'In the living room and bedrooms' },
]

const FURNITURE: { value: DesignOptions['furniture']; label: string }[] = [
  { value: 'replace', label: 'Replace mine' },
  { value: 'add', label: 'Keep mine, add what’s missing' },
  { value: 'none', label: 'Leave it as it is' },
]

export function DesignDialog() {
  const open = useDesign((s) => s.open)
  const close = useDesign((s) => s.close)
  // Previewing, it takes up most of the screen: the plan is the point.
  const previewing = useDesign((s) => !!s.designs)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        className={cn(
          'flex max-h-[94dvh] flex-col gap-4 overflow-hidden',
          previewing ? 'h-[94dvh] sm:max-w-[min(96vw,1600px)]' : 'sm:max-w-5xl',
        )}
      >
        {open && <Wizard />}
      </DialogContent>
    </Dialog>
  )
}

function Wizard() {
  const floor = useEditor((s) => currentFloor(s))
  const units = useEditor((s) => s.project.units)
  const rooms = useDesign((s) => s.rooms)
  const opts = useDesign((s) => s.opts)
  const variants = useDesign((s) => s.variants)
  const designs = useDesign((s) => s.designs)
  const setDesigns = (next: RoomDesign[] | null | ((d: RoomDesign[] | null) => RoomDesign[] | null)) =>
    useDesign.setState((st) => ({ designs: typeof next === 'function' ? next(st.designs) : next }))
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)

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
    setFocus(id)
    const current = designs?.find((d) => d.roomId === id)
    const room = floor.rooms.find((r) => r.id === id)
    if (!current || !room) return
    // The next idea that really is different from this one.
    const next = nextIdea(floor, room, rooms[id].use, uses, opts, current.variant, ideaOf(current))
    if (!next) {
      toast(t('No other layout fits this room'), { description: t('Move or remove something to make room for more ideas.') })
      return
    }
    useDesign.setState({ variants: { ...variants, [id]: next.variant } })
    setDesigns((list) => list && list.map((d) => (d.roomId === id ? next : d)))
  }
  const apply = () => {
    if (!designs) return
    useEditor.getState().commit((d) => applyDesigns(draftFloor(d), designs))
    // A room's "Another idea" (in its properties) carries on from the one applied.
    useDesign.setState({
      variants: Object.fromEntries(designs.map((d) => [d.roomId, d.variant])),
      shown: Object.fromEntries(designs.map((d) => [d.roomId, ideaOf(d)])),
    })
    useDesign.getState().close()
    toast.success(designs.length === 1 ? t('Designed 1 room') : t('Designed {n} rooms', { n: designs.length }), {
      description: t('Change anything you like, or undo it with Ctrl+Z.'),
    })
  }

  if (designs) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="size-5 text-primary" /> {t('Your design')}
          </DialogTitle>
          <DialogDescription>
            {t('Nothing on your plan has changed yet. Scroll to zoom and drag to look around; pick a room to zoom to it, ask it for another idea, then apply.')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 max-md:grid-rows-[minmax(300px,1fr)_auto] md:grid-cols-[1fr_280px]">
          <Preview designs={designs} focus={focus} onFocus={setFocus} />
          <div className="min-h-0 space-y-1.5 overflow-y-auto pe-1 max-md:max-h-48">
            {designs.map((d) => {
              const room = floor.rooms.find((r) => r.id === d.roomId)!
              const pieces = d.add.filter((s) => !s.room && !['spot', 'switch', 'wall-light', 'curtain', 'blind', 'shower-niche'].includes(s.type)).length
              return (
                <div
                  key={d.roomId}
                  role="button"
                  tabIndex={0}
                  onClick={() => setFocus(focus === d.roomId ? null : d.roomId)}
                  onKeyDown={(e) => e.key === 'Enter' && setFocus(focus === d.roomId ? null : d.roomId)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors hover:border-foreground/30',
                    focus === d.roomId && 'border-primary bg-primary/5 ring-1 ring-primary',
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{room.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t(USE_NAMES[d.use])} · {pieces === 1 ? t('1 item') : t('{n} items', { n: pieces })}
                      {d.variant ? ` · ${t('idea {n}', { n: d.variant + 1 })}` : ''}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      another(d.roomId)
                    }}
                    className="shrink-0"
                  >
                    <RefreshCw /> {t('Another idea')}
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              setDesigns(null)
              setFocus(null)
            }}
          >
            <ArrowLeft className="rtl-flip" /> {t('Back')}
          </Button>
          <Button onClick={apply}>
            <Check /> {t('Apply to my plan')}
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-xl">
          <Sparkles className="size-5 text-primary" /> {t('Design my home')}
        </DialogTitle>
        <DialogDescription>
          {t('Say what each room is for and pick a style. Furniture is laid out around your doors and windows, with room to walk and to open things.')}
        </DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 flex-1 gap-5 overflow-x-hidden overflow-y-auto md:grid-cols-[1fr_300px]">
        <section className="min-w-0 space-y-2">
          <h3 className="text-sm font-medium">{t('Rooms')}</h3>
          <div className="space-y-1.5">
            {floor.rooms
              .filter((r) => rooms[r.id])
              .map((r) => {
                const c = rooms[r.id]
                const furnished = isFurnished(floor, r)
                return (
                  <div key={r.id} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2', !c.on && 'opacity-60')}>
                    <Switch size="sm" checked={c.on} onCheckedChange={(on) => useDesign.getState().setRoom(r.id, { on })} aria-label={t('Design {room}', { room: r.name })} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatArea(area(r.points), units)}
                        {furnished && c.on && opts.furniture === 'replace' ? ` · ${t('its furniture is replaced')}` : ''}
                        {furnished && c.on && opts.furniture === 'add' ? ` · ${t('designed round its furniture')}` : ''}
                      </div>
                    </div>
                    <Select value={c.use} onValueChange={(v) => useDesign.getState().setRoom(r.id, { use: v as RoomUse })}>
                      <SelectTrigger size="sm" className="w-40" aria-label={t('What {room} is for', { room: r.name })}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROOM_USES.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {t(u.name)}
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
            <h3 className="text-sm font-medium">{t('Style')}</h3>
            <div className="grid gap-1.5">
              {DESIGN_STYLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => useDesign.getState().setOpts({ style: s.id })}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-3 py-2 text-start transition-colors hover:border-foreground/30',
                    opts.style === s.id && 'border-primary bg-primary/5 ring-1 ring-primary',
                  )}
                >
                  <span className="flex shrink-0 overflow-hidden rounded-md border">
                    {s.swatches.map((c) => (
                      <span key={c} className="h-8 w-3" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t(s.name)}</span>
                    <span className="block text-xs leading-snug text-muted-foreground">{t(s.hint)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t('What to design')}</h3>
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm">{t('Furniture')}</span>
              <Select value={opts.furniture} onValueChange={(v) => useDesign.getState().setOpts({ furniture: v as DesignOptions['furniture'] })}>
                <SelectTrigger size="sm" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FURNITURE.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {t(f.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {INCLUDE.map((i) => (
              <label key={i.key} className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-sm">{t(i.label)}</span>
                  <span className="block text-xs text-muted-foreground">{t(i.hint)}</span>
                </span>
                <Switch size="sm" checked={opts[i.key]} onCheckedChange={(v) => useDesign.getState().setOpts({ [i.key]: v })} />
              </label>
            ))}
            <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
              {t('Doors and windows are never changed. To keep a particular light, piece of furniture or curtain, select it and turn on “Keep when designing”.')}
            </p>
          </div>
        </section>
      </div>
      <DialogFooter className="gap-2">
        <Button variant="ghost" onClick={() => useDesign.getState().close()}>
          {t('Cancel')}
        </Button>
        <Button onClick={suggest} disabled={!chosen.length || busy || !(opts.furniture !== 'none' || INCLUDE.some((i) => opts[i.key]))}>
          {busy ? <Loader className="size-4" /> : <Sparkles />}
          {t('Suggest a design')}
        </Button>
      </DialogFooter>
    </>
  )
}

/** The middle and scale (px per cm) a plan is shown at. */
interface View {
  cx: number
  cy: number
  z: number
}

/** The view that fits these points into a box w × h px, with a margin. */
function fitView(pts: Point[], w: number, h: number, margin: number): View {
  const b = bbox(pts)
  const bw = b.maxX - b.minX + margin * 2
  const bh = b.maxY - b.minY + margin * 2
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, z: Math.min(w / bw, h / bh) }
}

/**
 * The plan as it would be with the designs applied, as big as there's room for: scroll to zoom (about the pointer),
 * drag to move, click a room to zoom to it; or see the plan as it is now, to compare.
 */
function Preview({ designs, focus, onFocus }: { designs: RoomDesign[]; focus: string | null; onFocus: (id: string | null) => void }) {
  const floor = useEditor((s) => currentFloor(s))
  const units = useEditor((s) => s.project.units)
  const images = useEditor((s) => s.project.images)
  const theme = usePlanTheme()
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 560 })
  const [now, setNow] = useState(false)
  const preview = useMemo(() => {
    const f: Floor = structuredClone(floor)
    applyDesigns(f, designs)
    return f
  }, [floor, designs])
  const all = useMemo(() => floorBounds(preview), [preview])
  const roomPts = (id: string | null) => preview.rooms.find((r) => r.id === id)?.points
  const fitted = (id: string | null) => {
    const pts = roomPts(id)
    return pts ? fitView(pts, size.w, size.h, 70) : fitView(all, size.w, size.h, 30)
  }
  const [view, setView] = useState<View | null>(null)
  // Following the room picked (in the list, or by clicking it).
  const [shownFocus, setShownFocus] = useState(focus)
  if (focus !== shownFocus) {
    setShownFocus(focus)
    setView(fitted(focus))
  }
  const v = view ?? fitted(focus)
  const viewRef = useRef(v)
  viewRef.current = v

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 560 }))
    ro.observe(el)
    // Zoom about the pointer (a wheel listener that can stop the page scrolling).
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', wheel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toPlan = (mx: number, my: number, at = viewRef.current): Point => ({ x: at.cx + (mx - size.w / 2) / at.z, y: at.cy + (my - size.h / 2) / at.z })
  function zoomAt(mx: number, my: number, factor: number) {
    const at = viewRef.current
    const el = ref.current
    const w = el?.clientWidth ?? size.w
    const h = el?.clientHeight ?? size.h
    const p = { x: at.cx + (mx - w / 2) / at.z, y: at.cy + (my - h / 2) / at.z }
    const z = Math.min(8, Math.max(0.05, at.z * factor))
    setView({ cx: p.x - (mx - w / 2) / z, cy: p.y - (my - h / 2) / z, z })
  }

  const drag = useRef<{ x: number; y: number; at: View; moved: boolean } | null>(null)
  const down = (e: ReactPointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, at: viewRef.current, moved: false }
  }
  const move = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    d.moved = true
    setView({ ...d.at, cx: d.at.cx - dx / d.at.z, cy: d.at.cy - dy / d.at.z })
  }
  const up = (e: ReactPointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
    // A click: zoom to the room under it (one that's being designed).
    const r = ref.current!.getBoundingClientRect()
    const p = toPlan(e.clientX - r.left, e.clientY - r.top)
    const room = preview.rooms.find((x) => designs.some((dd) => dd.roomId === x.id) && pointInPolygon(p, x.points))
    onFocus(room ? room.id : null)
  }

  const shown = now ? floor : preview
  const focusPts = roomPts(focus)
  const vb = `${v.cx - size.w / 2 / v.z} ${v.cy - size.h / 2 / v.z} ${size.w / v.z} ${size.h / v.z}`
  return (
    <div ref={ref} className="relative min-h-[300px] touch-none overflow-hidden rounded-xl border bg-muted/30 select-none">
      <svg
        viewBox={vb}
        width={size.w}
        height={size.h}
        className={cn('absolute inset-0', drag.current?.moved ? 'cursor-grabbing' : 'cursor-grab')}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        aria-label={now ? t('The plan as it is now') : t('The plan with the design')}
      >
        <PlanLayers floor={shown} units={units} theme={theme} scale={v.z} showWallLengths={false} showDimensions={false} images={images} />
        {focusPts && <path d={polygonPath(focusPts)} fill="none" stroke="var(--primary)" strokeWidth={3 / v.z} strokeDasharray={`${10 / v.z} ${6 / v.z}`} pointerEvents="none" />}
      </svg>
      <div className="absolute start-2 top-2 flex items-center gap-1 rounded-lg border bg-background/90 p-1 shadow-sm backdrop-blur">
        <Button variant={now ? 'ghost' : 'secondary'} size="xs" onClick={() => setNow(false)}>
          <Sparkles /> {t('Design')}
        </Button>
        <Button variant={now ? 'secondary' : 'ghost'} size="xs" onClick={() => setNow(true)}>
          <Eye /> {t('Now')}
        </Button>
      </div>
      <div className="absolute end-2 bottom-2 flex flex-col gap-1 rounded-lg border bg-background/90 p-1 shadow-sm backdrop-blur">
        <Button variant="ghost" size="icon-sm" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.3)} aria-label={t('Zoom in')}>
          <ZoomIn />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.3)} aria-label={t('Zoom out')}>
          <ZoomOut />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            onFocus(null)
            setView(fitted(null))
          }}
          aria-label={t('Show the whole plan')}
        >
          <Maximize />
        </Button>
      </div>
    </div>
  )
}
