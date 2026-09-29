import { create } from 'zustand'

/** Where an imported drawing goes: a brand-new project or the floor being edited. */
export type ImportTarget = 'new' | 'current'

interface UiState {
  startOpen: boolean
  projectsOpen: boolean
  printOpen: boolean
  importTarget: ImportTarget | null
  openStart: (open: boolean) => void
  openProjects: (open: boolean) => void
  openPrint: (open: boolean) => void
  openImport: (target: ImportTarget | null) => void
}

/** Dialog visibility, shared so any part of the UI can open them. */
export const useUi = create<UiState>((set) => ({
  startOpen: false,
  projectsOpen: false,
  printOpen: false,
  importTarget: null,
  openStart: (startOpen) => set({ startOpen }),
  openProjects: (projectsOpen) => set({ projectsOpen }),
  openPrint: (printOpen) => set({ printOpen }),
  openImport: (importTarget) => set({ importTarget }),
}))
