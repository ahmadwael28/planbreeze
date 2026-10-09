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
import { bbox, dist, dot, labelPoint, normalize, pointInPolygon, signedArea, sub } from '@/model/geometry'
import { allRefs, clipFootprint, copyItems, deleteItems, exists, moveItems, pasteItems, refsOf, rotateItems, selectionOf, setGroup } from '@/model/items'
import { arrange, arrangeable } from '@/model/arrange'
import type { Arrangement } from '@/model/arrange'
import { boxCenterShift, boxGaps } from '@/model/guides'
import type { Side } from '@/model/guides'
import { fixSizes } from '@/model/sizes'
import type { Clip } from '@/model/items'
import { CEILING_STYLES, mergeRoomLights, OTHER_LIGHTS, pruneControls, remapEdges, remapEdgeValues, ROOM_LIGHTS } from '@/model/lighting'
import { columnIntoWall, dimensionPoints, findWallSnap, isOutdoor, moveWall, roomOuter, symbolPose } from '@/model/project'
import { dividePoints, healOpenings, joinPoints, openedPoints, sharedStretch, wallAcross } from '@/model/divide'
import { personDepth, personSupport } from '@/model/people'
import { behindSofa } from '@/model/placement'
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
  /** The 3D view has been opened: it then stays alive (hidden in 2D), so switching back is instant. */
  seen3d: boolean
  layer: PlanLayer
  /** The switch being wired while the wire tool is active. */
  wireSwitch: string | null
  /** On/off per switch id (and OTHER_LIGHTS for lights without a switch). Missing = on. */
  lightStates: Record<string, boolean>
  /** Doors shut in 3D, by id (the others stand open). Like the lights, not saved with the plan. */
  doorsClosed: Record<string, boolean>
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
  setDoorsClosed: (ids: string[], closed: boolean) => void
  setView: (v: View | ((v: View) => View)) => void
  setViewport: (w: number, h: number) => void
  setSettings: (s: Partial<Settings>) => void
  requestFit: () => void
}

function apply(p: Project, recipe: (draft: Project) => void) {
  const next = produce(p, recipe)
  return next === p ? p : { ...next, updatedAt: Date.now() }
}

/** A plan shared with this user to view only: nothing changes it. */
export const isViewOnly = (p: Project) => p.access?.role === 'viewer'

