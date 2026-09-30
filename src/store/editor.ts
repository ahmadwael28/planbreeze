import { produce } from 'immer'
import { create } from 'zustand'
import {
  newOutdoor,
  newFloor,
  newProject,
  newRoom,
  newSymbol,
  reattachSymbols,
  rectPoints,
  uid,
} from '@/model/project'
import { bbox, labelPoint, pointInPolygon } from '@/model/geometry'
import { allRefs, clipFootprint, copyItems, deleteItems, exists, moveItems, pasteItems, refsOf, rotateItems, selectionOf, setGroup } from '@/model/items'
import { boxCenterShift } from '@/model/guides'
import type { Clip } from '@/model/items'
import { CEILING_STYLES, OTHER_LIGHTS, pruneControls, remapEdges } from '@/model/lighting'
import { dimensionPoints, roomOuter } from '@/model/project'
import { SYMBOL_MAP } from '@/model/symbols'
import type {
  CeilingStyle,
  Dimension,
  Floor,
  PlanLayer,
  PlanSymbol,
  OutdoorKind,
  Point,
  Project,
  Room,
  Selection,
  Tool,
  View,
} from '@/model/types'

export interface Settings {
  snap: boolean
  showGrid: boolean
  showWallLengths: boolean
  showAreas: boolean
  showFloorBelow: boolean
  /** Which floors the 3D view shows. */
  floors3d: 'upToCurrent' | 'all' | 'current'
  showDimensions: boolean
  /** 3D: 0 = night, 1 = full daylight. */
  daylight: number
  /** 3D: show gypsum ceilings (seen from inside rooms). */
  showCeilings: boolean
  /** 3D camera lens: how much of the scene fits in view. */
  lens3d: 'normal' | 'wide' | 'ultra'
  /** Plan: library categories (and 'Dimensions', 'Saved views') shown faded and not clickable. */
  faded: string[]
}

export type ViewMode = '2d' | '3d'

const SETTINGS_KEY = 'fp.settings'
const HISTORY_LIMIT = 100

const defaultSettings: Settings = {
  snap: true,
  showGrid: true,
  showWallLengths: true,
  showAreas: true,
  showFloorBelow: true,
  floors3d: 'upToCurrent',
  showDimensions: true,
  daylight: 1,
  showCeilings: true,
  lens3d: 'normal',
  faded: [],
}

function loadSettings(): Settings {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }
  } catch {
    return defaultSettings
  }
}

interface EditorState {
  project: Project
  past: Project[]
  future: Project[]
  floorId: string
  selection: Selection | null
  tool: Tool
  viewMode: ViewMode
  layer: PlanLayer
  /** The switch being wired while the wire tool is active. */
  wireSwitch: string | null
  /** On/off per switch id (and OTHER_LIGHTS for lights without a switch). Missing = on. */
  lightStates: Record<string, boolean>
  view: View
  viewport: { w: number; h: number }
  settings: Settings
  /** Incremented to ask the canvas to zoom-to-fit. */
  fitRequest: number

  loadProject: (p: Project) => void
  /** Apply a change as a new undo step. */
  commit: (recipe: (draft: Project) => void) => void
  /** Save the current state as an undo step; follow with `mutate` calls (e.g. while dragging). */
  checkpoint: () => void
  /** Apply a change without creating an undo step. */
  mutate: (recipe: (draft: Project) => void) => void
  undo: () => void
  redo: () => void
  setFloor: (id: string) => void
  select: (sel: Selection | null) => void
  setTool: (t: Tool) => void
  setViewMode: (m: ViewMode) => void
  setLayer: (l: PlanLayer) => void
  setWireSwitch: (id: string | null) => void
  setLightState: (id: string, on: boolean) => void
  setAllLights: (on: boolean) => void
  setView: (v: View | ((v: View) => View)) => void
  setViewport: (w: number, h: number) => void
  setSettings: (s: Partial<Settings>) => void
  requestFit: () => void
}

function apply(p: Project, recipe: (draft: Project) => void) {
  const next = produce(p, recipe)
  return next === p ? p : { ...next, updatedAt: Date.now() }
}

function validSelection(p: Project, floorId: string, sel: Selection | null): Selection | null {
  if (!sel) return null
  const floor = p.floors.find((f) => f.id === floorId)
  if (!floor) return null
  if (sel.kind === 'room') {
    const room = floor.rooms.find((r) => r.id === sel.id)
    if (!room) return null
    return sel.vertex !== undefined && sel.vertex >= room.points.length ? { kind: 'room', id: sel.id } : sel
  }
  if (sel.kind === 'multi') return selectionOf(sel.items.filter((r) => exists(floor, r)))
  if (sel.kind === 'dimension') return floor.dimensions?.some((d) => d.id === sel.id) ? sel : null
  if (sel.kind === 'view') return floor.views?.some((v) => v.id === sel.id) ? sel : null
  return floor.symbols.some((s) => s.id === sel.id) ? sel : null
}

