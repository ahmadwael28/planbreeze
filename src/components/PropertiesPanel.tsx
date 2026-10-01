import { useId } from 'react'
import type { ReactNode } from 'react'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalSpaceAround,
  AlignVerticalDistributeCenter,
  AlignVerticalSpaceAround,
  Box, ClipboardCopy, Copy, FlipHorizontal2, Group, Ungroup, FlipVertical2, ImageOff, Lightbulb, Link2Off, Lock, Ruler, RotateCw, SplitSquareHorizontal, Trash2, Video } from 'lucide-react'
import { toast } from 'sonner'
import { arrange, arrangeable, layoutOf, spacingOf, wouldMove } from '@/model/arrange'
import type { Unit } from '@/model/arrange'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { usePlanTheme } from '@/hooks/use-plan-theme'
import { cn } from '@/lib/utils'
import { area, dist, perimeter } from '@/model/geometry'
import { DEFAULT_RAILING, isOutdoor, OUTDOOR, RAILING_THICKNESS, ROOM_COLORS, roomOuter, setWallLength, symbolPose } from '@/model/project'
import { CABINETS, curtainLayers, frameOf, hasGlass, PENDANT_STYLES, SYMBOL_MAP } from '@/model/symbols'
import type { FrameColor } from '@/model/symbols'
import { formatArea, formatLength } from '@/model/units'
import type { Dimension, ItemRef, OutdoorKind, PlanSymbol, RailingStyle, Room, SavedView, Units } from '@/model/types'
import {
  arrangeSelection,
  autoDimension,
  centerSelection,
  copySelection,
  rotateSelection,
  selectionBox,
  currentFloor,
  deleteSelection,
  groupSelection,
  draftFloor,
  duplicateSelection,
  removeVertex,
  splitWall,
  useEditor,
  useFloor,
  useSelectedRoom,
  useSelectedSymbol,
} from '@/store/editor'
import { boxGaps, centeredPosition, openSides, wallGaps } from '@/model/guides'
import { isRound, resized, sizeRule } from '@/model/sizes'
import type { Dim } from '@/model/sizes'
import { useUi } from '@/store/ui'
import { LengthInput, NumberInput, TextInput } from './LengthInput'
import { CeilingSection, HiddenLightControls, LightSection, SwitchSection } from './LightingProps'

function Section({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3 px-4 py-4', className)}>
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="grid grid-cols-[104px_1fr] items-center gap-2">
      <Label htmlFor={id} className="font-normal text-muted-foreground">
        {label}
      </Label>
      <div className="min-w-0">{children(id)}</div>
    </div>
  )
}

function Stats({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-lg bg-muted/60 px-3 py-2.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border bg-muted px-1 font-mono text-[0.7rem] text-foreground">{children}</kbd>
}

function Actions() {
  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={duplicateSelection}>
        <Copy /> Duplicate
      </Button>
      <Button variant="destructive" size="sm" onClick={deleteSelection}>
        <Trash2 /> Delete
      </Button>
    </div>
  )
}

function updateRoom(id: string, recipe: (r: Room) => void) {
  useEditor.getState().commit((d) => {
    const r = draftFloor(d).rooms.find((x) => x.id === id)
    if (r) recipe(r)
  })
}

