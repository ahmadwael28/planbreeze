import { t } from '@/i18n'
import { useMemo } from 'react'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { area } from '@/model/geometry'
import { finishAreas, finishOf, floorAreas } from '@/model/finishes'
import type { Place } from '@/model/finishes'
import { wallPatches } from '@/model/walls'
import type { ProjectImage, Surface, Units } from '@/model/types'
import { floorStats } from '@/model/project'
import { SYMBOL_MAP } from '@/model/symbols'
import { formatArea, formatLength } from '@/model/units'
import { useEditor, useFloor } from '@/store/editor'

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

  const tiles: [string, string][] = [
    [t('Rooms area'), formatArea(stats.interiorArea, units)],
    [t('Walls area'), formatArea(stats.wallArea, units)],
    [t('Level area'), formatArea(stats.levelArea, units)],
  ]
  if (stats.outdoorArea > 0) tiles.push([t('Outdoor area'), formatArea(stats.outdoorArea, units)])
  if (project.floors.length > 1) tiles.push([t('All floors area'), formatArea(projectArea, units)])
  // Floor finishes to buy: their area, with a tenth more for cuts (and how many tiles that is).
  const finishes = useMemo(() => floorAreas(floor.rooms, (r) => area(r.points)), [floor.rooms])
  // Wall finishes up to the ceiling (the gypsum one, if there is one), around doors and windows.
  const wallFinishes = useMemo(
    () =>
      finishAreas(
        wallPatches(floor, (r) => floor.height - (r.ceiling?.drop ?? 0)).map((p) => ({
          surface: p.surface,
          area: p.parts.reduce((sum, [s1, s2, z0, z1]) => sum + (s2 - s1) * (z1 - z0), 0),
        })),
        'wall',
      ),
    [floor],
  )

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

      {finishes.length > 0 && <FinishTable title={t('Floor finishes')} place="floor" rows={finishes} units={units} images={project.images} />}
      {wallFinishes.length > 0 && <FinishTable title={t('Wall finishes')} place="wall" rows={wallFinishes} units={units} images={project.images} />}

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

/** Litres of paint per m² for two coats, and the area of a wallpaper roll (53 cm × 10.05 m, in cm²). */
const PAINT_PER_M2 = 2 / 10
const ROLL = 53 * 1005

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
              const photo = surface.image && images?.find((i) => i.id === surface.image)
              const color = f.def.colors.find((c) => c.hex === f.color)?.name
              const what = photo ? photo.name : color ? t(color) : t('Custom color')
              const pieces = (kind === 'tile' || kind === 'plank') && f.size ? Math.ceil((a * 1.1) / (f.size[0] * f.size[1])) : 0
              let buy = formatArea(a * 1.1, units)
              let note = pieces ? (kind === 'tile' ? t('≈ {n} tiles', { n: pieces }) : t('≈ {n} planks', { n: pieces })) : ''
              if (kind === 'paint') {
                buy = t('{n} L', { n: Math.max(1, Math.ceil((a / 10000) * PAINT_PER_M2)) })
                note = t('two coats')
              } else if (kind === 'paper') {
                const rolls = Math.ceil((a * 1.15) / ROLL)
                buy = rolls === 1 ? t('1 roll') : t('{n} rolls', { n: rolls })
                note = t('53 cm × 10 m')
              }
              return (
                <TableRow key={JSON.stringify(surface)}>
                  <TableCell className="max-w-40">
                    <div className="truncate">{t(f.def.name)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {what}
                      {f.size && (kind === 'tile' || kind === 'plank') ? ` · ${f.size[0]}×${f.size[1]}` : ''}
                      {f.design && !photo ? ` · ${t(f.design.name)}` : ''}
                    </div>
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
            ? t('To buy: the area plus a tenth for cuts and breakage.')
            : t('Walls up to the ceiling, less doors and windows. Tiles: plus a tenth for cuts; paint: about 10 m² per litre a coat.')}
        </p>
      </div>
    </>
  )
}
