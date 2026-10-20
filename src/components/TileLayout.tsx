import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { PointerEvent as RPointerEvent, ReactNode } from 'react'
import { Check, Columns3, Grid2x2Check, ImagePlus, Maximize2, Pencil, Plus, Redo2, Rows3, Shuffle, SquareDashed, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useLayout } from '@/hooks/use-layout'
import { readPhoto } from '@/lib/images'
import { cn } from '@/lib/utils'
import { finishOf, wallSurfaceAt } from '@/model/finishes'
import type { Place } from '@/model/finishes'
import { bbox, dist, polygonPath } from '@/model/geometry'
import { floorOrigin } from '@/model/divide'
import { uid } from '@/model/project'
import { borderCells, cellAt, cellCenter, cellKey, cellRect, cellsOn, checker, cutPieces, parseKey, randomMix, tileGrid, tileIndex, tileStyle, toGrid } from '@/model/tiles'
import type { Cell, CutSide, Span, TileGrid } from '@/model/tiles'
import { formatLength } from '@/model/units'
import type { Point, Project, ProjectImage, Room, Surface, TileMix, Units, WallSurface } from '@/model/types'
import { wallPatches } from '@/model/walls'
import { aroundColumns, columnFaces, developed, wallColumns } from '@/model/developed'
import { currentFloor, draftFloor, useEditor } from '@/store/editor'
import { useUi } from '@/store/ui'
import { t } from '@/i18n'

type Target = { roomId: string; edge?: number }

/** The surface being laid out: its finish, and where it is in its own coordinates (y down). */
interface Laid {
  room: Room
  place: Place
  surface: Surface
  /** Where tiles go: a floor's outline, or the parts of a wall around its doors and windows. */
  areas: Point[][]
  /** The whole outline, to show doors and windows as gaps in it. */
  frame: Point[]
  /** A wall's columns, unfolded into it: where their corners fold (x), and their fronts. */
  folds?: number[]
  fronts?: [number, number][]
}

/** The floor or wall `target` points at, laid out in its own coordinates; null if it's gone or isn't finished. */
function surfaceFor(target: Target, rooms: Room[], floorHeight: number, floor: ReturnType<typeof currentFloor>): Laid | null {
  const room = rooms.find((r) => r.id === target.roomId)
  if (!room) return null
  if (target.edge === undefined) {
    if (!room.floor) return null
    const o = floorOrigin(room, rooms)
    const pts = room.points.map((p) => ({ x: p.x - o.x, y: p.y - o.y }))
    return { room, place: 'floor', surface: room.floor, areas: [pts], frame: pts }
  }
  const s = wallSurfaceAt(room, target.edge)
  if (!s) return null
  // Along the developed wall as seen from the room (left to right, on round its columns, see model/developed) and
  // down from the floor, as its texture is laid.
  const cols = wallColumns(floor, room, target.edge)
  const rect = (x0: number, x1: number, z0: number, z1: number) => [
    { x: x0, y: -z1 },
    { x: x1, y: -z1 },
    { x: x1, y: -z0 },
    { x: x0, y: -z0 },
  ]
  const areas: Point[][] = []
  let zLo = Infinity
  let zHi = -Infinity
  for (const p of wallPatches(floor, () => floorHeight)) {
    if (p.room.id !== room.id || p.edge !== target.edge || p.surface !== s) continue
    const sign = p.dir.x * p.inward.y - p.dir.y * p.inward.x > 0 ? 1 : -1
    for (const [s1, s2, z0, z1] of p.parts) {
      const [u0, u1] = [sign * s1, sign * s2].sort((a, b) => a - b)
      for (const [a, b] of aroundColumns(cols, u0, u1)) areas.push(rect(developed(cols, a), developed(cols, b), z0, z1))
      zLo = Math.min(zLo, z0)
      zHi = Math.max(zHi, z1)
    }
  }
  if (!areas.length) return null
  // Each column's sides and front, as tall as the tiles.
  const folds: number[] = []
  const fronts: [number, number][] = []
  for (const c of cols) {
    const faces = columnFaces(cols, c)
    for (const [a, b] of [faces.left, faces.front, faces.right]) areas.push(rect(a, b, zLo, zHi))
    folds.push(faces.left[0], faces.front[0], faces.right[0], faces.right[1])
    fronts.push(faces.front)
  }
  const b = bbox(areas.flat())
  const frame = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ]
  return { room, place: 'wall', surface: s, areas, frame, folds, fronts }
}

