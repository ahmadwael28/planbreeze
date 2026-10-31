import { lazy, Suspense, useEffect, useRef } from 'react'
import { Download, FolderOpen, LayoutGrid, Lightbulb, Map as MapIcon, Maximize, Undo2 } from 'lucide-react'
import { Loader } from '@/components/ui/loader'
import { toast } from 'sonner'
import { Canvas } from '@/components/Canvas'
import { EmptyState } from '@/components/EmptyState'
import { DesignDialog } from '@/components/DesignDialog'
import { TileLayoutDialog } from '@/components/TileLayout'
import { FloorBar } from '@/components/FloorBar'
import { GuidedTour } from '@/components/GuidedTour'
import { ImportWizard } from '@/components/ImportWizard'
import { PrintDialog } from '@/components/PrintDialog'
import { RenderDialog } from '@/components/RenderDialog'
import { ProjectsDialog } from '@/components/ProjectsDialog'
import { Sidebar } from '@/components/Sidebar'
import { StartDialog } from '@/components/StartDialog'
import { BottomBar, Toolbar, zoomBy } from '@/components/Toolbar'
import { SelectionBar } from '@/components/SelectionBar'
import { Button } from '@/components/ui/button'
import { useLayout } from '@/hooks/use-layout'
import { TopBar } from '@/components/TopBar'
import { sampleProject } from '@/model/sample'
import type { PlanLayer, Tool } from '@/model/types'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  copiedNote,
  copySelection,
  currentFloor,
  cutSelection,
  deleteSelection,
  draftFloor,
  duplicateSelection,
  groupSelection,
  hasClipboard,
  nudge,
  pasteClipboard,
  removeVertices,
  rotateSelection,
  selectAll,
  useEditor,
} from '@/store/editor'
import { lastProjectId, listProjects, loadProject, purgeOldTrash, saveProject } from '@/store/storage'
import type { Project } from '@/model/types'
import { newProject } from '@/model/project'
import { download, safeName } from '@/store/backup'
import { useDesign } from '@/store/design'
import { safeStart } from '@/store/recovery'
import { DialogGuard, ErrorBoundary, PartCrash } from '@/components/ErrorBoundary'
import { useUi } from '@/store/ui'
import { useCloud } from '@/cloud/store'
import { connectMemoryCloudForTesting, initCloud, resolveConflict } from '@/cloud/sync'
import { ConflictDialog } from '@/components/ConflictDialog'
import { SignInDialog } from '@/components/SignInDialog'
import { ShareDialog } from '@/components/ShareDialog'
import { VisibilityMenu } from '@/components/VisibilityMenu'
import { TracingControl } from '@/components/TracingControl'
import { t, useLang } from '@/i18n'

// Handy for debugging in the browser console during development.
if (import.meta.env.DEV) {
  Object.assign(window, { __editor: useEditor, __ui: useUi, __cloud: { useCloud, connectMemoryCloudForTesting } })
  void import('@/cloud/sync').then((sync) => Object.assign(window, { __sync: sync }))
}

// three.js is only downloaded when the 3D view is first opened.
const Viewer3D = lazy(() => import('@/components/Viewer3D'))

const TOOL_KEYS: Record<string, Tool> = { v: 'select', m: 'area', p: 'room', r: 'rect', b: 'balcony', t: 'terrace', h: 'pan', d: 'dimension', s: 'divide', l: 'partition' }

const HINTS: Partial<Record<Tool, string>> = {
  room: 'Click to place corners · type a length + Enter for exact walls · Enter / double-click / click the first corner to finish · Esc to cancel',
  rect: 'Drag to draw a rectangular room',
  area: 'Drag a box around things to select them · Shift adds to the selection',
  balcony: 'Drag to draw a balcony against the outside of a wall · no railing is added where it meets the house',
  terrace: 'Drag to draw a terrace or patio against the outside of the house',
  pan: 'Drag to move the view',
  dimension: 'Click the start point, then the end point, then where the dimension line should go · Esc when done',
  divide:
    'Click a wall (or corner) where the line between the two rooms starts, then across the room · straight or at 45° unless you hold Shift · no wall goes in between · Esc to cancel',
}

