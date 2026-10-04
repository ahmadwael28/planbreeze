import { create } from 'zustand'

/** Where an imported drawing goes: a brand-new project or the floor being edited. */
export type ImportTarget = 'new' | 'current'

interface UiState {
  startOpen: boolean
  projectsOpen: boolean
  printOpen: boolean
  shareOpen: boolean
  importTarget: ImportTarget | null
  /** A saved view the 3D viewer should go to as soon as it's ready. */
  pendingView: string | null
  /** Library categories the user has folded away (all open by default). */
  libraryCollapsed: string[]
  openStart: (open: boolean) => void
  openProjects: (open: boolean) => void
  openPrint: (open: boolean) => void
  openShare: (open: boolean) => void
  openImport: (target: ImportTarget | null) => void
  setPendingView: (id: string | null) => void
  setLibraryCollapsed: (cats: string[]) => void
}

/** Dialog visibility, shared so any part of the UI can open them. */
export const useUi = create<UiState>((set) => ({
  startOpen: false,
  projectsOpen: false,
  printOpen: false,
  shareOpen: false,
  importTarget: null,
  pendingView: null,
  libraryCollapsed: [],
  openStart: (startOpen) => set({ startOpen }),
  openProjects: (projectsOpen) => set({ projectsOpen }),
  openPrint: (printOpen) => set({ printOpen }),
  openShare: (shareOpen) => set({ shareOpen }),
  openImport: (importTarget) => set({ importTarget }),
  setPendingView: (pendingView) => set({ pendingView }),
  setLibraryCollapsed: (libraryCollapsed) => set({ libraryCollapsed }),
}))