function RoomProps({ room, units }: { room: Room; units: Units }) {
  const theme = usePlanTheme()
  const selection = useEditor((s) => s.selection)
  const vertex = selection?.kind === 'room' ? selection.vertex : undefined
  const a = area(room.points)
  const balcony = isOutdoor(room)
  const defaultWall = useEditor((s) => s.project.defaultWallThickness)
  const setKind = (kind: OutdoorKind | null) =>
    useEditor.getState().commit((d) => {
      const f = draftFloor(d)
      const r = f.rooms.find((x) => x.id === room.id)
      if (!r) return
      if (kind) {
        if (r.kind !== kind) r.railing = { ...OUTDOOR[kind].railing }
        r.kind = kind
        r.wallThickness = RAILING_THICKNESS
        // Open to the sky: no gypsum ceiling or ceiling lights.
        r.ceiling = undefined
        r.shadowGaps = undefined
        f.symbols = f.symbols.filter((s) => s.room !== r.id)
      } else {
        r.kind = undefined
        r.wallThickness = defaultWall
      }
    })
  return (
    <>
      <Section title={room.kind ? OUTDOOR[room.kind].name : 'Room'}>
        <Field label="Name">
          {(id) => <TextInput id={id} value={room.name} onChange={(v) => updateRoom(room.id, (r) => void (r.name = v))} />}
        </Field>
        <Field label="Type">
          {() => (
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={room.kind ?? 'room'}
              onValueChange={(v) => v && setKind(v === 'room' ? null : (v as OutdoorKind))}
              className="w-full"
            >
              <ToggleGroupItem value="room" className="flex-1">
                Room
              </ToggleGroupItem>
              <ToggleGroupItem value="balcony" className="flex-1">
                Balcony
              </ToggleGroupItem>
              <ToggleGroupItem value="terrace" className="flex-1">
                Terrace
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </Field>
        {balcony && (
          <>
            <Field label="Railing">
              {() => (
                <Select
                  value={room.railing?.style ?? DEFAULT_RAILING.style}
                  onValueChange={(v) =>
                    updateRoom(room.id, (r) => {
                      r.railing = { ...(r.railing ?? DEFAULT_RAILING), style: v as RailingStyle }
                      // A parapet is a wall; railings are slim.
                      if (v === 'solid' && r.wallThickness < 10) r.wallThickness = 15
                      if (v !== 'solid' && r.wallThickness >= 10) r.wallThickness = RAILING_THICKNESS
                    })
                  }
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="glass">Glass panels</SelectItem>
                    <SelectItem value="metal">Metal balusters</SelectItem>
                    <SelectItem value="solid">Solid wall (parapet)</SelectItem>
                    <SelectItem value="none">No railing</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            {room.railing?.style !== 'none' && (
            <Field label="Railing height">
              {(id) => (
                <LengthInput
                  id={id}
                  value={room.railing?.height ?? DEFAULT_RAILING.height}
                  units={units}
                  min={30}
                  onChange={(v) => updateRoom(room.id, (r) => void (r.railing = { ...(r.railing ?? DEFAULT_RAILING), height: v }))}
                />
              )}
            </Field>
            )}
            <p className="text-xs text-muted-foreground">
              There's no railing where it meets the house. Put a door in the house wall to step out onto it.
            </p>
          </>
        )}
        <Field label="Floor color">
          {() => (
            <div className="flex flex-wrap gap-1.5">
              {ROOM_COLORS.map((c) => (
                <button
                  key={c}
                  className={cn(
                    'size-6 rounded-full border border-foreground/15 transition-transform hover:scale-110',
                    room.color === c && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                  )}
                  style={{ background: theme.tint(c) }}
                  onClick={() => updateRoom(room.id, (r) => void (r.color = c))}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          )}
        </Field>
        <Field label={balcony ? 'Railing thickness' : 'Wall thickness'}>
          {(id) => (
            <LengthInput
              id={id}
              value={room.wallThickness}
              units={units}
              min={1}
              onChange={(v) => updateRoom(room.id, (r) => void (r.wallThickness = v))}
            />
          )}
        </Field>
        <Stats
          rows={[
            ['Area', formatArea(a, units)],
            ['Perimeter', formatLength(perimeter(room.points), units)],
            ...(balcony ? [] : [['Wall area', formatArea(area(roomOuter(room)) - a, units)] as [string, string]]),
          ]}
        />
      </Section>
      <Separator />
      {!balcony && (
        <>
          <Section title="Gypsum ceiling">
            <CeilingSection room={room} units={units} />
          </Section>
          <Separator />
        </>
      )}
      <Section title="Walls">
        <ol className="space-y-1">
          {room.points.map((p, i) => {
            const q = room.points[(i + 1) % room.points.length]
            return (
              <li
                key={i}
                className={cn(
                  'grid grid-cols-[56px_1fr_auto] items-center gap-1.5 rounded-md px-1 py-0.5',
                  vertex === i && 'bg-primary/10',
                )}
              >
                <span className="text-sm text-muted-foreground">Wall {i + 1}</span>
                <LengthInput
                  value={dist(p, q)}
                  units={units}
                  onChange={(v) => updateRoom(room.id, (r) => void (r.points = setWallLength(r.points, i, v)))}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" onClick={() => splitWall(room.id, i)} aria-label="Split wall">
                      <SplitSquareHorizontal />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">Split wall (add a corner)</TooltipContent>
                </Tooltip>
              </li>
            )
          })}
        </ol>
        {vertex !== undefined && (
          <Button
            variant="outline"
            size="sm"
            disabled={room.points.length <= 3}
            onClick={() => removeVertex(room.id, vertex)}
          >
            Remove corner {vertex + 1}
          </Button>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Drag corners to reshape, drag the wall handles to move walls, double-click a wall handle to add a corner.
        </p>
      </Section>
      <Separator />
      <Section>
        <Actions />
      </Section>
    </>
  )
}

function updateSymbol(id: string, recipe: (s: PlanSymbol) => void) {
  useEditor.getState().commit((d) => {
    const s = draftFloor(d).symbols.find((x) => x.id === id)
    if (s) recipe(s)
  })
}

function CoveProps({ sym, units }: { sym: PlanSymbol; units: Units }) {
  const floor = useFloor()
  const room = floor.rooms.find((r) => r.id === sym.room)
  if (sym.type === 'gap-light' || sym.type === 'pocket-light') {
    const gap = sym.type === 'gap-light'
    return (
      <>
        <Section title={gap ? 'Shadow gap light' : 'Curtain pocket light'}>
          <p className="text-sm text-muted-foreground">
            An LED strip in the {gap ? 'shadow gap' : 'curtain pocket'} of <b className="text-foreground">{room?.name ?? 'the room'}</b>,{' '}
            {gap ? 'washing the walls below' : 'lighting the curtains'}. Choose the walls with a {gap ? 'gap' : 'pocket'} in the room's ceiling
            settings.
          </p>
          <LightSection sym={sym} units={units} />
        </Section>
        <Separator />
        <Section>
          <Button variant="destructive" size="sm" onClick={deleteSelection}>
            <Trash2 /> Delete
          </Button>
        </Section>
      </>
    )
  }
  return (
    <>
      <Section title="Cove / hidden light">
        <p className="text-sm text-muted-foreground">
          An LED strip hidden around the ceiling of <b className="text-foreground">{room?.name ?? 'the room'}</b>
          {room?.ceiling?.style === 'cove'
            ? ', inside the cove, washing the ceiling with light.'
            : room?.ceiling?.style === 'floating'
              ? ', on top of the floating panel, lighting the ceiling around it.'
              : sym.cove?.at === 'inner' && room && (room.ceiling?.style === 'tray' || room.ceiling?.style === 'stepped')
                ? ', inside the tray, lighting its raised middle.'
                : ', along the walls just below the ceiling.'}
        </p>
        {room && <HiddenLightControls room={room} sym={sym} units={units} />}
        <LightSection sym={sym} units={units} />
      </Section>
      <Separator />
      <Section>
        <Button variant="destructive" size="sm" onClick={deleteSelection}>
          <Trash2 /> Delete
        </Button>
      </Section>
    </>
  )
}

function DimensionProps({ dim, units }: { dim: Dimension; units: Units }) {
  return (
    <>
      <Section title="Dimension">
        <Stats rows={[['Length', formatLength(dist(dim.a, dim.b), units)]]} />
        <Field label="Distance out">
          {(id) => (
            <LengthInput
              id={id}
              value={Math.abs(dim.offset)}
              units={units}
              min={0}
              onChange={(v) =>
                useEditor.getState().commit((d) => {
                  const x = draftFloor(d).dimensions?.find((y) => y.id === dim.id)
                  if (x) x.offset = Math.sign(x.offset || 1) * v
                })
              }
            />
          )}
        </Field>
        <p className="text-xs text-muted-foreground">Drag the line to move it, or drag its end points onto other corners.</p>
      </Section>
      <Separator />
      <Section>
        <Button variant="destructive" size="sm" onClick={deleteSelection}>
          <Trash2 /> Delete
        </Button>
      </Section>
    </>
  )
}

/** Several items selected: what they are, and what can be done with all of them. */
/** Curtains and blinds: the fabric, a sheer behind, and how far open (one undo step per drag). */
function FabricControls({ sym }: { sym: PlanSymbol }) {
  const isBlind = sym.type === 'blind'
  const fabric = sym.fabric ?? (isBlind ? 'screen' : 'curtain')
  const open = sym.open ?? (isBlind ? 0 : 0.7)
  return (
    <>
      {isBlind ? (
        <Field label="Fabric">
          {() => (
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={fabric}
              onValueChange={(v) => v && updateSymbol(sym.id, (s) => void (s.fabric = v as NonNullable<PlanSymbol['fabric']>))}
              className="w-full"
            >
              {(['screen', 'blackout'] as const).map((f) => (
                <ToggleGroupItem key={f} value={f} className="flex-1 capitalize">
                  {f}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </Field>
      ) : (
        <Field label="Layers">
          {() => (
            <div className="space-y-1">
              <ToggleGroup
                type="multiple"
                size="sm"
                variant="outline"
                value={curtainLayers(sym)}
                // At least one layer: emptying it does nothing.
                onValueChange={(v) =>
                  v.length &&
                  updateSymbol(sym.id, (s) => {
                    s.layers = v as NonNullable<PlanSymbol['layers']>
                    delete s.sheer
                    delete s.fabric
                  })
                }
                className="w-full"
              >
                {(['sheer', 'curtain', 'blackout'] as const).map((f) => (
                  <ToggleGroupItem key={f} value={f} className="flex-1 capitalize">
                    {f}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">Any of them together, from the window out: sheer, blackout, curtain.</p>
            </div>
          )}
        </Field>
      )}
      <Field label={isBlind ? 'Rolled up' : 'Open'}>
        {() => (
          <div className="flex items-center gap-3">
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={[open]}
              onPointerDown={() => useEditor.getState().checkpoint()}
              onValueChange={([v]) =>
                useEditor.getState().mutate((d) => {
                  const s = draftFloor(d).symbols.find((x) => x.id === sym.id)
                  if (s) s.open = v
                })
              }
            />
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round(open * 100)}%</span>
          </div>
        )}
      </Field>
    </>
  )
}

/** Items with a choice of hinged or sliding doors, and which they have unless chosen. */
const DOOR_DEFAULT: Record<string, 'hinged' | 'sliding'> = {
  shower: 'hinged',
  'shower-quadrant': 'sliding',
  wardrobe: 'hinged',
  'wardrobe-corner': 'hinged',
}

/** Which sides of a shower have glass: by default the ones not against a wall, or chosen. */
function ShowerGlass({ sym }: { sym: PlanSymbol }) {
  const floor = useFloor()
  const auto = !sym.screens
  const sides = sym.screens ?? openSides(sym, floor.rooms)
  return (
    <Field label="Glass on">
      {(id) => (
        <div className="space-y-1">
          <ToggleGroup
            id={id}
            type="multiple"
            variant="outline"
            size="sm"
            className="w-full"
            value={sides}
            onValueChange={(v) => updateSymbol(sym.id, (s) => void (s.screens = v as NonNullable<PlanSymbol['screens']>))}
          >
            {(['front', 'left', 'right', 'back'] as const).map((s) => (
              <ToggleGroupItem key={s} value={s} className="flex-1 capitalize">
                {s}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            {auto ? (
              'Glass where there is no wall.'
            ) : (
              <>
                Chosen by hand.{' '}
                <button className="underline underline-offset-2 hover:text-foreground" onClick={() => updateSymbol(sym.id, (s) => void delete s.screens)}>
                  Follow the walls
                </button>
              </>
            )}
          </p>
        </div>
      )}
    </Field>
  )
}

/** Swatches for the frame finishes an item comes in, plus any custom color. */
function FramePicker({ sym, frames, label = 'Frame' }: { sym: PlanSymbol; frames: FrameColor[]; label?: string }) {
  const current = frameOf(sym) ?? frames[0]
  const custom = !frames.some((f) => f.hex === current.hex)
  const set = (hex: string) => updateSymbol(sym.id, (s) => void (s.frame = hex))
  const swatch = (f: FrameColor) => (f.metal ? `linear-gradient(135deg, ${f.hex} 20%, #ffffff 50%, ${f.hex} 80%)` : f.hex)
  const ring = 'ring-2 ring-primary ring-offset-2 ring-offset-background'
  return (
    <Field label={label}>
      {(id) => (
        <div id={id} className="flex flex-wrap items-center gap-2 py-1">
          {frames.map((f) => (
            <button
              key={f.hex}
              type="button"
              title={f.name}
              aria-label={`${f.name} frame`}
              aria-pressed={f.hex === current.hex}
              onClick={() => set(f.hex)}
              className={cn('size-6 rounded-full border shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', f.hex === current.hex && ring)}
              style={{ background: swatch(f) }}
            />
          ))}
          <label
            title="Custom color"
            className={cn('relative size-6 cursor-pointer overflow-hidden rounded-full border shadow-sm', custom && ring)}
            style={{ background: custom ? current.hex : 'conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)' }}
          >
            <input
              type="color"
              aria-label="Custom frame color"
              className="absolute inset-0 cursor-pointer opacity-0"
              value={current.hex}
              // One undo step for the whole pick, updated live while choosing.
              onPointerDown={() => useEditor.getState().checkpoint()}
              onChange={(e) => {
                const hex = e.target.value
                useEditor.getState().mutate((d) => {
                  const s = draftFloor(d).symbols.find((x) => x.id === sym.id)
                  if (s) s.frame = hex
                })
              }}
            />
          </label>
          <span className="text-xs text-muted-foreground">{current.name}</span>
        </div>
      )}
    </Field>
  )
}

/** Lining several pieces up in rows and spacing them evenly, e.g. spotlights down a corridor. */
function ArrangeBlock({ syms }: { syms: Unit[] }) {
  const floor = useFloor()
  const units = useEditor((s) => s.project.units)
  const layout = layoutOf(syms)
  const { dir, rows } = layout
  const sideways = Math.abs(dir.x) >= Math.abs(dir.y)
  const way = dir.y === 0 ? 'left to right' : dir.x === 0 ? 'top to bottom' : 'at an angle'
  const counts = rows.map((r) => r.length)
  const groups = syms.some((u) => u.group)
  const of = syms.every((u) => u.group) ? ' groups' : ''
  const rowsText =
    counts.length === 1
      ? `1 row of ${counts[0]}${of}`
      : counts.every((c) => c === counts[0])
        ? `${counts.length} rows of ${counts[0]}${of}`
        : `${counts.length} rows (${counts.join(' + ')})`
  const spacing = spacingOf(layout)
  const uneven = spacing && spacing.max - spacing.min > 0.5
  const canLine = wouldMove(syms, floor.rooms, 'line')
  const canEven = wouldMove(syms, floor.rooms, 'even')
  const inRoom = !!arrange(syms, floor.rooms, 'fill')
  const canFill = inRoom && wouldMove(syms, floor.rooms, 'fill')
  const LineIcon = sideways ? AlignCenterHorizontal : AlignCenterVertical
  const EvenIcon = sideways ? AlignHorizontalDistributeCenter : AlignVerticalDistributeCenter
  const FillIcon = sideways ? AlignHorizontalSpaceAround : AlignVerticalSpaceAround
  return (
    <div className="space-y-2 rounded-lg bg-muted/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">Arrange</p>
        <span className="truncate text-xs text-muted-foreground">
          {rowsText}, {way}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" disabled={!canLine} onClick={() => arrangeSelection('line')}>
          <LineIcon /> {canLine ? 'Line up' : 'Lined up'}
        </Button>
        <Button variant="outline" size="sm" disabled={!canEven} onClick={() => arrangeSelection('even')}>
          <EvenIcon /> {canEven ? 'Space evenly' : 'Even'}
        </Button>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={!canFill}
        title={inRoom ? undefined : 'They need to be inside a room'}
        onClick={() => arrangeSelection('fill')}
      >
        <FillIcon /> Spread over the room
      </Button>
      {spacing && (
        <Field label="Spacing">
          {(id) => (
            <LengthInput
              id={id}
              value={Math.round(spacing.avg * 10) / 10}
              units={units}
              min={1}
              onChange={(v) => arrangeSelection({ spacing: v })}
            />
          )}
        </Field>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {uneven && (
          <>
            Now {formatLength(spacing.min, units)} to {formatLength(spacing.max, units)} apart.{' '}
          </>
        )}
        {groups && 'Each group moves as one piece. '}Spacing is center to center. Spreading over the room leaves half a space at
        the walls, the usual layout for ceiling lights.
      </p>
    </div>
  )
}

function MultiProps({ items }: { items: ItemRef[] }) {
  const floor = useFloor()
  const count = (k: ItemRef['kind']) => items.filter((r) => r.kind === k).length
  const parts = [
    [count('room'), 'room'],
    [count('symbol'), 'item'],
    [count('dimension'), 'dimension'],
    [count('view'), 'saved view'],
  ]
    .filter(([n]) => n)
    .map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`)
  const groups = new Set(
    items.map((r) => {
      const x =
        r.kind === 'room'
          ? floor.rooms.find((y) => y.id === r.id)
          : r.kind === 'symbol'
            ? floor.symbols.find((y) => y.id === r.id)
            : r.kind === 'dimension'
              ? floor.dimensions?.find((y) => y.id === r.id)
              : floor.views?.find((y) => y.id === r.id)
      return x?.groupId ?? ''
    }),
  )
  const grouped = groups.size === 1 && !groups.has('')
  const units = useEditor((s) => s.project.units)
  const selection = useEditor((s) => s.selection)
  const { box, rooms } = selectionBox(floor, selection)
  const gaps = box ? boxGaps(box, rooms) : {}
  const across = gaps.left !== undefined && gaps.right !== undefined
  const depthwise = gaps.front !== undefined && gaps.back !== undefined
  const fmt = (v?: number) => (v === undefined ? '–' : formatLength(v, units))
  const free = arrangeable(floor, items)
  return (
    <>
      <Section title={`${items.length} selected`}>
        <p className="text-sm text-muted-foreground">{parts.join(', ')}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => rotateSelection(-90)}>
            <RotateCw className="-scale-x-100" /> 90°
          </Button>
          <Button variant="outline" size="sm" onClick={() => rotateSelection(90)}>
            <RotateCw /> 90°
          </Button>
          <span className="self-center text-xs text-muted-foreground">or drag the handle above them</span>
        </div>
        {free.length >= 2 && <ArrangeBlock syms={free} />}
        {(across || depthwise) && (
          <div className="space-y-2 rounded-lg bg-muted/60 p-3">
            <p className="text-sm font-medium">Position in the room</p>
            {(
              [
                ['Side to side', 'across', gaps.left, gaps.right, across],
                ['Top to bottom', 'depth', gaps.back, gaps.front, depthwise],
              ] as const
            ).map(([label, axis, a, b, ok]) => {
              const centered = ok && Math.abs(a! - b!) < 0.5
              return (
                <div key={axis} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="ml-2 tabular-nums">
                      {fmt(a)} · {fmt(b)}
                    </span>
                  </span>
                  <Button variant="outline" size="xs" disabled={!ok || centered} onClick={() => centerSelection(axis)}>
                    {centered ? 'Centered' : 'Center'}
                  </Button>
                </div>
              )
            })}
            {across && depthwise && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => centerSelection('both')}>
                <AlignHorizontalJustifyCenter /> Center in the room
              </Button>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {grouped ? (
            <Button variant="outline" size="sm" onClick={() => groupSelection(false)}>
              <Ungroup /> Ungroup
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => groupSelection(true)}>
              <Group /> Group
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={duplicateSelection}>
            <Copy /> Duplicate
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const n = copySelection()
              if (n) toast(`Copied ${n} items`, { description: 'Paste with Ctrl+V, on this floor or another.' })
            }}
          >
            <ClipboardCopy /> Copy
          </Button>
          <Button variant="destructive" size="sm" onClick={deleteSelection}>
            <Trash2 /> Delete
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Drag any of them to move them all, or use the arrow keys. {grouped ? 'Alt + click picks one item in the group.' : 'Group them to keep them together.'}{' '}
          Shortcuts: Ctrl+G group, Ctrl+Shift+G ungroup, Ctrl+C / X / V, Ctrl+D, Delete.
        </p>
      </Section>
    </>
  )
}

function ViewProps({ view, units }: { view: SavedView; units: Units }) {
  const update = (recipe: (v: SavedView) => void) =>
    useEditor.getState().commit((d) => {
      const v = draftFloor(d).views?.find((x) => x.id === view.id)
      if (v) recipe(v)
    })
  return (
    <>
      <Section
        title={
          <span className="flex items-center gap-2">
            <Video className="size-4" /> Saved 3D view
          </span>
        }
      >
        <Field label="Name">
          {(id) => (
            <TextInput
              id={id}
              value={view.name}
              onChange={(name) => {
                if (name.trim()) update((v) => (v.name = name.trim()))
              }}
            />
          )}
        </Field>
        <Field label="Eye height">
          {(id) => (
            <LengthInput
              id={id}
              value={view.eye.h}
              units={units}
              min={10}
              onChange={(h) =>
                update((v) => {
                  // Keep the camera's tilt: move what it looks at up or down by the same amount.
                  v.look = { ...v.look, h: v.look.h + h - v.eye.h }
                  v.eye = { ...v.eye, h }
                })
              }
            />
          )}
        </Field>
        <Button
          className="w-full"
          onClick={() => {
            useUi.getState().setPendingView(view.id)
            useEditor.getState().setViewMode('3d')
          }}
        >
          <Box /> Look from here in 3D
        </Button>
        <p className="text-xs text-muted-foreground">Drag the camera to move it, and its round handle to turn it. Arrow keys nudge it.</p>
      </Section>
      <Separator />
      <Section>
        <Button variant="destructive" size="sm" onClick={deleteSelection}>
          <Trash2 /> Delete
        </Button>
      </Section>
    </>
  )
}

function SymbolProps({ sym, units }: { sym: PlanSymbol; units: Units }) {
  const floor = useFloor()
  const def = SYMBOL_MAP.get(sym.type)
  const wallRoom = sym.wall ? floor.rooms.find((r) => r.id === sym.wall!.roomId) : undefined
  const pose = symbolPose(sym, floor.rooms)
  const isLabel = sym.type === 'label'
  // For a door or window: the wall's length and the gaps to its two ends.
  const wallLen =
    sym.wall && wallRoom
      ? dist(wallRoom.points[sym.wall.edge], wallRoom.points[(sym.wall.edge + 1) % wallRoom.points.length])
      : 0
  const wallOffset = sym.wall ? (wallLen < sym.width ? wallLen / 2 : Math.min(Math.max(sym.wall.offset, sym.width / 2), wallLen - sym.width / 2)) : 0
  const gapStart = wallOffset - sym.width / 2
  const gapEnd = wallLen - wallOffset - sym.width / 2
  const setOffset = (offset: number) => updateSymbol(sym.id, (s) => void (s.wall = s.wall && { ...s.wall, offset }))
  // For free-standing furniture: the gaps to the walls around it, to center it in the room.
  const free = !sym.wall && !sym.room && !def?.wallMount && !def?.wall
  const gaps = free ? wallGaps(sym, floor.rooms) : {}
  const across = gaps.left !== undefined && gaps.right !== undefined
  const depthwise = gaps.front !== undefined && gaps.back !== undefined
  const centerIn = (axis: 'across' | 'depth' | 'both') =>
    updateSymbol(sym.id, (s) => Object.assign(s, centeredPosition(s, floor.rooms, axis)))
  const fmt = (v?: number) => (v === undefined ? '–' : formatLength(v, units))
  return (
    <>
      <Section
        title={
          <span className="flex items-center gap-2">
            {def?.name ?? sym.type}
            {def && <Badge variant="secondary">{def.category}</Badge>}
          </span>
        }
      >
        {(isLabel || sym.label !== undefined) && (
          <Field label={def?.fixture === 'switch' ? 'Name' : 'Text'}>
            {(id) => (
              <TextInput id={id} value={sym.label ?? ''} onChange={(v) => updateSymbol(sym.id, (s) => void (s.label = v))} />
            )}
          </Field>
        )}
        {(
          [
            ['width', isRound(sym.type) ? 'Diameter' : 'Width', true],
            ['depth', isLabel ? 'Text size' : 'Depth', !sym.wall && !isRound(sym.type)],
            ['height', sym.type === 'gypsum-box' ? 'Drop' : def?.fixture === 'switch' ? 'Mount height' : 'Height', !isLabel && !def?.fullHeight],
          ] as [Dim, string, boolean][]
        ).map(([dim, label, shown]) => {
          if (!shown) return null
          const rule = sizeRule(sym.type, dim)
          return (
            <Field key={dim} label={label}>
              {(id) =>
                rule?.fixed ? (
                  <div id={id} className="flex h-8 items-center gap-1.5 text-sm tabular-nums">
                    {formatLength(rule.min, units)}
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="size-3" /> standard size
                    </span>
                  </div>
                ) : (
                  <LengthInput
                    id={id}
                    value={sym[dim]}
                    units={units}
                    onChange={(v) => {
                      if (rule && (v < rule.min || v > rule.max)) {
                        toast(`${def?.name ?? 'This item'}: ${label.toLowerCase()} ${formatLength(rule.min, units)} to ${formatLength(rule.max, units)}`, {
                          description: 'Kept to a size it comes in.',
                        })
                      }
                      updateSymbol(sym.id, (s) => void Object.assign(s, resized(s, { [dim]: v })))
                    }}
                  />
                )
              }
            </Field>
          )
        })}
        {def?.fullHeight && <p className="text-xs text-muted-foreground">Floor to ceiling, whatever the room's height.</p>}
        {sym.type === 'shower' && <ShowerGlass sym={sym} />}
        {sym.type === 'pendant' && (
          <Field label="Style">
            {(id) => (
              <Select value={sym.style ?? PENDANT_STYLES[0].id} onValueChange={(v) => updateSymbol(sym.id, (s) => void (s.style = v))}>
                <SelectTrigger id={id} size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['Modern', 'Classic', 'Industrial'] as const).map((kind) => (
                    <SelectGroup key={kind}>
                      <SelectLabel>{kind}</SelectLabel>
                      {PENDANT_STYLES.filter((p) => p.kind === kind).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        )}
        {(sym.type === 'curtain' || sym.type === 'blind') && <FabricControls sym={sym} />}
        {CABINETS.has(sym.type) && (
          <div className="space-y-3 rounded-lg bg-muted/60 p-3">
            {sym.type !== 'coffee-corner' && (
              <label className="flex items-center justify-between gap-2 text-sm">
                <span>Glass doors</span>
                <Switch size="sm" checked={hasGlass(sym)} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (s.glass = on))} />
              </label>
            )}
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5">
                <Lightbulb className="size-4" /> LED lighting inside
              </span>
              <Switch size="sm" checked={!!sym.led} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (s.led = on || undefined))} />
            </label>
            {sym.led && <LightSection sym={sym} units={units} />}
          </div>
        )}
        {def?.frames && <FramePicker sym={sym} frames={def.frames} label={def.frameLabel} />}
        {def?.sill !== undefined && (
          <Field label="Sill height">
            {(id) => (
              <LengthInput
                id={id}
                value={sym.elevation ?? def.sill ?? 0}
                units={units}
                min={0}
                onChange={(v) => updateSymbol(sym.id, (s) => void (s.elevation = v))}
              />
            )}
          </Field>
        )}
        {def?.elevation !== undefined && !def.fixture && !def.wallMount && (
          <Field label="Above the floor">
            {(id) => (
              <LengthInput
                id={id}
                value={sym.elevation ?? def.elevation ?? 0}
                units={units}
                min={0}
                onChange={(v) => updateSymbol(sym.id, (s) => void (s.elevation = v))}
              />
            )}
          </Field>
        )}
        {free && (across || depthwise) && (
          <div className="space-y-2 rounded-lg bg-muted/60 p-3">
            <p className="text-sm font-medium">Position in the room</p>
            {(
              [
                ['Side to side', 'across', gaps.left, gaps.right, across],
                ['Front to back', 'depth', gaps.back, gaps.front, depthwise],
              ] as const
            ).map(([label, axis, a, b, ok]) => {
              const centered = ok && Math.abs(a! - b!) < 0.5
              return (
                <div key={axis} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="ml-2 tabular-nums">
                      {fmt(a)} · {fmt(b)}
                    </span>
                  </span>
                  <Button variant="outline" size="xs" disabled={!ok || centered} onClick={() => centerIn(axis)}>
                    {centered ? 'Centered' : 'Center'}
                  </Button>
                </div>
              )
            })}
            {across && depthwise && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => centerIn('both')}>
                <AlignHorizontalJustifyCenter /> Center in the room
              </Button>
            )}
            <p className="text-xs text-muted-foreground">Gaps to the nearest wall on each side. Dragging near the middle snaps to it.</p>
          </div>
        )}
        {DOOR_DEFAULT[sym.type] && (
          <Field label="Doors">
            {() => (
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={sym.doors ?? DOOR_DEFAULT[sym.type]}
                onValueChange={(v) => v && updateSymbol(sym.id, (s) => void (s.doors = v as 'hinged' | 'sliding'))}
                className="w-full"
              >
                <ToggleGroupItem value="hinged" className="flex-1">
                  Hinged
                </ToggleGroupItem>
                <ToggleGroupItem value="sliding" className="flex-1">
                  Sliding
                </ToggleGroupItem>
              </ToggleGroup>
            )}
          </Field>
        )}
        {sym.type.startsWith('wardrobe') && (
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Glass doors</span>
            <Switch size="sm" checked={!!sym.glass} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (s.glass = on || undefined))} />
          </label>
        )}
        {(sym.type === 'sofa-corner' || sym.type === 'wardrobe-corner') && (
          <Field label="Corner on">
            {() => (
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={sym.flipX ? 'right' : 'left'}
                onValueChange={(v) => v && updateSymbol(sym.id, (s) => void (s.flipX = v === 'right'))}
                className="w-full"
              >
                <ToggleGroupItem value="left" className="flex-1">
                  Left
                </ToggleGroupItem>
                <ToggleGroupItem value="right" className="flex-1">
                  Right
                </ToggleGroupItem>
              </ToggleGroup>
            )}
          </Field>
        )}
        {!sym.wall && (
          <Field label="Rotation">
            {(id) => (
              <NumberInput
                id={id}
                value={sym.rotation}
                step={15}
                suffix="°"
                onChange={(v) => updateSymbol(sym.id, (s) => void (s.rotation = ((v % 360) + 360) % 360))}
              />
            )}
          </Field>
        )}
        <div className="flex flex-wrap gap-2">
          {!sym.wall && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateSymbol(sym.id, (s) => void (s.rotation = (s.rotation + 90) % 360))}
            >
              <RotateCw /> 90°
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => updateSymbol(sym.id, (s) => void (s.flipX = !s.flipX))}>
            <FlipHorizontal2 /> {sym.wall ? 'Hinge side' : 'Mirror'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => updateSymbol(sym.id, (s) => void (s.flipY = !s.flipY))}>
            <FlipVertical2 /> {sym.wall ? 'Swing side' : 'Flip front/back'}
          </Button>
        </div>
        {sym.wall && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm">
            <span>
              In wall {sym.wall.edge + 1} of <b>{wallRoom?.name ?? 'room'}</b>
            </span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() =>
                updateSymbol(sym.id, (s) => {
                  s.wall = undefined
                  s.x = pose.x
                  s.y = pose.y
                  s.rotation = pose.rotation
                })
              }
            >
              <Link2Off /> Detach
            </Button>
          </div>
        )}
        {sym.wall && wallLen > 0 && (
          <div className="space-y-2">
            <Field label="Gap to wall start">
              {(id) => (
                <LengthInput id={id} value={Math.max(0, gapStart)} units={units} min={0} onChange={(v) => setOffset(v + sym.width / 2)} />
              )}
            </Field>
            <Field label="Gap to wall end">
              {(id) => (
                <LengthInput id={id} value={Math.max(0, gapEnd)} units={units} min={0} onChange={(v) => setOffset(wallLen - v - sym.width / 2)} />
              )}
            </Field>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={Math.abs(gapStart - gapEnd) < 0.5}
              onClick={() => setOffset(wallLen / 2)}
            >
              <AlignHorizontalJustifyCenter /> {Math.abs(gapStart - gapEnd) < 0.5 ? 'Centered on the wall' : 'Center on wall'}
            </Button>
          </div>
        )}
        {def?.wall && !sym.wall && <p className="text-xs text-muted-foreground">Drag it onto a wall to insert it.</p>}
      </Section>
      {def?.fixture && (
        <>
          <Separator />
          <Section title={def.fixture === 'switch' ? 'Switch wiring' : 'Light'}>
            {def.fixture === 'switch' ? <SwitchSection sym={sym} /> : <LightSection sym={sym} units={units} />}
          </Section>
        </>
      )}
      <Separator />
      <Section>
        <Actions />
      </Section>
    </>
  )
}

function FloorAndProjectProps() {
  const project = useEditor((s) => s.project)
  const floor = useFloor()
  const commit = useEditor((s) => s.commit)
  return (
    <>
      <Section title="Floor">
        <Field label="Name">
          {(id) => (
            <TextInput
              id={id}
              value={floor.name}
              onChange={(v) =>
                commit((d) => {
                  draftFloor(d).name = v
                })
              }
            />
          )}
        </Field>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const n = autoDimension()
            toast(n ? 'Added overall dimensions.' : 'Overall dimensions are already there (or the floor is empty).')
          }}
        >
          <Ruler /> Add overall dimensions
        </Button>
        <Field label="Wall height">
          {(id) => (
            <LengthInput
              id={id}
              value={floor.height}
              units={project.units}
              onChange={(v) =>
                commit((d) => {
                  draftFloor(d).height = v
                })
              }
            />
          )}
        </Field>
      </Section>
      {floor.underlay && (
        <>
          <Separator />
          <Section title="Background drawing">
            <label className="flex items-center justify-between text-sm">
              Show while editing
              <Switch
                checked={floor.underlay.visible}
                onCheckedChange={(v) =>
                  commit((d) => {
                    const u = draftFloor(d).underlay
                    if (u) u.visible = v
                  })
                }
              />
            </label>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Opacity</span>
                <span className="tabular-nums">{Math.round(floor.underlay.opacity * 100)}%</span>
              </div>
              <Slider
                min={0.1}
                max={1}
                step={0.05}
                value={[floor.underlay.opacity]}
                onValueChange={([v]) =>
                  useEditor.getState().mutate((d) => {
                    const u = draftFloor(d).underlay
                    if (u) u.opacity = v
                  })
                }
              />
            </div>
            <p className="text-xs text-muted-foreground">Only shown while editing. It isn't exported or shown in 3D.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                commit((d) => {
                  draftFloor(d).underlay = undefined
                })
              }
            >
              <ImageOff /> Remove drawing
            </Button>
          </Section>
        </>
      )}
      <Separator />
      <Section title="Project">
        <Field label="Name">
          {(id) => <TextInput id={id} value={project.name} onChange={(v) => commit((d) => void (d.name = v))} />}
        </Field>
        <Field label="Units">
          {(id) => (
            <Select value={project.units} onValueChange={(v) => commit((d) => void (d.units = v as Units))}>
              <SelectTrigger id={id} className="w-full" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="metric">Metric (m, cm)</SelectItem>
                <SelectItem value="imperial">Imperial (ft, in)</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Default wall">
          {(id) => (
            <LengthInput
              id={id}
              value={project.defaultWallThickness}
              units={project.units}
              min={1}
              onChange={(v) => commit((d) => void (d.defaultWallThickness = v))}
            />
          )}
        </Field>
      </Section>
      <Separator />
      <Section title="Getting started">
        <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
          <li>
            Press <Kbd>R</Kbd> and drag to draw a rectangular room, or <Kbd>P</Kbd> to click out any shape.
          </li>
          <li>
            While drawing, type a length (e.g. <Kbd>3.5</Kbd>) and press <Kbd>Enter</Kbd> for exact walls.
          </li>
          <li>Add doors, windows and furniture from the Library tab.</li>
          <li>Scroll to zoom, drag empty space to pan, switch to 3D at the top.</li>
        </ul>
      </Section>
    </>
  )
}

export function PropertiesPanel() {
  const units = useEditor((s) => s.project.units)
  const multi = useEditor((s) => (s.selection?.kind === 'multi' ? s.selection.items : null))
  const room = useSelectedRoom()
  const sym = useSelectedSymbol()
  const dim = useEditor((s) => {
    const sel = s.selection
    return sel?.kind === 'dimension' ? currentFloor(s).dimensions?.find((d) => d.id === sel.id) : undefined
  })
  const view = useEditor((s) => {
    const sel = s.selection
    return sel?.kind === 'view' ? currentFloor(s).views?.find((v) => v.id === sel.id) : undefined
  })
  if (multi) return <MultiProps items={multi} />
  if (room) return <RoomProps room={room} units={units} />
  if (sym?.room) return <CoveProps sym={sym} units={units} />
  if (sym) return <SymbolProps sym={sym} units={units} />
  if (dim) return <DimensionProps dim={dim} units={units} />
  if (view) return <ViewProps view={view} units={units} />
  return <FloorAndProjectProps />
}