function useHint(tool: Tool): string | undefined {
  const wireName = useEditor((s) => {
    if (!s.wireSwitch) return null
    const sw = currentFloor(s).symbols.find((x) => x.id === s.wireSwitch)
    return sw ? sw.label || t('this switch') : null
  })
  if (tool === 'wire') {
    return wireName
      ? t('Wiring {name}: click lights to connect or disconnect them · click another switch to wire it · Esc when done', { name: wireName })
      : t('Click a switch, then click the lights it should control')
  }
  const hint = HINTS[tool]
  return hint && t(hint)
}

function LayerToggle() {
  const layer = useEditor((s) => s.layer)
  const setLayer = useEditor((s) => s.setLayer)
  // On a phone held upright, the icons alone.
  const narrow = useLayout().bottomBar
  return (
    <div className="absolute start-3 top-3 z-10 flex items-center gap-2">
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={layer}
        onValueChange={(v) => v && setLayer(v as PlanLayer)}
        className="bg-background/95 shadow-sm backdrop-blur"
        data-tour="layers"
      >
        <ToggleGroupItem value="plan" aria-label={t('Plan')} className="px-2.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
          <LayoutGrid /> {!narrow && t('Plan')}
        </ToggleGroupItem>
        <ToggleGroupItem value="lighting" aria-label={t('Lighting')} className="px-2.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
          <Lightbulb /> {!narrow && t('Lighting')}
        </ToggleGroupItem>
      </ToggleGroup>
      <VisibilityMenu />
      <TracingControl />
    </div>
  )
}

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
          const note = copiedNote(n, k === 'x')
          toast(note.title, { description: note.description })
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
        // Corners picked: those go, not the room.
        const sel = st.selection
        const corners = sel?.kind === 'room' ? (sel.vertices ?? (sel.vertex !== undefined ? [sel.vertex] : [])) : []
        if (sel?.kind === 'room' && corners.length) {
          if (!removeVertices(sel.id, corners)) toast(t('A room needs at least three corners.'))
        } else deleteSelection()
      } else if (k === 'escape') {
        // Corners or a wall picked: let go of those first.
        const sel = st.selection
        if (sel?.kind === 'room' && (sel.vertex !== undefined || sel.edge !== undefined)) st.select({ kind: 'room', id: sel.id })
        else st.select(null)
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
    let pending: Project | null = null
    let warned = false
    const save = (p: Project) => {
      if (saveProject(p)) {
        warned = false
      } else if (!warned) {
        warned = true
        toast.error(t('Browser storage is full, so changes are not being saved. Remove a background drawing or save the project to a file.'), {
          duration: 10000,
        })
      }
    }
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.project === prev.project) return
      clearTimeout(timer)
      // Switching projects: store the one being left right away so no edit is lost.
      if (s.project.id !== prev.project.id) save(prev.project)
      const p = (pending = s.project)
      timer = setTimeout(() => {
        pending = null
        save(p)
      }, 400)
    })
    // Leaving the page, or it's hidden (switching apps on a phone, which may close it unseen): saved right away.
    const flush = () => {
      if (!pending) return
      clearTimeout(timer)
      const p = pending
      pending = null
      save(p)
    }
    const onHide = () => document.visibilityState === 'hidden' && flush()
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      unsub()
      clearTimeout(timer)
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])
}

function loadInitialProject() {
  purgeOldTrash()
  if (safeStart()) {
    // The new plan's the last one now, so a normal start next time doesn't open the one that failed either.
    const p = newProject()
    saveProject(p)
    useEditor.getState().loadProject(p)
    useUi.getState().openProjects(true)
    toast(t('Started with a new plan, without opening the last one. Your plans are all here.'), { id: 'safe-start', duration: 8000 })
    return
  }
  const id = lastProjectId() ?? listProjects()[0]?.id
  const saved = id ? loadProject(id) : null
  const p = saved || sampleProject()
  saveProject(p)
  useEditor.getState().loadProject(p)
  // First visit: offer the quick ways to get started (the sample stays open behind it).
  if (!saved) useUi.getState().openStart(true)
}

