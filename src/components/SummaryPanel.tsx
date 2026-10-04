import { useMemo } from 'react'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { area } from '@/model/geometry'
import { FLOOR_FINISHES, floorAreas, floorOf } from '@/model/floors'
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
    ['Rooms', formatArea(stats.interiorArea, units)],
    ['Walls', formatArea(stats.wallArea, units)],
    ['Level', formatArea(stats.levelArea, units)],
  ]
  if (stats.outdoorArea > 0) tiles.push(['Outdoor', formatArea(stats.outdoorArea, units)])
  if (project.floors.length > 1) tiles.push(['All floors', formatArea(projectArea, units)])
  // Floor finishes to buy: their area, with a tenth more for cuts (and how many tiles that is).
  const finishes = useMemo(() => floorAreas(floor.rooms, (r) => area(r.points)), [floor.rooms])

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-sm font-semibold">{floor.name}</h3>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-lg border bg-card px-3 py-2">
            <div className="text-xs text-muted-foreground">{k} area</div>
            <div className="text-base font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      <Separator />
      <div className="space-y-2">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Rooms</h4>
        {stats.rooms.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Area</TableHead>
                <TableHead className="text-right">Perimeter</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.rooms.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => select({ kind: 'room', id: r.id })}>
                  <TableCell className="max-w-28 truncate">
                    {r.name}
                    {r.kind && <span className="ml-1 text-xs text-muted-foreground">({r.kind})</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatArea(r.area, units)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatLength(r.perimeter, units)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-xs text-muted-foreground">No rooms on this floor yet.</p>
        )}
      </div>

      {finishes.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Floor finishes</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Finish</TableHead>
                  <TableHead className="text-right">Area</TableHead>
                  <TableHead className="text-right">To buy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {finishes.map(({ floor: fl, area: a }) => {
                  const f = floorOf(fl)
                  const def = FLOOR_FINISHES[fl.finish]
                  const buy = a * 1.1
                  const tiles = def.kind !== 'plain' && f.size ? Math.ceil(buy / (f.size[0] * f.size[1])) : 0
                  return (
                    <TableRow key={`${fl.finish}${f.color}${f.size?.join('x')}${f.pattern}`}>
                      <TableCell className="max-w-36">
                        <div className="truncate">{def.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {def.colors.find((c) => c.hex === f.color)?.name ?? 'Custom'}
                          {f.size && def.kind !== 'plain' ? ` · ${f.size[0]}×${f.size[1]}` : ''}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatArea(a, units)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatArea(buy, units)}
                        {tiles > 0 && <div className="text-xs text-muted-foreground">≈ {tiles} {def.kind === 'tile' ? 'tiles' : 'planks'}</div>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">To buy: the area plus a tenth for cuts and breakage.</p>
          </div>
        </>
      )}

      <Separator />
      <div className="space-y-2">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Symbols</h4>
        {stats.symbolCounts.length ? (
          <Table>
            <TableBody>
              {[...stats.symbolCounts]
                .sort((a, b) => b.count - a.count)
                .map((c) => (
                  <TableRow key={c.type}>
                    <TableCell>{SYMBOL_MAP.get(c.type)?.name ?? c.type}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{c.count}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-xs text-muted-foreground">No symbols on this floor yet.</p>
        )}
      </div>
    </div>
  )
}
