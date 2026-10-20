import { t } from '@/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, PointerEvent as RPointerEvent, ReactNode } from 'react'
import { Camera, Eraser, ImageUp, Lightbulb, Magnet, Maximize2, PenLine, ScanLine, Sparkles, Undo2, Wand2, ZoomIn, ZoomOut } from 'lucide-react'
import { Loader } from '@/components/ui/loader'
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
import { getLayout } from '@/hooks/use-layout'
import { buildFloorContent, tidyRooms } from '@/import/convert'
import type { ImportResult } from '@/import/convert'
import { eraseMarks, imageForAi, loadImage } from '@/import/image'
import { DEFAULT_RECOGNIZE } from '@/import/recognize'
import type { DrawingKind } from '@/import/recognize'
import { useRecognition } from '@/import/useRecognition'
import type { EraseStroke, LoadedImage } from '@/import/image'
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

type View = { x: number; y: number; w: number; h: number }

/**
 * The drawing with an adjustable measuring line and the detected outlines on top. Scroll or pinch to zoom and drag to
 * pan, so the line's ends can go exactly on the drawing's own marks; while an end is dragged, a magnifier shows what's
 * under it (and under the finger, on a phone). Erasing: drag to paint out marks detection shouldn't read as walls.
 */
function DrawingPreview({
  img,
  outlines,
  line,
  onLine,
  showLine,
  erasing,
  brush,
  strokes,
  onStroke,
}: {
  img: LoadedImage
  outlines: Point[][]
  line: { a: Point; b: Point }
  onLine: (l: { a: Point; b: Point }) => void
  showLine: boolean
  erasing: boolean
  /** Eraser radius, in screen px. */
  brush: number
  strokes: EraseStroke[]
  onStroke: (s: EraseStroke) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const full: View = { x: 0, y: 0, w: img.width, h: img.height }
  const [view, setView] = useState<View>(full)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [stick, setStick] = useState(true)
  const [drag, setDrag] = useState<'a' | 'b' | null>(null)
  const [live, setLive] = useState<EraseStroke | null>(null)
  const [cursor, setCursor] = useState<Point | null>(null)
  const [snapped, setSnapped] = useState<{ a: boolean; b: boolean }>({ a: false, b: false })
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<
    | { kind: 'pan'; from: Point; view: View; moved: boolean }
    | { kind: 'pinch'; d: number; at: Point; view: View }
    | null
  >(null)
  const blockClick = useRef(false)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** Screen px per image px, for a view. */
  const ppuOf = (v: View) => (box.w ? Math.min(box.w / v.w, box.h / v.h) : 1)
  const ppu = ppuOf(view)
  // Handles and hit areas keep their size on screen at any zoom.
  const r = 8 / ppu

  /** The image point under a screen point, for a view (the drawing is centred in the box). */
  const at = (client: Point, v: View = view): Point => {
    const rect = boxRef.current!.getBoundingClientRect()
    const s = ppuOf(v)
    return {
      x: v.x + (client.x - rect.left - (rect.width - v.w * s) / 2) / s,
      y: v.y + (client.y - rect.top - (rect.height - v.h * s) / 2) / s,
    }
  }
  const clamp = (v: View): View => {
    if (v.w >= img.width - 1e-6) return full
    const cx = Math.min(img.width, Math.max(0, v.x + v.w / 2))
    const cy = Math.min(img.height, Math.max(0, v.y + v.h / 2))
    return { x: cx - v.w / 2, y: cy - v.h / 2, w: v.w, h: v.h }
  }
  /** Zoomed by `f` about the image point `p`, which stays put. Up to 40×. */
  const zoomAt = (p: Point, f: number, v: View): View => {
    const w = Math.min(img.width, Math.max(img.width / 40, v.w / f))
    const s = w / v.w
    return clamp({ x: p.x - (p.x - v.x) * s, y: p.y - (p.y - v.y) * s, w, h: v.h * s })
  }
  const zoomBy = (f: number) => setView((v) => zoomAt({ x: v.x + v.w / 2, y: v.y + v.h / 2 }, f, v))

  // The wheel zooms about the pointer (a non-passive listener, so the dialog doesn't scroll instead).
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = view
      const f = Math.exp(-Math.max(-100, Math.min(100, e.deltaY * (e.deltaMode === 1 ? 33 : 1))) * 0.003)
      setView(zoomAt(at({ x: e.clientX, y: e.clientY }, v), f, v))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

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
  const inside = (p: Point) => ({ x: Math.min(img.width, Math.max(0, p.x)), y: Math.min(img.height, Math.max(0, p.y)) })
  const client = (e: RPointerEvent) => ({ x: e.clientX, y: e.clientY })

  const onDown = (e: RPointerEvent) => {
    pointers.current.set(e.pointerId, client(e))
    if (pointers.current.size === 2) {
      // Two fingers: pinch to zoom, whatever the first one was doing.
      const [p, q] = [...pointers.current.values()]
      setLive(null)
      setDrag(null)
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
      gesture.current = { kind: 'pinch', d: dist(p, q), at: mid, view }
      return
    }
    if (pointers.current.size > 2) return
    if (erasing && e.button === 0) {
      e.currentTarget.setPointerCapture(e.pointerId)
      setLive({ points: [at(client(e))], r: brush / ppu })
    } else {
      // Pan; the pointer's only captured once it moves, so a click on a wall still lands on it.
      gesture.current = { kind: 'pan', from: client(e), view, moved: false }
    }
  }

  const onMove = (e: RPointerEvent) => {
    const c = client(e)
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, c)
    if (erasing) setCursor(at(c))
    const g = gesture.current
    if (g?.kind === 'pinch' && pointers.current.size === 2) {
      const [p, q] = [...pointers.current.values()]
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
      const anchor = at(g.at, g.view)
      const v = zoomAt(anchor, dist(p, q) / Math.max(1, g.d), g.view)
      // Keep the point between the fingers under them as they move.
      const now = at(mid, v)
      setView(clamp({ ...v, x: v.x + anchor.x - now.x, y: v.y + anchor.y - now.y }))
      return
    }
    if (drag) {
      const p = inside(at(c))
      const s = stick && !e.altKey ? snap(p) : { p, hit: false }
      setSnapped((v) => ({ ...v, [drag]: s.hit }))
      onLine({ ...line, [drag]: s.p })
      return
    }
    if (live) {
      const p = at(c)
      const last = live.points[live.points.length - 1]
      if (dist(p, last) > live.r * 0.3) setLive({ ...live, points: [...live.points, p] })
      return
    }
    if (g?.kind === 'pan') {
      const dx = c.x - g.from.x
      const dy = c.y - g.from.y
      if (!g.moved && Math.hypot(dx, dy) < 4) return
      if (!g.moved) {
        g.moved = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      const s = ppuOf(g.view)
      setView(clamp({ ...g.view, x: g.view.x - dx / s, y: g.view.y - dy / s }))
    }
  }

  const onUp = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (g?.kind === 'pan' && g.moved) {
      // The click that ends a pan isn't a click on a wall.
      blockClick.current = true
      setTimeout(() => (blockClick.current = false))
    }
    if (live) onStroke(live)
    setLive(null)
    setDrag(null)
    gesture.current = null
  }

  const handle = (which: 'a' | 'b') => (
    <circle
      cx={line[which].x}
      cy={line[which].y}
      r={r}
      className={cn('cursor-grab stroke-primary', snapped[which] ? 'fill-primary' : 'fill-background')}
      strokeWidth={r * 0.35}
      pointerEvents={erasing ? 'none' : undefined}
      onPointerDown={(e) => {
        e.stopPropagation()
        if (pointers.current.size) return
        setDrag(which)
        e.currentTarget.ownerSVGElement!.setPointerCapture(e.pointerId)
      }}
    />
  )

  const strokePath = (s: EraseStroke) =>
    `M${s.points.map((p) => `${p.x} ${p.y}`).join('L')}${s.points.length === 1 ? 'l0.01 0' : ''}`
  const marks = [...strokes, ...(live ? [live] : [])]

  // What's under the dragged end, 3× closer, beside it.
  const loupe = 128
  const held = drag ? line[drag] : null
  const lw = loupe / (ppu * 3)
  const heldLeft = held ? (held.x - view.x) / view.w < 0.5 : false

  const layers = (detail: boolean) => (
    <>
      <image href={img.url} width={img.width} height={img.height} />
      {marks.map((s, i) => (
        <g key={i} pointerEvents="none" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={strokePath(s)} className="stroke-destructive/50" strokeWidth={s.r * 2 + 2 / ppu} />
          <path d={strokePath(s)} stroke="#fff" strokeWidth={s.r * 2} />
        </g>
      ))}
      {outlines.map((pts, i) => (
        <path
          key={i}
          d={polygonPath(pts)}
          className="fill-primary/20 stroke-primary"
          strokeWidth={r * 0.3}
          strokeLinejoin="round"
          pointerEvents={erasing ? 'none' : undefined}
        />
      ))}
      {/* Click a detected wall to measure along it. */}
      {detail &&
        showLine &&
        !erasing &&
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
                  if (blockClick.current) return
                  setSnapped({ a: true, b: true })
                  onLine({ a, b })
                }}
              >
                <title>{t('Measure this wall')}</title>
              </line>
            )
          }),
        )}
      {showLine && (
        <line
          x1={line.a.x}
          y1={line.a.y}
          x2={line.b.x}
          y2={line.b.y}
          className="stroke-primary"
          strokeWidth={detail ? r * 0.45 : r * 0.2}
          strokeDasharray={detail ? `${r} ${r * 0.6}` : undefined}
          pointerEvents="none"
        />
      )}
    </>
  )

  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden">
      <svg
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className={cn(
          'h-full w-full touch-none select-none',
          erasing ? 'cursor-none' : view.w < img.width && 'cursor-grab active:cursor-grabbing',
        )}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={(e) => !erasing && setView(zoomAt(at({ x: e.clientX, y: e.clientY }), 2, view))}
      >
        {layers(true)}
        {showLine && (
          <g>
            {handle('a')}
            {handle('b')}
          </g>
        )}
        {erasing && cursor && (
          <circle cx={cursor.x} cy={cursor.y} r={brush / ppu} className="fill-destructive/10 stroke-destructive" strokeWidth={1.5 / ppu} pointerEvents="none" />
        )}
      </svg>

      {held && (
        <div
          className={cn('pointer-events-none absolute top-2 overflow-hidden rounded-full border-2 border-primary bg-background shadow-lg', heldLeft ? 'right-2' : 'left-2')}
          style={{ width: loupe, height: loupe }}
        >
          <svg viewBox={`${held.x - lw / 2} ${held.y - lw / 2} ${lw} ${lw}`} className="size-full" preserveAspectRatio="xMidYMid slice">
            {layers(false)}
            <g className="stroke-primary" strokeWidth={lw / loupe}>
              <line x1={held.x - lw / 2} x2={held.x - lw * 0.06} y1={held.y} y2={held.y} />
              <line x1={held.x + lw * 0.06} x2={held.x + lw / 2} y1={held.y} y2={held.y} />
              <line y1={held.y - lw / 2} y2={held.y - lw * 0.06} x1={held.x} x2={held.x} />
              <line y1={held.y + lw * 0.06} y2={held.y + lw / 2} x1={held.x} x2={held.x} />
            </g>
          </svg>
        </div>
      )}

      <div className="absolute right-2 bottom-2 flex items-center gap-0.5 rounded-lg border bg-background/95 p-0.5 shadow-sm">
        {showLine && !erasing && (
          <Button
            variant="ghost"
            size="icon"
            className={cn('size-8', stick && 'bg-primary/10 text-primary')}
            aria-pressed={stick}
            title={stick ? t('Line ends stick to detected corners (hold Alt to place freely)') : t('Line ends go exactly where you put them')}
            onClick={() => setStick(!stick)}
          >
            <Magnet />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="size-8" title={t('Zoom out')} disabled={view.w >= img.width} onClick={() => zoomBy(1 / 1.6)}>
          <ZoomOut />
        </Button>
        <span className="w-11 text-center text-xs tabular-nums">{Math.round((img.width / view.w) * 100)}%</span>
        <Button variant="ghost" size="icon" className="size-8" title={t('Zoom in')} disabled={view.w <= img.width / 40 + 1e-6} onClick={() => zoomBy(1.6)}>
          <ZoomIn />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" title={t('Show it all')} disabled={view.w >= img.width} onClick={() => setView(full)}>
          <Maximize2 />
        </Button>
      </div>
    </div>
  )
}

