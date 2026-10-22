import { create } from 'zustand'
import { getLayout } from '@/hooks/use-layout'

/** Where an imported drawing goes: a brand-new project or the floor being edited. */
export type ImportTarget = 'new' | 'current'

export type SidebarTab = 'properties' | 'library' | 'summary'

interface UiState {
  startOpen: boolean
  projectsOpen: boolean
  printOpen: boolean
  shareOpen: boolean
  /** The realistic render's dialog (see RenderDialog). */
  renderOpen: boolean
  importTarget: ImportTarget | null
  /** A viewpoint the 3D viewer should go to as soon as it's ready (`saved:<view id>` or `room:<room id>`). */
  pendingView: string | null
  /** Library categories the user has folded away (all open by default). */
  libraryCollapsed: string[]
  /** The side panel: shown or not, and its tab. */
  sidebarOpen: boolean
  sidebarTab: SidebarTab
  /** The guided tour's step, while it's running (see GuidedTour). */
  tourStep: number | null
  /** A room's wall pointed at in the panel's list, lit up on the plan. */
  hoverWall: { roomId: string; edge: number } | null
  /** Touch: taps add things (or corners) to what's picked, or take them out, as Shift + click does with a mouse. */
  multiPick: boolean
  /** The panel as a sheet from the bottom (phones): half the screen, or all of it. */
  sheetFull: boolean
  /** Laying out several tiles (see TileLayout): a room's floor, or one of its walls (`edge`). */
  tileLayout: { roomId: string; edge?: number } | null
  openStart: (open: boolean) => void
  openProjects: (open: boolean) => void
  openPrint: (open: boolean) => void
  openShare: (open: boolean) => void
  openRender: (open: boolean) => void
  openImport: (target: ImportTarget | null) => void
  setPendingView: (id: string | null) => void
  setLibraryCollapsed: (cats: string[]) => void
  setSidebarOpen: (open: boolean) => void
  setSidebarTab: (tab: SidebarTab) => void
  setTourStep: (step: number | null) => void
  setHoverWall: (w: { roomId: string; edge: number } | null) => void
  setMultiPick: (on: boolean) => void
  setSheetFull: (full: boolean) => void
  openTileLayout: (target: { roomId: string; edge?: number } | null) => void
}

/** Dialog visibility, shared so any part of the UI can open them. */
export const useUi = create<UiState>((set) => ({
  startOpen: false,
  projectsOpen: false,
  printOpen: false,
  shareOpen: false,
  renderOpen: false,
  importTarget: null,
  pendingView: null,
  libraryCollapsed: [],
  // Open from the start only where it sits beside the plan; elsewhere it'd cover it.
  sidebarOpen: getLayout().panel === 'docked',
  sidebarTab: 'properties',
  tourStep: null,
  hoverWall: null,
  multiPick: false,
  sheetFull: false,
  tileLayout: null,
  openStart: (startOpen) => set({ startOpen }),
  openProjects: (projectsOpen) => set({ projectsOpen }),
  openPrint: (printOpen) => set({ printOpen }),
  openShare: (shareOpen) => set({ shareOpen }),
  openRender: (renderOpen) => set({ renderOpen }),
  openImport: (importTarget) => set({ importTarget }),
  setPendingView: (pendingView) => set({ pendingView }),
  setLibraryCollapsed: (libraryCollapsed) => set({ libraryCollapsed }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setTourStep: (tourStep) => set({ tourStep }),
  setHoverWall: (hoverWall) => set({ hoverWall }),
  setMultiPick: (multiPick) => set({ multiPick }),
  setSheetFull: (sheetFull) => set({ sheetFull }),
  openTileLayout: (tileLayout) => set({ tileLayout }),
}))

/** Open the panel on a tab, or close it if it's already showing that tab. */
export function togglePanel(tab: SidebarTab) {
  const ui = useUi.getState()
  if (ui.sidebarOpen && ui.sidebarTab === tab) ui.setSidebarOpen(false)
  else {
    ui.setSidebarTab(tab)
    ui.setSidebarOpen(true)
  }
}
