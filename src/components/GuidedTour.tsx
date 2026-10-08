/**
 * A guided tour of the app: one step at a time it lights up a part of the screen (the rest dimmed) and says what it's
 * for, getting the app ready first (the 3D view, a tab of the side panel…). Started from the help button at the top,
 * or offered once on a first visit.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { currentFloor, useEditor } from '@/store/editor'
import { useUi } from '@/store/ui'
import type { SidebarTab } from '@/store/ui'

interface Step {
  /** What to light up: the element with this `data-tour`; without one, the card sits in the middle. */
  target?: string
  title: string
  body: ReactNode
  /** Where the card goes: beside the target, or over the middle of it (a big one, like the plan). */
  side?: 'right' | 'left' | 'top' | 'bottom' | 'over'
  /** Gets the app ready for the step: the view, the side panel and its tab, a selection. */
  enter?: () => void
  /** Left out when its target isn't there (sharing, when plans aren't saved online). */
  optional?: boolean
}

const view = (mode: '2d' | '3d') => useEditor.getState().setViewMode(mode)
const panel = (tab: SidebarTab) => {
  useUi.getState().setSidebarOpen(true)
  useUi.getState().setSidebarTab(tab)
}

/** A room worth showing the properties of: one with finishes, if there is one. */
function selectARoom() {
  const rooms = currentFloor(useEditor.getState()).rooms
  const room = rooms.find((r) => r.floor && r.walls) ?? rooms[0]
  if (room) useEditor.getState().select({ kind: 'room', id: room.id })
}

const STEPS: Step[] = [
  {
    title: 'Welcome to Planbreeze',
    body: "A one-minute look at where everything is. Use the buttons below or the arrow keys, and Esc to leave whenever you like.",
    enter: () => view('2d'),
  },
  {
    target: 'projects',
    side: 'bottom',
    title: 'Your plans',
    body: 'Open, rename and start plans here: from a ready-made layout, a photo or sketch of a plan, or a blank page. Everything is saved as you go.',
  },
  {
    target: 'tools',
    side: 'right',
    title: 'Drawing tools',
    body: 'Drag out rectangular rooms or click out any shape, add balconies, terraces and dimension lines. While drawing, type a length and press Enter for an exact wall.',
  },
  {
    target: 'import',
    side: 'right',
    title: 'From a photo or sketch',
    body: 'Already have a plan? Snap a photo of it, or of a hand sketch, and its rooms are found for you.',
  },
  {
    target: 'canvas',
    side: 'over',
    title: 'The plan',
    body: 'Click a room or an item to select it, drag to move it, drag corners and walls to reshape a room. Furniture dragged up to a wall is pulled flush against it. Scroll to zoom, drag empty space to pan, double-click a room to zoom to it.',
    enter: () => useEditor.getState().select(null),
  },
  {
    target: 'sidebar',
    side: 'left',
    title: 'Properties',
    body: 'Everything about what you selected: sizes, floor and wall finishes (tiles, herringbone, wallpaper, even a photo of your own tile), ceilings and lights.',
    enter: () => {
      selectARoom()
      panel('properties')
    },
  },
  {
    target: 'sidebar',
    side: 'left',
    title: 'Library',
    body: 'Furniture, kitchen and bathroom fittings, doors and windows, lights, air conditioning, and people for scale. Drag them onto the plan, or click to add.',
    enter: () => {
      useEditor.getState().select(null)
      panel('library')
    },
  },
  {
    target: 'sidebar',
    side: 'left',
    title: 'Summary',
    body: 'Room and wall areas, and how much flooring, tiles and paint to buy.',
    enter: () => panel('summary'),
  },
  {
    target: 'layers',
    side: 'bottom',
    title: 'Plan and lighting',
    body: 'The lighting layer is for gypsum ceilings, hidden LED strips, curtain pockets, spots and pendants, and for wiring switches to the lights they turn on.',
    enter: () => panel('properties'),
  },
  {
    target: 'show',
    side: 'bottom',
    title: 'Show and fade',
    body: 'Fade whole kinds of things (furniture, lights, dimensions…) to work on what matters right now.',
  },
  {
    target: 'floors',
    side: 'top',
    title: 'Floors',
    body: 'Add a floor above, copy one to start the next, and switch between them.',
  },
  {
    target: 'view-mode',
    side: 'bottom',
    title: '2D and 3D',
    body: 'See your plan built in 3D at any time, with its finishes, furniture and lights. Let’s have a look.',
  },
  {
    target: 'lights3d',
    side: 'right',
    title: 'Lights',
    body: 'Flip the switches, set the time of day, pick how warm each light is, and step inside with Walk inside.',
    enter: () => view('3d'),
  },
  {
    target: 'viewpoints',
    side: 'top',
    title: 'Viewpoints',
    body: 'Fly from room to room, and save views of your own with the bookmark button.',
    optional: true,
  },
  {
    target: 'camera3d',
    side: 'bottom',
    title: 'Camera',
    body: 'Top view, reset the camera, open all the doors, or go wide with the lens. Walk with WASD or the arrow keys.',
  },
  {
    target: 'design',
    side: 'bottom',
    title: 'Design my home',
    body: 'Say what each room is for and pick a style: you get furniture laid out around your doors and windows, floors and walls, ceilings, lights and switches. Ask any room for another idea before applying it.',
    enter: () => view('2d'),
    optional: true,
  },
  {
    target: 'share',
    side: 'bottom',
    title: 'Share',
    body: 'Sign in to keep your plans online, and share them with others: to look at, or to edit together.',
    enter: () => view('2d'),
    optional: true,
  },
  {
    target: 'export',
    side: 'bottom',
    title: 'Print and export',
    body: 'Print to scale as a PDF, export images, or save the whole project to a file.',
    enter: () => view('2d'),
  },
  {
    target: 'help',
    side: 'bottom',
    title: "That's the tour",
    body: 'Take it again from here any time. Happy planning!',
  },
]