/** Who may do what with a plan stays as it is now when stepping back or forward through its history. */
const withAccess = (p: Project, current: Project) => (p.access === current.access ? p : { ...p, access: current.access })

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
  seen3d: false,
  layer: 'plan',
  wireSwitch: null,
  lightStates: {},
  doorsClosed: {},
  view: { panX: 200, panY: 150, zoom: 0.8 },
  viewport: { w: 800, h: 600 },
  settings: loadSettings(),
  fitRequest: 0,

  loadProject: (p) =>
    set((s) => ({
      project: fixRoomLights(fixSizes(p)),
      past: [],
      future: [],
      floorId: p.floors[0].id,
      selection: null,
      tool: 'select',
      fitRequest: s.fitRequest + 1,
    })),

  commit: (recipe) => {
    const { project, past } = get()
    if (isViewOnly(project)) return
    const next = apply(project, (d) => {
      recipe(d)
      healAll(d)
    })
    if (next === project) return
    set({ project: next, past: [...past, project].slice(-HISTORY_LIMIT), future: [] })
  },

  checkpoint: () => {
    const { project, past } = get()
    if (isViewOnly(project)) return
    set({ past: [...past, project].slice(-HISTORY_LIMIT), future: [] })
  },

  mutate: (recipe) => {
    const { project } = get()
    if (!isViewOnly(project)) set({ project: apply(project, recipe) })
  },

  undo: () => {
    const { past, future, project, floorId, selection } = get()
    if (!past.length || isViewOnly(project)) return
    const prev = withAccess(past[past.length - 1], project)
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
    if (!future.length || isViewOnly(project)) return
    const next = withAccess(future[0], project)
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
    // Shared to view: only the tools for looking around.
    (!isViewOnly(get().project) || tool === 'select' || tool === 'pan' || tool === 'area') &&
    set({
      tool,
      selection: tool === 'select' || tool === 'wire' || tool === 'divide' ? get().selection : null,
      wireSwitch: tool === 'wire' ? get().wireSwitch : null,
    }),
  setViewMode: (viewMode) => set({ viewMode, tool: 'select', ...(viewMode === '3d' && { seen3d: true }) }),
  setLayer: (layer) => set({ layer, tool: 'select', wireSwitch: null }),
  setWireSwitch: (wireSwitch) => set({ wireSwitch }),
  setLightState: (id, on) => set({ lightStates: { ...get().lightStates, [id]: on } }),
  setAllLights: (on) => {
    const states: Record<string, boolean> = { [OTHER_LIGHTS]: on }
    for (const f of get().project.floors) for (const s of f.symbols) if (s.type === 'switch') states[s.id] = on
    set({ lightStates: states })
  },
  setDoorsClosed: (ids, closed) => set({ doorsClosed: { ...get().doorsClosed, ...Object.fromEntries(ids.map((id) => [id, closed])) } }),
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

/** A plan as loaded, with any room's extra hidden lights of a kind merged into its first (see mergeRoomLights). */
function fixRoomLights(p: Project): Project {
  if (!p.floors.some((f) => f.symbols.some((s) => s.room && ROOM_LIGHTS.includes(s.type)))) return p
  return produce(p, (d) => {
    for (const f of d.floors) mergeRoomLights(f)
  })
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
    if ((style === 'cove' || style === 'floating') && !f.symbols.some((s) => s.room === room.id && s.type === 'cove-light')) {
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
  const sym = { ...newSymbol(type, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10), rotation, wall }
  if (def?.wall) sym.depth = st0.project.defaultWallThickness
  if (def?.fixture === 'switch') sym.label = `S${floor0.symbols.filter((s) => s.type === 'switch').length + 1}`
  if (def?.fixture === 'cove') {
    const sel = st0.selection
    const room = roomAt(floor0, p) ?? (sel?.kind === 'room' ? floor0.rooms.find((r) => r.id === sel.id) : undefined)
    if (!room) return null
    // A room has one of each: show the one it has instead of adding another.
    const has = ROOM_LIGHTS.includes(type) && floor0.symbols.find((s) => s.room === room.id && s.type === type)
    if (has) {
      useEditor.setState({ selection: { kind: 'symbol', id: has.id }, tool: 'select' })
      return has
    }
    sym.room = room.id
  }
  useEditor.getState().commit((d) => {
    draftFloor(d).symbols.push(sym)
  })
  useEditor.setState({ selection: { kind: 'symbol', id: sym.id }, tool: 'select' })
  return sym
}

/**
 * Turn free-standing columns into ones built into the nearest wall, or back, as one undo step. Returns how many
 * changed (columns with no wall near enough to build them into stay as they are).
 */
export function convertColumns(ids: string[], into: 'wall' | 'free'): number {
  const st = useEditor.getState()
  const floor = currentFloor(st)
  const from = into === 'wall' ? 'column' : 'wall-post'
  const changes = new Map<string, Partial<PlanSymbol>>()
  for (const sym of floor.symbols) {
    if (!ids.includes(sym.id) || sym.type !== from) continue
    const pose = into === 'wall' ? columnIntoWall(sym, floor.rooms) : {}
    if (pose) changes.set(sym.id, { ...pose, type: into === 'wall' ? 'wall-post' : 'column', flipX: false, flipY: false })
  }
  if (changes.size)
    st.commit((d) => {
      for (const s of draftFloor(d).symbols) if (changes.has(s.id)) Object.assign(s, changes.get(s.id))
    })
  return changes.size
}

/**
 * Put a sofa table behind the nearest sofa (or corner sofa). `live` makes no undo step (the end of a drag, which has
 * one). Returns false when there's no sofa near it.
 */
export function placeBehindSofa(id: string, live = false): boolean {
  const st = useEditor.getState()
  const floor = currentFloor(st)
  const table = floor.symbols.find((s) => s.id === id)
  const at = table && behindSofa(table, floor.symbols)
  if (!at) return false
  const recipe = (d: Project) => {
    const s = draftFloor(d).symbols.find((x) => x.id === id)
    if (s) Object.assign(s, at, { flipX: false, flipY: false })
  }
  if (live) st.mutate(recipe)
  else st.commit(recipe)
  return true
}

/**
 * Change a person (height, shoulder width, pose…): their footprint follows, and sitting or lying, they settle onto what
 * they're on. `live` makes no undo step (e.g. at the end of a drag, which has one).
 */
export function updatePerson(id: string, patch: Partial<Pick<PlanSymbol, 'height' | 'width' | 'pose'>> = {}, live = false) {
  const st = useEditor.getState()
  const recipe = (d: Project) => {
    const f = draftFloor(d)
    const s = f.symbols.find((x) => x.id === id)
    if (!s || s.type !== 'person') return
    Object.assign(s, patch)
    if (s.pose === 'stand') delete s.pose
    s.depth = personDepth(s.height, s.width, s.pose)
    const at = personSupport(s, f.symbols)
    if (at) Object.assign(s, { x: at.x, y: at.y, rotation: at.rotation })
  }
  if (live) st.mutate(recipe)
  else st.commit(recipe)
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

/** Move the selected pieces together right up against the wall on one side of them (left/right, back is up). */
export function pushSelection(side: Side) {
  const st = useEditor.getState()
  const { clip, box, rooms } = selectionBox(currentFloor(st), st.selection)
  if (!box) return
  const g = boxGaps(box, rooms)[side]
  if (g === undefined || Math.abs(g) < 0.05) return
  const r = Math.round(g * 10) / 10
  const [dx, dy] = side === 'left' ? [-r, 0] : side === 'right' ? [r, 0] : side === 'back' ? [0, -r] : [0, r]
  st.commit((d) => moveItems(draftFloor(d), clip, dx, dy))
}

/** Lay the selected pieces (or groups) out in rows (see model/arrange). False if it can't be done. */
export function arrangeSelection(how: Arrangement) {
  const st = useEditor.getState()
  const fl = currentFloor(st)
  const units = arrangeable(fl, refsOf(st.selection))
  const moves = arrange(units, fl.rooms, how)
  if (!moves) return false
  const round = (v: number) => Math.round(v * 10) / 10
  st.commit((d) => {
    const df = draftFloor(d)
    for (const u of units) {
      const p = moves.get(u.id)
      if (p) moveItems(df, copyItems(fl, u.refs), round(p.x - u.x), round(p.y - u.y))
    }
  })
  return true
}

/** Fade a category on the plan, or show it again. */
export function toggleFaded(key: string) {
  const { settings, setSettings } = useEditor.getState()
  setSettings({ faded: settings.faded.includes(key) ? settings.faded.filter((k) => k !== key) : [...settings.faded, key] })
}

export function selectAll() {
  const st = useEditor.getState()
  st.select(selectionOf(allRefs(currentFloor(st), st.settings.faded)))
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
export function fixAttachments(d: Project, oldRoom: Room, force = false) {
  fixRoom(draftFloor(d), oldRoom, force)
}

/**
 * After a room's outline changed on floor `f`: its doors and windows re-attached, and its per-wall settings carried
 * over to the walls they're on now (`force`: even with as many corners as before, when they're not the same ones).
 */
function fixRoom(f: Floor, oldRoom: Room, force = false) {
  const r = f.rooms.find((x) => x.id === oldRoom.id)
  if (!r) return
  reattachSymbols(f, oldRoom, r)
  // Per-wall settings follow the walls.
  if (r.shadowGaps) r.shadowGaps = remapEdges(oldRoom.points, r.points, r.shadowGaps, force)
  if (r.curtainPockets) r.curtainPockets = remapEdges(oldRoom.points, r.points, r.curtainPockets, force)
  if (r.openEdges) r.openEdges = remapEdges(oldRoom.points, r.points, r.openEdges, force)
  if (r.ceilingBreaks) r.ceilingBreaks = remapEdges(oldRoom.points, r.points, r.ceilingBreaks, force)
  if (r.ceiling?.bands) r.ceiling.bands = remapEdgeValues(oldRoom.points, r.points, r.ceiling.bands, force)
  if (r.wallFinishes) r.wallFinishes = remapEdgeValues(oldRoom.points, r.points, r.wallFinishes, force)
  for (const s of f.symbols) {
    if (s.room === r.id && s.cove?.off) s.cove = { ...s.cove, off: remapEdges(oldRoom.points, r.points, s.cove.off, force) }
  }
}

/** Keep the open walls on every floor matched (see healOpenings); part of every change. */
function healAll(d: Project) {
  for (const f of d.floors) healOpenings(f, (old) => fixRoom(f, old))
}

/** Match up open walls again after a drag (part of its undo step). */
export function healDrag() {
  useEditor.getState().mutate(healAll)
}

// ---------------------------------------------------------------------------
// Rooms open to each other (see model/divide)

/**
 * Divide a room in two along the line a–b across it, with no wall between the parts: one space, two rooms with their
 * own floors, ceilings and lights. The bigger part stays the room; the other is a new room like it. Returns the new
 * room, or null if the line doesn't cut the room in two.
 */
export function divideRoom(roomId: string, a: Point, b: Point): Room | null {
  const st = useEditor.getState()
  const floor = currentFloor(st)
  const room = floor.rooms.find((r) => r.id === roomId)
  if (!room || isOutdoor(room)) return null
  const parts = dividePoints(room.points, a, b)
  if (!parts) return null
  const [big, small] = Math.abs(signedArea(parts[0])) >= Math.abs(signedArea(parts[1])) ? parts : [parts[1], parts[0]]
  const other: Room = { ...structuredClone(room), id: uid(), name: `${room.name} 2`, points: small }
  // Per-wall settings stay on the walls they were on, whichever part has them now; the line between is open.
  const carry = (r: Room, pts: Point[]) => {
    r.shadowGaps = remapEdges(room.points, pts, room.shadowGaps, true)
    r.curtainPockets = remapEdges(room.points, pts, room.curtainPockets, true)
    r.wallFinishes = remapEdgeValues(room.points, pts, room.wallFinishes, true)
    if (r.ceiling?.bands) r.ceiling.bands = remapEdgeValues(room.points, pts, room.ceiling!.bands, true)
    r.openEdges = [...(remapEdges(room.points, pts, room.openEdges, true) ?? []), pts.length - 1]
    // One ceiling across the new line (it was one ceiling before).
    r.ceilingBreaks = remapEdges(room.points, pts, room.ceilingBreaks, true)
  }
  carry(other, small)
  // Lights that run round the room: the new part gets its own, worked by the same switches.
  const lights = floor.symbols.filter((s) => s.room === roomId)
  const copies = new Map(lights.map((s) => [s.id, uid()]))
  st.commit((d) => {
    const f = draftFloor(d)
    const r = f.rooms.find((x) => x.id === roomId)!
    r.points = big
    carry(r, big)
    f.rooms.splice(f.rooms.indexOf(r) + 1, 0, other)
    // Doors and windows: on whichever part has their wall now.
    for (const s of f.symbols) {
      if (s.wall?.roomId !== roomId) continue
      const snap = findWallSnap(symbolPose(s, [room]), [r, other], room.wallThickness + 5)
      if (snap) s.wall = snap
    }
    for (const s of lights) {
      const mine = f.symbols.find((x) => x.id === s.id)
      if (mine?.cove?.off) mine.cove = { ...mine.cove, off: remapEdges(room.points, big, s.cove!.off, true) }
      const copy: PlanSymbol = { ...structuredClone(s), id: copies.get(s.id)!, room: other.id }
      if (copy.cove?.off) copy.cove.off = remapEdges(room.points, small, s.cove!.off, true)
      f.symbols.push(copy)
    }
    for (const sw of f.symbols) {
      if (sw.controls?.some((id) => copies.has(id))) sw.controls = [...sw.controls, ...sw.controls.flatMap((id) => (copies.has(id) ? [copies.get(id)!] : []))]
    }
  })
  useEditor.setState({ selection: { kind: 'room', id: other.id }, tool: 'select' })
  return other
}

/** Join a room and one it's open to back into one room (the first, with the other's doors and windows). */
export function joinRooms(roomId: string, otherId: string): boolean {
  const st = useEditor.getState()
  const floor = currentFloor(st)
  const a = floor.rooms.find((r) => r.id === roomId)
  const b = floor.rooms.find((r) => r.id === otherId)
  if (!a || !b) return false
  const pts = joinPoints(a, b)
  if (!pts) return false
  // Each wall keeps the settings it had, from whichever room it was a wall of.
  const edges = (key: 'shadowGaps' | 'curtainPockets' | 'openEdges' | 'ceilingBreaks') => {
    const all = [...(remapEdges(a.points, pts, a[key], true) ?? []), ...(remapEdges(b.points, pts, b[key], true) ?? [])]
    return all.length ? [...new Set(all)].sort((x, y) => x - y) : undefined
  }
  const values = <T,>(va?: (T | null)[], vb?: (T | null)[]) => {
    const ma = remapEdgeValues(a.points, pts, va, true)
    const mb = remapEdgeValues(b.points, pts, vb, true)
    return ma || mb ? pts.map((_, i) => ma?.[i] ?? mb?.[i] ?? null) : undefined
  }
  st.commit((d) => {
    const f = draftFloor(d)
    const r = f.rooms.find((x) => x.id === a.id)!
    r.points = pts
    r.shadowGaps = edges('shadowGaps')
    r.curtainPockets = edges('curtainPockets')
    r.openEdges = edges('openEdges')
    r.ceilingBreaks = edges('ceilingBreaks')
    r.wallFinishes = values(a.wallFinishes, b.wallFinishes)
    if (r.ceiling) r.ceiling.bands = values(a.ceiling?.bands, b.ceiling?.bands)
    for (const s of f.symbols) {
      if (s.wall?.roomId !== a.id && s.wall?.roomId !== b.id) continue
      const snap = findWallSnap(symbolPose(s, [s.wall.roomId === a.id ? a : b]), [r], Math.max(a.wallThickness, b.wallThickness) + 5)
      if (snap) s.wall = snap
    }
    for (const s of f.symbols) {
      if (s.room === a.id && s.cove?.off) s.cove = { ...s.cove, off: remapEdges(a.points, pts, s.cove.off, true) }
    }
    // The other room's own lights go with it (this one's run round the whole room now).
    f.symbols = f.symbols.filter((s) => s.room !== b.id)
    f.rooms = f.rooms.filter((x) => x.id !== b.id)
    pruneControls(f)
  })
  useEditor.setState({ selection: { kind: 'room', id: a.id } })
  return true
}

/**
 * Take away the wall between a room's wall `edge` and the room drawn next to it, leaving them open to each other. The
 * doors and windows in that stretch of wall go with it: how many did, or -1 if there's no room there.
 */
export function openWall(roomId: string, edge: number): number {
  const st = useEditor.getState()
  const floor = currentFloor(st)
  const room = floor.rooms.find((r) => r.id === roomId)
  const across = room && wallAcross(room, edge, floor.rooms)
  if (!room || !across) return -1
  const { pts, open } = openedPoints(room, edge, across)
  const a = room.points[edge]
  const dir = normalize(sub(room.points[(edge + 1) % room.points.length], a))
  const gone = new Set(
    floor.symbols
      .filter((s) => (s.wall?.roomId === room.id && s.wall.edge === edge) || (s.wall?.roomId === across.room.id && s.wall.edge === across.edge))
      .filter((s) => {
        const at = dot(sub(symbolPose(s, floor.rooms), a), dir)
        return at > across.s1 - 1 && at < across.s2 + 1
      })
      .map((s) => s.id),
  )
  st.commit((d) => {
    const f = draftFloor(d)
    f.symbols = f.symbols.filter((s) => !gone.has(s.id))
    const r = f.rooms.find((x) => x.id === room.id)!
    r.points = pts
    fixRoom(f, room, true)
    r.openEdges = [...new Set([...(r.openEdges ?? []), open])].sort((x, y) => x - y)
  })
  return gone.size
}

/**
 * Rooms open to each other given new outlines, each with the line between them as its last edge (inside a recipe on
 * floor `f`): per-wall settings carried over from how they were (`coves`: their lights' dark walls then), the ceiling
 * one across the line or each room's stopping at it (`apart`), and the doors and windows that were on them (`poses`:
 * where they were) back on whichever's wall they're on.
 */
export function reshapeOpen(
  f: Floor,
  shapes: [Room, Point[]][],
  poses: { id: string; pose: Point }[],
  coves: { id: string; off: number[] }[] = [],
  apart = false,
) {
  const rooms: Room[] = []
  for (const [old, pts] of shapes) {
    const r = f.rooms.find((x) => x.id === old.id)
    if (!r) continue
    r.points = pts
    r.shadowGaps = remapEdges(old.points, pts, old.shadowGaps, true)
    r.curtainPockets = remapEdges(old.points, pts, old.curtainPockets, true)
    r.wallFinishes = remapEdgeValues(old.points, pts, old.wallFinishes, true)
    if (r.ceiling && old.ceiling?.bands) r.ceiling.bands = remapEdgeValues(old.points, pts, old.ceiling.bands, true)
    r.openEdges = [...new Set([...(remapEdges(old.points, pts, old.openEdges, true) ?? []), pts.length - 1])].sort((x, y) => x - y)
    // The line keeps its ceiling: one across it, or each room's stopping at it (`apart`).
    const breaks = [...(remapEdges(old.points, pts, old.ceilingBreaks, true) ?? []).filter((i) => i !== pts.length - 1), ...(apart ? [pts.length - 1] : [])]
    r.ceilingBreaks = breaks.length ? breaks : undefined
    // Room lights' dark walls, from where they were.
    for (const cv of coves) {
      const s = f.symbols.find((x) => x.id === cv.id)
      if (s?.room === r.id && s.cove) s.cove = { ...s.cove, off: remapEdges(old.points, pts, cv.off, true) }
    }
    rooms.push(r)
  }
  const reach = Math.max(...rooms.map((r) => r.wallThickness)) + 5
  for (const { id, pose } of poses) {
    const s = f.symbols.find((x) => x.id === id)
    const snap = s && findWallSnap(pose, rooms, reach)
    if (s && snap) s.wall = snap
  }
}

/** Build a wall again along an open wall of a room: the room gives up the wall's thickness for it. */
export function closeWall(roomId: string, edge: number) {
  const st = useEditor.getState()
  const room = currentFloor(st).rooms.find((r) => r.id === roomId)
  if (!room?.openEdges?.includes(edge)) return
  const n = room.points.length
  const moved = moveWall(room.points, edge, -room.wallThickness)
  // Its ends: gone where they now sit on the next corner, or in line between their neighbours.
  const ends = new Set([edge, (edge + 1) % n])
  const pts = moved.filter((p, i) => {
    if (!ends.has(i)) return true
    const prev = moved[(i - 1 + n) % n]
    const next = moved[(i + 1) % n]
    if (dist(p, next) < 0.5 || dist(p, prev) < 0.5) return false
    const u = sub(p, prev)
    const v = sub(next, p)
    return Math.abs(u.x * v.y - u.y * v.x) > 1e-3 * Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y) || dot(u, v) < 0
  })
  if (pts.length < 3) return
  st.commit((d) => {
    const f = draftFloor(d)
    const r = f.rooms.find((x) => x.id === roomId)!
    r.points = moved
    const open = room.openEdges!.filter((i) => i !== edge)
    r.openEdges = open.length ? open : undefined
    if (pts.length !== n) {
      const before = { ...r, points: moved, openEdges: r.openEdges }
      r.points = pts
      fixRoom(f, before)
    }
  })
}

/** The open walls of `room` that lie along `other`'s (the line between them). */
function wallsFacing(room: Room, other: Room): number[] {
  return (room.openEdges ?? []).filter((i) => {
    const a = room.points[i]
    const b = room.points[(i + 1) % room.points.length]
    const sa = signedArea(room.points)
    const so = signedArea(other.points)
    return !!a && !!b && other.points.some((c, j) => !!sharedStretch(a, b, sa, c, other.points[(j + 1) % other.points.length], so, 5))
  })
}

/** Whether the gypsum ceiling runs on across the line between two rooms open to each other, as one ceiling. */
export function ceilingJoined(room: Room, other: Room): boolean {
  const mine = wallsFacing(room, other)
  return mine.length > 0 && mine.some((i) => !room.ceilingBreaks?.includes(i))
}

/** One ceiling across the line between two rooms open to each other, or each room's stopping at it. */
export function setCeilingJoined(roomId: string, otherId: string, joined: boolean) {
  useEditor.getState().commit((d) => {
    const f = draftFloor(d)
    const a = f.rooms.find((r) => r.id === roomId)
    const b = f.rooms.find((r) => r.id === otherId)
    if (!a || !b) return
    for (const [r, o] of [
      [a, b],
      [b, a],
    ]) {
      const line = wallsFacing(r, o)
      const rest = (r.ceilingBreaks ?? []).filter((i) => !line.includes(i))
      const breaks = joined ? rest : [...rest, ...line]
      r.ceilingBreaks = breaks.length ? breaks.sort((x, y) => x - y) : undefined
    }
  })
}

/** The rooms across a room's open walls, nearest first by how much they share. */
export function roomsAcross(room: Room, rooms: Room[]): Room[] {
  const out = new Map<string, Room>()
  for (const i of room.openEdges ?? []) {
    const a = room.points[i]
    const b = room.points[(i + 1) % room.points.length]
    if (!a || !b) continue
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const r = rooms.find((x) => x.id !== room.id && x.points.some((p, j) => dist(p, x.points[(j + 1) % x.points.length]) > 1 && pointOnSegment(m, p, x.points[(j + 1) % x.points.length])))
    if (r) out.set(r.id, r)
  }
  return [...out.values()]
}

const pointOnSegment = (m: Point, p: Point, q: Point) => {
  const L = dist(p, q)
  const t = dot(sub(m, p), sub(q, p)) / (L * L)
  const x = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
  return t >= 0 && t <= 1 && dist(x, m) < 1
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
