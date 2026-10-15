import { useSyncExternalStore } from 'react'

/**
 * How the editor is laid out for the screen it's on, and whether it's used by touch.
 *
 * - `panel`: the side panel docked beside the plan on wide screens; a drawer over the plan on smaller landscape
 *   screens; a sheet up from the bottom on portrait ones (phones, tablets held upright), where the plan keeps the
 *   full width.
 * - `compact`: phone-sized (narrow, or a phone on its side): the tools are grouped, the top bar keeps only the
 *   essentials and the rest goes in its menu.
 * - `bottomBar`: the tools along the bottom, within reach of a thumb (phones held upright); otherwise down the side.
 * - `topBar`: everything in the top bar (wide), the occasional things in its menu (medium), or only the essentials.
 * - `touch`: a finger is the main pointer: bigger handles, tap to pick and then drag, and buttons for what a
 *   keyboard does on a computer (finishing a room, deleting, …).
 */
export interface Layout {
  panel: 'docked' | 'drawer' | 'sheet'
  compact: boolean
  bottomBar: boolean
  topBar: 'full' | 'medium' | 'compact'
  touch: boolean
}

function measure(): Layout {
  if (typeof window === 'undefined') return { panel: 'docked', compact: false, bottomBar: false, topBar: 'full', touch: false }
  const w = window.innerWidth
  const h = window.innerHeight
  const compact = w < 640 || h < 500
  return {
    panel: w >= 1024 && h >= 500 ? 'docked' : h >= w * 0.9 ? 'sheet' : 'drawer',
    compact,
    bottomBar: compact && h > w,
    topBar: w >= 1024 ? 'full' : w >= 640 ? 'medium' : 'compact',
    touch: window.matchMedia('(pointer: coarse)').matches,
  }
}

let current = measure()
let key = JSON.stringify(current)
const listeners = new Set<() => void>()

/** Marks the page as on a phone (`html[data-phone]`), for the styles that make it look and feel like an app there. */
function mark(l: Layout) {
  if (typeof document !== 'undefined') document.documentElement.dataset.phone = String(l.compact && l.touch)
}

function update() {
  const next = measure()
  const k = JSON.stringify(next)
  if (k === key) return
  key = k
  current = next
  mark(next)
  for (const l of listeners) l()
}

if (typeof window !== 'undefined') {
  mark(current)
  window.addEventListener('resize', update)
  window.matchMedia('(pointer: coarse)').addEventListener('change', update)
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The layout for this screen, as it is now (outside React). */
export function getLayout(): Layout {
  return current
}

/** The layout for this screen, re-rendering when it changes (turning a phone, resizing a window). */
export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, getLayout, getLayout)
}
