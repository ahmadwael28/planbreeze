import { create } from 'zustand'
import type { CloudRow } from './backend'

export const cloudConfig = (() => {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined
  return url && key ? { url, key } : null
})()

/**
 * local    – not signed in; changes are saved on this device
 * saving   – a cloud save is pending or in progress
 * saved    – everything is in the cloud
 * offline  – no connection; saved on this device, will sync when back online
 * error    – the cloud rejected a save
 * conflict – the plan was changed on another device; the user must choose
 */
export type SaveState = 'local' | 'saving' | 'saved' | 'offline' | 'error' | 'conflict'

export interface CloudUser {
  id: string
  email?: string
  name?: string
  avatar?: string
  provider?: string
}

interface CloudState {
  /** Whether a Supabase project is configured for this build. */
  configured: boolean
  /** Auth has finished restoring any previous session. */
  ready: boolean
  user: CloudUser | null
  saveState: SaveState
  lastSaved: number | null
  error: string | null
  conflict: { projectId: string; remote: CloudRow } | null
  signInOpen: boolean
  openSignIn: (open: boolean) => void
}

export const useCloud = create<CloudState>((set) => ({
  configured: !!cloudConfig,
  ready: !cloudConfig,
  user: null,
  saveState: 'local',
  lastSaved: null,
  error: null,
  conflict: null,
  signInOpen: false,
  openSignIn: (signInOpen) => set({ signInOpen }),
}))