const initial = newProject()

export const useEditor = create<EditorState>((set, get) => ({
  project: initial,
  past: [],
  future: [],
  floorId: initial.floors[0].id,
  selection: null,
  tool: 'select',
  viewMode: '2d',
  layer: 'plan',
  wireSwitch: null,
  lightStates: {},
  view: { panX: 200, panY: 150, zoom: 0.8 },
  viewport: { w: 800, h: 600 },
  settings: loadSettings(),
  fitRequest: 0,

  loadProject: (p) =>
    set((s) => ({
      project: p,
      past: [],
      future: [],
      floorId: p.floors[0].id,
      selection: null,
      tool: 'select',
      fitRequest: s.fitRequest + 1,
    })),

  commit: (recipe) => {
    const { project, past } = get()
    const next = apply(project, recipe)
    if (next === project) return
    set({ project: next, past: [...past, project].slice(-HISTORY_LIMIT), future: [] })
  },

  checkpoint: () => {
    const { project, past } = get()
    set({ past: [...past, project].slice(-HISTORY_LIMIT), future: [] })
  },

  mutate: (recipe) => set({ project: apply(get().project, recipe) }),

  undo: () => {
    const { past, future, project, floorId, selection } = get()
    if (!past.length) return
    const prev = past[past.length - 1]
    const fid = prev.floors.some((f) => f.id === floorId) ? floorId : prev.floors[0].id
    set({
      project: prev,
      past: past.slice(0, -1),
      future: [project, ...future],
      floorId: fid,
      selection: validSelection(prev, fid, selection),
    })
  },

  redo: () => {
    const { past, future, project, floorId, selection } = get()
    if (!future.length) return
    const next = future[0]
    const fid = next.floors.some((f) => f.id === floorId) ? floorId : next.floors[0].id
    set({
      project: next,
      past: [...past, project],
      future: future.slice(1),
      floorId: fid,
      selection: validSelection(next, fid, selection),
    })
  },

  setFloor: (id) => set({ floorId: id, selection: null }),
  select: (selection) => set({ selection }),
  setTool: (tool) =>
    set({
      tool,
      selection: tool === 'select' || tool === 'wire' ? get().selection : null,
      wireSwitch: tool === 'wire' ? get().wireSwitch : null,
    }),
  setViewMode: (viewMode) => set({ viewMode, tool: 'select' }),
  setLayer: (layer) => set({ layer, tool: 'select', wireSwitch: null }),
  setWireSwitch: (wireSwitch) => set({ wireSwitch }),
  setLightState: (id, on) => set({ lightStates: { ...get().lightStates, [id]: on } }),
  setAllLights: (on) => {
    const states: Record<string, boolean> = { [OTHER_LIGHTS]: on }
    for (const f of get().project.floors) for (const s of f.symbols) if (s.type === 'switch') states[s.id] = on
    set({ lightStates: states })
  },
  setView: (v) => set({ view: typeof v === 'function' ? v(get().view) : v }),
  setViewport: (w, h) => set({ viewport: { w, h } }),
  setSettings: (s) => {
    const settings = { ...get().settings, ...s }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    set({ settings })
  },
  requestFit: () => set({ fitRequest: get().fitRequest + 1 }),
}))

// ---------- selectors & helpers ----------

export function currentFloor(s: Pick<EditorState, 'project' | 'floorId'>): Floor {
  return s.project.floors.find((f) => f.id === s.floorId) ?? s.project.floors[0]
}

export const useFloor = () => useEditor(currentFloor)

/** Access the active floor inside a draft project. */
export function draftFloor(d: Project): Floor {
  const id = useEditor.getState().floorId
  return d.floors.find((f) => f.id === id) ?? d.floors[0]
}

export function useSelectedRoom(): Room | undefined {
  return useEditor((s) => {
    const sel = s.selection
    return sel?.kind === 'room' ? currentFloor(s).rooms.find((r) => r.id === sel.id) : undefined
  })
}

export function useSelectedSymbol(): PlanSymbol | undefined {
  return useEditor((s) => {
    const sel = s.selection
    return sel?.kind === 'symbol' ? currentFloor(s).symbols.find((r) => r.id === sel.id) : undefined
  })
}

