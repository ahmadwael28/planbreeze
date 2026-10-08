import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent, MouseEvent as RMouseEvent, PointerEvent as RPointerEvent } from 'react'
import {
  add,
  bbox,
  dist,
  dot,
  inwardNormal,
  mul,
  normalize,
  pointInPolygon,
  polygonPath,
  rotate,
  signedArea,
  snapAngle,
  snapTo,
  sub,
} from '@/model/geometry'
import { toast } from 'sonner'
import { ceilingLight, ceilingRoom, coveRuns } from '@/model/lighting'
import { dimensionPoints, findWallSnap, floorBounds, moveWall, newSymbol, roomOuter, symbolPose, wallMountPose } from '@/model/project'
import { boxMagnet, magnetize } from '@/model/magnet'
import type { SnapMark } from '@/model/magnet'
import { SYMBOL_MAP } from '@/model/symbols'
import { formatLength, gridSpacing, parseLength, snapStep } from '@/model/units'
import type { Dimension, Floor, PlanSymbol, Point, Pose, Room, SavedView } from '@/model/types'
import {
  addDimension,
  addOutdoor,
  addRoom,
  selectionBox,
  addSymbol,
  currentFloor,
  draftFloor,
  splitWall,
  toggleWire,
  placeBehindSofa,
  updatePerson,
  useEditor,
} from '@/store/editor'
import { usePlanTheme } from '@/hooks/use-plan-theme'
import { DimensionGraphic, PlanLayers } from './PlanLayers'
import { PlanViews } from './PlanViews'
import { boxGaps, boxGuides, clearanceGuides, wallGaps } from '@/model/guides'
import type { Guide } from '@/model/guides'
import type { BBox } from '@/model/geometry'
import { clipFootprint, copyItems, moveItems, refsInRect, refsOf, rotateItems, selectionOf, withGroup } from '@/model/items'
import type { Clip } from '@/model/items'
import { canResize, resized } from '@/model/sizes'
import type { ItemRef } from '@/model/types'

const MIN_ZOOM = 0.05
const MAX_ZOOM = 8
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
export const SYMBOL_DRAG_MIME = 'application/x-floorplan-symbol'

interface DragBase {
  moved: boolean
  sx: number
  sy: number
}
type Drag = DragBase &
  (
    | { type: 'pan'; panX: number; panY: number }
    | { type: 'room'; id: string; start: Point; orig: Room }
    | { type: 'vertex'; id: string; index: number; orig: Room }
    | { type: 'edge'; id: string; index: number; orig: Room; start: Point }
    | { type: 'symbol'; id: string; start: Point; orig: PlanSymbol; pose: Pose }
    | { type: 'rotate'; id: string; pose: Pose }
    | { type: 'resize'; id: string; orig: PlanSymbol; pose: Pose; isWall: boolean; handle: string; w0: number; d0: number; offset0?: number }
    | { type: 'rect'; start: Point; current: Point }
    | { type: 'dim-end'; id: string; end: 'a' | 'b' }
    | { type: 'dim-offset'; id: string; orig: Dimension; start: Point }
    | { type: 'view'; id: string; orig: SavedView; start: Point }
    | { type: 'multi'; orig: Clip; start: Point; box: BBox | null; rooms: Room[] }
    | { type: 'multi-rotate'; orig: Clip; center: Point; a0: number }
    | { type: 'marquee'; start: Point; current: Point; additive: boolean }
    | { type: 'view-rotate'; id: string; orig: SavedView }
  )

/** The view that frames these points on screen, `margin` pixels in from the edges (null if there are none). */
function framing(el: Element, pts: Point[], margin: number) {
  if (!pts.length) return null
  const { width: w, height: h } = el.getBoundingClientRect()
  const b = bbox(pts)
  const zoom = clampZoom(
    Math.min((w - margin * 2) / Math.max(b.maxX - b.minX, 1), (h - margin * 2) / Math.max(b.maxY - b.minY, 1)),
  )
  return { zoom, panX: w / 2 - ((b.minX + b.maxX) / 2) * zoom, panY: h / 2 - ((b.minY + b.maxY) / 2) * zoom }
}

/** Vertices (interior + wall outline) of all rooms except `excludeId`, for alignment snapping. */
function snapTargets(floor: Floor, excludeId?: string): Point[] {
  const out: Point[] = []
  for (const r of floor.rooms) {
    if (r.id === excludeId) continue
    out.push(...r.points, ...roomOuter(r))
  }
  return out
}

