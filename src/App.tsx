import { lazy, Suspense, useEffect } from 'react'
import { LayoutGrid, Lightbulb } from 'lucide-react'
import { Loader } from '@/components/ui/loader'
import { toast } from 'sonner'
import { Canvas } from '@/components/Canvas'
import { EmptyState } from '@/components/EmptyState'
import { FloorBar } from '@/components/FloorBar'
import { GuidedTour } from '@/components/GuidedTour'
import { ImportWizard } from '@/components/ImportWizard'
import { PrintDialog } from '@/components/PrintDialog'
import { ProjectsDialog } from '@/components/ProjectsDialog'
import { Sidebar } from '@/components/Sidebar'
import { StartDialog } from '@/components/StartDialog'
import { Toolbar, zoomBy } from '@/components/Toolbar'
import { TopBar } from '@/components/TopBar'
import { sampleProject } from '@/model/sample'
import type { PlanLayer, Tool } from '@/model/types'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  copySelection,
  currentFloor,
  cutSelection,
  deleteSelection,
  draftFloor,
  duplicateSelection,
  groupSelection,
  hasClipboard,
  pasteClipboard,
  rotateSelection,
  selectAll,
  useEditor,
} from '@/store/editor'
import { copyItems, moveItems, refsOf } from '@/model/items'
import { lastProjectId, listProjects, loadProject, saveProject } from '@/store/storage'
import { useUi } from '@/store/ui'
import { useCloud } from '@/cloud/store'
import { connectMemoryCloudForTesting, initCloud } from '@/cloud/sync'
import { ConflictDialog } from '@/components/ConflictDialog'
import { SignInDialog } from '@/components/SignInDialog'
import { ShareDialog } from '@/components/ShareDialog'
import { VisibilityMenu } from '@/components/VisibilityMenu'

// Handy for debugging in the browser console during development.
if (import.meta.env.DEV) {
  Object.assign(window, { __editor: useEditor, __ui: useUi, __cloud: { useCloud, connectMemoryCloudForTesting } })
  void import('@/cloud/sync').then((sync) => Object.assign(window, { __sync: sync }))
}

// three.js is only downloaded when the 3D view is first opened.
const Viewer3D = lazy(() => import('@/components/Viewer3D'))

const TOOL_KEYS: Record<string, Tool> = { v: 'select', m: 'area', p: 'room', r: 'rect', b: 'balcony', t: 'terrace', h: 'pan', d: 'dimension' }

const HINTS: Partial<Record<Tool, string>> = {
  room: 'Click to place corners · type a length + Enter for exact walls · Enter / double-click / click the first corner to finish · Esc to cancel',
  rect: 'Drag to draw a rectangular room',
  area: 'Drag a box around things to select them · Shift adds to the selection',
  balcony: 'Drag to draw a balcony against the outside of a wall · no railing is added where it meets the house',
  terrace: 'Drag to draw a terrace or patio against the outside of the house',
  pan: 'Drag to move the view',
  dimension: 'Click the start point, then the end point, then where the dimension line should go · Esc when done',
}

function useHint(tool: Tool): string | undefined {
  const wireName = useEditor((s) => {
    if (!s.wireSwitch) return null
    const sw = currentFloor(s).symbols.find((x) => x.id === s.wireSwitch)
    return sw ? sw.label || 'this switch' : null
  })
  if (tool === 'wire') {
    return wireName
      ? `Wiring ${wireName}: click lights to connect or disconnect them · click another switch to wire it · Esc when done`
      : 'Click a switch, then click the lights it should control'
  }
  return HINTS[tool]
}

function LayerToggle() {
  const layer = useEditor((s) => s.layer)
  const setLayer = useEditor((s) => s.setLayer)
  return (
    <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={layer}
        onValueChange={(v) => v && setLayer(v as PlanLayer)}
        className="bg-background/95 shadow-sm backdrop-blur"
        data-tour="layers"
      >
        <ToggleGroupItem value="plan" className="px-2.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
          <LayoutGrid /> Plan
        </ToggleGroupItem>
        <ToggleGroupItem value="lighting" className="px-2.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
          <Lightbulb /> Lighting
        </ToggleGroupItem>
      </ToggleGroup>
      <VisibilityMenu />
    </div>
  )
}