/** World coordinates of the visible viewport center. */
export function viewCenter(): Point {
  const { view, viewport } = useEditor.getState()
  return { x: (viewport.w / 2 - view.panX) / view.zoom, y: (viewport.h / 2 - view.panY) / view.zoom }
}

// ---------- actions ----------

export function addRoom(points: Point[]) {
  const st = useEditor.getState()
  const floor = currentFloor(st)
  const room = newRoom(floor, points, st.project.defaultWallThickness)
  st.commit((d) => {
    draftFloor(d).rooms.push(room)
  })
  useEditor.setState({ selection: { kind: 'room', id: room.id }, tool: 'select' })
}

export function addOutdoor(points: Point[], kind: OutdoorKind) {
  const st = useEditor.getState()
  const room = newOutdoor(currentFloor(st), points, kind)
  st.commit((d) => {
    draftFloor(d).rooms.push(room)
  })
  useEditor.setState({ selection: { kind: 'room', id: room.id }, tool: 'select' })
}

export function addRectRoomAtCenter(w = 400, h = 300) {
  const c = viewCenter()
  const step = 10
  addRoom(rectPoints(Math.round((c.x - w / 2) / step) * step, Math.round((c.y - h / 2) / step) * step, w, h))
}

export function addLShapeRoomAtCenter() {
  const c = viewCenter()
  const x = Math.round((c.x - 250) / 10) * 10
  const y = Math.round((c.y - 200) / 10) * 10
  addRoom([
    { x, y },
    { x: x + 500, y },
    { x: x + 500, y: y + 200 },
    { x: x + 250, y: y + 200 },
    { x: x + 250, y: y + 400 },
    { x, y: y + 400 },
  ])
}

/** The room under a point, if any. */
export function roomAt(floor: Floor, p: Point): Room | undefined {
  return floor.rooms.find((r) => pointInPolygon(p, r.points))
}

export function applyCeiling(roomId: string, style: CeilingStyle | null) {
  const st = useEditor.getState()
  st.commit((d) => {
    const f = draftFloor(d)
    const room = f.rooms.find((r) => r.id === roomId)
    if (!room) return
    if (!style) {
      room.ceiling = undefined
      return
    }
    const defaults = CEILING_STYLES[style].defaults
    const band = room.ceiling?.band && style !== 'flat' ? room.ceiling.band : defaults.band
    room.ceiling = { style, drop: room.ceiling?.drop ?? defaults.drop, band }
    // Cove and floating ceilings come with their hidden LED.
    if ((style === 'cove' || style === 'floating') && !f.symbols.some((s) => s.room === room.id)) {
      const c = labelPoint(room.points)
      f.symbols.push({ ...newSymbol('cove-light', c.x, c.y), room: room.id })
    }
  })
  useEditor.setState({ selection: { kind: 'room', id: roomId } })
}

export function addSymbol(type: string, at?: Point, rotation = 0, wall?: PlanSymbol['wall']) {
  const st0 = useEditor.getState()
  const p = at ?? viewCenter()
  const def = SYMBOL_MAP.get(type)
  const floor0 = currentFloor(st0)
  if (def?.ceilingStyle) {
    const sel = st0.selection
    const room = roomAt(floor0, p) ?? (sel?.kind === 'room' ? floor0.rooms.find((r) => r.id === sel.id) : undefined)
    if (room) applyCeiling(room.id, def.ceilingStyle)
    return room ?? null
  }
  const sym = { ...newSymbol(type, Math.round(p.x), Math.round(p.y)), rotation, wall }
  if (def?.wall) sym.depth = st0.project.defaultWallThickness
  if (def?.fixture === 'switch') sym.label = `S${floor0.symbols.filter((s) => s.type === 'switch').length + 1}`
  if (def?.fixture === 'cove') {
    const sel = st0.selection
    const room = roomAt(floor0, p) ?? (sel?.kind === 'room' ? floor0.rooms.find((r) => r.id === sel.id) : undefined)
    if (!room) return null
    sym.room = room.id
  }
  useEditor.getState().commit((d) => {
    draftFloor(d).symbols.push(sym)
  })
  useEditor.setState({ selection: { kind: 'symbol', id: sym.id }, tool: 'select' })
  return sym
}

export function deleteSelection() {
  const { selection, commit } = useEditor.getState()
  const refs = refsOf(selection)
  if (!refs.length) return
  commit((d) => {
    const f = draftFloor(d)
    deleteItems(f, refs)
    pruneControls(f)
  })
  useEditor.setState({ selection: null })
}

// ---------------------------------------------------------------------------
// Several items at once: clipboard, groups, select all

