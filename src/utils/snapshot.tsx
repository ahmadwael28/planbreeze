import { toast } from 'sonner'
import { t } from '@/i18n'
import { currentFloor, useEditor } from '@/store/editor'

/**
 * Snapshots: a picture of the plan or the 3D view as it's seen now, without the editor round it (its bars, panels,
 * handles and selection), copied to the clipboard as it's taken, to paste anywhere, and to save.
 */

/** The 3D view's way to take a picture of itself, while it's showing (see Viewer3D). */
let capture3d: (() => Promise<Blob>) | null = null

export function setCapture3d(fn: (() => Promise<Blob>) | null) {
  capture3d = fn
}

const safe = (s: string) => s.replace(/[^\p{L}\p{N}\- ]+/gu, '').trim().replace(/\s+/g, '-') || 'plan'

/** Its file name: the plan's and floor's names, the view, and when it was taken. */
function fileName(three: boolean) {
  const st = useEditor.getState()
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const at = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
  return `${safe(st.project.name)}-${safe(currentFloor(st).name)}-${three ? '3D' : '2D'} ${at}.png`
}

/** Put the picture on the clipboard (as it's made: the clipboard has to be asked while the tap that asked for it lasts). */
function copy(blob: Promise<Blob>): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return Promise.resolve(false)
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(
      () => true,
      () => false,
    )
  } catch {
    return Promise.resolve(false)
  }
}

/** Take a snapshot of what's showing (the 3D view or the plan), copy it, and offer to save it. */
export function takeSnapshot() {
  const three = useEditor.getState().viewMode === '3d' && !!capture3d
  const name = fileName(three)
  const blob = three ? capture3d!() : import('./plan-snapshot').then((m) => m.planSnapshot())
  const copied = copy(blob)
  const id = `snapshot-${name}`
  blob.then(
    (b) => {
      const url = URL.createObjectURL(b)
      const show = (ok: boolean) =>
        toast(ok ? t('Snapshot copied') : t('Snapshot taken'), {
          id,
          description: (
            <div className="mt-1.5 space-y-1.5">
              <img src={url} alt="" className="max-h-32 w-full rounded-md border object-contain" />
              {ok && <p>{t('Paste it anywhere, or save it as a picture.')}</p>}
            </div>
          ),
          action: { label: t('Save'), onClick: () => void import('./export').then((m) => m.saveBlob(b, name)) },
          duration: 10000,
          onAutoClose: () => URL.revokeObjectURL(url),
          onDismiss: () => URL.revokeObjectURL(url),
        })
      // Shown as soon as it's taken, and said to be copied once the clipboard has it (some browsers never say).
      show(false)
      void copied.then((ok) => ok && show(true))
    },
    (e: Error) => toast.error(t('Could not take a snapshot'), { description: e.message }),
  )
}
