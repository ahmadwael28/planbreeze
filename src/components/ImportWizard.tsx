import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, PointerEvent as RPointerEvent, ReactNode } from 'react'
import { Camera, ImageUp, Loader2, PenLine, ScanLine, Sparkles, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { usePlanTheme } from '@/hooks/use-plan-theme'
import { cn } from '@/lib/utils'
import { buildFloorContent, tidyRooms } from '@/import/convert'
import type { ImportResult } from '@/import/convert'
import { DEFAULT_DETECT, detectRooms } from '@/import/detect'
import type { Detection } from '@/import/detect'
import { imageForAi, loadImage } from '@/import/image'
import type { LoadedImage } from '@/import/image'
import { area, bbox, dist, polygonPath } from '@/model/geometry'
import { floorBounds, newProject } from '@/model/project'
import { formatLength } from '@/model/units'
import type { Floor, Point, Underlay } from '@/model/types'
import { currentFloor, draftFloor, useEditor } from '@/store/editor'
import { saveProject } from '@/store/storage'
import { useUi } from '@/store/ui'
import { LengthInput } from './LengthInput'
import { PlanLayers } from './PlanLayers'

type Method = 'auto' | 'ai' | 'trace'
type AiState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'done'; result: ImportResult; scaleSource: 'labels' | 'estimated' }

const KEY_STORAGE = 'fp.anthropicKey'
const MIN_ROOM_AREA = 10000 // 1 m²

function readKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <span className="grid size-5 place-items-center rounded-full bg-primary text-[11px] text-primary-foreground">{n}</span>
        {title}
      </h4>
      {children}
    </section>
  )
}

/** The drawing with an adjustable measuring line and the detected outlines on top. */
function DrawingPreview({
  img,
  outlines,
  line,
  onLine,
  showLine,
}: {
  img: LoadedImage
  outlines: Point[][]
  line: { a: Point; b: Point }
  onLine: (l: { a: Point; b: Point }) => void
  showLine: boolean
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef<'a' | 'b' | null>(null)
  const r = Math.max(img.width, img.height) * 0.014

  const toImage = (e: RPointerEvent) => {
    const svg = svgRef.current!
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse())
    return { x: Math.min(img.width, Math.max(0, pt.x)), y: Math.min(img.height, Math.max(0, pt.y)) }
  }

  const handle = (which: 'a' | 'b') => (
    <circle
      cx={line[which].x}
      cy={line[which].y}
      r={r}
      className="cursor-grab fill-background stroke-primary"
      strokeWidth={r * 0.35}
      onPointerDown={(e) => {
        dragging.current = which
        svgRef.current!.setPointerCapture(e.pointerId)
      }}
    />
  )

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${img.width} ${img.height}`}
      className="h-full w-full touch-none select-none"
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={(e) => {
        if (!dragging.current) return
        onLine({ ...line, [dragging.current]: toImage(e) })
      }}
      onPointerUp={() => (dragging.current = null)}
    >
      <image href={img.url} width={img.width} height={img.height} />
      {outlines.map((pts, i) => (
        <path
          key={i}
          d={polygonPath(pts)}
          className="fill-primary/20 stroke-primary"
          strokeWidth={r * 0.3}
          strokeLinejoin="round"
        />
      ))}
      {showLine && (
        <g>
          <line
            x1={line.a.x}
            y1={line.a.y}
            x2={line.b.x}
            y2={line.b.y}
            className="stroke-primary"
            strokeWidth={r * 0.45}
            strokeDasharray={`${r} ${r * 0.6}`}
          />
          {handle('a')}
          {handle('b')}
        </g>
      )}
    </svg>
  )
}

function ResultPreview({ floor, units }: { floor: Floor; units: 'metric' | 'imperial' }) {
  const theme = usePlanTheme()
  const pts = floorBounds(floor)
  if (!pts.length) {
    return <div className="grid h-full place-items-center text-sm text-muted-foreground">No rooms yet</div>
  }
  const b = bbox(pts)
  const m = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.06 + 20
  const w = b.maxX - b.minX + m * 2
  const h = b.maxY - b.minY + m * 2
  return (
    <svg viewBox={`${b.minX - m} ${b.minY - m} ${w} ${h}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <PlanLayers floor={floor} units={units} theme={theme} scale={560 / Math.max(w, h)} showWallLengths />
    </svg>
  )
}

// ---------------------------------------------------------------------------

