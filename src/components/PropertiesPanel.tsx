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
  Box, CircleHelp, ClipboardCopy, Sparkles, Columns2, Copy, Sofa, FlipHorizontal2, Group, Ungroup, FlipVertical2, ImageOff, Lightbulb, Link2Off, Lock, Ruler, RotateCw, SplitSquareHorizontal, Trash2, Video } from 'lucide-react'
import { toast } from 'sonner'
import { arrange, arrangeable, layoutOf, spacingOf, wouldMove } from '@/model/arrange'
import type { Unit } from '@/model/arrange'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { startTour } from '@/components/tour'
import { ROOM_USES } from '@/model/design'
import { redesignRoom, useDesign } from '@/store/design'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { usePlanTheme } from '@/hooks/use-plan-theme'
import { cn } from '@/lib/utils'
import { area, dist, perimeter, pointInPolygon } from '@/model/geometry'
import { DEFAULT_RAILING, isOutdoor, OUTDOOR, RAILING_THICKNESS, ROOM_COLORS, roomOuter, setWallLength, symbolPose } from '@/model/project'
import { CABINETS, curtainLayers, frameOf, givesLight, hasGlass, SKIN_TONES, STYLES, styleOf, SYMBOL_MAP, tvInches, tvSize, WORKTOPS, worktopOf, hasWorktop } from '@/model/symbols'
import type { Worktop } from '@/model/symbols'
import type { FrameColor } from '@/model/symbols'
import { formatArea, formatLength } from '@/model/units'
import { PERSON, PERSON_PRESETS, personLook, personSupport, POSE_NAMES } from '@/model/people'
import type { Dimension, ItemRef, OutdoorKind, PlanSymbol, RailingStyle, Room, RoomUse, SavedView, Units } from '@/model/types'
import {
  arrangeSelection,
  autoDimension,
  centerSelection,
  convertColumns,
  placeBehindSofa,
  updatePerson,
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
import { CeilingSection, GroupLightSection, GrooveLightWalls, HiddenLightControls, LightSection, SwitchSection } from './LightingProps'
import { Choice } from './Choice'
import { FloorSection, WallsSection } from './FinishProps'

function Section({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3 px-4 py-4', className)}>
      {action ? (
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          {action}
        </div>
      ) : (
        title && <h3 className="text-sm font-semibold">{title}</h3>
      )}
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

/** A swatch suggesting a worktop: marble's veins, the flecks of quartz and granite, a wooden block's staves. */
function worktopSwatch(w: Worktop) {
  switch (w.kind) {
    case 'marble':
      return `linear-gradient(125deg, ${w.color} 30%, ${w.vein} 36%, ${w.color} 41%, ${w.color} 62%, ${w.vein} 66%, ${w.color} 70%)`
    case 'wood':
      return `repeating-linear-gradient(90deg, ${w.color} 0 5px, color-mix(in srgb, ${w.color} 80%, black) 5px 6px)`
    case 'concrete':
      return `radial-gradient(circle at 30% 35%, color-mix(in srgb, ${w.color} 80%, white), ${w.color} 70%)`
    default:
      return `radial-gradient(circle, color-mix(in srgb, ${w.color} 40%, white) 1px, transparent 1.4px) 0 0 / 5px 5px, radial-gradient(circle, color-mix(in srgb, ${w.color} 60%, black) 1px, transparent 1.4px) 2px 3px / 6px 6px, ${w.color}`
  }
}

/** The worktop of a kitchen unit (or island, or a vanity's stone top), and putting the same on every one in its room. */
function WorktopPicker({ sym }: { sym: PlanSymbol }) {
  const floor = useFloor()
  const current = worktopOf(sym)
  const room = floor.rooms.find((r) => pointInPolygon(sym, r.points))
  const others = room ? floor.symbols.filter((s) => s.id !== sym.id && hasWorktop(s) && pointInPolygon(s, room.points) && worktopOf(s).id !== current.id) : []
  const ring = 'ring-2 ring-primary ring-offset-2 ring-offset-background'
  return (
    <>
      <Field label="Worktop">
        {(id) => (
          <div id={id} className="flex flex-wrap items-center gap-1.5 py-1">
            {WORKTOPS.map((w) => (
              <button
                key={w.id}
                type="button"
                title={w.name}
                aria-label={w.name}
                aria-pressed={w.id === current.id}
                onClick={() => updateSymbol(sym.id, (s) => void (s.top = w.id))}
                className={cn('size-6 rounded-md border shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', w.id === current.id && ring)}
                style={{ background: worktopSwatch(w) }}
              />
            ))}
          </div>
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-x-2 pl-[112px] text-xs text-muted-foreground">
        {current.name}
        {room && others.length > 0 && (
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 text-xs"
            onClick={() =>
              useEditor.getState().commit((d) => {
                const ids = new Set(others.map((s) => s.id))
                for (const s of draftFloor(d).symbols) if (ids.has(s.id)) s.top = current.id
              })
            }
          >
            Use it for every worktop in {room.name}
          </Button>
        )}
      </div>
    </>
  )
}

const TV_SIZES = [43, 50, 55, 65, 75, 85]

/** A TV's screen size in inches (its diagonal): setting it sets its width and height. */
function TvSize({ sym }: { sym: PlanSymbol }) {
  const inches = tvInches(sym.width)
  const set = (v: number) => {
    const n = Math.min(110, Math.max(22, Math.round(v)))
    if (n !== Math.round(v)) toast('TVs here go from 22″ to 110″')
    updateSymbol(sym.id, (s) => void Object.assign(s, tvSize(n)))
  }
  return (
    <>
      <Field label="Screen size">{(id) => <NumberInput id={id} value={inches} step={1} suffix="″" onChange={set} />}</Field>
      <div className="flex flex-wrap gap-1 pl-[112px]">
        {TV_SIZES.map((n) => (
          <Button key={n} variant={n === inches ? 'secondary' : 'outline'} size="xs" className="tabular-nums" onClick={() => set(n)}>
            {n}″
          </Button>
        ))}
      </div>
    </>
  )
}

/** Kept as it is (where it is) when rooms are designed. */
function KeepSwitch({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-1.5">
        <Lock className="size-3.5 text-muted-foreground" /> Keep when designing
      </span>
      <Switch size="sm" checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

/** What a room is for, and a design suggested for it (the next idea each time). */
function RoomUseControls({ room }: { room: Room }) {
  const tried = useDesign((s) => room.id in s.variants)
  return (
    <>
      <Field label="Used as">
        {(id) => (
          <Select value={room.use ?? 'none'} onValueChange={(v) => updateRoom(room.id, (r) => void (v === 'none' ? delete r.use : (r.use = v as RoomUse)))}>
            <SelectTrigger id={id} size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not set</SelectItem>
              {ROOM_USES.filter((u) => u.id !== 'balcony').map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Button variant="outline" size="sm" className="w-full" onClick={() => redesignRoom(room.id)}>
        <Sparkles className="text-primary" /> {tried ? 'Another idea' : 'Suggest a design'}
      </Button>
    </>
  )
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
      <Section
        title={room.kind ? OUTDOOR[room.kind].name : 'Room'}
        action={
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              // Fly into the room, standing in its far corner looking across it (not tinted as selected).
              useUi.getState().setPendingView(`room:${room.id}`)
              useEditor.getState().select(null)
              useEditor.getState().setViewMode('3d')
            }}
          >
            <Box /> View in 3D
          </Button>
        }
      >
        <Field label="Name">
          {(id) => <TextInput id={id} value={room.name} onChange={(v) => updateRoom(room.id, (r) => void (r.name = v))} />}
        </Field>
        <Choice
          label="Type"
          value={room.kind ?? 'room'}
          onChange={(v) => setKind(v === 'room' ? null : v)}
          options={[
            { value: 'room', label: 'Room' },
            { value: 'balcony', label: 'Balcony' },
            { value: 'terrace', label: 'Terrace' },
          ]}
        />
        {!balcony && <RoomUseControls room={room} />}
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
        <FloorSection room={room} units={units} />
        <Field label={room.floor ? 'Plan color' : 'Floor color'}>
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
      {!balcony && (
        <>
          <Section title="Wall finishes">
            <WallsSection room={room} units={units} />
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
            {gap ? 'washing the walls below' : 'lighting the curtains'}. The room's ceiling settings choose the walls with a{' '}
            {gap ? 'gap' : 'pocket'}; here, which of them have light.
          </p>
          {room && <GrooveLightWalls room={room} sym={sym} units={units} />}
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
        <Choice
          label="Fabric"
          value={fabric}
          onChange={(v) => updateSymbol(sym.id, (s) => void (s.fabric = v))}
          options={[
            { value: 'screen', label: 'Screen' },
            { value: 'blackout', label: 'Blackout' },
          ]}
        />
      ) : (
        <Choice
          multiple
          label="Layers"
          value={curtainLayers(sym)}
          // At least one layer: emptying it does nothing.
          onChange={(v) =>
            v.length > 0 &&
            updateSymbol(sym.id, (s) => {
              s.layers = v
              delete s.sheer
              delete s.fabric
            })
          }
          options={[
            { value: 'sheer', label: 'Sheer' },
            { value: 'curtain', label: 'Curtain' },
            { value: 'blackout', label: 'Blackout' },
          ]}
        >
          <p className="text-xs text-muted-foreground">Any of them together, from the window out: sheer, blackout, curtain.</p>
        </Choice>
      )}
      {!isBlind && (
        <Choice
          label="Opens to"
          value={sym.openSide ?? 'both'}
          onChange={(v) => updateSymbol(sym.id, (s) => void (s.openSide = v === 'both' ? undefined : v))}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'both', label: 'Both sides' },
            { value: 'right', label: 'Right' },
          ]}
        />
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
    <Choice
      multiple
      label="Glass on"
      value={sides}
      onChange={(v) => updateSymbol(sym.id, (s) => void (s.screens = v))}
      options={[
        { value: 'front', label: 'Front' },
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
        { value: 'back', label: 'Back' },
      ]}
    >
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
    </Choice>
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
  // Everything selected but doors and windows can be kept as it is when designing.
  const keepable = items.flatMap((r) => (r.kind === 'symbol' ? floor.symbols.filter((s) => s.id === r.id && !s.wall && !s.room) : []))
  const symbolIds = items.filter((r) => r.kind === 'symbol').map((r) => r.id)
  const lit = floor.symbols.some((s) => symbolIds.includes(s.id) && givesLight(s))
  const columns = floor.symbols.filter((s) => symbolIds.includes(s.id) && s.type === 'column').length
  const inWalls = floor.symbols.filter((s) => symbolIds.includes(s.id) && s.type === 'wall-post').length
  const convert = (into: 'wall' | 'free', of: number) => {
    const n = convertColumns(symbolIds, into)
    if (into === 'wall' && n < of) toast(`Built ${n} of ${of} columns into the walls`, { description: 'The others have no wall near them.' })
  }
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
        {keepable.length > 0 && (
          <KeepSwitch
            checked={keepable.every((s) => s.keep)}
            onChange={(on) =>
              useEditor.getState().commit((d) => {
                const ids = new Set(keepable.map((s) => s.id))
                for (const s of draftFloor(d).symbols) {
                  if (!ids.has(s.id)) continue
                  if (on) s.keep = true
                  else delete s.keep
                }
              })
            }
          />
        )}
        {(columns > 0 || inWalls > 0) && (
          <div className="flex flex-wrap gap-2">
            {columns > 0 && (
              <Button variant="outline" size="sm" onClick={() => convert('wall', columns)}>
                <Columns2 /> Build {columns === 1 ? 'the column' : `${columns} columns`} into the walls
              </Button>
            )}
            {inWalls > 0 && (
              <Button variant="outline" size="sm" onClick={() => convert('free', inWalls)}>
                <Columns2 /> Make {inWalls === 1 ? 'the wall column' : `${inWalls} wall columns`} free-standing
              </Button>
            )}
          </div>
        )}
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
      {lit && (
        <>
          <Separator />
          <Section title="Lights">
            <GroupLightSection ids={symbolIds} />
          </Section>
        </>
      )}
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
            useUi.getState().setPendingView(`saved:${view.id}`)
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

/** A person's height and shoulder width (or a typical person's), and whether they stand, sit or lie, and on what. */
function PersonControls({ sym, units }: { sym: PlanSymbol; units: Units }) {
  const floor = useFloor()
  const pose = sym.pose ?? 'stand'
  const on = personSupport(sym, floor.symbols)
  const preset = PERSON_PRESETS.find((p) => p.height === sym.height && p.width === sym.width)
  const clampTo = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {PERSON_PRESETS.map((p) => (
          <Button
            key={p.name}
            variant={preset === p ? 'secondary' : 'outline'}
            size="xs"
            aria-pressed={preset === p}
            onClick={() => updatePerson(sym.id, { height: p.height, width: p.width })}
          >
            {p.name} · {formatLength(p.height, units)}
          </Button>
        ))}
      </div>
      <Field label="Height">
        {(id) => (
          <LengthInput
            id={id}
            value={sym.height}
            units={units}
            min={PERSON.minHeight}
            onChange={(v) => updatePerson(sym.id, { height: clampTo(v, PERSON.minHeight, PERSON.maxHeight) })}
          />
        )}
      </Field>
      <Field label="Shoulders">
        {(id) => (
          <LengthInput
            id={id}
            value={sym.width}
            units={units}
            min={PERSON.minWidth}
            onChange={(v) => updatePerson(sym.id, { width: clampTo(v, PERSON.minWidth, PERSON.maxWidth) })}
          />
        )}
      </Field>
      <Field label="Skin">
        {() => (
          <div className="flex flex-wrap items-center gap-1.5 py-1">
            {SKIN_TONES.map((c) => {
              const on = personLook(sym).skin === c.hex
              return (
                <button
                  key={c.hex}
                  type="button"
                  title={c.name}
                  aria-label={`Skin: ${c.name}`}
                  aria-pressed={on}
                  onClick={() => updateSymbol(sym.id, (s) => void (s.style = c.hex))}
                  className={cn('size-6 rounded-full border shadow-sm', on && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}
                  style={{ background: c.hex }}
                />
              )
            })}
          </div>
        )}
      </Field>
      <Choice
        label="Pose"
        value={pose}
        onChange={(v) => updatePerson(sym.id, { pose: v })}
        options={(['stand', 'sit', 'lie'] as const).map((p) => ({ value: p, label: POSE_NAMES[p] }))}
      >
        <p className="text-xs text-muted-foreground">
          {pose === 'stand'
            ? 'Drag them onto a chair, sofa or bed and pick sitting or lying: they settle onto it.'
            : on
              ? `${POSE_NAMES[pose]} on the ${on.name}, ${formatLength(on.height, units)} up. Drag them to another spot on it.`
              : `${POSE_NAMES[pose]} on the floor. Drag them onto ${pose === 'sit' ? 'a chair, sofa, bed or toilet' : 'a bed or sofa'} to ${pose === 'sit' ? 'sit' : 'lie'} on it.`}
        </p>
      </Choice>
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
        {sym.type === 'person' && <PersonControls sym={sym} units={units} />}
        {(isLabel || sym.label !== undefined) && (
          <Field label={def?.fixture === 'switch' ? 'Name' : 'Text'}>
            {(id) => (
              <TextInput id={id} value={sym.label ?? ''} onChange={(v) => updateSymbol(sym.id, (s) => void (s.label = v))} />
            )}
          </Field>
        )}
        {sym.type === 'tv' && <TvSize sym={sym} />}
        {(
          [
            ['width', isRound(sym.type) ? 'Diameter' : 'Width', true],
            ['depth', isLabel ? 'Text size' : 'Depth', !sym.wall && !isRound(sym.type)],
            ['height', sym.type === 'gypsum-box' ? 'Drop' : def?.fixture === 'switch' ? 'Mount height' : 'Height', !isLabel && !def?.fullHeight],
          ] as [Dim, string, boolean][]
        ).map(([dim, label, shown]) => {
          if (!shown || sym.type === 'person') return null
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
        {STYLES[sym.type] && (
          <Field label="Style">
            {(id) => (
              <Select
                value={styleOf(sym)}
                onValueChange={(v) =>
                  updateSymbol(sym.id, (s) => {
                    s.style = v
                    // Made as tall as it usually is in that style (a slim hood, a tall mantel one).
                    const height = STYLES[s.type].find((p) => p.id === v)?.height
                    if (height) s.height = height
                  })
                }
              >
                <SelectTrigger id={id} size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['Modern', 'Classic', 'Industrial'] as const)
                    .filter((kind) => STYLES[sym.type].some((p) => p.kind === kind))
                    .map((kind) => (
                    <SelectGroup key={kind}>
                      <SelectLabel>{kind}</SelectLabel>
                      {STYLES[sym.type].filter((p) => p.kind === kind).map((p) => (
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
        {sym.type === 'shower-niche' && (
          <div className="space-y-3 rounded-lg bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">Recessed into the wall and lined with the wall's finish (its tiles, if it's tiled).</p>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>Glass shelf</span>
              <Switch size="sm" checked={!!sym.shelf} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (s.shelf = on || undefined))} />
            </label>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5">
                <Lightbulb className="size-4" /> LED strip
              </span>
              <Switch size="sm" checked={!!sym.led} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (s.led = on || undefined))} />
            </label>
            {sym.led && <LightSection sym={sym} units={units} />}
          </div>
        )}
        {sym.type === 'oven-tower' && (
          <Choice
            label="Built in"
            value={sym.appliances ?? 'micro'}
            onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'micro' ? delete s.appliances : (s.appliances = v as 'oven' | 'two-ovens')))}
            options={[
              { value: 'micro', label: 'Oven + microwave' },
              { value: 'oven', label: 'Oven' },
              { value: 'two-ovens', label: 'Two ovens' },
            ]}
          />
        )}
        {sym.type === 'kitchen-island' && (
          <div className="space-y-3 rounded-lg bg-muted/60 p-3">
            <Choice
              label="In the top"
              value={sym.islandTop ?? 'none'}
              onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'none' ? delete s.islandTop : (s.islandTop = v as 'hob' | 'sink')))}
              options={[
                { value: 'none', label: 'Nothing' },
                { value: 'hob', label: 'Hob' },
                { value: 'sink', label: 'Sink' },
              ]}
            />
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>Stools</span>
              <Switch size="sm" checked={sym.stool !== false} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (on ? delete s.stool : (s.stool = false)))} />
            </label>
          </div>
        )}
        {sym.type === 'wall-cabinet' && (
          <div className="space-y-3 rounded-lg bg-muted/60 p-3">
            <Choice
              label="Fronts"
              value={sym.fronts ?? 'doors'}
              onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'doors' ? delete s.fronts : (s.fronts = v as 'glass' | 'open')))}
              options={[
                { value: 'doors', label: 'Doors' },
                { value: 'glass', label: 'Glass doors' },
                { value: 'open', label: 'Open shelves' },
              ]}
            />
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5">
                <Lightbulb className="size-4" /> Light under it
              </span>
              <Switch size="sm" checked={!!sym.led} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (s.led = on || undefined))} />
            </label>
            {sym.led && <LightSection sym={sym} units={units} />}
          </div>
        )}
        {sym.type === 'range-hood' && (
          <div className="space-y-3 rounded-lg bg-muted/60 p-3">
            {styleOf(sym) !== 'built-in' && <p className="text-xs text-muted-foreground">Its chimney goes up to the ceiling.</p>}
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5">
                <Lightbulb className="size-4" /> Hood lights
              </span>
              <Switch size="sm" checked={!!sym.led} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (s.led = on || undefined))} />
            </label>
            {sym.led && <LightSection sym={sym} units={units} />}
          </div>
        )}
        {(sym.type === 'towel-rail' || sym.type === 'towel-radiator') && (
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Towel on it</span>
            <Switch size="sm" checked={sym.towel !== false} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (on ? delete s.towel : (s.towel = false)))} />
          </label>
        )}
        {sym.type === 'bath-vanity' && (
          <div className="space-y-3 rounded-lg bg-muted/60 p-3">
            {sym.width >= 110 && (
              <Choice
                label="Sinks"
                value={sym.sinks === 2 ? 'two' : 'one'}
                onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'two' ? (s.sinks = 2) : delete s.sinks))}
                options={[
                  { value: 'one', label: 'One' },
                  { value: 'two', label: 'Two' },
                ]}
              />
            )}
            <Choice
              label="Mounted"
              value={sym.onFloor ? 'floor' : 'wall'}
              onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'floor' ? (s.onFloor = true) : delete s.onFloor))}
              options={[
                { value: 'wall', label: 'On the wall' },
                { value: 'floor', label: 'On the floor' },
              ]}
            />
            <Choice
              label="Above it"
              value={sym.mirror ?? 'cabinet'}
              onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'cabinet' ? delete s.mirror : (s.mirror = v)))}
              options={[
                { value: 'cabinet', label: 'Mirror cabinet' },
                { value: 'plain', label: 'Mirror' },
                { value: 'none', label: 'Nothing' },
              ]}
            />
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5">
                <Lightbulb className="size-4" /> {(sym.mirror ?? 'cabinet') === 'none' ? 'Light under it' : 'Mirror light'}
              </span>
              <Switch size="sm" checked={!!sym.led} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (s.led = on || undefined))} />
            </label>
            {sym.led && <LightSection sym={sym} units={units} />}
          </div>
        )}
        {sym.type === 'dressing-table' && (
          <div className="space-y-3 rounded-lg bg-muted/60 p-3">
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>Stool</span>
              <Switch
                size="sm"
                checked={sym.stool !== false}
                onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (on ? delete s.stool : (s.stool = false)))}
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5">
                <Lightbulb className="size-4" /> {styleOf(sym) === 'hollywood' ? 'Bulbs lit' : 'Mirror light'}
              </span>
              <Switch size="sm" checked={!!sym.led} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (s.led = on || undefined))} />
            </label>
            {sym.led && <LightSection sym={sym} units={units} />}
          </div>
        )}
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
        {hasWorktop(sym) && <WorktopPicker sym={sym} />}
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
        {def?.elevation !== undefined && !def.fixture && (!def.wallMount || ['ac-split', 'towel-rail', 'towel-radiator', 'wall-cabinet', 'range-hood'].includes(sym.type)) && (
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
          <Choice
            label="Doors"
            value={sym.doors ?? DOOR_DEFAULT[sym.type]}
            onChange={(v) => updateSymbol(sym.id, (s) => void (s.doors = v))}
            options={[
              { value: 'hinged', label: 'Hinged' },
              { value: 'sliding', label: 'Sliding' },
            ]}
          />
        )}
        {sym.type.startsWith('wardrobe') && (
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Glass doors</span>
            <Switch size="sm" checked={!!sym.glass} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (s.glass = on || undefined))} />
          </label>
        )}
        {sym.type === 'sofa-table' && (
          <div className="space-y-1.5">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                if (!placeBehindSofa(sym.id)) toast.error('There is no sofa near it. Move it close to the back of one first.')
              }}
            >
              <Sofa /> Put it behind the sofa
            </Button>
            <p className="text-xs text-muted-foreground">Drag it near a sofa's back (or either back of a corner sofa) and it tucks in behind it.</p>
          </div>
        )}
        {(sym.type === 'column' || sym.type === 'wall-post') && (
          <div className="space-y-1.5">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                if (!convertColumns([sym.id], sym.type === 'column' ? 'wall' : 'free')) toast.error('There is no wall near it. Move it up to a wall first.')
              }}
            >
              <Columns2 /> {sym.type === 'column' ? 'Build it into the wall' : 'Make it free-standing'}
            </Button>
            <p className="text-xs text-muted-foreground">
              {sym.type === 'column'
                ? 'Moves it against the nearest wall, standing out of it into the room. The gypsum ceiling, hidden lights and shadow gaps then go around it.'
                : 'Makes it a column on its own, away from the walls, where it is now.'}
            </p>
          </div>
        )}
        {(sym.type === 'sofa-corner' || sym.type === 'wardrobe-corner') && (
          <Choice
            label="Corner on"
            value={sym.flipX ? 'right' : 'left'}
            onChange={(v) => updateSymbol(sym.id, (s) => void (s.flipX = v === 'right'))}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
            ]}
          />
        )}
        {!sym.wall && !sym.room && sym.type !== 'label' && (
          <KeepSwitch checked={!!sym.keep} onChange={(on) => updateSymbol(sym.id, (s) => void (on ? (s.keep = true) : delete s.keep))} />
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
        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={startTour}>
          <CircleHelp /> Take the tour
        </Button>
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
