import { t } from '@/i18n'
import { Fragment, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { finishOf } from '@/model/finishes'
import type { Place } from '@/model/finishes'
import type { ProjectImage, Surface, Units } from '@/model/types'
import { floorStats } from '@/model/project'
import { SYMBOL_MAP } from '@/model/symbols'
import { finishTotals, roomSurfaces, skirting, stoneTotals } from '@/model/takeoff'
import { formatArea, formatLength } from '@/model/units'
import { useEditor, useFloor } from '@/store/editor'
import { finishLabel, stoneName, useTakeoff } from '@/hooks/use-takeoff'
import { Breakdown } from './Surfaces'

export function SummaryPanel() {
  const floor = useFloor()
  const project = useEditor((s) => s.project)
  const select = useEditor((s) => s.select)
  const units = project.units
  const stats = useMemo(() => floorStats(floor), [floor])
  const projectArea = useMemo(
    () => project.floors.reduce((s, f) => s + floorStats(f).interiorArea, 0),
    [project.floors],
  )
  // Every room's floor, walls and ceiling, part by part (see model/takeoff).
  const parts = useTakeoff()
  const [open, setOpen] = useState<string | null>(null)

  const tiles: [string, string][] = [
    [t('Rooms area'), formatArea(stats.interiorArea, units)],
    [t('Walls area'), formatArea(stats.wallArea, units)],
    [t('Level area'), formatArea(stats.levelArea, units)],
  ]
  if (stats.outdoorArea > 0) tiles.push([t('Outdoor area'), formatArea(stats.outdoorArea, units)])
  if (project.floors.length > 1) tiles.push([t('All floors area'), formatArea(projectArea, units)])
  // What to buy: each floor and wall finish, the ceilings' paint and gypsum board, and skirting boards.
  const floors = useMemo(() => finishTotals(parts, 'floor'), [parts])
  const walls = useMemo(() => finishTotals(parts, 'wall'), [parts])
  const ceilings = useMemo(() => {
    const paint = parts.reduce((s, p) => s + (p.place === 'ceiling' ? p.area : 0), 0)
    const board = parts.reduce((s, p) => s + (p.board ? p.area : 0), 0)
    return { paint, board }
  }, [parts])
  const skirt = useMemo(() => [...skirting(floor).values()].reduce((s, l) => s + l, 0), [floor])
  const stones = useMemo(() => stoneTotals(parts), [parts])
  const surfaces = floor.rooms.map((r) => ({ room: r, ...roomSurfaces(parts, r.id) }))
  const total = surfaces.reduce((s, r) => ({ floor: s.floor + r.floor, walls: s.walls + r.walls, ceiling: s.ceiling + r.ceiling }), { floor: 0, walls: 0, ceiling: 0 })

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-sm font-semibold">{floor.name}</h3>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-lg border bg-card px-3 py-2">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="text-base font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      <Separator />
      <div className="space-y-2">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('Rooms')}</h4>
        {stats.rooms.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Name')}</TableHead>
                <TableHead className="text-end">{t('Area')}</TableHead>
                <TableHead className="text-end">{t('Perimeter')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.rooms.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => select({ kind: 'room', id: r.id })}>
                  <TableCell className="max-w-28 truncate">
                    {r.name}
                    {r.kind && <span className="ms-1 text-xs text-muted-foreground">({t(r.kind === 'balcony' ? 'Balcony' : 'Terrace')})</span>}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{formatArea(r.area, units)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatLength(r.perimeter, units)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-xs text-muted-foreground">{t('No rooms on this floor yet.')}</p>
        )}
      </div>

      {surfaces.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('Surfaces to finish')}</h4>
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Room')}</TableHead>
                  <TableHead className="text-end">{t('Floor')}</TableHead>
                  <TableHead className="text-end">{t('Walls')}</TableHead>
                  <TableHead className="text-end">{t('Ceiling')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {surfaces.map(({ room, floor: f, walls: w, ceiling: c }) => (
                  <Fragment key={room.id}>
                    <TableRow className="cursor-pointer" onClick={() => setOpen(open === room.id ? null : room.id)} aria-expanded={open === room.id}>
                      <TableCell className="max-w-24">
                        <span className="flex items-center gap-1">
                          <ChevronRight className={cn('size-3 shrink-0 transition-transform', open === room.id && 'rotate-90 rtl:-rotate-90')} />
                          <span className="truncate">{room.name}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{area(f, units)}</TableCell>
                      <TableCell className="text-end tabular-nums">{room.kind ? '–' : area(w, units)}</TableCell>
                      <TableCell className="text-end tabular-nums">{room.kind ? '–' : area(c, units)}</TableCell>
                    </TableRow>
                    {open === room.id && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={4} className="bg-muted/40 whitespace-normal">
                          <Breakdown room={room.id} parts={parts} units={units} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>{t('Total')}</TableCell>
                  <TableCell className="text-end tabular-nums">{area(total.floor, units)}</TableCell>
                  <TableCell className="text-end tabular-nums">{area(total.walls, units)}</TableCell>
                  <TableCell className="text-end tabular-nums">{area(total.ceiling, units)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
            <p className="text-xs text-muted-foreground">
              {t('In {unit}. Floors less what’s built on them; walls up to the ceiling less doors and windows, with columns, niches, window reveals and what’s built against them (a toilet’s box, half walls, benches, a tiled vanity); ceilings with their gypsum bands, sides, coves, pockets, boxes and beams. Tap a room for every part.', { unit: units === 'metric' ? 'm²' : 'ft²' })}
            </p>
          </div>
        </>
      )}

      {floors.length > 0 && <FinishTable title={t('Floor finishes')} place="floor" rows={floors} units={units} images={project.images} />}
      {walls.length > 0 && <FinishTable title={t('Wall finishes')} place="wall" rows={walls} units={units} images={project.images} />}
      {ceilings.paint > 0.5 && (
        <>
          <Separator />
          <div className="space-y-2">
            <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('Ceilings')}</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Finish')}</TableHead>
                  <TableHead className="text-end">{t('To buy')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>
                    <div>{t('Paint')}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">{formatArea(ceilings.paint, units)}</div>
                  </TableCell>
                  <TableCell className="text-end align-top tabular-nums">
                    {t('{n} L', { n: litres(ceilings.paint) })}
                    <div className="text-xs text-muted-foreground">{t('two coats')}</div>
                  </TableCell>
                </TableRow>
                {ceilings.board > 0.5 && (
                  <TableRow>
                    <TableCell>
                      <div>{t('Gypsum board')}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">{formatArea(ceilings.board, units)}</div>
                    </TableCell>
                    <TableCell className="text-end align-top tabular-nums">
                      {t('≈ {n} boards', { n: Math.ceil((ceilings.board * 1.1) / BOARD) })}
                      <div className="text-xs text-muted-foreground">{t('120 × 240 cm')}</div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">{t('The slab and gypsum alike, every face that shows. Boards: plus a tenth for cuts.')}</p>
          </div>
        </>
      )}
      {stones.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('Stone and worktops')}</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Stone')}</TableHead>
                  <TableHead className="text-end">{t('To buy')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stones.map((s) => (
                  <TableRow key={s.stone}>
                    <TableCell className="max-w-40">
                      <div className="truncate">{stoneName(s.stone)}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">{formatArea(s.area, units)}</div>
                    </TableCell>
                    <TableCell className="text-end align-top tabular-nums">
                      {formatArea(s.area * 1.1, units)}
                      <div className="text-xs text-muted-foreground">{t('{length} front edge', { length: formatLength(s.length, units) })}</div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">{t('Worktops, vanity and bench tops, niche sills and the shelves on toilet boxes and half walls. To buy: plus a tenth for cuts; the front edge is what’s polished.')}</p>
          </div>
        </>
      )}
      {skirt > 0 && (
        <>
          <Separator />
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <div>
              <div>{t('Skirting boards')}</div>
              <div className="text-xs text-muted-foreground">{t('Along walls that aren’t tiled to the floor, round columns, less doorways; plus a tenth.')}</div>
            </div>
            <span className="shrink-0 font-medium tabular-nums">{formatLength(skirt * 1.1, units)}</span>
          </div>
        </>
      )}

      <Separator />
      <div className="space-y-2">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('Symbols')}</h4>
        {stats.symbolCounts.length ? (
          <Table>
            <TableBody>
              {[...stats.symbolCounts]
                .sort((a, b) => b.count - a.count)
                .map((c) => (
                  <TableRow key={c.type}>
                    <TableCell>{t(SYMBOL_MAP.get(c.type)?.name ?? c.type)}</TableCell>
                    <TableCell className="text-end font-medium tabular-nums">{c.count}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-xs text-muted-foreground">{t('No symbols on this floor yet.')}</p>
        )}
      </div>
    </div>
  )
}

/** An area as a bare number in the table's unit (m² or ft², said once under it). */
const area = (cm2: number, units: Units) => formatArea(cm2, units).replace(/\s*(m²|ft²)$/, '')

/** Litres of paint per m² for two coats, the area of a wallpaper roll (53 cm × 10.05 m) and of a gypsum board (cm²). */
const PAINT_PER_M2 = 2 / 10
const ROLL = 53 * 1005
const BOARD = 120 * 240

const litres = (cm2: number) => Math.max(1, Math.ceil((cm2 / 10000) * PAINT_PER_M2))

/** Finishes and how much of each to buy: tiles and planks with a tenth for cuts, litres of paint, rolls of wallpaper. */
function FinishTable({ title, place, rows, units, images }: { title: string; place: Place; rows: { surface: Surface; area: number }[]; units: Units; images?: ProjectImage[] }) {
  return (
    <>
      <Separator />
      <div className="space-y-2">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h4>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Finish')}</TableHead>
              <TableHead className="text-end">{t('To buy')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ surface, area: a }) => {
              const f = finishOf(surface, place)
              const kind = f.def.kind
              const label = finishLabel(surface, place, images)
              const pieces = (kind === 'tile' || kind === 'plank') && f.size ? Math.ceil((a * 1.1) / (f.size[0] * f.size[1])) : 0
              let buy = formatArea(a * 1.1, units)
              let note = pieces ? (kind === 'tile' ? t('≈ {n} tiles', { n: pieces }) : t('≈ {n} planks', { n: pieces })) : ''
              if (kind === 'paint') {
                buy = t('{n} L', { n: litres(a) })
                note = t('two coats')
              } else if (kind === 'paper') {
                const rolls = Math.ceil((a * 1.15) / ROLL)
                buy = rolls === 1 ? t('1 roll') : t('{n} rolls', { n: rolls })
                note = t('53 cm × 10 m')
              }
              return (
                <TableRow key={JSON.stringify(surface)}>
                  <TableCell className="max-w-40">
                    <div className="truncate">{label.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{label.detail}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">{formatArea(a, units)}</div>
                  </TableCell>
                  <TableCell className="text-end align-top tabular-nums">
                    {buy}
                    {note && <div className="text-xs text-muted-foreground">{note}</div>}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">
          {place === 'floor'
            ? t('Floors less what’s built on them. To buy: the area plus a tenth for cuts and breakage.')
            : t('Walls up to the ceiling less doors and windows, with columns, niches, reveals and what’s built against them. Tiles: plus a tenth for cuts; paint: about 10 m² per litre a coat.')}
        </p>
      </div>
    </>
  )
}