function nudge(dx: number, dy: number) {
  const { selection, commit } = useEditor.getState()
  if (!selection) return
  commit((d) => {
    const f = draftFloor(d)
    // A door or window slides along its wall.
    if (selection.kind === 'symbol') {
      const s = f.symbols.find((x) => x.id === selection.id)
      if (s?.wall) {
        s.wall.offset += dx || dy
        return
      }
    }
    moveItems(f, copyItems(f, refsOf(selection)), dx, dy)
  })
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('input, textarea, select, [role="dialog"], [role="menu"], [role="listbox"]')) return
      const st = useEditor.getState()
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      const is2d = st.viewMode === '2d'

      if (mod && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) st.redo()
        else st.undo()
        return
      }
      if (mod && k === 'y') {
        e.preventDefault()
        st.redo()
        return
      }
      // The polygon tool handles its own keys (typing lengths, Enter, Esc, Backspace).
      if (st.tool === 'room' && !mod && k !== 'v' && k !== 'r' && k !== 'h') return

      // Clipboard and groups (Ctrl/⌘ + C, X, V, A, G).
      if (mod && (k === 'c' || k === 'x')) {
        const n = k === 'c' ? copySelection() : cutSelection()
        if (n) {
          e.preventDefault()
          toast(`${k === 'c' ? 'Copied' : 'Cut'} ${plural(n, 'item')}`, { description: 'Paste with Ctrl+V, on this floor or another.' })
        }
        return
      }
      if (mod && k === 'v') {
        if (!hasClipboard()) return
        e.preventDefault()
        pasteClipboard()
        return
      }
      if (mod && k === 'a' && is2d) {
        e.preventDefault()
        selectAll()
        return
      }
      if (mod && k === 'g') {
        e.preventDefault()
        groupSelection(!e.shiftKey)
        return
      }

      if (mod && k === 'd') {
        e.preventDefault()
        duplicateSelection()
      } else if (!mod && (k === 'delete' || k === 'backspace')) {
        e.preventDefault()
        deleteSelection()
      } else if (k === 'escape') {
        st.select(null)
        st.setTool('select')
      } else if (is2d && !mod && k === 'w') {
        st.setLayer('lighting')
        st.setTool('wire')
      } else if (is2d && !mod && TOOL_KEYS[k]) {
        st.setTool(TOOL_KEYS[k])
      } else if (is2d && !mod && k === 'f') {
        st.requestFit()
      } else if (is2d && !mod && (k === '+' || k === '=')) {
        zoomBy(1.25)
      } else if (is2d && !mod && k === '-') {
        zoomBy(0.8)
      } else if (is2d && !mod && k === 'e' && st.selection?.kind === 'multi') {
        rotateSelection(90)
      } else if (is2d && !mod && k === 'e' && st.selection?.kind === 'symbol') {
        const id = st.selection.id
        st.commit((d) => {
          const s = draftFloor(d).symbols.find((x) => x.id === id)
          if (s && !s.wall) s.rotation = (s.rotation + 90) % 360
        })
      } else if (is2d && k.startsWith('arrow') && st.selection) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const map: Record<string, [number, number]> = {
          arrowleft: [-step, 0],
          arrowright: [step, 0],
          arrowup: [0, -step],
          arrowdown: [0, step],
        }
        nudge(...map[k])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function useAutosave() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let warned = false
    const save = (p = useEditor.getState().project) => {
      if (saveProject(p)) {
        warned = false
      } else if (!warned) {
        warned = true
        toast.error('Browser storage is full, so changes are not being saved. Remove a background drawing or save the project to a file.', {
          duration: 10000,
        })
      }
    }
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.project === prev.project) return
      clearTimeout(timer)
      // Switching projects: store the one being left right away so no edit is lost.
      if (s.project.id !== prev.project.id) save(prev.project)
      const p = s.project
      timer = setTimeout(() => save(p), 400)
    })
    const flush = () => saveProject(useEditor.getState().project)
    window.addEventListener('beforeunload', flush)
    return () => {
      unsub()
      clearTimeout(timer)
      window.removeEventListener('beforeunload', flush)
    }
  }, [])
}

function loadInitialProject() {
  const id = lastProjectId() ?? listProjects()[0]?.id
  const saved = id ? loadProject(id) : null
  const p = saved || sampleProject()
  saveProject(p)
  useEditor.getState().loadProject(p)
  // First visit: offer the quick ways to get started (the sample stays open behind it).
  if (!saved) useUi.getState().openStart(true)
}

export default function App() {
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const setSidebarOpen = useUi((s) => s.setSidebarOpen)
  const tool = useEditor((s) => s.tool)
  const viewMode = useEditor((s) => s.viewMode)
  const seen3d = useEditor((s) => s.seen3d)
  const hint = useHint(tool)

  useEffect(loadInitialProject, [])
  useEffect(() => void initCloud(), [])
  useKeyboardShortcuts()
  useAutosave()

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <TopBar onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} sidebarOpen={sidebarOpen} />
      <div className="relative flex min-h-0 flex-1">
        {viewMode === '2d' && <Toolbar />}
        <main className="relative min-w-0 flex-1" data-tour="canvas">
          {viewMode === '2d' && (
            <>
              <Canvas />
              <LayerToggle />
              <EmptyState />
              {hint && (
                <div className="pointer-events-none absolute top-14 left-1/2 max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-full bg-foreground/85 px-3 py-1.5 text-center text-xs text-background shadow max-md:top-auto max-md:bottom-16 max-md:rounded-lg">
                  {hint}
                </div>
              )}
            </>
          )}
          {/* Once opened, the 3D view stays alive while hidden, so switching back to it is instant. */}
          {(viewMode === '3d' || seen3d) && (
            <div className={viewMode === '3d' ? 'h-full' : 'hidden'}>
              <Suspense
                fallback={
                  <div className="grid h-full place-content-center justify-items-center gap-3 text-sm text-muted-foreground">
                    <Loader brand className="size-14 text-foreground" label="Opening the 3D view" />
                    Opening the 3D view…
                  </div>
                }
              >
                <Viewer3D />
              </Suspense>
            </div>
          )}
          <FloorBar />
        </main>
        <Sidebar open={sidebarOpen} />
      </div>
      <ProjectsDialog />
      <StartDialog />
      <ImportWizard />
      <PrintDialog />
      <SignInDialog />
      <ShareDialog />
      <ConflictDialog />
      <GuidedTour />
    </div>
  )
}
