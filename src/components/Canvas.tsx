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
  polygonPath,
  rotate,
  signedArea,
  snapAngle,
  snapTo,
  sub,
} from '@/model/geometry'
import { toast } from 'sonner'
import { covePath } from '@/model/lighting'
import { dimensionPoints, findWallSnap, floorBounds, moveWall, roomOuter, symbolPose, wallMountPose } from '@/model/project'
import { SYMBOL_MAP } from '@/model/symbols'
import { formatLength, gridSpacing, parseLength, snapStep } from '@/model/units'
import type { Dimension, Floor, PlanSymbol, Point, Pose, Room, SavedView } from '@/model/types'
import {
  addDimension,
  addRoom,
  addSymbol,
  currentFloor,
  draftFloor,
  splitWall,
  toggleWire,
  useEditor,
} from '@/store/editor'
import { usePlanTheme } from '@/hooks/use-plan-theme'
import { DimensionGraphic, PlanLayers } from './PlanLayers'
import { PlanViews } from './PlanViews'

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
    | { type: 'resize'; id: string; pose: Pose; isWall: boolean }
    | { type: 'rect'; start: Point; current: Point }
    | { type: 'dim-end'; id: string; end: 'a' | 'b' }
    | { type: 'dim-offset'; id: string; orig: Dimension; start: Point }
    | { type: 'view'; id: string; orig: SavedView; start: Point }
    | { type: 'view-rotate'; id: string; orig: SavedView }
  )

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
  const [drawPts, setDrawPts] = useState<Point[]>([])
  const [cursor, setCursor] = useState<Point | null>(null)
  const [typed, setTyped] = useState('')
  const [dimDraft, setDimDraft] = useState<{ a: Point; b?: Point } | null>(null)

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
    const pts = floorBounds(currentFloor(st))
    const { width: w, height: h } = svgRef.current!.getBoundingClientRect()
    if (!pts.length) {
      st.setView({ panX: w / 2 - 200, panY: h / 2 - 150, zoom: 1 })
      return
    }
    const b = bbox(pts)
    const margin = 60
    const zoom = clampZoom(
      Math.min((w - margin * 2) / Math.max(b.maxX - b.minX, 1), (h - margin * 2) / Math.max(b.maxY - b.minY, 1)),
    )
    st.setView({
      zoom,
      panX: w / 2 - ((b.minX + b.maxX) / 2) * zoom,
      panY: h / 2 - ((b.minY + b.maxY) / 2) * zoom,
    })
  }, [])

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
    if (st.tool === 'rect') {
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
      } else if (sym && fixture) {
        if (st.wireSwitch) toggleWire(st.wireSwitch, sym.id)
        else toast('Click a switch first, then the lights it should control.')
      } else {
        startPan()
      }
      return
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
          : { ...base, type: 'resize', id: sym.id, pose, isWall: !!sym.wall }
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
      if (d.type !== 'pan' && d.type !== 'rect') st.checkpoint()
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
        if (symDef?.wallMount) {
          const mount = wallMountPose(pos, fl.rooms, Math.max(30, 25 / st.view.zoom), d.orig.depth)
          st.mutate((pd) => {
            const sym = draftFloor(pd).symbols.find((x) => x.id === d.id)
            if (!sym) return
            const p = mount ?? (snap ? { x: snapTo(pos.x, step), y: snapTo(pos.y, step), rotation: sym.rotation } : { ...pos, rotation: sym.rotation })
            sym.x = p.x
            sym.y = p.y
            sym.rotation = p.rotation
          })
          break
        }
        const isWall = !!symDef?.wall
        const att = isWall ? findWallSnap(pos, fl.rooms, Math.max(30, 25 / st.view.zoom)) : null
        if (!att && snap) pos = { x: snapTo(pos.x, step), y: snapTo(pos.y, step) }
        st.mutate((pd) => {
          const sym = draftFloor(pd).symbols.find((x) => x.id === d.id)
          if (!sym) return
          if (att) {
            if (snap) att.offset = snapTo(att.offset, step)
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
        const local = rotate(sub(w, d.pose), -d.pose.rotation)
        const r1 = (v: number) => (snap ? Math.max(step, snapTo(v, step)) : Math.max(1, Math.round(v)))
        st.mutate((pd) => {
          const sym = draftFloor(pd).symbols.find((x) => x.id === d.id)
          if (!sym) return
          sym.width = r1(Math.abs(local.x) * 2)
          if (!d.isWall) sym.depth = r1(Math.abs(local.y) * 2)
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
    if (d?.type === 'rect') {
      setRectPreview(null)
      const w = Math.abs(d.current.x - d.start.x)
      const h = Math.abs(d.current.y - d.start.y)
      if (w >= 20 && h >= 20) {
        const x = Math.min(d.start.x, d.current.x)
        const y = Math.min(d.start.y, d.current.y)
        addRoom([
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ])
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
    if (target?.dataset.kind === 'edge' && st.selection?.kind === 'room') {
      splitWall(st.selection.id, Number(target.dataset.index))
    }
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
    const added = addSymbol(type, mount ?? w, mount?.rotation ?? 0, att ?? undefined)
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
        />

        {/* saved 3D views */}
        {!!floor.views?.length && (
          <PlanViews views={floor.views} scale={zoom} theme={theme} selectedId={selection?.kind === 'view' ? selection.id : null} />
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
        {selCoveRoom && <path d={polygonPath(covePath(selCoveRoom).path)} className="sel-outline" />}

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
              <rect
                data-kind="resize"
                className="handle resize-handle"
                x={hw - px(6)}
                y={hd - px(6)}
                width={px(12)}
                height={px(12)}
              >
                <title>Resize</title>
              </rect>
            </g>
          )
        })()}

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