/**
 * The panel follows the layout as the screen changes (a tablet turned, a window resized): shown when it moves beside
 * the plan, put away when it'd cover it. And picking several by touch ends when nothing's picked any more.
 */
function useAdaptivePanel() {
  const panel = useLayout().panel
  const last = useRef(panel)
  useEffect(() => {
    if (panel === last.current) return
    const docked = panel === 'docked'
    if (docked || last.current === 'docked') useUi.getState().setSidebarOpen(docked)
    last.current = panel
  }, [panel])
  useEffect(
    () =>
      useEditor.subscribe((s, prev) => {
        if (!s.selection && prev.selection && useUi.getState().multiPick) useUi.getState().setMultiPick(false)
      }),
    [],
  )
}

/**
 * A button (or switch, or a choice) clicked with the mouse or a tap doesn't keep the keyboard: the plan or the 3D view
 * has it again, for its keys (Space would otherwise press the button again, the arrows move along a choice, and walking
 * in 3D would wait for a click on it). Chosen by keyboard, it keeps it; in dialogs and menus too.
 */
function useFocusBackToView() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.detail === 0) return
      const el = document.activeElement
      if (!(el instanceof HTMLElement) || !(e.target instanceof Node) || !el.contains(e.target)) return
      if (!el.matches('button, [role="radio"], [role="switch"], [role="tab"], [role="checkbox"]')) return
      if (el.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-keep-focus]')) return
      el.blur()
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])
}

/** The plan couldn't be drawn: try again, open another plan, or keep a copy of this one. */
function PlanCrash({ error, retry }: { error: Error; retry: () => void }) {
  const canUndo = useEditor((s) => s.past.length > 0)
  return (
    <div className="grid h-full place-items-center">
      <PartCrash className="max-w-md" title={t("The plan couldn't be shown")} error={error} retry={retry}>
        {canUndo && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              useEditor.getState().undo()
              retry()
            }}
          >
            <Undo2 /> {t('Undo the last change')}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => useUi.getState().openProjects(true)}>
          <FolderOpen /> {t('Open another plan')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const p = useEditor.getState().project
            download(p, `${safeName(p.name)}.floorplan.json`)
          }}
        >
          <Download /> {t('Download this plan')}
        </Button>
      </PartCrash>
    </div>
  )
}

/** If the dialog for a plan changed on two devices fails: the two choices, plainly, so the plan can sync again. */
function ConflictChoice() {
  const conflict = useCloud((s) => s.conflict)
  if (!conflict) return null
  return (
    <div role="alertdialog" className="fixed inset-x-0 bottom-4 z-50 mx-auto w-[min(28rem,calc(100%-2rem))] space-y-3 rounded-xl border bg-card p-4 text-sm shadow-lg">
      <p className="font-medium">{t('This plan was changed on another device')}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void resolveConflict('theirs')}>
          {t('Use the version from my account')}
        </Button>
        <Button size="sm" onClick={() => void resolveConflict('mine')}>
          {t("Keep this device's version")}
        </Button>
      </div>
    </div>
  )
}

