import { useRef, useState } from 'react'
import type { PointerEvent as RPointerEvent } from 'react'
import { t } from '@/i18n'

const RADIUS = 44

/**
 * An on-screen stick for walking around in 3D by touch: push it up to walk forward, down to walk back, sideways to
 * turn; the further it's pushed, the faster. `onMove` gets x (turn, −1 … 1) and y (walk, −1 … 1), and 0, 0 when let go.
 */
export function TouchStick({ onMove, className }: { onMove: (x: number, y: number) => void; className?: string }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const center = useRef<{ x: number; y: number } | null>(null)

  const set = (e: RPointerEvent<HTMLDivElement>) => {
    const c = center.current
    if (!c) return
    let dx = e.clientX - c.x
    let dy = e.clientY - c.y
    const d = Math.hypot(dx, dy)
    if (d > RADIUS) {
      dx = (dx / d) * RADIUS
      dy = (dy / d) * RADIUS
    }
    setKnob({ x: dx, y: dy })
    // A little dead zone in the middle, so resting a thumb doesn't drift.
    const dead = (v: number) => (Math.abs(v) < 0.12 ? 0 : v)
    onMove(dead(dx / RADIUS), dead(-dy / RADIUS))
  }
  const release = () => {
    center.current = null
    setKnob({ x: 0, y: 0 })
    onMove(0, 0)
  }

  return (
    <div
      className={className}
      role="application"
      aria-label={t('Walk: push up to go forward, sideways to turn')}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        center.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        e.currentTarget.setPointerCapture(e.pointerId)
        set(e)
      }}
      onPointerMove={set}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div className="relative grid size-28 touch-none place-items-center rounded-full border-2 border-background/60 bg-foreground/15 shadow-lg backdrop-blur-sm select-none">
        <div
          className="size-12 rounded-full border-2 border-background/80 bg-background/85 shadow-md"
          style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
        />
      </div>
    </div>
  )
}
