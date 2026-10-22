import { toast } from 'sonner'
import { isRtl, t } from '@/i18n'
import { getLayout } from '@/hooks/use-layout'
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

/** Where what's shown is (the plan or the 3D view, between the bars), and whether to keep still (reduced motion). */
const viewArea = () => document.querySelector('main')
const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The shutter: the view flashes white as it's taken. */
function flash() {
  const area = viewArea()
  if (!area || still()) return
  const r = area.getBoundingClientRect()
  const el = document.createElement('div')
  Object.assign(el.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, background: '#fff', pointerEvents: 'none', zIndex: '60' })
  document.body.appendChild(el)
  el.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 450, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => el.remove()
  // Gone even if the animation never ends (in a hidden tab, say).
  setTimeout(() => el.remove(), 1500)
}

/**
 * The picture, from the whole view, shrinks and flies to the corner where it's then shown (where the toasts come:
 * the bottom corner, or the top on a phone), tipping a little on the way, and fades into it.
 */
function fly(url: string) {
  const area = viewArea()
  if (!area || still()) return
  const r = area.getBoundingClientRect()
  const img = document.createElement('img')
  img.src = url
  img.alt = ''
  Object.assign(img.style, {
    position: 'fixed',
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    objectFit: 'contain',
    pointerEvents: 'none',
    zIndex: '61',
    filter: 'drop-shadow(0 12px 28px rgb(0 0 0 / 0.35))',
    transformOrigin: 'center',
  })
  document.body.appendChild(img)
  // Where it lands: a thumbnail about the toast's picture's size, in its corner.
  const w = Math.min(220, window.innerWidth * 0.5)
  const s = w / r.width
  const h = r.height * s
  const top = getLayout().compact
  const x = top ? window.innerWidth / 2 : isRtl() ? 24 + w / 2 : window.innerWidth - 24 - w / 2
  const y = top ? 24 + h / 2 : window.innerHeight - 24 - h / 2
  const dx = x - (r.left + r.width / 2)
  const dy = y - (r.top + r.height / 2)
  const tilt = isRtl() ? 4 : -4
  img
    .animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: 'scale(0.94)', opacity: 1, offset: 0.18 },
        { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(${tilt}deg)`, opacity: 1, offset: 0.85 },
        { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(0deg)`, opacity: 0 },
      ],
      { duration: 820, easing: 'cubic-bezier(.45,.05,.25,1)' },
    )
    .addEventListener('finish', () => img.remove())
  setTimeout(() => img.remove(), 2500)
}

/** Take a snapshot of what's showing (the 3D view or the plan), copy it, and offer to save it. */
export function takeSnapshot() {
  const three = useEditor.getState().viewMode === '3d' && !!capture3d
  const name = fileName(three)
  const blob = three ? capture3d!() : import('./plan-snapshot').then((m) => m.planSnapshot())
  const copied = copy(blob)
  const id = `snapshot-${name}`
  flash()
  blob.then(
    (b) => {
      const url = URL.createObjectURL(b)
      fly(url)
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