/** Best per-axis correction that aligns any of `moving` with any of `targets` within `thr`. */
function axisSnap(moving: Point[], targets: Point[], thr: number) {
  let dx: number | null = null
  let dy: number | null = null
  let bx = thr
  let by = thr
  for (const m of moving) {
    for (const t of targets) {
      const ddx = t.x - m.x
      const ddy = t.y - m.y
      if (Math.abs(ddx) < bx) {
        bx = Math.abs(ddx)
        dx = ddx
      }
      if (Math.abs(ddy) < by) {
        by = Math.abs(ddy)
        dy = ddy
      }
    }
  }
  return { dx, dy }
}

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null)
  const project = useEditor((s) => s.project)
  const floor = useEditor(currentFloor)
  const floorId = useEditor((s) => s.floorId)
  const view = useEditor((s) => s.view)
  const tool = useEditor((s) => s.tool)
  const selection = useEditor((s) => s.selection)
  const settings = useEditor((s) => s.settings)
  const fitRequest = useEditor((s) => s.fitRequest)
  const layer = useEditor((s) => s.layer)
  const wireSwitch = useEditor((s) => s.wireSwitch)
  const units = project.units
  const theme = usePlanTheme()

  const drag = useRef<Drag | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<{ dist: number; zoom: number; world: Point } | null>(null)
  const [rectPreview, setRectPreview] = useState<{ a: Point; b: Point } | null>(null)
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null)
  /** The symbol being moved or resized, for the distance guides. */
  const [movingId, setMovingId] = useState<string | null>(null)
  /** Several items being moved together, for the distance guides around them. */
  const [movingMulti, setMovingMulti] = useState(false)
  const [drawPts, setDrawPts] = useState<Point[]>([])
  const [cursor, setCursor] = useState<Point | null>(null)
  const [typed, setTyped] = useState('')
  const [dimDraft, setDimDraft] = useState<{ a: Point; b?: Point } | null>(null)
  /** What's lined up with the walls or other pieces while dragging. */
  const [marks, setMarks] = useState<SnapMark[]>([])
  const glide = useRef(0)

  const floorBelow = (() => {
    const idx = project.floors.findIndex((f) => f.id === floorId)
    return idx > 0 ? project.floors[idx - 1] : null
  })()

  // ---------- viewport ----------
  useEffect(() => {
    const el = svgRef.current!
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      useEditor.getState().setViewport(r.width, r.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit = useCallback(() => {
    const st = useEditor.getState()
    const { width: w, height: h } = svgRef.current!.getBoundingClientRect()
    st.setView(framing(svgRef.current!, floorBounds(currentFloor(st)), 60) ?? { panX: w / 2 - 200, panY: h / 2 - 150, zoom: 1 })
  }, [])

  /** Move the view smoothly to frame these points. */
  const glideTo = (pts: Point[]) => {
    const to = framing(svgRef.current!, pts, 50)
    if (!to) return
    cancelAnimationFrame(glide.current)
    const from = useEditor.getState().view
    const t0 = performance.now()
    // Zooming evenly (in log scale), with the point in the middle of the screen moving straight across.
    const { width: w, height: h } = svgRef.current!.getBoundingClientRect()
    const mid = (v: { zoom: number; panX: number; panY: number }) => ({ x: (w / 2 - v.panX) / v.zoom, y: (h / 2 - v.panY) / v.zoom })
    const [m0, m1] = [mid(from), mid(to)]
    const frame = (now: number) => {
      const k = Math.min(1, (now - t0) / 320)
      const e = 1 - Math.pow(1 - k, 3)
      const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e)
      const m = { x: m0.x + (m1.x - m0.x) * e, y: m0.y + (m1.y - m0.y) * e }
      useEditor.getState().setView({ zoom, panX: w / 2 - m.x * zoom, panY: h / 2 - m.y * zoom })
      if (k < 1) glide.current = requestAnimationFrame(frame)
    }
    glide.current = requestAnimationFrame(frame)
  }
  useEffect(() => () => cancelAnimationFrame(glide.current), [])

  useEffect(() => {
    // wait one frame so the viewport size is known
    const id = requestAnimationFrame(fit)
    return () => cancelAnimationFrame(id)
  }, [fitRequest, fit])

  // Wheel zoom (non-passive so we can prevent page scroll).
  useEffect(() => {
    const el = svgRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      cancelAnimationFrame(glide.current)
      const r = el.getBoundingClientRect()
      const sx = e.clientX - r.left
      const sy = e.clientY - r.top
      useEditor.getState().setView((v) => {
        const zoom = clampZoom(v.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
        return {
          zoom,
          panX: sx - ((sx - v.panX) * zoom) / v.zoom,
          panY: sy - ((sy - v.panY) * zoom) / v.zoom,
        }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Reset drawing state when the tool changes.
  useEffect(() => {
    setDrawPts([])
    setTyped('')
    setRectPreview(null)
    setDimDraft(null)
  }, [tool, floorId])

  const screenPos = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const toWorld = (s: Point): Point => {
    const v = useEditor.getState().view
    return { x: (s.x - v.panX) / v.zoom, y: (s.y - v.panY) / v.zoom }
  }

  // ---------- snapping ----------
  const snapThr = () => 10 / useEditor.getState().view.zoom
  /** How close a piece comes to a wall before it's pulled against it: about 14 pixels on screen. */
  const reachOf = (zoom: number) => Math.min(40, Math.max(6, 14 / zoom))

  const snapFree = (p: Point, extraTargets: Point[] = [], excludeRoom?: string): Point => {
    const st = useEditor.getState()
    if (!st.settings.snap) return p
    const step = snapStep(st.project.units)
    const s = axisSnap([p], [...snapTargets(currentFloor(st), excludeRoom), ...extraTargets], snapThr())
    return {
      x: s.dx !== null ? p.x + s.dx : snapTo(p.x, step),
      y: s.dy !== null ? p.y + s.dy : snapTo(p.y, step),
    }
  }

  /** Snap to the nearest wall corner (inside or outside face) if close, else to the grid. */
  const pointSnap = (p: Point): { p: Point; vertex: boolean } => {
    const st = useEditor.getState()
    let best: Point | null = null
    let bestD = snapThr() * 1.2
    for (const t of snapTargets(currentFloor(st))) {
      const d = dist(t, p)
      if (d < bestD) {
        bestD = d
        best = t
      }
    }
    return best ? { p: best, vertex: true } : { p: snapFree(p), vertex: false }
  }

  const dimEnd = (a: Point, raw: Point) => {
    const v = pointSnap(raw)
    return v.vertex ? v.p : snapFree(snapAngle(a, raw))
  }

  const dimOffset = (a: Point, b: Point, cursor: Point) => {
    const l = dist(a, b) || 1
    const n = { x: (b.y - a.y) / l, y: -(b.x - a.x) / l }
    return Math.round(dot(sub(cursor, a), n) / 5) * 5
  }

  const drawSnap = (raw: Point, pts: Point[]): Point => {
    const last = pts[pts.length - 1]
    const p = last ? snapAngle(last, raw) : raw
    return snapFree(p, pts)
  }

  // ---------- polygon drawing ----------
  const finishPolygon = useCallback((pts: Point[]) => {
    if (pts.length >= 3) addRoom(pts)
    setDrawPts([])
    setTyped('')
  }, [])

  const isClosing = (pts: Point[], p: Point) =>
    pts.length >= 3 && dist(pts[0], p) * useEditor.getState().view.zoom < 12

  useEffect(() => {
    if (tool !== 'room') return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return
      if (e.key === 'Escape') {
        if (drawPts.length) setDrawPts([])
        else useEditor.getState().setTool('select')
        setTyped('')
      } else if (e.key === 'Enter') {
        if (typed && drawPts.length && cursor) {
          const len = parseLength(typed, units)
          if (len && len > 0) {
            const last = drawPts[drawPts.length - 1]
            const target = drawSnap(cursor, drawPts)
            const dir = normalize(sub(target, last))
            if (dir.x || dir.y) setDrawPts([...drawPts, add(last, mul(dir, len))])
          }
          setTyped('')
        } else {
          finishPolygon(drawPts)
        }
      } else if (e.key === 'Backspace') {
        if (typed) setTyped(typed.slice(0, -1))
        else setDrawPts(drawPts.slice(0, -1))
      } else if (/^[0-9.,'" a-z]$/i.test(e.key) && drawPts.length) {
        setTyped(typed + e.key)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---------- pointer handling ----------
  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    const s = screenPos(e)
    pointers.current.set(e.pointerId, s)
    svgRef.current!.setPointerCapture(e.pointerId)
    cancelAnimationFrame(glide.current)
    const st = useEditor.getState()

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = {
        dist: dist(a, b),
        zoom: st.view.zoom,
        world: toWorld({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
      }
      drag.current = null
      setRectPreview(null)
      return
    }
    if (pointers.current.size > 2) return

    const base = { moved: false, sx: s.x, sy: s.y }
    const startPan = () => {
      drag.current = { ...base, type: 'pan', panX: st.view.panX, panY: st.view.panY }
    }
    if (e.button === 1 || e.button === 2 || st.tool === 'pan') return startPan()
    if (e.button !== 0) return
    const w = toWorld(s)
    const fl = currentFloor(st)

    if (st.tool === 'room') {
      if (e.pointerType !== 'mouse') setCursor(w) // touch has no hover
      const p = drawSnap(w, drawPts)
      if (isClosing(drawPts, p)) return finishPolygon(drawPts)
      if (drawPts.length && dist(drawPts[drawPts.length - 1], p) < 1) return
      setDrawPts([...drawPts, p])
      setTyped('')
      return
    }
    if (st.tool === 'rect' || st.tool === 'balcony' || st.tool === 'terrace') {
      const p = snapFree(w)
      drag.current = { ...base, type: 'rect', start: p, current: p }
      return
    }
    if (st.tool === 'dimension') {
      if (e.pointerType !== 'mouse') setCursor(w)
      if (!dimDraft) setDimDraft({ a: pointSnap(w).p })
      else if (!dimDraft.b) {
        const b = dimEnd(dimDraft.a, w)
        if (dist(b, dimDraft.a) > 1) setDimDraft({ a: dimDraft.a, b })
      } else {
        const d = addDimension({ a: dimDraft.a, b: dimDraft.b, offset: dimOffset(dimDraft.a, dimDraft.b, w) })
        setDimDraft(null)
        st.select({ kind: 'dimension', id: d.id })
      }
      return
    }

    const target = (e.target as Element).closest('[data-kind]') as HTMLElement | null
    const kind = target?.dataset.kind
    const id = target?.dataset.id
    const index = Number(target?.dataset.index)
    const sel = st.selection

    if (st.tool === 'wire') {
      const sym = kind === 'symbol' && id ? fl.symbols.find((x) => x.id === id) : undefined
      const fixture = sym && SYMBOL_MAP.get(sym.type)?.fixture
      if (sym && fixture === 'switch') {
        st.setWireSwitch(sym.id)
        st.select({ kind: 'symbol', id: sym.id })
      } else if (sym && (fixture || sym.led)) {
        if (st.wireSwitch) toggleWire(st.wireSwitch, sym.id)
        else toast('Click a switch first, then the lights it should control.')
      } else {
        startPan()
      }
      return
    }

    // Turning several selected items (or a group) with the handle above them.
    if (kind === 'multi-rotate' && sel?.kind === 'multi') {
      const { clip, box } = selectionBox(fl, sel)
      if (box) {
        const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
        drag.current = { ...base, type: 'multi-rotate', orig: clip, center, a0: Math.atan2(w.y - center.y, w.x - center.x) }
      }
      return
    }

    // Selecting several things: drag a box (the area tool, or Shift + drag on empty space).
    const itemKind = kind === 'room' || kind === 'symbol' || kind === 'dimension' || kind === 'view' ? kind : null
    if (st.tool === 'area' || (e.shiftKey && !itemKind && kind !== 'vertex' && kind !== 'edge')) {
      drag.current = { ...base, type: 'marquee', start: w, current: w, additive: e.shiftKey }
      return
    }
    if (itemKind && id) {
      const ref: ItemRef = { kind: itemKind, id }
      const same = (r: ItemRef) => r.kind === ref.kind && r.id === ref.id
      const current = refsOf(sel)
      // Shift + click adds or removes an item (with its group).
      if (e.shiftKey) {
        st.select(selectionOf(current.some(same) ? current.filter((r) => !same(r)) : [...current, ...withGroup(fl, ref)]))
        return
      }
      // Dragging one of several selected items, or any item of a group (Alt + click picks just the one), moves them all.
      const inMulti = sel?.kind === 'multi' && current.some(same)
      const group = e.altKey ? [ref] : withGroup(fl, ref)
      if (inMulti || group.length > 1) {
        const refs = inMulti ? current : group
        if (!inMulti) st.select(selectionOf(refs))
        const orig = copyItems(fl, refs)
        const pts = clipFootprint(orig)
        const inSel = new Set(orig.rooms.map((r) => r.id))
        drag.current = { ...base, type: 'multi', orig, start: w, box: pts.length ? bbox(pts) : null, rooms: fl.rooms.filter((r) => !inSel.has(r.id)) }
        return
      }
    }

    // select tool
    if ((kind === 'dim-a' || kind === 'dim-b') && sel?.kind === 'dimension') {
      drag.current = { ...base, type: 'dim-end', id: sel.id, end: kind === 'dim-a' ? 'a' : 'b' }
      return
    }
    if (kind === 'dimension' && id) {
      const orig = fl.dimensions?.find((x) => x.id === id)
      st.select({ kind: 'dimension', id })
      if (orig) drag.current = { ...base, type: 'dim-offset', id, orig, start: w }
      return
    }
    if (kind === 'view-rotate' && sel?.kind === 'view') {
      const orig = fl.views?.find((x) => x.id === sel.id)
      if (orig) drag.current = { ...base, type: 'view-rotate', id: sel.id, orig }
      return
    }
    if (kind === 'view' && id) {
      const orig = fl.views?.find((x) => x.id === id)
      st.select({ kind: 'view', id })
      if (orig) drag.current = { ...base, type: 'view', id, orig, start: w }
      return
    }

    if (kind === 'vertex' && sel?.kind === 'room') {
      const orig = fl.rooms.find((r) => r.id === sel.id)!
      st.select({ kind: 'room', id: sel.id, vertex: index })
      drag.current = { ...base, type: 'vertex', id: sel.id, index, orig }
    } else if (kind === 'edge' && sel?.kind === 'room') {
      const orig = fl.rooms.find((r) => r.id === sel.id)!
      drag.current = { ...base, type: 'edge', id: sel.id, index, orig, start: w }
    } else if ((kind === 'rotate' || kind === 'resize') && sel?.kind === 'symbol') {
      const sym = fl.symbols.find((x) => x.id === sel.id)!
      const pose = symbolPose(sym, fl.rooms)
      drag.current =
        kind === 'rotate'
          ? { ...base, type: 'rotate', id: sym.id, pose }
          : {
              ...base,
              type: 'resize',
              id: sym.id,
              orig: sym,
              pose,
              isWall: !!sym.wall,
              handle: target?.dataset.handle ?? 'se',
              w0: sym.width,
              d0: sym.depth,
              offset0: sym.wall?.offset,
            }
    } else if (kind === 'room' && id) {
      const orig = fl.rooms.find((r) => r.id === id)!
      if (!(sel?.kind === 'room' && sel.id === id)) st.select({ kind: 'room', id })
      drag.current = { ...base, type: 'room', id, start: w, orig }
    } else if (kind === 'symbol' && id) {
      const orig = fl.symbols.find((x) => x.id === id)!
      st.select({ kind: 'symbol', id })
      drag.current = { ...base, type: 'symbol', id, start: w, orig, pose: symbolPose(orig, fl.rooms) }
    } else {
      st.select(null)
      startPan()
    }
  }

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const s = screenPos(e)
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, s)
    const st = useEditor.getState()

    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const zoom = clampZoom((pinch.current.zoom * dist(a, b)) / pinch.current.dist)
      st.setView({ zoom, panX: mid.x - pinch.current.world.x * zoom, panY: mid.y - pinch.current.world.y * zoom })
      return
    }

    const w = toWorld(s)
    if (st.tool === 'room' || st.tool === 'dimension') setCursor(w)

    const d = drag.current
    if (!d) return
    if (!d.moved) {
      if (Math.hypot(s.x - d.sx, s.y - d.sy) < 3) return
      d.moved = true
      if (d.type !== 'pan' && d.type !== 'rect' && d.type !== 'marquee') st.checkpoint()
      if (d.type === 'symbol' || d.type === 'resize') setMovingId(d.id)
      if (d.type === 'multi') setMovingMulti(true)
    }
    const fl = currentFloor(st)
    const step = snapStep(st.project.units)
    const snap = st.settings.snap

    switch (d.type) {
      case 'pan':
        st.setView({ ...st.view, panX: d.panX + s.x - d.sx, panY: d.panY + s.y - d.sy })
        break
      case 'rect': {
        d.current = snapFree(w)
        setRectPreview({ a: d.start, b: d.current })
        break
      }
      case 'room': {
        let dx = w.x - d.start.x
        let dy = w.y - d.start.y
        if (snap) {
          const moved = [...d.orig.points, ...roomOuter(d.orig)].map((p) => ({ x: p.x + dx, y: p.y + dy }))
          const sn = axisSnap(moved, snapTargets(fl, d.id), snapThr())
          const p0 = d.orig.points[0]
          dx += sn.dx ?? snapTo(p0.x + dx, step) - (p0.x + dx)
          dy += sn.dy ?? snapTo(p0.y + dy, step) - (p0.y + dy)
        }
        st.mutate((pd) => {
          const r = draftFloor(pd).rooms.find((x) => x.id === d.id)
          if (r) r.points = d.orig.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
        })
        break
      }
      case 'vertex': {
        const others = d.orig.points.filter((_, i) => i !== d.index)
        const p = snapFree(w, others, d.id)
        st.mutate((pd) => {
          const r = draftFloor(pd).rooms.find((x) => x.id === d.id)
          if (r) r.points[d.index] = p
        })
        break
      }
      case 'edge': {
        const pts = d.orig.points
        const a = pts[d.index]
        const b = pts[(d.index + 1) % pts.length]
        const outward = mul(inwardNormal(a, b, signedArea(pts)), -1)
        let amount = dot(sub(w, d.start), outward)
        if (snap) amount = snapTo(amount, step)
        st.mutate((pd) => {
          const r = draftFloor(pd).rooms.find((x) => x.id === d.id)
          if (r) r.points = moveWall(pts, d.index, amount)
        })
        break
      }
      case 'dim-end': {
        const dim = fl.dimensions?.find((x) => x.id === d.id)
        if (!dim) break
        const other = d.end === 'a' ? dim.b : dim.a
        const p = dimEnd(other, w)
        st.mutate((pd) => {
          const x = draftFloor(pd).dimensions?.find((y) => y.id === d.id)
          if (x) x[d.end] = p
        })
        break
      }
      case 'dim-offset': {
        const { a, b } = d.orig
        const offset = d.orig.offset + dimOffset(a, b, w) - dimOffset(a, b, d.start)
        st.mutate((pd) => {
          const x = draftFloor(pd).dimensions?.find((y) => y.id === d.id)
          if (x) x.offset = offset
        })
        break
      }
      case 'multi': {
        let dx = w.x - d.start.x
        let dy = w.y - d.start.y
        if (snap) {
          dx = snapTo(dx, step)
          dy = snapTo(dy, step)
        }
        // Close to a wall: right up against it; close to the middle between the walls around them: stuck there,
        // like a single piece (hold Ctrl to place them freely).
        let found: SnapMark[] = []
        if (d.box && snap && !e.ctrlKey && !e.metaKey) {
          const m = boxMagnet({ minX: d.box.minX + dx, maxX: d.box.maxX + dx, minY: d.box.minY + dy, maxY: d.box.maxY + dy }, d.rooms, reachOf(st.view.zoom))
          dx += m.dx
          dy += m.dy
          found = m.marks
          const g = boxGaps({ minX: d.box.minX + dx, maxX: d.box.maxX + dx, minY: d.box.minY + dy, maxY: d.box.maxY + dy }, d.rooms)
          const thr = Math.max(4, 10 / st.view.zoom)
          if (!m.dx && g.left !== undefined && g.right !== undefined && Math.abs(g.right - g.left) / 2 < thr) dx += (g.right - g.left) / 2
          if (!m.dy && g.front !== undefined && g.back !== undefined && Math.abs(g.front - g.back) / 2 < thr) dy += (g.front - g.back) / 2
        }
        setMarks(found)
        st.mutate((pd) => moveItems(draftFloor(pd), d.orig, dx, dy))
        break
      }
      case 'multi-rotate': {
        let deg = ((Math.atan2(w.y - d.center.y, w.x - d.center.x) - d.a0) * 180) / Math.PI
        if (!e.shiftKey) deg = snapTo(deg, 15)
        st.mutate((pd) => rotateItems(draftFloor(pd), d.orig, d.center, deg))
        break
      }
      case 'marquee': {
        d.current = w
        setMarquee({ a: d.start, b: w })
        break
      }
      case 'view': {
        const { eye, look } = d.orig
        let x = eye.x + w.x - d.start.x
        let y = eye.y + w.y - d.start.y
        if (snap) {
          x = snapTo(x, step)
          y = snapTo(y, step)
        }
        st.mutate((pd) => {
          const v = draftFloor(pd).views?.find((z) => z.id === d.id)
          if (!v) return
          v.eye = { ...eye, x, y }
          v.look = { ...look, x: look.x + x - eye.x, y: look.y + y - eye.y }
        })
        break
      }
      case 'view-rotate': {
        const { eye, look } = d.orig
        let ang = (Math.atan2(w.y - eye.y, w.x - eye.x) * 180) / Math.PI
        if (!e.shiftKey) ang = snapTo(ang, 15)
        const r = Math.hypot(look.x - eye.x, look.y - eye.y) || 100
        const rad = (ang * Math.PI) / 180
        st.mutate((pd) => {
          const v = draftFloor(pd).views?.find((z) => z.id === d.id)
          if (v) v.look = { ...look, x: eye.x + Math.cos(rad) * r, y: eye.y + Math.sin(rad) * r }
        })
        break
      }
      case 'symbol': {
        if (d.orig.room) break // cove lights follow their room
        let pos = add(d.pose, sub(w, d.start))
        const symDef = SYMBOL_MAP.get(d.orig.type)
        const zoom = st.view.zoom
        // Lined up with the walls and the pieces around it, unless snapping's off or Ctrl is held.
        const magnet = snap && !e.ctrlKey && !e.metaKey
        const opts = { reach: reachOf(zoom), middle: Math.max(4, 10 / zoom), align: Math.max(3, 8 / zoom), walls: !symDef?.fixture }
        const cur = fl.symbols.find((x) => x.id === d.id) ?? d.orig
        if (symDef?.wallMount) {
          const mount = wallMountPose(pos, fl.rooms, Math.max(30, 25 / zoom), d.orig.depth)
          const along = mount && magnet ? magnetize(cur, mount, fl, { ...opts, mounted: true }) : null
          setMarks(along?.marks ?? [])
          st.mutate((pd) => {
            const sym = draftFloor(pd).symbols.find((x) => x.id === d.id)
            if (!sym) return
            const p = along ?? mount ?? (snap ? { x: snapTo(pos.x, step), y: snapTo(pos.y, step), rotation: sym.rotation } : { ...pos, rotation: sym.rotation })
            sym.x = p.x
            sym.y = p.y
            sym.rotation = p.rotation
          })
          break
        }
        if (!symDef?.wall) {
          const p = magnet
            ? magnetize(cur, { ...pos, rotation: cur.rotation }, fl, { ...opts, turn: true, rotation0: d.pose.rotation, grid: step })
            : { ...(snap ? { x: snapTo(pos.x, step), y: snapTo(pos.y, step) } : pos), rotation: d.pose.rotation, marks: [] }
          setMarks(p.marks)
          st.mutate((pd) => {
            const sym = draftFloor(pd).symbols.find((x) => x.id === d.id)
            if (!sym) return
            sym.wall = undefined
            sym.x = p.x
            sym.y = p.y
            sym.rotation = p.rotation
          })
          break
        }
        const att = findWallSnap(pos, fl.rooms, Math.max(30, 25 / zoom))
        if (!att && snap) pos = { x: snapTo(pos.x, step), y: snapTo(pos.y, step) }
        if (!att) {
          // Close to the middle between two walls (side to side, or front to back): stick to it.
          const g = wallGaps({ ...d.orig, x: pos.x, y: pos.y, rotation: d.pose.rotation, wall: undefined }, fl.rooms)
          const r = (d.pose.rotation * Math.PI) / 180
          const thr = Math.max(4, 10 / zoom)
          if (g.left !== undefined && g.right !== undefined && Math.abs(g.right - g.left) / 2 < thr) {
            const s = (g.right - g.left) / 2
            pos = { x: pos.x + Math.cos(r) * s, y: pos.y + Math.sin(r) * s }
          }
          if (g.front !== undefined && g.back !== undefined && Math.abs(g.front - g.back) / 2 < thr) {
            const s = (g.front - g.back) / 2
            pos = { x: pos.x - Math.sin(r) * s, y: pos.y + Math.cos(r) * s }
          }
        }
        st.mutate((pd) => {
          const sym = draftFloor(pd).symbols.find((x) => x.id === d.id)
          if (!sym) return
          if (att) {
            // Close to the middle of the wall: stick to it exactly.
            const room = fl.rooms.find((r) => r.id === att.roomId)
            const L = room ? dist(room.points[att.edge], room.points[(att.edge + 1) % room.points.length]) : 0
            if (L && Math.abs(att.offset - L / 2) < Math.max(6, 12 / zoom)) att.offset = L / 2
            else if (snap) att.offset = snapTo(att.offset, step)
            sym.wall = att
          } else {
            sym.wall = undefined
            sym.x = pos.x
            sym.y = pos.y
            sym.rotation = d.pose.rotation
          }
        })
        break
      }
      case 'rotate': {
        const v = sub(w, d.pose)
        let ang = (Math.atan2(v.y, v.x) * 180) / Math.PI + 90
        if (!e.shiftKey) ang = snapTo(ang, 15)
        ang = ((ang % 360) + 360) % 360
        st.mutate((pd) => {
          const sym = draftFloor(pd).symbols.find((x) => x.id === d.id)
          if (sym) sym.rotation = ang
        })
        break
      }
      case 'resize': {
        // Drag one side (or corner) and the opposite side stays put; hold Alt to resize from the center.
        const local = rotate(sub(w, d.pose), -d.pose.rotation)
        const r1 = (v: number) => (snap ? Math.max(step, snapTo(v, step)) : Math.max(1, Math.round(v)))
        const sx = d.handle.includes('e') ? 1 : d.handle.includes('w') ? -1 : 0
        const sy = d.isWall ? 0 : d.handle.includes('s') ? 1 : d.handle.includes('n') ? -1 : 0
        const fromCenter = e.altKey
        const size = (s: number, v: number, orig: number) =>
          s === 0 ? orig : fromCenter ? r1(Math.abs(v) * 2) : r1(s * v + orig / 2)
        // Kept to realistic sizes (and round things round); a track gets modules to fill its new length.
        const next = resized(d.orig, d.isWall ? { width: size(sx, local.x, d.w0) } : { width: size(sx, local.x, d.w0), depth: size(sy, local.y, d.d0) })
        const { width, depth } = next
        // The center moves by half the growth, toward the dragged side.
        const shift = fromCenter ? { x: 0, y: 0 } : { x: (sx * (width - d.w0)) / 2, y: (sy * (depth - d.d0)) / 2 }
        const moved = rotate(shift, d.pose.rotation)
        st.mutate((pd) => {
          const sym = draftFloor(pd).symbols.find((x) => x.id === d.id)
          if (!sym) return
          sym.width = width
          if (next.modules) sym.modules = next.modules
          if (d.isWall) {
            if (sym.wall && d.offset0 !== undefined) sym.wall = { ...sym.wall, offset: d.offset0 + shift.x }
          } else {
            sym.depth = depth
            sym.x = d.pose.x + moved.x
            sym.y = d.pose.y + moved.y
          }
        })
        break
      }
    }
  }

  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const d = drag.current
    drag.current = null
    setMovingId(null)
    setMovingMulti(false)
    setMarks([])
    // A person dropped onto a seat or bed settles onto it.
    if (d?.type === 'symbol' && d.moved && d.orig.type === 'person' && d.orig.pose) updatePerson(d.id, {}, true)
    // A sofa table dropped near a sofa tucks in behind it.
    if (d?.type === 'symbol' && d.moved && d.orig.type === 'sofa-table') placeBehindSofa(d.id, true)
    if (d?.type === 'marquee') {
      setMarquee(null)
      const st = useEditor.getState()
      if (!d.moved) {
        if (!d.additive) st.select(null)
        return
      }
      const found = refsInRect(currentFloor(st), d.start, d.current, st.settings.faded)
      st.select(selectionOf(d.additive ? [...refsOf(st.selection), ...found] : found))
      // Ready to move what was picked.
      if (st.tool === 'area' && found.length) useEditor.setState({ tool: 'select' })
      return
    }
    if (d?.type === 'rect') {
      setRectPreview(null)
      const w = Math.abs(d.current.x - d.start.x)
      const h = Math.abs(d.current.y - d.start.y)
      if (w >= 20 && h >= 20) {
        const x = Math.min(d.start.x, d.current.x)
        const y = Math.min(d.start.y, d.current.y)
        const pts = [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ]
        const tool = useEditor.getState().tool
        if (tool === 'balcony' || tool === 'terrace') addOutdoor(pts, tool)
        else addRoom(pts)
      }
    }
  }

  const onDoubleClick = (e: RMouseEvent) => {
    const st = useEditor.getState()
    if (st.tool === 'room') {
      finishPolygon(drawPts)
      return
    }
    const target = (e.target as Element).closest('[data-kind]') as HTMLElement | null
    const kind = target?.dataset.kind
    if (kind === 'edge' && st.selection?.kind === 'room') {
      splitWall(st.selection.id, Number(target!.dataset.index))
      return
    }
    if (kind === 'vertex' || ['dimension', 'rect', 'balcony', 'terrace'].includes(st.tool)) return
    // Double-click a room (or anything in it) to bring it to the middle of the screen; outside them, the whole floor.
    const fl = currentFloor(st)
    const w = toWorld(screenPos(e))
    const room =
      (kind === 'room' ? fl.rooms.find((r) => r.id === target!.dataset.id) : undefined) ??
      [...fl.rooms].reverse().find((r) => r.points.length >= 3 && pointInPolygon(w, r.points))
    glideTo(room ? roomOuter(room) : floorBounds(fl))
  }

  // ---------- drag & drop from library ----------
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(SYMBOL_DRAG_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }
  const onDrop = (e: DragEvent) => {
    const type = e.dataTransfer.getData(SYMBOL_DRAG_MIME)
    if (!type) return
    e.preventDefault()
    const w = toWorld(screenPos(e))
    const def = SYMBOL_MAP.get(type)
    const fl = currentFloor(useEditor.getState())
    const att = def?.wall ? findWallSnap(w, fl.rooms, Math.max(40, 30 / view.zoom)) : null
    const mount = def?.wallMount ? wallMountPose(w, fl.rooms, Math.max(40, 30 / view.zoom), def.depth) : null
    // Dropped close to a wall: right up against it, turned to face the room if it stands that way.
    const opts = { reach: reachOf(view.zoom) * 1.5, middle: Math.max(4, 10 / view.zoom), align: Math.max(3, 8 / view.zoom), walls: !def?.fixture }
    const placed =
      def && !def.wall && !def.ceilingStyle && settings.snap
        ? magnetize(newSymbol(type, w.x, w.y), mount ?? { ...w, rotation: 0 }, fl, { ...opts, mounted: !!mount, turn: true, rotation0: 0 })
        : null
    const at = placed ?? mount
    const added = addSymbol(type, at ?? w, at?.rotation ?? 0, att ?? undefined)
    if (!added) toast('Drop it onto a room.')
  }

  // ---------- rendering ----------
  const { zoom, panX, panY } = view
  const px = (n: number) => n / zoom // screen px -> world units

  const [minor, majorBase] = gridSpacing(units)
  let major = majorBase
  while (major * zoom < 40) major *= 5
  const minorPx = minor * zoom
  const majorPx = major * zoom

  const selRoom = selection?.kind === 'room' ? floor.rooms.find((r) => r.id === selection.id) : undefined
  const selSym = selection?.kind === 'symbol' ? floor.symbols.find((r) => r.id === selection.id) : undefined
  const selDim = selection?.kind === 'dimension' ? floor.dimensions?.find((d) => d.id === selection.id) : undefined
  const selCoveRoom = selSym?.room ? floor.rooms.find((r) => r.id === selSym.room) : undefined

  let dimPreview: Dimension | null = null
  if (tool === 'dimension' && cursor) {
    if (dimDraft?.b) dimPreview = { id: 'preview', a: dimDraft.a, b: dimDraft.b, offset: dimOffset(dimDraft.a, dimDraft.b, cursor) }
    else if (dimDraft) dimPreview = { id: 'preview', a: dimDraft.a, b: dimEnd(dimDraft.a, cursor), offset: 0 }
  }
  const dimCursor = tool === 'dimension' && cursor && !dimDraft ? pointSnap(cursor) : null

  const drawCursor = tool === 'room' && cursor ? drawSnap(cursor, drawPts) : null

  /** Dashed distance lines with their lengths; equal gaps on both sides (centered) show in green. */
  const drawGuides = (guides: Guide[], alongWall: boolean) => (
    <g pointerEvents="none" className="guides">
      {guides.map((gd, i, all) => {
        const pair = alongWall ? all : all.filter((o) => (o.side === 'left' || o.side === 'right') === (gd.side === 'left' || gd.side === 'right'))
        const color = pair.length === 2 && Math.abs(pair[0].length - pair[1].length) < 0.5 ? '#16a34a' : '#e11d48'
        const sh = gd.shift ? { x: gd.shift.x * px(14), y: gd.shift.y * px(14) } : { x: 0, y: 0 }
        const a = { x: gd.a.x + sh.x, y: gd.a.y + sh.y }
        const b = { x: gd.b.x + sh.x, y: gd.b.y + sh.y }
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const n = normalize({ x: -(b.y - a.y), y: b.x - a.x })
        const tick = (p: Point) => <line x1={p.x - n.x * px(5)} y1={p.y - n.y * px(5)} x2={p.x + n.x * px(5)} y2={p.y + n.y * px(5)} />
        return (
          <g key={i}>
            <g stroke={color} strokeWidth={1.3} vectorEffect="non-scaling-stroke">
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeDasharray="5 3" />
              {tick(a)}
              {tick(b)}
            </g>
            <text
              x={m.x}
              y={m.y}
              fontSize={px(11)}
              fontWeight={700}
              fontFamily="system-ui, sans-serif"
              textAnchor="middle"
              dominantBaseline="central"
              fill={color}
              stroke={theme.paper}
              strokeWidth={3}
              paintOrder="stroke"
              vectorEffect="non-scaling-stroke"
            >
              {formatLength(gd.length, units)}
            </text>
          </g>
        )
      })}
    </g>
  )
  const closing = drawCursor ? isClosing(drawPts, drawCursor) : false

  return (
    <svg
      ref={svgRef}
      className={`plan-canvas tool-${tool}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => tool === 'room' && setCursor(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <defs>
        <pattern id="grid-minor" width={minorPx} height={minorPx} patternUnits="userSpaceOnUse" x={panX % minorPx} y={panY % minorPx}>
          <path d={`M${minorPx} 0L0 0 0 ${minorPx}`} fill="none" stroke={theme.gridMinor} strokeWidth={1} />
        </pattern>
        <pattern id="grid-major" width={majorPx} height={majorPx} patternUnits="userSpaceOnUse" x={panX % majorPx} y={panY % majorPx}>
          <path d={`M${majorPx} 0L0 0 0 ${majorPx}`} fill="none" stroke={theme.gridMajor} strokeWidth={1} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={theme.paper} />
      {settings.showGrid && (
        <>
          {minorPx >= 8 && <rect width="100%" height="100%" fill="url(#grid-minor)" />}
          <rect width="100%" height="100%" fill="url(#grid-major)" />
        </>
      )}

      <g transform={`translate(${panX},${panY}) scale(${zoom})`}>
        {floor.underlay?.visible && (
          <image
            href={floor.underlay.src}
            x={floor.underlay.x}
            y={floor.underlay.y}
            width={floor.underlay.width}
            height={floor.underlay.height}
            opacity={floor.underlay.opacity}
            preserveAspectRatio="none"
            pointerEvents="none"
            transform={
              floor.underlay.rotation
                ? `rotate(${floor.underlay.rotation},${floor.underlay.x + floor.underlay.width / 2},${floor.underlay.y + floor.underlay.height / 2})`
                : undefined
            }
          />
        )}
        {settings.showFloorBelow && floorBelow && (
          <PlanLayers floor={floorBelow} units={units} theme={theme} scale={zoom} ghost />
        )}
        <PlanLayers
          floor={floor}
          units={units}
          theme={theme}
          layer={layer}
          activeSwitch={tool === 'wire' ? wireSwitch : null}
          showDimensions={settings.showDimensions}
          scale={zoom}
          showWallLengths={settings.showWallLengths}
          showAreas={settings.showAreas}
          faded={settings.faded}
          images={project.images}
        />

        {/* saved 3D views */}
        {!!floor.views?.length && (
          <g opacity={settings.faded.includes('Saved views') ? 0.15 : 1} pointerEvents={settings.faded.includes('Saved views') ? 'none' : undefined}>
            <PlanViews views={floor.views} scale={zoom} theme={theme} selectedId={selection?.kind === 'view' ? selection.id : null} />
          </g>
        )}

        {/* selected room: outline, vertex & wall handles */}
        {selRoom && (
          <g>
            <path d={polygonPath(selRoom.points)} className="sel-outline" />
            {selRoom.points.map((a, i) => {
              const b = selRoom.points[(i + 1) % selRoom.points.length]
              const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
              const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
              return (
                <rect
                  key={`e${i}`}
                  data-kind="edge"
                  data-index={i}
                  className="handle edge-handle"
                  x={m.x - px(9)}
                  y={m.y - px(4)}
                  width={px(18)}
                  height={px(8)}
                  rx={px(3)}
                  transform={`rotate(${ang},${m.x},${m.y})`}
                >
                  <title>Drag to move wall · double-click to add a point</title>
                </rect>
              )
            })}
            {selRoom.points.map((p, i) => (
              <circle
                key={`v${i}`}
                data-kind="vertex"
                data-index={i}
                className={`handle${selection?.kind === 'room' && selection.vertex === i ? ' active' : ''}`}
                cx={p.x}
                cy={p.y}
                r={px(7)}
              />
            ))}
          </g>
        )}

        {/* selected dimension: end handles */}
        {selDim && (() => {
          const [p, q] = dimensionPoints(selDim)
          return (
            <g>
              <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="sel-outline" />
              <circle data-kind="dim-a" className="handle" cx={selDim.a.x} cy={selDim.a.y} r={px(6)} />
              <circle data-kind="dim-b" className="handle" cx={selDim.b.x} cy={selDim.b.y} r={px(6)} />
            </g>
          )
        })()}

        {/* dimension tool preview */}
        {dimPreview && (
          <g pointerEvents="none" opacity={0.8}>
            <DimensionGraphic d={dimPreview} units={units} scale={zoom} theme={theme} />
          </g>
        )}
        {(dimCursor || dimDraft) && (
          <g pointerEvents="none">
            {dimDraft && <circle cx={dimDraft.a.x} cy={dimDraft.a.y} r={px(4)} className="draw-point" />}
            {dimDraft?.b && <circle cx={dimDraft.b.x} cy={dimDraft.b.y} r={px(4)} className="draw-point" />}
            {dimCursor && <circle cx={dimCursor.p.x} cy={dimCursor.p.y} r={px(dimCursor.vertex ? 6 : 3)} className="draw-point" />}
          </g>
        )}

        {/* selected cove light: its path */}
        {selCoveRoom &&
          selSym &&
          (() => {
            const room = ceilingRoom(selCoveRoom, floor)
            const light = ceilingLight(selSym, room)
            // Only where it's lit.
            return <path d={coveRuns(room, light).runs.map(({ a, b }) => `M${a.x},${a.y}L${b.x},${b.y}`).join('')} className="sel-outline" />
          })()}

        {/* selected symbol: bounds, rotate & resize handles */}
        {selSym && !selSym.room && (() => {
          const pose = symbolPose(selSym, floor.rooms)
          const dpt = pose.wallThickness ?? selSym.depth
          const hw = selSym.width / 2 + px(3)
          const hd = dpt / 2 + px(3)
          return (
            <g transform={`translate(${pose.x},${pose.y}) rotate(${pose.rotation})`}>
              <rect x={-hw} y={-hd} width={hw * 2} height={hd * 2} className="sel-outline" />
              {!selSym.wall && (
                <>
                  <line x1={0} y1={-hd} x2={0} y2={-hd - px(22)} className="sel-outline" />
                  <circle data-kind="rotate" className="handle rotate-handle" cx={0} cy={-hd - px(22)} r={px(7)}>
                    <title>Rotate (hold Shift for free rotation)</title>
                  </circle>
                </>
              )}
              {(() => {
                // Only the sides that can change: a magnetic track only gets longer, a switch doesn't resize at all.
                // People are sized in the panel (their footprint follows their height and pose).
                const wide = selSym.type !== 'person' && canResize(selSym.type, 'width')
                const deep = selSym.type !== 'person' && !selSym.wall && canResize(selSym.type, 'depth')
                return wide && deep
                  ? (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const)
                  : wide
                    ? (['w', 'e'] as const)
                    : deep
                      ? (['n', 's'] as const)
                      : []
              })().map((h) => {
                const cx = h.includes('e') ? hw : h.includes('w') ? -hw : 0
                const cy = h.includes('s') ? hd : h.includes('n') ? -hd : 0
                const side = h.length === 1
                return (
                  <rect
                    key={h}
                    data-kind="resize"
                    data-handle={h}
                    className={`handle resize-handle resize-${h}`}
                    x={cx - px(side ? 5 : 6)}
                    y={cy - px(side ? 5 : 6)}
                    width={px(side ? 10 : 12)}
                    height={px(side ? 10 : 12)}
                    rx={side ? px(5) : 0}
                  >
                    <title>{side ? 'Drag to stretch this side (Alt: both sides)' : 'Drag to resize from this corner (Alt: from the center)'}</title>
                  </rect>
                )
              })}
            </g>
          )
        })()}

        {/* several selected items: an outline around each */}
        {selection?.kind === 'multi' && (
          <g pointerEvents="none">
            {selection.items.map((r) => {
              if (r.kind === 'room') {
                const room = floor.rooms.find((x) => x.id === r.id)
                return room ? <path key={`r${r.id}`} d={polygonPath(room.points)} className="sel-outline" /> : null
              }
              if (r.kind === 'symbol') {
                const s = floor.symbols.find((x) => x.id === r.id)
                if (!s) return null
                const pose = symbolPose(s, floor.rooms)
                const hw = s.width / 2 + px(3)
                const hd = (pose.wallThickness ?? s.depth) / 2 + px(3)
                return (
                  <rect
                    key={`s${r.id}`}
                    x={-hw}
                    y={-hd}
                    width={hw * 2}
                    height={hd * 2}
                    className="sel-outline"
                    transform={`translate(${pose.x},${pose.y}) rotate(${pose.rotation})`}
                  />
                )
              }
              if (r.kind === 'dimension') {
                const dm = floor.dimensions?.find((x) => x.id === r.id)
                if (!dm) return null
                const [p, q] = dimensionPoints(dm)
                return <line key={`d${r.id}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="sel-outline" />
              }
              const v = floor.views?.find((x) => x.id === r.id)
              return v ? <circle key={`v${r.id}`} cx={v.eye.x} cy={v.eye.y} r={px(17)} className="sel-outline" /> : null
            })}
          </g>
        )}

        {/* distances to the walls around what's being moved */}
        {movingId &&
          (() => {
            const s = floor.symbols.find((x) => x.id === movingId)
            return s && !s.room ? drawGuides(clearanceGuides(s, floor.rooms), !!s.wall) : null
          })()}
        {movingMulti &&
          selection?.kind === 'multi' &&
          (() => {
            const { box, rooms } = selectionBox(floor, selection)
            return box ? drawGuides(boxGuides(box, rooms), false) : null
          })()}

        {/* what's lined up: against a wall (solid), or in line with another piece (dashed) */}
        {marks.length > 0 && (
          <g pointerEvents="none" stroke="#0ea5e9" strokeLinecap="round">
            {marks.map((m, i) => {
              const dir = normalize(sub(m.b, m.a))
              const ext = m.kind === 'align' ? px(10) : 0
              return (
                <line
                  key={i}
                  x1={m.a.x - dir.x * ext}
                  y1={m.a.y - dir.y * ext}
                  x2={m.b.x + dir.x * ext}
                  y2={m.b.y + dir.y * ext}
                  strokeWidth={m.kind === 'wall' ? 4 : 1.3}
                  strokeDasharray={m.kind === 'align' ? '6 4' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
          </g>
        )}

        {/* several selected: their extent, with a handle to turn them */}
        {selection?.kind === 'multi' &&
          !movingMulti &&
          (() => {
            const { box } = selectionBox(floor, selection)
            if (!box) return null
            const cx = (box.minX + box.maxX) / 2
            const top = box.minY - px(8)
            return (
              <g>
                <rect
                  x={box.minX - px(8)}
                  y={top}
                  width={box.maxX - box.minX + px(16)}
                  height={box.maxY - box.minY + px(16)}
                  className="sel-outline"
                  pointerEvents="none"
                  opacity={0.6}
                />
                <line x1={cx} y1={top} x2={cx} y2={top - px(22)} className="sel-outline" pointerEvents="none" />
                <circle data-kind="multi-rotate" className="handle rotate-handle" cx={cx} cy={top - px(22)} r={px(7)}>
                  <title>Turn them together (hold Shift for free rotation)</title>
                </circle>
              </g>
            )
          })()}

        {/* selection box */}
        {marquee && (
          <rect
            pointerEvents="none"
            x={Math.min(marquee.a.x, marquee.b.x)}
            y={Math.min(marquee.a.y, marquee.b.y)}
            width={Math.abs(marquee.a.x - marquee.b.x)}
            height={Math.abs(marquee.a.y - marquee.b.y)}
            className="draw-preview"
          />
        )}

        {/* rectangle tool preview */}
        {rectPreview && (() => {
          const x = Math.min(rectPreview.a.x, rectPreview.b.x)
          const y = Math.min(rectPreview.a.y, rectPreview.b.y)
          const w = Math.abs(rectPreview.a.x - rectPreview.b.x)
          const h = Math.abs(rectPreview.a.y - rectPreview.b.y)
          return (
            <g pointerEvents="none">
              <rect x={x} y={y} width={w} height={h} className="draw-preview" />
              <text x={x + w / 2} y={y - px(8)} fontSize={px(12)} textAnchor="middle" className="draw-label">
                {formatLength(w, units)}
              </text>
              <text
                x={x - px(8)}
                y={y + h / 2}
                fontSize={px(12)}
                textAnchor="middle"
                className="draw-label"
                transform={`rotate(-90,${x - px(8)},${y + h / 2})`}
              >
                {formatLength(h, units)}
              </text>
            </g>
          )
        })()}

        {/* polygon tool preview */}
        {tool === 'room' && (drawPts.length > 0 || drawCursor) && (
          <g pointerEvents="none">
            {drawPts.length > 0 && (
              <polyline
                points={[...drawPts, ...(drawCursor ? [closing ? drawPts[0] : drawCursor] : [])]
                  .map((p) => `${p.x},${p.y}`)
                  .join(' ')}
                className="draw-line"
              />
            )}
            {drawPts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={px(i === 0 && closing ? 8 : 4)} className="draw-point" />
            ))}
            {drawCursor && <circle cx={drawCursor.x} cy={drawCursor.y} r={px(3)} className="draw-cursor" />}
            {drawCursor && drawPts.length > 0 && (() => {
              const last = drawPts[drawPts.length - 1]
              const L = dist(last, drawCursor)
              return (
                <text x={drawCursor.x + px(12)} y={drawCursor.y - px(12)} fontSize={px(12)} className="draw-label">
                  {typed ? `${typed}▏` : formatLength(L, units)}
                </text>
              )
            })()}
          </g>
        )}
      </g>
    </svg>
  )
}
