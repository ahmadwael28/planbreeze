import { useState } from 'react'
import { BrickWall, ChevronRight, Grid2x2, PanelTop } from 'lucide-react'
import { t } from '@/i18n'
import { finishLabel, useTakeoff } from '@/hooks/use-takeoff'
import { cn } from '@/lib/utils'
import { roomBreakdown, roomSurfaces } from '@/model/takeoff'
import type { TakeoffPart } from '@/model/takeoff'
import type { Room, Units } from '@/model/types'
import { formatArea } from '@/model/units'
import { useEditor } from '@/store/editor'

const ICONS = { floor: Grid2x2, wall: BrickWall, ceiling: PanelTop } as const

/** Each part of a room's surfaces: what it is, its finish, its area (what's taken off, less). */
export function Breakdown({ room, parts, units }: { room: string; parts: TakeoffPart[]; units: Units }) {
  const images = useEditor((s) => s.project.images)
  const rows = roomBreakdown(parts, room)
  return (
    <ul className="space-y-1 text-xs">
      {rows.map((p) => {
        const Icon = ICONS[p.place]
        const f = finishLabel(p.surface, p.place, images)
        return (
          <li key={`${p.place}|${p.what}|${JSON.stringify(p.surface ?? null)}`} className="flex items-start gap-2">
            <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate">
                {t(p.what)}
                {p.board && <span className="text-muted-foreground"> · {t('gypsum board')}</span>}
              </div>
              <div className="truncate text-muted-foreground">
                {f.name}
                {f.detail && ` · ${f.detail}`}
              </div>
            </div>
            <span className={cn('shrink-0 tabular-nums', p.area < 0 && 'text-muted-foreground')}>
              {p.area < 0 ? '−' : ''}
              {formatArea(Math.abs(p.area), units)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A room's surfaces to finish: its floor, its walls (in each of their finishes) and its ceiling (and the gypsum board
 * in it), with every part that makes them up a click away.
 */
export function RoomSurfaces({ room, units }: { room: Room; units: Units }) {
  const parts = useTakeoff()
  const [open, setOpen] = useState(false)
  const s = roomSurfaces(parts, room.id)
  const rows: [string, number][] = [
    [t('Floor'), s.floor],
    ...(room.kind
      ? []
      : ([
          [t('Walls'), s.walls],
          [t('Ceiling'), s.ceiling],
        ] as [string, number][])),
  ]
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-lg bg-muted/60 px-3 py-2.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-end font-medium tabular-nums">{formatArea(v, units)}</dd>
          </div>
        ))}
        {s.board > 0.5 && (
          <div className="contents text-xs">
            <dt className="text-muted-foreground">{t('Gypsum board in it')}</dt>
            <dd className="text-end tabular-nums">{formatArea(s.board, units)}</dd>
          </div>
        )}
      </dl>
      <button type="button" className="flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90 rtl:-rotate-90')} />
        {open ? t('Hide the parts') : t('Every part: columns, niches, boxes, bulkheads…')}
      </button>
      {open && <Breakdown room={room.id} parts={parts} units={units} />}
    </div>
  )
}