let clipboard: { clip: Clip; floorId: string } | null = null
let pastes = 0

/** Copy the selection. Returns how many items were copied. */
export function copySelection(): number {
  const st = useEditor.getState()
  const refs = refsOf(st.selection)
  if (!refs.length) return 0
  clipboard = { clip: copyItems(currentFloor(st), refs), floorId: st.floorId }
  pastes = 0
  return refs.length
}

export function cutSelection(): number {
  const n = copySelection()
  if (n) deleteSelection()
  return n
}

/**
 * Paste the clipboard onto the current floor: shifted a little each time on the floor it came
 * from, in the same place on another floor (or project). Returns how many items were added.
 */
export function pasteClipboard(): number {
  if (!clipboard) return 0
  const st = useEditor.getState()
  const sameFloor = clipboard.floorId === st.floorId
  pastes++
  const off = sameFloor ? 50 * pastes : 50 * (pastes - 1)
  const { clip } = clipboard
  let added: ReturnType<typeof pasteItems> = []
  st.commit((d) => {
    added = pasteItems(draftFloor(d), clip, off, off)
  })
  useEditor.setState({ selection: selectionOf(added) })
  return added.length
}

export const hasClipboard = () => !!clipboard

/** Group the selected items (they're then selected and moved together), or ungroup them. */
export function groupSelection(group: boolean) {
  const st = useEditor.getState()
  const refs = refsOf(st.selection)
  if (!refs.length || (group && refs.length < 2)) return
  const id = group ? uid() : null
  st.commit((d) => setGroup(draftFloor(d), refs, id))
}

/** The selected items' extent, and the rooms around them (the selected rooms themselves don't count as walls to measure to). */
export function selectionBox(floor: Floor, sel: Selection | null) {
  const clip = copyItems(floor, refsOf(sel))
  const pts = clipFootprint(clip)
  const inSel = new Set(clip.rooms.map((r) => r.id))
  return { clip, box: pts.length ? bbox(pts) : null, rooms: floor.rooms.filter((r) => !inSel.has(r.id)) }
}

/** Turn the selection by `deg` (clockwise on the plan) around its middle. */
export function rotateSelection(deg: number) {
  const st = useEditor.getState()
  const { clip, box } = selectionBox(currentFloor(st), st.selection)
  if (!box) return
  const c = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
  st.commit((d) => rotateItems(draftFloor(d), clip, c, deg))
}

/** Move the selection so it sits midway between the walls around it. */
export function centerSelection(axis: 'across' | 'depth' | 'both') {
  const st = useEditor.getState()
  const { clip, box, rooms } = selectionBox(currentFloor(st), st.selection)
  if (!box) return
  const s = boxCenterShift(box, rooms, axis)
  if (s.x || s.y) st.commit((d) => moveItems(draftFloor(d), clip, s.x, s.y))
}

/** Fade a category on the plan, or show it again. */
export function toggleFaded(key: string) {
  const { settings, setSettings } = useEditor.getState()
  setSettings({ faded: settings.faded.includes(key) ? settings.faded.filter((k) => k !== key) : [...settings.faded, key] })
}

export function selectAll() {
  const st = useEditor.getState()
  st.select(selectionOf(allRefs(currentFloor(st))))
}

export function removeVertex(roomId: string, index: number) {
  const st = useEditor.getState()
  const room = currentFloor(st).rooms.find((r) => r.id === roomId)
  if (!room || room.points.length <= 3) return
  st.commit((d) => {
    const r = draftFloor(d).rooms.find((x) => x.id === roomId)!
    r.points.splice(index, 1)
    fixAttachments(d, room)
  })
  useEditor.setState({ selection: { kind: 'room', id: roomId } })
}

