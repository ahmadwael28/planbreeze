import { useMemo } from 'react'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
