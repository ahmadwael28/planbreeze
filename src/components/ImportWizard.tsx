import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, PointerEvent as RPointerEvent, ReactNode } from 'react'
import { Camera, ImageUp, Lightbulb, Loader2, PenLine, ScanLine, Sparkles, Wand2 } from 'lucide-react'
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
import { imageForAi, loadImage } from '@/import/image'
import { DEFAULT_RECOGNIZE } from '@/import/recognize'
import type { DrawingKind } from '@/import/recognize'
import { useRecognition } from '@/import/useRecognition'
import type { LoadedImage } from '@/import/image'
import { area, bbox, dist, polygonPath, projectOnSegment } from '@/model/geometry'
import { floorBounds, newProject } from '@/model/project'
import { formatLength } from '@/model/units'
import type { Floor, Point, Underlay } from '@/model/types'
import { currentFloor, draftFloor, useEditor } from '@/store/editor'
import { saveProject } from '@/store/storage'
import { useUi } from '@/store/ui'
import { DrawingTips } from './DrawingTips'
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
  const [snapped, setSnapped] = useState<{ a: boolean; b: boolean }>({ a: false, b: false })
  const r = Math.max(img.width, img.height) * 0.014

  /** Stick to a detected room's corner if one is close, else onto its wall. */
  const snap = (p: Point): { p: Point; hit: boolean } => {
    let best: Point | null = null
    let bd = r * 1.8
    for (const poly of outlines) {
      for (const q of poly) {
        const d = dist(p, q)
        if (d < bd) {
          bd = d
          best = q
        }
      }
    }
    if (best) return { p: best, hit: true }
    bd = r * 1.1
    for (const poly of outlines) {
      poly.forEach((a, i) => {
        const pr = projectOnSegment(p, a, poly[(i + 1) % poly.length])
        if (pr.dist < bd) {
          bd = pr.dist
          best = pr.point
        }
      })
    }
    return best ? { p: best, hit: true } : { p, hit: false }
  }

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
      className={cn('cursor-grab stroke-primary', snapped[which] ? 'fill-primary' : 'fill-background')}
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
        const which = dragging.current
        if (!which) return
        const s = snap(toImage(e))
        setSnapped((v) => ({ ...v, [which]: s.hit }))
        onLine({ ...line, [which]: s.p })
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
      {/* Click a detected wall to measure along it. */}
      {showLine &&
        outlines.map((pts, i) =>
          pts.map((a, j) => {
            const b = pts[(j + 1) % pts.length]
            return (
              <line
                key={`${i}-${j}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="transparent"
                strokeWidth={r * 1.1}
                className="cursor-pointer"
                onClick={() => {
                  setSnapped({ a: true, b: true })
                  onLine({ a, b })
                }}
              >
                <title>Measure this wall</title>
              </line>
            )
          }),
        )}
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
  const [gap, setGap] = useState(DEFAULT_RECOGNIZE.gap)
  const [sensitivity, setSensitivity] = useState(DEFAULT_RECOGNIZE.sensitivity)
  const [kind, setKind] = useState<DrawingKind>('auto')
  const [tipsOpen, setTipsOpen] = useState(false)
  const autoPlaced = useRef(false)
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
    setKind('auto')
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
    autoPlaced.current = !!preset
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

  // On-device detection, in a background worker; re-runs when its inputs change.
  const recognition = useRecognition(img && method === 'auto' ? img.work : null, { gap, sensitivity, kind })
  const detection = recognition.result
  const detecting = recognition.busy

  // Printed plans show how thick the walls are; use that (to the nearest 2.5 cm) instead of the default.
  // (Only once the scale is set: before that, sizes are guesses.)
  const autoWall = useMemo(() => {
    const t = detection?.wallThickness
    if (!img || !t || !scaleSet) return wall
    return Math.min(35, Math.max(7.5, Math.round((t * img.workScale * cmPerPx) / 2.5) * 2.5))
  }, [img, detection, cmPerPx, wall, scaleSet])

  // Rooms in cm from on-device detection.
  const autoResult = useMemo<ImportResult>(() => {
    if (!img || !detection) return { rooms: [], openings: [] }
    const k = img.workScale * cmPerPx
    const toCm = (q: Point) => ({ x: q.x * k, y: q.y * k })
    const rooms = detection.rooms.map((p) => p.map(toCm)).filter((p) => area(p) >= MIN_ROOM_AREA)
    const tidy = tidyRooms(rooms, autoWall).filter((p) => p.length >= 3 && area(p) >= MIN_ROOM_AREA)
    // Name rooms top-to-bottom, left-to-right.
    tidy.sort((p, q) => {
      const a = bbox(p)
      const b = bbox(q)
      return Math.abs(a.minY - b.minY) > 50 ? a.minY - b.minY : a.minX - b.minX
    })
    const openings = [
      ...detection.doors.map(([a, b]) => {
        const [ca, cb] = [toCm(a), toCm(b)]
        return { kind: dist(ca, cb) > 130 ? ('opening' as const) : ('door' as const), a: ca, b: cb }
      }),
      ...detection.windows.map(([a, b]) => ({ kind: 'window' as const, a: toCm(a), b: toCm(b) })),
    ]
    return { rooms: tidy.map((points, i) => ({ name: `Room ${i + 1}`, points })), openings }
  }, [img, detection, cmPerPx, autoWall])
  const importWall = method === 'auto' ? autoWall : wall

  const result: ImportResult | null =
    method === 'auto' ? autoResult : method === 'ai' && ai.status === 'done' ? ai.result : null

  const previewFloor = useMemo<Floor | null>(() => {
    if (!result) return null
    const content = buildFloorContent(result, importWall)
    return { id: 'preview', name: 'Preview', height: 250, ...content }
  }, [result, importWall])

  // Detected rooms over the drawing. A straightened photo's rooms are turned back to match it.
  const outlines = useMemo(() => {
    if (method !== 'auto' || !img) return []
    const a = ((detection?.angle ?? 0) * Math.PI) / 180
    const c = Math.cos(a)
    const s = Math.sin(a)
    const cx = img.width / 2
    const cy = img.height / 2
    return autoResult.rooms.map((r) =>
      r.points.map((p) => {
        const x = p.x / cmPerPx - cx
        const y = p.y / cmPerPx - cy
        return { x: cx + c * x - s * y, y: cy + s * x + c * y }
      }),
    )
  }, [method, img, detection, autoResult, cmPerPx])

  // Until the scale is set, put the measuring line on the longest wall found: often you only need to type its length.
  useEffect(() => {
    if (autoPlaced.current || scaleSet || !outlines.length) return
    let best: { a: Point; b: Point } | null = null
    let longest = 0
    for (const poly of outlines) {
      poly.forEach((a, i) => {
        const b = poly[(i + 1) % poly.length]
        if (dist(a, b) > longest) {
          longest = dist(a, b)
          best = { a, b }
        }
      })
    }
    if (!best) return
    autoPlaced.current = true
    setLine(best)
  }, [outlines, scaleSet])

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
    const content = buildFloorContent(res, importWall)
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
            // Rooms from a straightened photo are square to the plan; turn the photo to match.
            rotation: method === 'auto' && detection?.angle ? -detection.angle : undefined,
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
        Click a detected wall (or drag the ends of the dashed line; they stick to room corners) whose length you know, such as one
        with a written dimension, then enter that length.
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
      <Dialog open={tipsOpen} onOpenChange={setTipsOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Getting a drawing recognized well</DialogTitle>
            <DialogDescription>What helps, with examples, and what to try when the result isn't right.</DialogDescription>
          </DialogHeader>
          <DrawingTips />
          <div className="space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
            <p className="font-medium">When the result isn't right</p>
            <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
              <li>
                <b className="text-foreground">Two rooms come out as one:</b> the doorway between them is wider than “Close doorways up to”.
                Raise it.
              </li>
              <li>
                <b className="text-foreground">A room is missing:</b> it leaks to the outside through a gap, often a window drawn without
                lines. Raise “Close doorways up to”, or the line sensitivity if the walls are pale.
              </li>
              <li>
                <b className="text-foreground">Furniture or text becomes rooms:</b> choose Printed plan under Drawing type, so only thick
                walls count.
              </li>
              <li>
                <b className="text-foreground">Still wrong:</b> crop the image to just the plan, or use Trace to draw over it. You can
                also fix any room afterwards by dragging its corners and walls.
              </li>
            </ul>
          </div>
        </DialogContent>
      </Dialog>
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
            <div className="mt-6 space-y-3">
              <h4 className="flex items-center gap-2 text-sm font-medium">
                <Lightbulb className="size-4 text-amber-500" /> For the best results
              </h4>
              <DrawingTips only={['walls', 'crop', 'photo', 'sketch']} />
              <p className="text-xs text-muted-foreground">
                Know the length of one wall (a written dimension is perfect): you'll use it to set the scale.
              </p>
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
                      Finds rooms, doors and windows on your device, in printed plans (CAD, estate agent, scans and photos) and
                      hand sketches. Nothing is uploaded.
                    </p>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-normal text-muted-foreground">Drawing type</Label>
                      <ToggleGroup
                        type="single"
                        size="sm"
                        variant="outline"
                        value={kind}
                        onValueChange={(v) => v && setKind(v as DrawingKind)}
                        className="w-full"
                      >
                        <ToggleGroupItem value="auto" className="flex-1">
                          Auto
                        </ToggleGroupItem>
                        <ToggleGroupItem value="plan" className="flex-1">
                          Printed plan
                        </ToggleGroupItem>
                        <ToggleGroupItem value="sketch" className="flex-1">
                          Sketch
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>
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
                      {detection && (
                        <div className="space-y-1.5 text-sm">
                          <p>
                            {autoResult.rooms.length
                              ? `Found ${autoResult.rooms.length} room${autoResult.rooms.length === 1 ? '' : 's'}`
                              : 'No rooms found yet'}
                            {(() => {
                              const doors = autoResult.openings.filter((o) => o.kind !== 'window').length
                              const windows = autoResult.openings.length - doors
                              const parts = [doors && `${doors} door${doors === 1 ? '' : 's'}`, windows && `${windows} window${windows === 1 ? '' : 's'}`].filter(Boolean)
                              return parts.length ? `, ${parts.join(' and ')}.` : '.'
                            })()}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {detection.kind === 'plan'
                              ? `Read as a printed plan${detection.style === 'outlined' ? ' with outlined walls' : ''}` +
                                (detection.wallThickness && scaleSet ? `, walls about ${formatLength(autoWall, units)} thick` : '') +
                                (detection.angle ? `, straightened by ${Math.abs(detection.angle)}°` : '') +
                                '.'
                              : 'Read as a hand sketch.'}
                          </p>
                          {autoResult.rooms.length === 0 && (
                            <p className="rounded-md bg-amber-500/15 px-2.5 py-1.5 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                              {kind === 'auto' && detection.kind === 'sketch'
                                ? 'No drawn walls found. If this is a printed plan, choose Printed plan and raise the sensitivity; for a sketch, make sure the walls meet at the corners.'
                                : 'Rooms may be leaking into each other or to the outside through a gap. Close wider doorways, or raise the sensitivity if walls are faint.'}
                            </p>
                          )}
                        </div>
                      )}
                      <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setTipsOpen(true)}>
                        <Lightbulb /> Tips for better results
                      </Button>
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