export function splitWall(roomId: string, edge: number) {
  const st = useEditor.getState()
  const room = currentFloor(st).rooms.find((r) => r.id === roomId)
  if (!room) return
  const a = room.points[edge]
  const b = room.points[(edge + 1) % room.points.length]
  st.commit((d) => {
    const r = draftFloor(d).rooms.find((x) => x.id === roomId)!
    r.points.splice(edge + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    fixAttachments(d, room)
  })
  useEditor.setState({ selection: { kind: 'room', id: roomId, vertex: edge + 1 } })
}

/** Re-attach wall symbols after the room's outline changed (call inside a recipe). */
export function fixAttachments(d: Project, oldRoom: Room) {
  const f = draftFloor(d)
  const r = f.rooms.find((x) => x.id === oldRoom.id)
  if (!r) return
  reattachSymbols(f, oldRoom, r)
  // Per-wall settings follow the walls.
  if (r.shadowGaps) r.shadowGaps = remapEdges(oldRoom.points, r.points, r.shadowGaps)
  for (const s of f.symbols) {
    if (s.room === r.id && s.cove?.off) s.cove = { ...s.cove, off: remapEdges(oldRoom.points, r.points, s.cove.off) }
  }
}

export function duplicateSelection() {
  const st = useEditor.getState()
  const refs = refsOf(st.selection)
  if (!refs.length) return
  const clip = copyItems(currentFloor(st), refs)
  let added: ReturnType<typeof pasteItems> = []
  st.commit((d) => {
    added = pasteItems(draftFloor(d), clip, 50, 50)
  })
  useEditor.setState({ selection: selectionOf(added) })
}

export function addFloor() {
  const st = useEditor.getState()
  const floor = newFloor(`Floor ${st.project.floors.length}`)
  st.commit((d) => {
    d.floors.push(floor)
  })
  st.setFloor(floor.id)
}

export function duplicateFloor(id: string) {
  const st = useEditor.getState()
  const src = st.project.floors.find((f) => f.id === id)
  if (!src) return
  const roomIds = new Map(src.rooms.map((r) => [r.id, uid()]))
  const symIds = new Map(src.symbols.map((s) => [s.id, uid()]))
  const copy: Floor = {
    ...src,
    id: uid(),
    name: `${src.name} copy`,
    rooms: src.rooms.map((r) => ({ ...r, id: roomIds.get(r.id)! })),
    symbols: src.symbols.map((s) => ({
      ...s,
      id: symIds.get(s.id)!,
      wall: s.wall ? { ...s.wall, roomId: roomIds.get(s.wall.roomId) ?? s.wall.roomId } : undefined,
      room: s.room ? roomIds.get(s.room) : undefined,
      controls: s.controls?.map((id) => symIds.get(id) ?? id),
    })),
    dimensions: src.dimensions?.map((dm) => ({ ...dm, id: uid() })),
  }
  st.commit((d) => {
    d.floors.splice(d.floors.findIndex((f) => f.id === id) + 1, 0, copy)
  })
  st.setFloor(copy.id)
}

export function deleteFloor(id: string) {
  const st = useEditor.getState()
  if (st.project.floors.length <= 1) return
  const idx = st.project.floors.findIndex((f) => f.id === id)
  st.commit((d) => {
    d.floors = d.floors.filter((f) => f.id !== id)
  })
  const floors = useEditor.getState().project.floors
  st.setFloor(floors[Math.max(0, idx - 1)].id)
}

// ---------- lighting & dimensions ----------

/** Connect or disconnect a light from a switch. */
export function toggleWire(switchId: string, lightId: string) {
  useEditor.getState().commit((d) => {
    const sw = draftFloor(d).symbols.find((s) => s.id === switchId)
    if (!sw) return
    const list = sw.controls ?? []
    sw.controls = list.includes(lightId) ? list.filter((id) => id !== lightId) : [...list, lightId]
  })
}

export function addDimension(dim: Omit<Dimension, 'id'>) {
  const d: Dimension = { ...dim, id: uid() }
  useEditor.getState().commit((p) => {
    const f = draftFloor(p)
    f.dimensions = [...(f.dimensions ?? []), d]
  })
  return d
}

/** Overall width and depth of the floor, measured on the outside of the walls. */
export function autoDimension() {
  const st = useEditor.getState()
  const floor = currentFloor(st)
  const pts = floor.rooms.flatMap(roomOuter)
  if (!pts.length) return 0
  const b = bbox(pts)
  const gap = 60
  const near = (u: Point, v: Point) => Math.hypot(u.x - v.x, u.y - v.y) < 5
  const exists = (a: Point, c: Point) =>
    (floor.dimensions ?? []).some((x) => {
      const [p, q] = dimensionPoints(x)
      return (near(x.a, a) && near(x.b, c)) || (near(p, a) && near(q, c))
    })
  const dims: Omit<Dimension, 'id'>[] = []
  const tl = { x: b.minX, y: b.minY }
  const tr = { x: b.maxX, y: b.minY }
  const bl = { x: b.minX, y: b.maxY }
  if (!exists(tl, tr)) dims.push({ a: tl, b: tr, offset: gap })
  if (!exists(bl, tl)) dims.push({ a: bl, b: tl, offset: gap })
  if (!dims.length) return 0
  st.commit((p) => {
    const f = draftFloor(p)
    f.dimensions = [...(f.dimensions ?? []), ...dims.map((x) => ({ ...x, id: uid() }))]
  })
  return dims.length
}
