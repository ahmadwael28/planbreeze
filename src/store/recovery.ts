/**
 * Ways on when something goes wrong: a start that skips the last plan (in case it's what keeps failing), and a reload
 * when a new version of the app has replaced the files this page still asks for.
 */
import { useEditor } from './editor'
import { saveOnLeave } from './storage'

const SAFE = 'safe'
const RELOADED = 'fp.reloadedForUpdate'

let safe: boolean | undefined

/**
 * `?safe` in the address: start without opening the last plan. Taken out of the address again, and the answer kept
 * for this page (the start can run twice).
 */
export function safeStart(): boolean {
  if (safe === undefined) {
    const u = new URL(window.location.href)
    safe = u.searchParams.has(SAFE)
    if (safe) {
      u.searchParams.delete(SAFE)
      window.history.replaceState(null, '', u)
    }
  }
  return safe
}

/** Start again without the last plan (nor a plan link that was being opened). */
export function startSafely() {
  window.location.assign(`${window.location.origin}${window.location.pathname}?${SAFE}`)
}

/**
 * The plan as it is, saved in this browser (before a reload, or when part of the app has failed): done when it's saved,
 * or after a second or two at most (it's noted at once all the same, see saveOnLeave).
 */
export async function saveNow(): Promise<void> {
  try {
    await Promise.race([saveOnLeave(useEditor.getState().project), new Promise((r) => setTimeout(r, 2000))])
  } catch {
    // Nothing more to do: the last autosave stands.
  }
}

/** Whether a failure is the app's own files gone missing (a newer version was published since the page opened). */
export const isUpdateError = (e: Error) =>
  e.name === 'ChunkLoadError' || /dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(e.message)

/** Offline: the part asked for was never downloaded (it's fetched the first time it's opened), not a new version. */
export const isOffline = () => !navigator.onLine

/**
 * After a new version's published, this page asks for files of the old one that are gone (opening the 3D view, a PDF,
 * a render): the plan's saved and the page loads the new version, the part that failed saying so meanwhile. Not when
 * offline (the page couldn't load), and once a minute at most, so it never goes round in circles: if that didn't
 * help, the error shows, with its ways on.
 */
export function reloadOnUpdate() {
  window.addEventListener('vite:preloadError', () => {
    if (isOffline()) return
    try {
      if (Date.now() - Number(sessionStorage.getItem(RELOADED) || 0) < 60_000) return
      sessionStorage.setItem(RELOADED, String(Date.now()))
    } catch {
      return
    }
    void saveNow().then(() => window.location.reload())
  })
}
