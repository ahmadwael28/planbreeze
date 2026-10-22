import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Aperture, Copy, Download, RotateCcw, Square } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { t } from '@/i18n'
import { currentFloor, useEditor } from '@/store/editor'
import { useUi } from '@/store/ui'
import { viewAspect } from '@/three/renderSource'
import type { RenderJob } from '@/three/render'

const on = 'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground'

/** How big: its longer side (px), the other as the view's shape has it. */
const SIZES = [
  { id: 'hd', name: 'HD', long: 1280 },
  { id: 'full', name: 'Full HD', long: 1920 },
  { id: '4k', name: '4K', long: 3840 },
] as const

/** How long it goes on: samples (passes over every pixel), each taking a little grain away. */
const QUALITIES = [
  { id: 'draft', name: 'Draft', samples: 64 },
  { id: 'good', name: 'Good', samples: 300 },
  { id: 'best', name: 'Best', samples: 1200 },
] as const

type Phase = 'setup' | 'preparing' | 'rendering' | 'done'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

const safe = (s: string) => s.replace(/[^\p{L}\p{N}\- ]+/gu, '').trim().replace(/\s+/g, '-') || 'plan'

/** Its file name: the plan's and floor's names, and when it was made. */
function fileName() {
  const st = useEditor.getState()
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${safe(st.project.name)}-${safe(currentFloor(st).name)}-render ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.png`
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * A realistic render of the 3D view as it's seen: path traced (see three/render), at a size and a quality, shown as
 * it's drawn (the grain going as the samples come in), to stop when it's good enough, then save or copy.
 */
export function RenderDialog() {
  const open = useUi((s) => s.renderOpen)
  const setOpen = useUi((s) => s.openRender)
  const [size, setSize] = useState<(typeof SIZES)[number]['id']>('full')
  const [quality, setQuality] = useState<(typeof QUALITIES)[number]['id']>('good')
  const [smooth, setSmooth] = useState(true)
  // A little brighter than the view: lit only by its lights and the sky, with no fill light added.
  const [exposure, setExposure] = useState(1.4)
  const [phase, setPhase] = useState<Phase>('setup')
  const [prepared, setPrepared] = useState(0)
  const [samples, setSamples] = useState(0)
  const [started, setStarted] = useState(0)
  const [now, setNow] = useState(0)
  const job = useRef<RenderJob | null>(null)
  const abort = useRef<AbortController | null>(null)
  const preview = useRef<HTMLDivElement>(null)
  const target = QUALITIES.find((q) => q.id === quality)!.samples

  const long = SIZES.find((s) => s.id === size)!.long
  const aspect = open ? viewAspect() : 16 / 9
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  const [w, h] = aspect >= 1 ? [long, even(long / aspect)] : [even(long * aspect), long]

  // Back to the start, the render (if any) let go.
  const reset = () => {
    abort.current?.abort()
    abort.current = null
    job.current?.dispose()
    job.current = null
    preview.current?.replaceChildren()
    setPhase('setup')
  }
  useEffect(() => {
    if (!open) reset()
  }, [open])
  useEffect(() => () => reset(), [])

  // The time it's taken, while it's going.
  useEffect(() => {
    if (phase !== 'preparing' && phase !== 'rendering') return
    const id = setInterval(() => setNow(performance.now()), 500)
    return () => clearInterval(id)
  }, [phase])

  const start = async () => {
    reset()
    useEditor.setState({ selection: null })
    setPhase('preparing')
    setPrepared(0)
    setSamples(0)
    setStarted(performance.now())
    setNow(performance.now())
    const ctl = new AbortController()
    abort.current = ctl
    try {
      const { startRender } = await import('@/three/render')
      if (ctl.signal.aborted) return
      const j = await startRender({
        width: w,
        height: h,
        samples: target,
        exposure,
        smooth,
        signal: ctl.signal,
        onProgress: (p) => {
          if (ctl.signal.aborted) return
          setPhase(p.phase)
          setPrepared(p.prepared)
          setSamples(p.samples)
        },
        onLost: () => {
          toast.error(t('The graphics card stopped the render'), { description: t('Try a smaller size, or close other tabs using 3D.') })
          reset()
        },
      })
      if (ctl.signal.aborted) return j.dispose()
      job.current = j
      j.canvas.className = 'block max-h-full max-w-full rounded-md object-contain shadow-lg ring-1 ring-black/10'
      Object.assign(j.canvas.style, { width: 'auto', height: 'auto' })
      preview.current?.replaceChildren(j.canvas)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      toast.error(t('Could not render'), { description: (e as Error).message })
      setPhase('setup')
    }
  }

  const save = async () => {
    const b = await job.current?.toBlob()
    if (b) void import('@/utils/export').then((m) => m.saveBlob(b, fileName()))
  }
  const copy = async () => {
    const b = job.current?.toBlob()
    if (!b) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })])
      toast.success(t('Render copied'))
    } catch {
      toast.error(t('Could not copy it: save it instead.'))
    }
  }

  const busy = phase === 'preparing' || phase === 'rendering'
  const shown = phase === 'rendering' || phase === 'done'
  const elapsed = clock(now - started)
  const fraction = phase === 'preparing' ? prepared : Math.min(1, samples / target)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{t('Realistic render')}</DialogTitle>
          <DialogDescription>
            {t('The 3D view as it is now, with light bouncing round the rooms as a camera would see it: soft shadows, real reflections, every light that’s on. No AI: just more time for more detail.')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[1fr_300px] md:overflow-hidden">
          {/* The picture as it's drawn. */}
          <div className="relative grid min-h-[38vh] place-items-center bg-muted/50 p-4 md:min-h-0">
            <div ref={preview} className="grid h-full max-h-[64vh] w-full place-items-center" />
            {!shown && (
              <div className="absolute inset-0 grid place-content-center justify-items-center gap-2 p-6 text-center text-sm text-muted-foreground">
                <Aperture className="size-10 opacity-60" />
                {phase === 'preparing' ? t('Getting the scene ready… {pct}%', { pct: Math.round(prepared * 100) }) : t('Set it up, then start: the picture shows here as it’s drawn.')}
              </div>
            )}
          </div>

          {/* What, and how far it's got. */}
          <div className="flex min-h-0 flex-col border-t md:border-t-0 md:border-l">
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <Row label={t('Size')}>
                <ToggleGroup type="single" variant="outline" size="sm" value={size} onValueChange={(v) => v && setSize(v as typeof size)} disabled={busy} className="w-full">
                  {SIZES.map((s) => (
                    <ToggleGroupItem key={s.id} value={s.id} className={`flex-1 ${on}`}>
                      {s.name}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {w} × {h} px
                </p>
              </Row>
              <Row label={t('Quality')}>
                <ToggleGroup type="single" variant="outline" size="sm" value={quality} onValueChange={(v) => v && setQuality(v as typeof quality)} disabled={busy} className="w-full">
                  {QUALITIES.map((q) => (
                    <ToggleGroupItem key={q.id} value={q.id} className={`flex-1 ${on}`}>
                      {t(q.name)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <p className="text-xs text-muted-foreground">{t('{n} samples: more, less grain, longer to wait.', { n: target })}</p>
              </Row>
              <Row label={t('Brightness')}>
                <Slider
                  min={0.4}
                  max={2.5}
                  step={0.05}
                  value={[exposure]}
                  onValueChange={([v]) => {
                    setExposure(v)
                    job.current?.setExposure(v)
                  }}
                />
              </Row>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span>{t('Smooth out the grain')}</span>
                <Switch
                  size="sm"
                  checked={smooth}
                  onCheckedChange={(v) => {
                    setSmooth(v)
                    job.current?.setSmooth(v)
                  }}
                />
              </label>
              <p className="-mt-2 text-xs text-muted-foreground">{t('An edge-keeping filter, no AI. Off, the grain fades only with more samples.')}</p>

              {phase !== 'setup' && (
                <div className="space-y-1.5">
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(fraction * 100)}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {phase === 'preparing'
                      ? t('Getting the scene ready… {pct}%', { pct: Math.round(prepared * 100) })
                      : phase === 'rendering'
                        ? t('{n} of {total} samples · {time}', { n: samples, total: target, time: elapsed })
                        : t('Done: {n} samples', { n: samples })}
                  </p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 border-t p-4">
              {phase === 'setup' && (
                <Button className="flex-1" onClick={start}>
                  <Aperture /> {t('Render')}
                </Button>
              )}
              {busy && (
                <>
                  {phase === 'rendering' && (
                    <Button className="flex-1" onClick={() => job.current?.stop()}>
                      <Square /> {t('Stop here')}
                    </Button>
                  )}
                  <Button variant="outline" className="flex-1" onClick={reset}>
                    {t('Cancel')}
                  </Button>
                </>
              )}
              {phase === 'done' && (
                <>
                  <Button className="flex-1" onClick={save}>
                    <Download /> {t('Save')}
                  </Button>
                  <Button variant="outline" onClick={copy} aria-label={t('Copy')}>
                    <Copy />
                  </Button>
                  <Button variant="outline" onClick={start} aria-label={t('Render again')}>
                    <RotateCcw />
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