function ResultPreview({ floor, units }: { floor: Floor; units: 'metric' | 'imperial' }) {
  const theme = usePlanTheme()
  const pts = floorBounds(floor)
  if (!pts.length) {
    return <div className="grid h-full place-items-center text-sm text-muted-foreground">{t('No rooms yet')}</div>
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
  // Marks painted out of the drawing before detection.
  const [erasing, setErasing] = useState(false)
  const [brush, setBrush] = useState(12)
  const [strokes, setStrokes] = useState<EraseStroke[]>([])
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
    setErasing(false)
    setStrokes([])
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
    setErasing(false)
    setStrokes([])
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
  const work = useMemo(() => (img && strokes.length ? eraseMarks(img, strokes) : (img?.work ?? null)), [img, strokes])
  const recognition = useRecognition(img && method === 'auto' ? work : null, { gap, sensitivity, kind })
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
    return { rooms: tidy.map((points, i) => ({ name: t('Room {n}', { n: i + 1 }), points })), openings }
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
      toast.success(t('Drawing placed. Drag over each room to trace it.'))
    } else {
      const rooms = content.rooms.length === 1 ? t('1 room') : t('{n} rooms', { n: content.rooms.length })
      toast.success(
        content.symbols.length
          ? t('Created {rooms} and {n} doors/windows. Tap a room to fine-tune its walls.', { rooms, n: content.symbols.length })
          : t('Created {rooms}. Tap a room to fine-tune its walls.', { rooms }),
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
    <Step n={1} title={t('Set the scale')}>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("Click a detected wall whose length you know (one with a written dimension is ideal), or drag the ends of the dashed line onto the drawing's own marks. Zoom in (scroll, pinch or the + button) to place them exactly. Then enter the length.")}
      </p>
      <div className="flex items-center gap-2">
        <Label className="shrink-0 font-normal text-muted-foreground">{t('Line length')}</Label>
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
          {t('The scale is a guess until you set it. Room sizes depend on it.')}
        </p>
      )}
    </Step>
  )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <Dialog open={tipsOpen} onOpenChange={setTipsOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('Getting a drawing recognized well')}</DialogTitle>
            <DialogDescription>{t("What helps, with examples, and what to try when the result isn't right.")}</DialogDescription>
          </DialogHeader>
          <DrawingTips />
          <div className="space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
            <p className="font-medium">{t("When the result isn't right")}</p>
            <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
              <li>
                <b className="text-foreground">{t('Two rooms come out as one:')}</b> the doorway between them is wider than “Close doorways up to”.
                Raise it.
              </li>
              <li>
                <b className="text-foreground">{t('A room is missing:')}</b> it leaks to the outside through a gap, often a window drawn without
                lines. Raise “Close doorways up to”, or the line sensitivity if the walls are pale.
              </li>
              <li>
                <b className="text-foreground">{t('Furniture or text becomes rooms:')}</b> choose Printed plan under Drawing type, so only thick
                walls count.
              </li>
              <li>
                <b className="text-foreground">{t('Still wrong:')}</b> crop the image to just the plan, or use Trace to draw over it. You can
                also fix any room afterwards by dragging its corners and walls.
              </li>
            </ul>
          </div>
        </DialogContent>
      </Dialog>
      <DialogContent className="flex max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{t('Start from a drawing')}</DialogTitle>
          <DialogDescription>
            {t('Use a photo, scan or hand sketch of a floor plan. Rooms are detected for you, or you can trace over it.')}
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
                {loading ? <Loader className="size-8" label={t('Opening your drawing')} /> : <ImageUp className="size-7" />}
              </div>
              <div>
                <p className="font-medium">
                  {getLayout().touch ? t('Choose a picture of your plan, or take a photo of it') : t('Drop an image here, paste it, or choose a file')}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{t('JPEG or PNG · photo, scan or screenshot')}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => fileRef.current?.click()} disabled={loading}>
                  <ImageUp /> {t('Choose image')}
                </Button>
                <Button variant="outline" onClick={() => cameraRef.current?.click()} disabled={loading}>
                  <Camera /> {t('Take a photo')}
                </Button>
                <Button variant="ghost" onClick={loadSample} disabled={loading}>
                  <PenLine /> {t('Try a sample sketch')}
                </Button>
              </div>
            </div>
            <div className="mt-6 space-y-3">
              <h4 className="flex items-center gap-2 text-sm font-medium">
                <Lightbulb className="size-4 text-amber-500" /> {t('For the best results')}
              </h4>
              <DrawingTips only={['walls', 'crop', 'photo', 'sketch']} />
              <p className="text-xs text-muted-foreground">
                {t("Know the length of one wall (a written dimension is perfect): you'll use it to set the scale.")}
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
                      {t('Drawing')}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="result" className="px-3">
                      {t('Result')}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              )}
              <div className="min-h-0 flex-1 p-4 pt-14">
                {view === 'result' && previewFloor ? (
                  <ResultPreview floor={previewFloor} units={units} />
                ) : (
                  <DrawingPreview
                    key={img.url}
                    img={img}
                    outlines={outlines}
                    line={line}
                    onLine={(l) => {
                      setLine(l)
                      setScaleSet(true)
                    }}
                    showLine={method !== 'ai'}
                    erasing={erasing && method === 'auto'}
                    brush={brush}
                    strokes={method === 'auto' ? strokes : []}
                    onStroke={(s) => setStrokes((all) => [...all, s])}
                  />
                )}
              </div>
              {detecting && (
                <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-1 text-xs shadow">
                  <Loader className="size-4" label={t('Detecting')} /> {t('Detecting…')}
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
                    <ScanLine /> {t('Detect')}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="ai" className="flex-1">
                    <Sparkles /> {t('AI')}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="trace" className="flex-1">
                    <PenLine /> {t('Trace')}
                  </ToggleGroupItem>
                </ToggleGroup>

                {method === 'auto' && (
                  <>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {t('Finds rooms, doors and windows on your device, in printed plans (CAD, estate agent, scans and photos) and hand sketches. Nothing is uploaded.')}
                    </p>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-normal text-muted-foreground">{t('Drawing type')}</Label>
                      <ToggleGroup
                        type="single"
                        size="sm"
                        variant="outline"
                        value={kind}
                        onValueChange={(v) => v && setKind(v as DrawingKind)}
                        className="w-full"
                      >
                        <ToggleGroupItem value="auto" className="flex-1">
                          {t('Auto')}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="plan" className="flex-1">
                          {t('Printed plan')}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="sketch" className="flex-1">
                          {t('Sketch')}
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                    {scaleStep}
                    <Step n={2} title={t('Check the rooms')}>
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">{t('Close doorways up to')}</span>
                            <span className="font-medium tabular-nums">
                              {formatLength(gap * Math.max(img.width, img.height) * cmPerPx, units)}
                            </span>
                          </div>
                          <Slider min={0.02} max={0.25} step={0.005} value={[gap]} onValueChange={([v]) => setGap(v)} />
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">{t('Line sensitivity')}</span>
                            <span className="font-medium tabular-nums">{Math.round(sensitivity * 100)}%</span>
                          </div>
                          <Slider min={0} max={1} step={0.05} value={[sensitivity]} onValueChange={([v]) => setSensitivity(v)} />
                        </div>
                      </div>
                      {detection && (
                        <div className="space-y-1.5 text-sm">
                          <p>
                            {autoResult.rooms.length
                              ? autoResult.rooms.length === 1
                                ? t('Found 1 room')
                                : t('Found {n} rooms', { n: autoResult.rooms.length })
                              : t('No rooms found yet')}
                            {(() => {
                              const doors = autoResult.openings.filter((o) => o.kind !== 'window').length
                              const windows = autoResult.openings.length - doors
                              const parts = [
                                doors && (doors === 1 ? t('1 door') : t('{n} doors', { n: doors })),
                                windows && (windows === 1 ? t('1 window') : t('{n} windows', { n: windows })),
                              ].filter(Boolean)
                              return parts.length ? `${t(', ')}${parts.join(t(' and '))}.` : '.'
                            })()}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {detection.kind === 'plan'
                              ? (detection.style === 'outlined' ? t('Read as a printed plan with outlined walls') : t('Read as a printed plan')) +
                                (detection.wallThickness && scaleSet ? t(', walls about {size} thick', { size: formatLength(autoWall, units) }) : '') +
                                (detection.angle ? t(', straightened by {n}°', { n: Math.abs(detection.angle) }) : '') +
                                '.'
                              : t('Read as a hand sketch.')}
                          </p>
                          {autoResult.rooms.length === 0 && (
                            <p className="rounded-md bg-amber-500/15 px-2.5 py-1.5 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                              {kind === 'auto' && detection.kind === 'sketch'
                                ? t('No drawn walls found. If this is a printed plan, choose Printed plan and raise the sensitivity; for a sketch, make sure the walls meet at the corners.')
                                : t('Rooms may be leaking into each other or to the outside through a gap. Close wider doorways, or raise the sensitivity if walls are faint.')}
                            </p>
                          )}
                        </div>
                      )}
                      <div className="space-y-2 rounded-md border p-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <Button
                            variant={erasing ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => {
                              setErasing(!erasing)
                              setView('drawing')
                            }}
                          >
                            <Eraser /> {erasing ? t('Done erasing') : t('Erase marks')}
                          </Button>
                          {strokes.length > 0 && (
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" onClick={() => setStrokes((all) => all.slice(0, -1))}>
                                <Undo2 className="rtl-flip" /> {t('Undo')}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setStrokes([])}>
                                {t('Clear all')}
                              </Button>
                            </div>
                          )}
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {t('Dimension lines, text or door swings read as walls? Paint over them on the drawing: detection runs again without them. The drawing you trace over keeps them.')}
                        </p>
                        {erasing && (
                          <div className="space-y-2">
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">{t('Brush size')}</span>
                            </div>
                            <Slider min={4} max={40} step={1} value={[brush]} onValueChange={([v]) => setBrush(v)} />
                          </div>
                        )}
                      </div>
                      <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setTipsOpen(true)}>
                        <Lightbulb /> {t('Tips for better results')}
                      </Button>
                    </Step>
                  </>
                )}

                {method === 'ai' && (
                  <>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {t("Claude reads the drawing, including handwritten room names and dimensions, so rough sketches that aren't to scale come out right. It also places doors and windows.")}
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="api-key">{t('Anthropic API key')}</Label>
                      <Input
                        id="api-key"
                        type="password"
                        autoComplete="off"
                        placeholder={t('sk-ant-…')}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                      />
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Switch checked={rememberKey} onCheckedChange={setRememberKey} size="sm" />
                        {t('Remember on this device')}
                      </label>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {t('Get a key at console.anthropic.com. The image is sent to Anthropic with your key, and usage is billed to your account. The key stays in this browser.')}
                      </p>
                    </div>
                    {ai.status === 'running' ? (
                      <div className="flex items-center gap-2">
                        <Button disabled className="flex-1">
                          <Loader label={t('Reading your drawing')} /> {t('Reading your drawing…')}
                        </Button>
                        <Button variant="outline" onClick={() => abortRef.current?.abort()}>
                          {t('Cancel')}
                        </Button>
                      </div>
                    ) : (
                      <Button className="w-full" disabled={!apiKey.trim()} onClick={runAi}>
                        <Wand2 /> {ai.status === 'done' ? 'Recognize again' : 'Recognize plan'}
                      </Button>
                    )}
                    {ai.status === 'running' && <p className="text-xs text-muted-foreground">{t('This usually takes 20–60 seconds.')}</p>}
                    {ai.status === 'error' && (
                      <p className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-sm text-destructive">{ai.message}</p>
                    )}
                    {ai.status === 'done' && (
                      <div className="space-y-1.5 text-sm">
                        <p>
                          {t('Found {rooms} rooms and {openings} doors/windows.', { rooms: ai.result.rooms.length, openings: ai.result.openings.length })}
                        </p>
                        <Badge variant="secondary">
                          {ai.scaleSource === 'labels' ? t('Sizes from written dimensions') : t('Sizes estimated, so check wall lengths')}
                        </Badge>
                      </div>
                    )}
                  </>
                )}

                {method === 'trace' && (
                  <>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {t('The drawing is placed behind your plan at the right size. Then drag over each room with the rectangle tool, or click its corners with the room tool.')}
                    </p>
                    {scaleStep}
                  </>
                )}

                <div className="space-y-3 border-t pt-4">
                  {method === 'auto' && (
                    <label className="flex items-center justify-between gap-3 text-sm">
                      {t('Keep the drawing behind the plan')}
                      <Switch checked={keepUnderlay} onCheckedChange={setKeepUnderlay} />
                    </label>
                  )}
                  {target === 'current' && floorHasContent && (
                    <label className="flex items-center justify-between gap-3 text-sm">
                      {t("Replace what's on this floor")}
                      <Switch checked={replace} onCheckedChange={setReplace} />
                    </label>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 border-t p-4">
                <Button variant="ghost" onClick={reset}>
                  {t('Change image')}
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