export default function App() {
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const setSidebarOpen = useUi((s) => s.setSidebarOpen)
  const tool = useEditor((s) => s.tool)
  const viewMode = useEditor((s) => s.viewMode)
  const seen3d = useEditor((s) => s.seen3d)
  const requestFit = useEditor((s) => s.requestFit)
  const hint = useHint(tool)
  const layout = useLayout()
  const projectId = useEditor((s) => s.project.id)
  // A new language: everything on screen again in it (the app itself carries on).
  const lang = useLang()

  useEffect(loadInitialProject, [])
  useEffect(() => void initCloud(), [])
  useKeyboardShortcuts()
  useFocusBackToView()
  useAutosave()
  useAdaptivePanel()

  return (
    <div key={lang} className="safe-area flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <TopBar onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} sidebarOpen={sidebarOpen} />
      <div className="relative flex min-h-0 flex-1">
        {viewMode === '2d' && !layout.bottomBar && <Toolbar />}
        <main className="relative min-w-0 flex-1" data-tour="canvas">
          {viewMode === '2d' && (
            <>
              <ErrorBoundary resetKey={projectId} fallback={(error, retry) => <PlanCrash error={error} retry={retry} />}>
                <Canvas />
                <LayerToggle />
                <EmptyState />
              </ErrorBoundary>
              {/* With the tools along the bottom, zooming to fit is up here (pinching does the rest). */}
              {layout.bottomBar && (
                <Button variant="outline" size="icon" className="absolute end-3 top-3 z-10 bg-background/95 shadow-sm backdrop-blur" onClick={requestFit} aria-label={t('Zoom to fit')}>
                  <Maximize />
                </Button>
              )}
              {/* By touch, the drawing tools have their own bar with buttons (see Canvas). */}
              {hint && !layout.touch && (
                <div className="pointer-events-none absolute top-14 left-1/2 max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-full bg-foreground/85 px-3 py-1.5 text-center text-xs text-background shadow max-md:top-auto max-md:bottom-16 max-md:rounded-lg">
                  {hint}
                </div>
              )}
            </>
          )}
          {/* Once opened, the 3D view stays alive while hidden, so switching back to it is instant. */}
          {(viewMode === '3d' || seen3d) && (
            <div className={viewMode === '3d' ? 'h-full' : 'hidden'}>
              <ErrorBoundary
                resetKey={viewMode}
                fallback={(error, retry) => (
                  <div className="grid h-full place-items-center">
                    <PartCrash className="max-w-md" title={t('The 3D view ran into a problem')} error={error} retry={retry}>
                      <Button size="sm" variant="outline" onClick={() => useEditor.getState().setViewMode('2d')}>
                        <MapIcon /> {t('Back to the plan')}
                      </Button>
                    </PartCrash>
                  </div>
                )}
              >
              <Suspense
                fallback={
                  <div className="grid h-full place-content-center justify-items-center gap-3 text-sm text-muted-foreground">
                    <Loader brand className="size-14 text-foreground" label={t('Opening the 3D view')} />
                    {t('Opening the 3D view…')}
                  </div>
                }
              >
                <Viewer3D />
              </Suspense>
              </ErrorBoundary>
            </div>
          )}
          <FloorBar />
          <SelectionBar />
        </main>
        <Sidebar open={sidebarOpen} />
      </div>
      {viewMode === '2d' && layout.bottomBar && <BottomBar />}
      <DialogGuard close={() => useUi.getState().openProjects(false)}>
        <ProjectsDialog />
      </DialogGuard>
      <DialogGuard close={() => useUi.getState().openStart(false)}>
        <StartDialog />
      </DialogGuard>
      <DialogGuard close={() => useUi.getState().openImport(null)}>
        <ImportWizard />
      </DialogGuard>
      <DialogGuard close={() => useUi.getState().openPrint(false)}>
        <PrintDialog />
      </DialogGuard>
      <DialogGuard close={() => useUi.getState().openRender(false)}>
        <RenderDialog />
      </DialogGuard>
      <DialogGuard close={() => useCloud.getState().openSignIn(false)}>
        <SignInDialog />
      </DialogGuard>
      <DialogGuard close={() => useUi.getState().openShare(false)}>
        <ShareDialog />
      </DialogGuard>
      <DialogGuard close={() => {}} fallback={<ConflictChoice />}>
        <ConflictDialog />
      </DialogGuard>
      <DialogGuard close={() => useDesign.getState().close()}>
        <DesignDialog />
      </DialogGuard>
      <DialogGuard close={() => useUi.getState().openTileLayout(null)}>
        <TileLayoutDialog />
      </DialogGuard>
      <DialogGuard close={() => useUi.getState().setTourStep(null)}>
        <GuidedTour />
      </DialogGuard>
    </div>
  )
}