/**
 * Change the surface being laid out, as one undo step. A wall that has its finish from the room's ("all walls") gets
 * its own copy first, so laying tiles on it doesn't lay them on every wall.
 */
function editSurface(target: Target, recipe: (s: Surface, d: Project) => void) {
  useEditor.getState().commit((d) => {
    const r = draftFloor(d).rooms.find((x) => x.id === target.roomId)
    if (!r) return
    let s: Surface | undefined
    if (target.edge === undefined) s = r.floor
    else {
      if (!r.wallFinishes?.[target.edge]) {
        if (!r.walls) return
        const list = r.points.map((_, k) => r.wallFinishes?.[k] ?? null)
        list[target.edge] = JSON.parse(JSON.stringify(r.walls))
        r.wallFinishes = list
      }
      s = r.wallFinishes![target.edge]!
    }
    if (!s) return
    recipe(s, d)
    // Only what's other than the surface's own tile.
    if (s.cells) {
      const n = s.mix?.length ?? 0
      for (const [k, v] of Object.entries(s.cells)) if (!(v > 0 && v <= n)) delete s.cells[k]
      if (!Object.keys(s.cells).length) delete s.cells
    }
    if (s.mix && !s.mix.length) delete s.mix
  })
}

/** A tile as a little square: its photo, or its color. */
function TileFace({ style, fallback, images, className }: { style: TileMix; fallback: string; images: ProjectImage[]; className?: string }) {
  const img = style.image ? images.find((i) => i.id === style.image) : undefined
  return img ? (
    <img src={img.src} alt="" className={cn('object-cover', className)} />
  ) : (
    <span className={cn('block', className)} style={{ background: style.color ?? fallback }} />
  )
}

/** Choosing a tile: a new photo, one of the plan's photos, or one of the finish's colors. */
function TileChoices({ colors, images, onPick, footer }: { colors: { hex: string; name: string }[]; images: ProjectImage[]; onPick: (m: TileMix, add?: ProjectImage) => void; footer?: ReactNode }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="space-y-3">
      <Button variant="outline" className="w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
        <ImagePlus /> {t('A photo of the tile…')}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setBusy(true)
          try {
            const img = await readPhoto(file, uid())
            onPick({ image: img.id }, img)
          } catch {
            toast.error(t("That file couldn't be read as a picture."))
          } finally {
            setBusy(false)
          }
        }}
      />
      {images.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t('Photos in this plan')}</p>
          <div className="flex flex-wrap gap-2">
            {images.map((img) => (
              <button key={img.id} type="button" title={img.name} aria-label={img.name} onClick={() => onPick({ image: img.id })} className="size-10 overflow-hidden rounded-md border shadow-sm">
                <img src={img.src} alt="" className="size-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">{t('Colors')}</p>
        <div className="flex flex-wrap gap-2">
          {colors.map((c) => (
            <button key={c.hex} type="button" title={t(c.name)} aria-label={t(c.name)} onClick={() => onPick({ color: c.hex })} className="size-10 rounded-md border shadow-sm" style={{ background: c.hex }} />
          ))}
        </div>
      </div>
      {footer}
    </div>
  )
}

type View = { x: number; y: number; w: number; h: number }

/**
 * Laying several tiles on a floor or wall: pick tiles on it (tap them, or drag across several), then the tile to lay
 * there; or fill it with a checkerboard, a random mix or a border. Walls show as seen from the room, with their doors
 * and windows as gaps.
 */
export function TileLayoutDialog() {
  const target = useUi((s) => s.tileLayout)
  const open = useUi((s) => s.openTileLayout)
  const compact = useLayout().compact
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && open(null)}>
      <DialogContent
        className={cn(
          'flex flex-col gap-0 overflow-hidden p-0',
          compact ? 'h-dvh max-h-none w-screen max-w-none rounded-none border-0 sm:max-w-none' : 'h-[90dvh] max-h-[900px] sm:max-w-6xl',
        )}
        showCloseButton={false}
        data-fullscreen={compact || undefined}
      >
        {target && <TileEditor key={`${target.roomId}:${target.edge ?? 'floor'}`} target={target} />}
      </DialogContent>
    </Dialog>
  )
}