export function ImportWizard() {
  const target = useUi((s) => s.importTarget)
  const openImport = useUi((s) => s.openImport)
  const units = useEditor((s) => s.project.units)
  const floorHasContent = useEditor((s) => {
    const f = currentFloor(s)
    return f.rooms.length + f.symbols.length > 0
  })

  const [img, setImg] = useState<LoadedImage | null>(null)
  const [loading, setLoading] = useState(false)
  const [method, setMethod] = useState<Method>('auto')
  const [line, setLine] = useState({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } })
  const [lineLen, setLineLen] = useState(500)
  const [scaleSet, setScaleSet] = useState(false)
  const [gap, setGap] = useState(DEFAULT_DETECT.gap)
  const [sensitivity, setSensitivity] = useState(DEFAULT_DETECT.sensitivity)
  const [detection, setDetection] = useState<Detection>({ rooms: [], doors: [] })
  const [detecting, setDetecting] = useState(false)
  const [apiKey, setApiKey] = useState(readKey)
  const [rememberKey, setRememberKey] = useState(() => !!readKey())
  const [ai, setAi] = useState<AiState>({ status: 'idle' })
  const [view, setView] = useState<'drawing' | 'result'>('drawing')
  const [keepUnderlay, setKeepUnderlay] = useState(true)
  const [replace, setReplace] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const open = target !== null
  const wall = useEditor((s) => s.project.defaultWallThickness)
  const cmPerPx = lineLen / Math.max(1, dist(line.a, line.b))

  const reset = () => {
    abortRef.current?.abort()
    setImg(null)
    setDetection({ rooms: [], doors: [] })
    setAi({ status: 'idle' })
    setView('drawing')
    setScaleSet(false)
    setReplace(false)
  }
  const close = () => {
    openImport(null)
    reset()
  }

  const applyImage = (im: LoadedImage, preset?: { a: Point; b: Point; len: number }) => {
    setImg(im)
    setAi({ status: 'idle' })
    setView('drawing')
    if (preset) {
      setLine({ a: preset.a, b: preset.b })
      setLineLen(preset.len)
      setScaleSet(true)
    } else {
      const y = im.height / 2
      setLine({ a: { x: im.width * 0.25, y }, b: { x: im.width * 0.75, y } })
      setLineLen(500)
      setScaleSet(false)
    }
  }

  const loadFile = async (file: Blob, name: string) => {
    setLoading(true)
    try {
      applyImage(await loadImage(file, name))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const loadSample = async () => {
    setLoading(true)
    try {
      const blob = await (await fetch(`${import.meta.env.BASE_URL}samples/hand-sketch.svg`)).blob()
      const im = await loadImage(blob, 'Hand sketch')
      const k = im.width / 1000 // the sample is drawn at 1 px = 1 cm on a 1000 px wide sheet
      applyImage(im, { a: { x: 70 * k, y: 62 * k }, b: { x: 930 * k, y: 62 * k }, len: 860 })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // Paste an image from the clipboard while the picker is showing.
  useEffect(() => {
    if (!open || img) return
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (file) loadFile(file, 'Pasted image')
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  // Re-run on-device detection when its inputs change.
  useEffect(() => {
    if (!img || method !== 'auto') return
    setDetecting(true)
    const id = setTimeout(() => {
      setDetection(detectRooms(img.work, { gap, sensitivity }))
      setDetecting(false)
    }, 80)
    return () => clearTimeout(id)
  }, [img, method, gap, sensitivity])

  // Rooms in cm from on-device detection.
  const autoResult = useMemo<ImportResult>(() => {
    if (!img) return { rooms: [], openings: [] }
    const k = img.workScale * cmPerPx
    const toCm = (q: Point) => ({ x: q.x * k, y: q.y * k })
    const rooms = detection.rooms.map((p) => p.map(toCm)).filter((p) => area(p) >= MIN_ROOM_AREA)
    const tidy = tidyRooms(rooms, wall).filter((p) => p.length >= 3 && area(p) >= MIN_ROOM_AREA)
    // Name rooms top-to-bottom, left-to-right.
    tidy.sort((p, q) => {
      const a = bbox(p)
      const b = bbox(q)
      return Math.abs(a.minY - b.minY) > 50 ? a.minY - b.minY : a.minX - b.minX
    })
    const openings = detection.doors.map(([a, b]) => {
      const [ca, cb] = [toCm(a), toCm(b)]
      return { kind: dist(ca, cb) > 130 ? ('opening' as const) : ('door' as const), a: ca, b: cb }
    })
    return { rooms: tidy.map((points, i) => ({ name: `Room ${i + 1}`, points })), openings }
  }, [img, detection, cmPerPx, wall])

  const result: ImportResult | null =
    method === 'auto' ? autoResult : method === 'ai' && ai.status === 'done' ? ai.result : null

  const previewFloor = useMemo<Floor | null>(() => {
    if (!result) return null
    const content = buildFloorContent(result, wall)
    return { id: 'preview', name: 'Preview', height: 250, ...content }
  }, [result, wall])

  const outlines = useMemo(
    () => (method === 'auto' ? autoResult.rooms.map((r) => r.points.map((p) => ({ x: p.x / cmPerPx, y: p.y / cmPerPx }))) : []),
    [method, autoResult, cmPerPx],
  )

  const runAi = async () => {
    if (!img || !apiKey.trim()) return
    try {
      if (rememberKey) localStorage.setItem(KEY_STORAGE, apiKey.trim())
      else localStorage.removeItem(KEY_STORAGE)
    } catch {
      // storage unavailable; keep the key for this session only
    }
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setAi({ status: 'running' })
    try {
      const [{ recognizePlan }, image] = await Promise.all([import('@/import/ai'), imageForAi(img)])
      const out = await recognizePlan(apiKey.trim(), image, ctrl.signal)
      const tidy = tidyRooms(out.result.rooms.map((r) => r.points), wall)
      const rooms = out.result.rooms
        .map((r, i) => ({ name: r.name, points: tidy[i] }))
        .filter((r) => r.points.length >= 3 && area(r.points) >= MIN_ROOM_AREA / 2)
      setAi({ status: 'done', result: { rooms, openings: out.result.openings }, scaleSource: out.scaleSource })
      setView('result')
    } catch (e) {
      if (!ctrl.signal.aborted) setAi({ status: 'error', message: (e as Error).message })
      else setAi({ status: 'idle' })
    }
  }

  const create = () => {
    if (!img) return
    const st = useEditor.getState()
    const res = method === 'trace' ? { rooms: [], openings: [] } : result
    if (!res) return
    const content = buildFloorContent(res, wall)
    const underlay: Underlay | undefined =
      method === 'trace' || (method === 'auto' && keepUnderlay)
        ? {
            src: img.url,
            x: 0,
            y: 0,
            width: img.width * cmPerPx,
            height: img.height * cmPerPx,
            opacity: method === 'trace' ? 0.6 : 0.35,
            visible: true,
          }
        : undefined

    if (target === 'new') {
      const p = newProject(img.name === 'Hand sketch' ? 'My sketch' : 'Imported plan')
      Object.assign(p.floors[0], content, { underlay })
      saveProject(p)
      st.loadProject(p)
    } else {
      // When adding next to existing content, place the import to the right of it.
      let dx = 0
      let dy = 0
      const floor = currentFloor(st)
      if (!replace && floor.rooms.length + floor.symbols.length) {
        const cur = bbox(floorBounds(floor))
        const mine = underlay ? { minX: 0, minY: 0 } : bbox(content.rooms.flatMap((r) => r.points))
        dx = cur.maxX + 200 - mine.minX
        dy = cur.minY - mine.minY
      }
      for (const r of content.rooms) r.points = r.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
      if (underlay) {
        underlay.x += dx
        underlay.y += dy
      }
      st.commit((d) => {
        const f = draftFloor(d)
        if (replace) {
          f.rooms = []
          f.symbols = []
        }
        f.rooms.push(...content.rooms)
        f.symbols.push(...content.symbols)
        if (underlay) f.underlay = underlay
      })
      st.select(null)
      st.requestFit()
    }
    if (st.viewMode !== '2d') st.setViewMode('2d')
    if (method === 'trace') {
      st.setTool('rect')
      toast.success('Drawing placed. Drag over each room to trace it.')
    } else {
      toast.success(
        `Created ${content.rooms.length} room${content.rooms.length === 1 ? '' : 's'}` +
          (content.symbols.length ? ` and ${content.symbols.length} doors/windows` : '') +
          '. Tap a room to fine-tune its walls.',
      )
    }
    close()
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
    if (file) loadFile(file, file.name)
  }

  const canCreate =
    !!img &&
    (method === 'trace' ||
      (method === 'auto' && autoResult.rooms.length > 0) ||
      (method === 'ai' && ai.status === 'done' && ai.result.rooms.length > 0))

  const scaleStep = (
    <Step n={1} title="Set the scale">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Drag the ends of the dashed line onto a wall whose length you know, such as one with a written dimension, then enter
        that length.
      </p>
      <div className="flex items-center gap-2">
        <Label className="shrink-0 font-normal text-muted-foreground">Line length</Label>
        <LengthInput
          value={lineLen}
          units={units}
          onChange={(v) => {
            setLineLen(v)
            setScaleSet(true)
          }}
        />
      </div>
      {!scaleSet && (
        <p className="rounded-md bg-amber-500/15 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          The scale is a guess until you set it. Room sizes depend on it.
        </p>
      )}
    </Step>
  )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Start from a drawing</DialogTitle>
          <DialogDescription>
            Use a photo, scan or hand sketch of a floor plan. Rooms are detected for you, or you can trace over it.
          </DialogDescription>
        </DialogHeader>

        {!img ? (
          <div className="overflow-y-auto p-5">
            <div
              className={cn(
                'flex flex-col items-center gap-4 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
                loading && 'opacity-60',
              )}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
            >
              <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                {loading ? <Loader2 className="size-7 animate-spin" /> : <ImageUp className="size-7" />}
              </div>
              <div>
                <p className="font-medium">Drop an image here, paste it, or choose a file</p>
                <p className="mt-1 text-sm text-muted-foreground">JPEG or PNG · photo, scan or screenshot</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => fileRef.current?.click()} disabled={loading}>
                  <ImageUp /> Choose image
                </Button>
                <Button variant="outline" onClick={() => cameraRef.current?.click()} disabled={loading}>
                  <Camera /> Take a photo
                </Button>
                <Button variant="ghost" onClick={loadSample} disabled={loading}>
                  <PenLine /> Try a sample sketch
                </Button>
              </div>
            </div>
            <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
              {[
                ['Shoot from straight above', 'Keep the paper flat and fill the frame. Avoid strong shadows.'],
                ['Draw walls as dark lines', 'Leave doorways as gaps. Arcs and furniture are fine.'],
                ['Write one dimension', 'e.g. “4.5 m” on a wall, so the plan comes out at the right size.'],
              ].map(([t, d]) => (
                <div key={t} className="rounded-lg bg-muted/60 p-3">
                  <p className="font-medium">{t}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{d}</p>
                </div>
              ))}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) loadFile(f, f.name)
              }}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) loadFile(f, 'Photo')
              }}
            />
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[1fr_340px] md:overflow-hidden">
            {/* preview */}
            <div className="relative flex min-h-[42vh] flex-col bg-muted/40 md:min-h-0">
              {result && (
                <div className="absolute top-3 left-3 z-10">
                  <ToggleGroup
                    type="single"
                    size="sm"
                    variant="outline"
                    value={view}
                    onValueChange={(v) => v && setView(v as 'drawing' | 'result')}
                    className="bg-background"
                  >
                    <ToggleGroupItem value="drawing" className="px-3">
                      Drawing
                    </ToggleGroupItem>
                    <ToggleGroupItem value="result" className="px-3">
                      Result
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              )}
              <div className="min-h-0 flex-1 p-4 pt-14">
                {view === 'result' && previewFloor ? (
                  <ResultPreview floor={previewFloor} units={units} />
                ) : (
                  <DrawingPreview
                    img={img}
                    outlines={outlines}
                    line={line}
                    onLine={(l) => {
                      setLine(l)
                      setScaleSet(true)
                    }}
                    showLine={method !== 'ai'}
                  />
                )}
              </div>
              {detecting && (
                <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-1 text-xs shadow">
                  <Loader2 className="size-3.5 animate-spin" /> Detecting…
                </div>
              )}
            </div>

            {/* controls */}
            <div className="flex min-h-0 flex-col border-t md:border-t-0 md:border-l">
              <div className="flex-1 space-y-5 overflow-y-auto p-4">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={method}
                  onValueChange={(v) => v && setMethod(v as Method)}
                  className="w-full"
                >
                  <ToggleGroupItem value="auto" className="flex-1">
                    <ScanLine /> Detect
                  </ToggleGroupItem>
                  <ToggleGroupItem value="ai" className="flex-1">
                    <Sparkles /> AI
                  </ToggleGroupItem>
                  <ToggleGroupItem value="trace" className="flex-1">
                    <PenLine /> Trace
                  </ToggleGroupItem>
                </ToggleGroup>

                {method === 'auto' && (
                  <>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Finds enclosed rooms on your device. Works best with clear lines. Nothing is uploaded.
                    </p>
                    {scaleStep}
                    <Step n={2} title="Check the rooms">
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Close doorways up to</span>
                            <span className="font-medium tabular-nums">
                              {formatLength(gap * Math.max(img.width, img.height) * cmPerPx, units)}
                            </span>
                          </div>
                          <Slider min={0.02} max={0.25} step={0.005} value={[gap]} onValueChange={([v]) => setGap(v)} />
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Line sensitivity</span>
                            <span className="font-medium tabular-nums">{Math.round(sensitivity * 100)}%</span>
                          </div>
                          <Slider min={0} max={1} step={0.05} value={[sensitivity]} onValueChange={([v]) => setSensitivity(v)} />
                        </div>
                      </div>
                      <p className={cn('text-sm', autoResult.rooms.length ? 'text-foreground' : 'text-muted-foreground')}>
                        {autoResult.rooms.length
                          ? `Found ${autoResult.rooms.length} room${autoResult.rooms.length === 1 ? '' : 's'}` +
                            (autoResult.openings.length ? ` and ${autoResult.openings.length} doorways.` : '.')
                          : 'No rooms found yet. If rooms leak into each other, close wider doorways; if lines are missed, raise the sensitivity.'}
                      </p>
                    </Step>
                  </>
                )}

                {method === 'ai' && (
                  <>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Claude reads the drawing, including handwritten room names and dimensions, so rough sketches that aren't to
                      scale come out right. It also places doors and windows.
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="api-key">Anthropic API key</Label>
                      <Input
                        id="api-key"
                        type="password"
                        autoComplete="off"
                        placeholder="sk-ant-…"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                      />
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Switch checked={rememberKey} onCheckedChange={setRememberKey} size="sm" />
                        Remember on this device
                      </label>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Get a key at console.anthropic.com. The image is sent to Anthropic with your key, and usage is billed to
                        your account. The key stays in this browser.
                      </p>
                    </div>
                    {ai.status === 'running' ? (
                      <div className="flex items-center gap-2">
                        <Button disabled className="flex-1">
                          <Loader2 className="animate-spin" /> Reading your drawing…
                        </Button>
                        <Button variant="outline" onClick={() => abortRef.current?.abort()}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button className="w-full" disabled={!apiKey.trim()} onClick={runAi}>
                        <Wand2 /> {ai.status === 'done' ? 'Recognize again' : 'Recognize plan'}
                      </Button>
                    )}
                    {ai.status === 'running' && <p className="text-xs text-muted-foreground">This usually takes 20–60 seconds.</p>}
                    {ai.status === 'error' && (
                      <p className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-sm text-destructive">{ai.message}</p>
                    )}
                    {ai.status === 'done' && (
                      <div className="space-y-1.5 text-sm">
                        <p>
                          Found {ai.result.rooms.length} rooms and {ai.result.openings.length} doors/windows.
                        </p>
                        <Badge variant="secondary">
                          {ai.scaleSource === 'labels' ? 'Sizes from written dimensions' : 'Sizes estimated, so check wall lengths'}
                        </Badge>
                      </div>
                    )}
                  </>
                )}

                {method === 'trace' && (
                  <>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      The drawing is placed behind your plan at the right size. Then drag over each room with the rectangle tool, or
                      click its corners with the room tool.
                    </p>
                    {scaleStep}
                  </>
                )}

                <div className="space-y-3 border-t pt-4">
                  {method === 'auto' && (
                    <label className="flex items-center justify-between gap-3 text-sm">
                      Keep the drawing behind the plan
                      <Switch checked={keepUnderlay} onCheckedChange={setKeepUnderlay} />
                    </label>
                  )}
                  {target === 'current' && floorHasContent && (
                    <label className="flex items-center justify-between gap-3 text-sm">
                      Replace what's on this floor
                      <Switch checked={replace} onCheckedChange={setReplace} />
                    </label>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 border-t p-4">
                <Button variant="ghost" onClick={reset}>
                  Change image
                </Button>
                <Button onClick={create} disabled={!canCreate}>
                  {method === 'trace' ? 'Start tracing' : target === 'new' ? 'Create plan' : 'Add to floor'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