const visible = (el: Element) => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

/** Where the step's target is on screen (null until it's there, e.g. while the 3D view loads), kept up to date. */
function useTargetRect(id: string | undefined, step: number) {
  // Found for this step: a rect left over from the step before doesn't count.
  const [found, setFound] = useState<{ step: number; rect: DOMRect | null }>({ step: -1, rect: null })
  useEffect(() => {
    if (!id) return
    let timer = 0
    const tick = () => {
      const el = [...document.querySelectorAll(`[data-tour="${id}"]`)].find(visible)
      const r = el?.getBoundingClientRect() ?? null
      setFound((prev) => {
        const p = prev.step === step ? prev.rect : null
        const same = p && r && p.x === r.x && p.y === r.y && p.width === r.width && p.height === r.height
        return same || (prev.step === step && !p && !r) ? prev : { step, rect: r }
      })
      timer = window.setTimeout(tick, 150)
    }
    timer = window.setTimeout(tick, 0)
    return () => clearTimeout(timer)
  }, [id, step])
  return id && found.step === step ? found.rect : null
}

const GAP = 14
const MARGIN = 12
const PAD = 6

/** Where the card goes: beside the target on its side (or the other side, if there's no room), kept on screen. */
function place(rect: DOMRect | null, side: Step['side'], w: number, h: number) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), Math.max(a, b))
  if (!rect || !side || side === 'over') {
    const cx = rect ? rect.left + rect.width / 2 : vw / 2
    const cy = rect ? rect.top + rect.height / 2 : vh / 2
    return { x: clamp(cx - w / 2, MARGIN, vw - w - MARGIN), y: clamp(cy - h / 2, MARGIN, vh - h - MARGIN) }
  }
  let s = side
  if (s === 'right' && rect.right + GAP + w > vw - MARGIN) s = 'left'
  else if (s === 'left' && rect.left - GAP - w < MARGIN) s = 'right'
  else if (s === 'bottom' && rect.bottom + GAP + h > vh - MARGIN) s = 'top'
  else if (s === 'top' && rect.top - GAP - h < MARGIN) s = 'bottom'
  const x =
    s === 'right' ? rect.right + GAP : s === 'left' ? rect.left - GAP - w : rect.left + rect.width / 2 - w / 2
  const y =
    s === 'bottom' ? rect.bottom + GAP : s === 'top' ? rect.top - GAP - h : rect.top + rect.height / 2 - h / 2
  return { x: clamp(x, MARGIN, vw - w - MARGIN), y: clamp(y, MARGIN, vh - h - MARGIN) }
}

export function GuidedTour() {
  const step = useUi((s) => s.tourStep)
  if (step === null) return null
  return <Tour step={Math.min(step, STEPS.length - 1)} />
}

function Tour({ step }: { step: number }) {
  const setStep = useUi((s) => s.setTourStep)
  const s = STEPS[step]
  const last = step === STEPS.length - 1
  const rect = useTargetRect(s.target, step)
  const cardRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 340, h: 200 })
  // Which way the user is going, to skip a step whose target isn't there.
  const dir = useRef(1)

  const go = (to: number) => {
    dir.current = to < step ? -1 : 1
    if (to < 0) return
    if (to >= STEPS.length) setStep(null)
    else setStep(to)
  }

  useEffect(() => {
    s.enter?.()
  }, [s])

  // An optional step whose target doesn't show up is passed over.
  useEffect(() => {
    if (!s.optional || rect) return
    const t = window.setTimeout(() => go(step + dir.current), 700)
    return () => clearTimeout(t)
  })

  // The card's size, for placing it; it changes with the step's text.
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const measure = () => setSize((prev) => (prev.w === el.offsetWidth && prev.h === el.offsetHeight ? prev : { w: el.offsetWidth, h: el.offsetHeight }))
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keys: arrows and Enter to move on, Esc to leave; caught before the app's own (they'd move what's selected).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key
      if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Enter' && k !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (k === 'Escape') setStep(null)
      else go(k === 'ArrowLeft' ? step - 1 : step + 1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const at = place(rect, s.side, size.w, size.h)
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-primary transition-all duration-300 ease-out"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}
      <div
        ref={cardRef}
        className="absolute w-[min(340px,calc(100vw-24px))] rounded-xl border bg-popover p-4 text-popover-foreground shadow-2xl transition-[left,top] duration-300 ease-out"
        style={{ left: at.x, top: at.y }}
      >
        <div className="mb-3 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
        <div className="flex items-start justify-between gap-2">
          <h2 id="tour-title" className="text-base font-semibold">
            {s.title}
          </h2>
          <Button variant="ghost" size="icon-xs" className="-mt-0.5 -mr-1.5" onClick={() => setStep(null)} aria-label="Close the tour">
            <X />
          </Button>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {step + 1} of {STEPS.length}
          </span>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" size="sm" onClick={() => go(step - 1)}>
                <ArrowLeft /> Back
              </Button>
            )}
            <Button size="sm" onClick={() => go(step + 1)} autoFocus>
              {last ? 'Done' : step === 0 ? 'Start' : 'Next'}
              {!last && <ArrowRight />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