function TileEditor({ target }: { target: Target }) {
  const floor = useEditor(currentFloor)
  const images = useEditor((s) => s.project.images) ?? []
  const units = useEditor((s) => s.project.units)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const compact = useLayout().compact
  const laid = surfaceFor(target, floor.rooms, floor.height, floor)
  const s = laid?.surface
  // A wall's grid is placed for its cut tiles, so it needs how far the wall reaches.
  const span = laid?.place === 'wall' ? spanOf(laid.areas) : undefined
  const grid = s && laid ? tileGrid(s, laid.place, span) : null
  const f = s && laid ? finishOf(s, laid.place) : null
  // The tiles on it (quick to work out, even for a few thousand).
  const cells = grid && laid ? cellsOn(grid, laid.areas) : []
  const onSurface = new Set(cells.map(cellKey))
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [active, setActive] = useState(1)
  /** The tile whose choices are open (to change it), or adding one. */
  const [editing, setEditing] = useState<number | 'add' | null>(null)
  const [last, setLast] = useState<Cell | null>(null)
  const close = () => useUi.getState().openTileLayout(null)
  const room = laid?.room ?? floor.rooms.find((r) => r.id === target.roomId)

  const title =
    target.edge === undefined
      ? t('Tiles on the floor of {room}', { room: room?.name ?? '' })
      : t('Tiles on wall {n} of {room}', { n: target.edge + 1, room: room?.name ?? '' })

  const kinds = (s?.mix?.length ?? 0) + 1
  // How many of each tile are laid.
  const counts = Array.from({ length: kinds }, () => 0)
  if (s) for (const c of cells) counts[tileIndex(s, cellKey(c))]++

  // ---------- changing it ----------
  const keysOf = (list: Cell[]) => list.map(cellKey)
  const targets = () => (picked.size ? [...picked].map(parseKey) : cells)
  const lay = (k: number, keys: string[]) =>
    editSurface(target, (x) => {
      x.cells ??= {}
      for (const key of keys) {
        if (k) x.cells[key] = k
        else delete x.cells[key]
      }
    })
  const pickTile = (k: number) => {
    setActive(k)
    if (picked.size) lay(k, [...picked])
  }
  const addTile = (m: TileMix, img?: ProjectImage) => {
    const k = kinds
    const keys = [...picked]
    editSurface(target, (x, d) => {
      if (img) d.images = [...(d.images ?? []), img]
      x.mix = [...(x.mix ?? []), m]
      if (keys.length) {
        x.cells ??= {}
        for (const key of keys) x.cells[key] = k
      }
    })
    setActive(k)
  }
  const replaceTile = (k: number, m: TileMix, img?: ProjectImage) =>
    editSurface(target, (x, d) => {
      if (img) d.images = [...(d.images ?? []), img]
      if (k === 0) {
        x.image = m.image
        if (m.color) x.color = m.color
        if (!m.image) delete x.image
      } else if (x.mix?.[k - 1]) x.mix[k - 1] = m
    })
  const removeTile = (k: number) => {
    editSurface(target, (x) => {
      x.mix?.splice(k - 1, 1)
      for (const [key, v] of Object.entries(x.cells ?? {})) {
        if (v === k) delete x.cells![key]
        else if (v > k) x.cells![key] = v - 1
      }
    })
    setActive((a) => (a >= k ? Math.max(0, a - 1) : a))
  }
  const fill = (map: Record<string, number>) =>
    editSurface(target, (x) => {
      x.cells ??= {}
      for (const [key, v] of Object.entries(map)) {
        if (v) x.cells[key] = v
        else delete x.cells[key]
      }
    })

  // ---------- picking tiles ----------
  const toggle = (cell: Cell) => {
    const key = cellKey(cell)
    if (!onSurface.has(key)) return
    setLast(cell)
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }
  const pickAll = () => setPicked(new Set(onSurface))
  const pickSame = () => s && setPicked(new Set(keysOf(cells.filter((c) => tileIndex(s, cellKey(c)) === active))))
  const pickRow = () => last && setPicked((p) => new Set([...p, ...keysOf(cells.filter((c) => c.r === last.r))]))
  const pickColumn = () => {
    if (!last || !grid) return
    // Down the column: the tiles whose middles line up with this one's (brick bond: every other row, half a tile off).
    const x = cellRect(grid, last).x + grid.len / 2
    setPicked((p) => new Set([...p, ...keysOf(cells.filter((c) => Math.abs(cellRect(grid, c).x + grid.len / 2 - x) < grid.len / 2))]))
  }

  if (!laid || !s || !f) {
    return (
      <>
        <Header title={title} onClose={close} />
        <p className="p-6 text-sm text-muted-foreground">{t('This wall has no tiles. Give it a tile finish first.')}</p>
      </>
    )
  }

  return (
    <>
      <Header
        title={title}
        onClose={close}
        extra={
          <>
            {target.edge !== undefined && room && (
              <Select value={String(target.edge)} onValueChange={(v) => useUi.getState().openTileLayout({ roomId: target.roomId, edge: Number(v) })}>
                <SelectTrigger size="sm" className="w-auto max-w-44" aria-label={t('Wall')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {room.points.map((a, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {t('Wall {n}', { n: i + 1 })} · {formatLength(dist(a, room.points[(i + 1) % room.points.length]), units)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="ghost" size="icon" disabled={!canUndo} onClick={() => useEditor.getState().undo()} aria-label={t('Undo')}>
              <Undo2 className="rtl-flip" />
            </Button>
            <Button variant="ghost" size="icon" disabled={!canRedo} onClick={() => useEditor.getState().redo()} aria-label={t('Redo')}>
              <Redo2 className="rtl-flip" />
            </Button>
          </>
        }
      />
      {!grid ? (
        <p className="p-6 text-sm text-muted-foreground">
          {t('Several kinds of tile can be laid when the tiles are laid straight, in brick bond or diagonally. Choose one of those under Laying.')}
        </p>
      ) : (
        <div className={cn('flex min-h-0 flex-1', compact ? 'flex-col' : 'flex-row')}>
          <div className={cn('relative min-h-0 bg-muted/40', compact ? 'h-[52%] shrink-0' : 'flex-1')}>
            <SurfaceView laid={laid} grid={grid} cells={cells} picked={picked} images={images} baseColor={f.color} onTap={toggle} onBox={(list) => setPicked((p) => new Set([...p, ...keysOf(list.filter((c) => onSurface.has(cellKey(c))))]))} />
          </div>
          <div className={cn('min-h-0 overflow-y-auto overscroll-contain', compact ? 'flex-1 border-t' : 'w-80 shrink-0 border-s')}>
            <div className="space-y-5 p-4">
              {span && <CutTiles grid={grid} span={span} cut={(s as WallSurface).cut} units={units} onChange={(cut) => editSurface(target, (x) => void ((x as WallSurface).cut = cut === 'right' ? undefined : cut))} />}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t('Tiles')}</h3>
                {/* Two lines either way, so the buttons below don't move as tiles are picked. */}
                <p className="min-h-8 text-xs text-muted-foreground">
                  {picked.size ? t('Tap a tile to lay it on the {n} picked.', { n: picked.size }) : t('Pick tiles on the floor or wall (tap them, or drag across several), then tap the tile to lay there.')}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: kinds }, (_, k) => (
                    <div key={k} className={cn('relative rounded-lg border p-1.5 transition-colors', active === k && 'border-primary bg-primary/5 ring-1 ring-primary')}>
                      <button type="button" className="block w-full text-start" onClick={() => pickTile(k)} aria-label={k ? t('Tile {n}', { n: k + 1 }) : t('Main tile')}>
                        <TileFace style={tileStyle(s, k)} fallback={f.color} images={images} className="aspect-square w-full rounded-md border" />
                        <span className="mt-1 block truncate text-xs font-medium">{k ? t('Tile {n}', { n: k + 1 }) : t('Main tile')}</span>
                        <span className="block text-[11px] text-muted-foreground tabular-nums">{counts[k] === 1 ? t('1 tile') : t('{n} tiles', { n: counts[k] })}</span>
                      </button>
                      <Popover open={editing === k} onOpenChange={(o) => setEditing(o ? k : null)}>
                        <PopoverTrigger asChild>
                          <Button variant="secondary" size="icon-xs" className="absolute end-1 top-1 shadow-sm" aria-label={t('Change this tile')}>
                            <Pencil />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72">
                          <TileChoices
                            colors={f.def.colors}
                            images={images}
                            onPick={(m, img) => {
                              replaceTile(k, m, img)
                              setEditing(null)
                            }}
                            footer={
                              k > 0 && (
                                <Button
                                  variant="ghost"
                                  className="w-full text-destructive hover:text-destructive"
                                  onClick={() => {
                                    removeTile(k)
                                    setEditing(null)
                                  }}
                                >
                                  <Trash2 /> {t('Remove this tile')}
                                </Button>
                              )
                            }
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  ))}
                  <Popover open={editing === 'add'} onOpenChange={(o) => setEditing(o ? 'add' : null)}>
                    <PopoverTrigger asChild>
                      <button type="button" className="flex aspect-[4/5] flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground hover:bg-muted">
                        <Plus className="size-5" />
                        {t('Add a tile')}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72">
                      <TileChoices
                        colors={f.def.colors}
                        images={images}
                        onPick={(m, img) => {
                          addTile(m, img)
                          setEditing(null)
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold">{t('Pick')}</h3>
                  <span className="text-xs text-muted-foreground tabular-nums">{picked.size === 1 ? t('1 picked') : t('{n} picked', { n: picked.size })}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="outline" size="sm" onClick={pickAll}>
                    {t('All')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={pickSame} title={t('Every tile like the one chosen above')}>
                    {t('Same tile')}
                  </Button>
                  <Button variant="outline" size="sm" disabled={!last} onClick={pickRow} title={t('The row of the last tile tapped')}>
                    <Rows3 /> {t('Row')}
                  </Button>
                  <Button variant="outline" size="sm" disabled={!last} onClick={pickColumn} title={t('The column of the last tile tapped')}>
                    <Columns3 /> {t('Column')}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={!picked.size} onClick={() => setPicked(new Set())}>
                    {t('Clear')}
                  </Button>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t('Quick layouts')}</h3>
                <p className="text-xs text-muted-foreground">{picked.size ? t('On the tiles picked.') : t('On the whole surface, or pick tiles first.')}</p>
                <div className="grid grid-cols-3 gap-1.5">
                  <Button variant="outline" size="sm" className="h-auto flex-col gap-1 py-2" disabled={kinds < 2} onClick={() => fill(checker(targets(), 0, active || 1))} title={t('The main tile and the one chosen above, taking turns')}>
                    <Grid2x2Check /> {t('Checkerboard')}
                  </Button>
                  <Button variant="outline" size="sm" className="h-auto flex-col gap-1 py-2" disabled={kinds < 2} onClick={() => fill(randomMix(targets(), Array.from({ length: kinds }, (_, k) => k), Math.floor(Math.random() * 1e6)))} title={t('All the tiles above, mixed at random')}>
                    <Shuffle /> {t('Random mix')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto flex-col gap-1 py-2"
                    disabled={kinds < 2}
                    onClick={() => fill(Object.fromEntries(borderCells(grid, targets(), laid.areas).map((c) => [cellKey(c), active || 1])))}
                    title={t('The tile chosen above around the edges')}
                  >
                    <SquareDashed /> {t('Border')}
                  </Button>
                </div>
                {kinds < 2 && <p className="text-xs text-muted-foreground">{t('Add a second tile to use these.')}</p>}
              </section>

              <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={!s.cells} onClick={() => fill(Object.fromEntries(cells.map((c) => [cellKey(c), 0])))}>
                {t('All back to the main tile')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** How far a wall's parts reach along it (left to right, as seen from the room). */
function spanOf(areas: Point[][]): Span {
  const xs = areas.flat().map((p) => p.x)
  return { u0: Math.min(...xs), u1: Math.max(...xs) }
}

/**
 * Where a wall's cut tiles go, as seen from the room: at the left end, both ends alike (the tiles centered), or the
 * right end; and how wide they come out.
 */
export function CutTiles({ grid, span, cut, units, onChange }: { grid: TileGrid; span: Span; cut?: CutSide; units: Units; onChange: (c: CutSide) => void }) {
  const { left, right } = cutPieces(grid, span)
  const len = (v: number) => formatLength(v, units)
  const note =
    !left && !right
      ? t('Whole tiles from end to end.')
      : left && right
        ? Math.abs(left - right) < 0.5
          ? t('Cut tiles {length} wide at each end.', { length: len(left) })
          : t('Cut tiles {left} wide at the left, {right} at the right.', { left: len(left), right: len(right) })
        : left
          ? t('Cut tiles {length} wide at the left end.', { length: len(left) })
          : t('Cut tiles {length} wide at the right end.', { length: len(right) })
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{t('Cut tiles at')}</h3>
      {/* Left and right as seen from the room, whichever way the page reads. */}
      <ToggleGroup type="single" variant="outline" size="sm" value={cut ?? 'right'} onValueChange={(v) => v && onChange(v as CutSide)} className="w-full" dir="ltr">
        <ToggleGroupItem value="left" className="flex-1">
          {t('Left end')}
        </ToggleGroupItem>
        <ToggleGroupItem value="both" className="flex-1" title={t('The tiles centered on the wall, cut alike at both ends')}>
          {t('Both ends')}
        </ToggleGroupItem>
        <ToggleGroupItem value="right" className="flex-1">
          {t('Right end')}
        </ToggleGroupItem>
      </ToggleGroup>
      <p className="text-xs text-muted-foreground">{note}</p>
    </section>
  )
}

function Header({ title, onClose, extra }: { title: string; onClose: () => void; extra?: ReactNode }) {
  return (
    <DialogHeader className="flex-row flex-wrap items-center gap-2 space-y-0 border-b px-4 py-2.5 text-start">
      <div className="min-w-0 flex-1 max-sm:basis-full">
        <DialogTitle className="truncate text-base">{title}</DialogTitle>
        <DialogDescription className="sr-only">{t('Choose which tile goes where.')}</DialogDescription>
      </div>
      {extra}
      <Button onClick={onClose} className="max-sm:ms-auto">
        <Check /> {t('Done')}
      </Button>
    </DialogHeader>
  )
}

/**
 * The floor (from above) or the wall (from the room) with its tiles: tap one to pick it, drag across several; scroll or
 * pinch to zoom, and drag with two fingers (or the right mouse button) to move around.
 */
function SurfaceView({
  laid,
  grid,
  cells,
  picked,
  images,
  baseColor,
  onTap,
  onBox,
}: {
  laid: Laid
  grid: TileGrid
  cells: Cell[]
  picked: Set<string>
  images: ProjectImage[]
  baseColor: string
  onTap: (c: Cell) => void
  onBox: (cells: Cell[]) => void
}) {
  const s = laid.surface
  const svgRef = useRef<SVGSVGElement>(null)
  const id = `tl${useId().replace(/[^\w-]/g, '')}`
  const fit = useMemo<View>(() => {
    const b = bbox(laid.frame)
    const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.05 + 10
    return { x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2 }
  }, [laid.frame])
  const [view, setView] = useState<View>(fit)
  const [box, setBox] = useState<{ a: Point; b: Point } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<
    | { kind: 'pick'; from: Point; client: { x: number; y: number }; moved: boolean }
    | { kind: 'pan'; client: { x: number; y: number }; view: View }
    | { kind: 'pinch'; d: number; mid: { x: number; y: number }; view: View }
    | null
  >(null)

  /** A screen point in surface coordinates, for a view. */
  const at = (cx: number, cy: number, v: View = view): Point => {
    const r = svgRef.current!.getBoundingClientRect()
    const k = Math.min(r.width / v.w, r.height / v.h)
    return { x: v.x + (cx - r.left - (r.width - v.w * k) / 2) / k, y: v.y + (cy - r.top - (r.height - v.h * k) / 2) / k }
  }
  const zoomAt = (p: Point, factor: number, v: View): View => {
    const w = Math.min(fit.w * 2, Math.max(fit.w / 30, v.w / factor))
    const k = w / v.w
    return { x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k, w, h: v.h * k }
  }
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const f = Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.003)
      setView((v) => zoomAt(at(e.clientX, e.clientY, v), f, v))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const down = (e: RPointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    e.currentTarget.setPointerCapture(e.pointerId)
    if (pointers.current.size === 2) {
      const [p, q] = [...pointers.current.values()]
      setBox(null)
      gesture.current = { kind: 'pinch', d: Math.hypot(p.x - q.x, p.y - q.y), mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, view }
      return
    }
    if (pointers.current.size > 2) return
    if (e.button === 1 || e.button === 2) gesture.current = { kind: 'pan', client: { x: e.clientX, y: e.clientY }, view }
    else gesture.current = { kind: 'pick', from: at(e.clientX, e.clientY), client: { x: e.clientX, y: e.clientY }, moved: false }
  }
  const move = (e: RPointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pinch' && pointers.current.size === 2) {
      const [p, q] = [...pointers.current.values()]
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
      const anchor = at(g.mid.x, g.mid.y, g.view)
      const v = zoomAt(anchor, Math.hypot(p.x - q.x, p.y - q.y) / Math.max(1, g.d), g.view)
      const now = at(mid.x, mid.y, v)
      setView({ ...v, x: v.x + anchor.x - now.x, y: v.y + anchor.y - now.y })
    } else if (g.kind === 'pan') {
      const a = at(g.client.x, g.client.y, g.view)
      const b = at(e.clientX, e.clientY, g.view)
      setView({ ...g.view, x: g.view.x - (b.x - a.x), y: g.view.y - (b.y - a.y) })
    } else if (g.kind === 'pick') {
      if (!g.moved && Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) < 6) return
      g.moved = true
      setBox({ a: g.from, b: at(e.clientX, e.clientY) })
    }
  }
  const up = (e: RPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (pointers.current.size) return
    gesture.current = null
    if (g?.kind !== 'pick') return
    const p = at(e.clientX, e.clientY)
    if (!g.moved) {
      onTap(cellAt(grid, toGrid(grid, p)))
      return
    }
    setBox(null)
    const x0 = Math.min(g.from.x, p.x)
    const x1 = Math.max(g.from.x, p.x)
    const y0 = Math.min(g.from.y, p.y)
    const y1 = Math.max(g.from.y, p.y)
    onBox(
      cells.filter((c) => {
        const m = cellCenter(grid, c)
        return m.x >= x0 && m.x <= x1 && m.y >= y0 && m.y <= y1
      }),
    )
  }

  const kinds = (s.mix?.length ?? 0) + 1
  const fillOf = (k: number) => {
    const st = tileStyle(s, k)
    return st.image && images.some((i) => i.id === st.image) ? `url(#${id}-t${k})` : (st.color ?? baseColor)
  }
  const joint = '#8a8a86'

  return (
    <div className="absolute inset-0">
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full touch-none select-none"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <clipPath id={`${id}-clip`}>
            {laid.areas.map((a, i) => (
              <path key={i} d={polygonPath(a)} />
            ))}
          </clipPath>
          {Array.from({ length: kinds }, (_, k) => {
            const st = tileStyle(s, k)
            const img = st.image ? images.find((i) => i.id === st.image) : undefined
            if (!img) return null
            // The photo along the tile's long side.
            const portrait = img.h > img.w * 1.05
            return (
              <pattern key={k} id={`${id}-t${k}`} patternContentUnits="objectBoundingBox" width="1" height="1">
                <image href={img.src} width="1" height="1" preserveAspectRatio="none" transform={portrait ? 'rotate(90 0.5 0.5)' : undefined} />
              </pattern>
            )
          })}
        </defs>
        {/* The whole floor or wall: doors and windows show as gaps in it. */}
        <path d={polygonPath(laid.frame)} className="fill-background stroke-muted-foreground" strokeWidth={1} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
        <g clipPath={`url(#${id}-clip)`}>
          <path d={polygonPath(laid.frame)} fill={joint} />
          <g transform={`translate(${grid.origin.x} ${grid.origin.y}) rotate(${grid.angle})`}>
            {cells.map((c) => {
              const key = cellKey(c)
              const r = cellRect(grid, c)
              return <rect key={key} x={r.x} y={r.y} width={r.w} height={r.h} fill={fillOf(tileIndex(s, key))} stroke={joint} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            })}
            {cells.map((c) => {
              const key = cellKey(c)
              if (!picked.has(key)) return null
              const r = cellRect(grid, c)
              return (
                <rect
                  key={`p${key}`}
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  className="fill-primary/35 stroke-primary"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              )
            })}
          </g>
        </g>
        {/* A wall's columns: where their corners fold, and which is their front. */}
        {laid.folds?.map((x, i) => {
          const b = bbox(laid.frame)
          return <line key={`f${i}`} x1={x} x2={x} y1={b.minY} y2={b.maxY} className="stroke-primary" strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        })}
        {laid.fronts?.map(([a, b], i) => {
          const top = bbox(laid.frame).minY
          const fs = Math.min(14, (b - a) * 0.28) // cm, to fit across its front
          return (
            <text
              key={`c${i}`}
              x={(a + b) / 2}
              y={top + fs * 1.3}
              fontSize={fs}
              textAnchor="middle"
              className="fill-primary stroke-background"
              strokeWidth={3}
              paintOrder="stroke"
              vectorEffect="non-scaling-stroke"
              fontWeight={600}
              pointerEvents="none"
            >
              {t('Column')}
            </text>
          )
        })}
        {/* A floor's outline (a wall's parts around its openings would show seams that aren't there). */}
        {laid.place === 'floor' && (
          <path d={polygonPath(laid.frame)} fill="none" className="stroke-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        )}
        {box && (
          <rect
            x={Math.min(box.a.x, box.b.x)}
            y={Math.min(box.a.y, box.b.y)}
            width={Math.abs(box.a.x - box.b.x)}
            height={Math.abs(box.a.y - box.b.y)}
            className="fill-primary/10 stroke-primary"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
      </svg>
      <div className="absolute end-2 bottom-2 flex items-center gap-0.5 rounded-lg border bg-background/95 p-0.5 shadow-sm" dir="ltr">
        <Button variant="ghost" size="icon" className="size-9" aria-label={t('Zoom out')} onClick={() => setView((v) => zoomAt({ x: v.x + v.w / 2, y: v.y + v.h / 2 }, 1 / 1.5, v))}>
          <ZoomOut />
        </Button>
        <Button variant="ghost" size="icon" className="size-9" aria-label={t('Zoom in')} onClick={() => setView((v) => zoomAt({ x: v.x + v.w / 2, y: v.y + v.h / 2 }, 1.5, v))}>
          <ZoomIn />
        </Button>
        <Button variant="ghost" size="icon" className="size-9" aria-label={t('Show it all')} onClick={() => setView(fit)}>
          <Maximize2 />
        </Button>
      </div>
    </div>
  )
}
