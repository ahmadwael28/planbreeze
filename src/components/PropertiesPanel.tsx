import { t, tc } from '@/i18n'
import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalSpaceAround,
  AlignVerticalDistributeCenter,
  AlignVerticalSpaceAround,
  ArrowRight,
  ArrowUpToLine,
  Box, BrickWall, CircleHelp, DoorOpen, Merge, MoveHorizontal, Scissors, Spline, ClipboardCopy, Sparkles, Columns2, Copy, Sofa, FlipHorizontal2, Group, Ungroup, FlipVertical2, ImageOff, Lightbulb, Link2Off, Lock, Ruler, RotateCw, SplitSquareHorizontal, Trash2, Video } from 'lucide-react'
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
import { area, dist, dot, normalize, perimeter, pointInPolygon, sub } from '@/model/geometry'
import { wallBehind } from '@/model/walls'
import { wallColumns, wallSign } from '@/model/developed'
import { DEFAULT_RAILING, isOpen, isOutdoor, keepBack, ledgeNear, linedUp, OUTDOOR, RAILING_THICKNESS, ROOM_COLORS, roomOuter, setWallLength, symbolPose } from '@/model/project'
import { wallAcross } from '@/model/divide'
import { beamSpan } from '@/model/beams'
import { CABINETS, curtainLayers, frameOf, givesLight, hasGlass, LEDGE_HEIGHT, LEDGE_RANGE, ledgeHeight, NICHES, SKIN_TONES, TANK_BOX, TANK_BOX_RANGE, tankBoxDepth, vanityLight, vanitySinks, WASHER_BAY, STYLES, styleOf, SYMBOL_MAP, tvInches, tvSize, WORKTOPS, worktopOf, hasWorktop } from '@/model/symbols'
import type { Worktop } from '@/model/symbols'
import type { FrameColor } from '@/model/symbols'
import { formatArea, formatLength } from '@/model/units'
import { PERSON, PERSON_PRESETS, personLook, personSupport, POSE_NAMES } from '@/model/people'
import type { Dimension, Floor, ItemRef, MirrorShape, OutdoorKind, PlanSymbol, Project, RailingStyle, Room, RoomUse, SavedView, Units } from '@/model/types'
import {
  arrangeSelection,
  autoDimension,
  addBeamAlong,
  beamAlong,
  ceilingJoined,
  centerSelection,
  closeWall,
  convertColumns,
  joinRooms,
  openWall,
  pushSelection,
  roomsAcross,
  setCeilingJoined,
  placeBehindSofa,
  updatePerson,
  copiedNote,
  copySelection,
  rotateSelection,
  selectionBox,
  currentFloor,
  deleteSelection,
  groupSelection,
  draftFloor,
  duplicateSelection,
  extraCorners,
  removeVertices,
  renameRoom,
  splitWall,
  useEditor,
  useFloor,
  useSelectedRoom,
  useSelectedSymbol,
} from '@/store/editor'
import { boxGaps, centeredPosition, openSides, wallGaps } from '@/model/guides'
import type { Side } from '@/model/guides'
import { BACK_TO_WALL, backToNearestWall, pushedTo, sideGaps } from '@/model/magnet'
import { isRound, resized, sizeRule } from '@/model/sizes'
import type { Dim } from '@/model/sizes'
import { useUi } from '@/store/ui'
import { LengthInput, NumberInput, TextInput } from './LengthInput'
import { CeilingSection, GroupLightSection, GrooveLightWalls, HiddenLightControls, LightSection, SwitchSection } from './LightingProps'
import { Choice } from './Choice'
import { doorRun, doorsOf, headOf, headPoint, showerGlass, showerRuns, wayIn } from '@/model/shower'
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
    <div data-field className="grid grid-cols-[104px_1fr] items-center gap-2">
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
          <dd className="text-end font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Actions() {
  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={duplicateSelection}>
        <Copy /> {t('Duplicate')}
      </Button>
      <Button variant="destructive" size="sm" onClick={deleteSelection}>
        <Trash2 /> {t('Delete')}
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
function WorktopPicker({ sym, label }: { sym: PlanSymbol; label?: string }) {
  const floor = useFloor()
  const current = worktopOf(sym)
  const room = floor.rooms.find((r) => pointInPolygon(sym, r.points))
  const others = room ? floor.symbols.filter((s) => s.id !== sym.id && hasWorktop(s) && pointInPolygon(s, room.points) && worktopOf(s).id !== current.id) : []
  const ring = 'ring-2 ring-primary ring-offset-2 ring-offset-background'
  return (
    <>
      <Field label={label ?? t('Worktop')}>
        {(id) => (
          <div id={id} className="flex flex-wrap items-center gap-1.5 py-1">
            {WORKTOPS.map((w) => (
              <button
                key={w.id}
                type="button"
                title={t(w.name)}
                aria-label={t(w.name)}
                aria-pressed={w.id === current.id}
                onClick={() => updateSymbol(sym.id, (s) => void (s.top = w.id))}
                className={cn('size-6 rounded-md border shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', w.id === current.id && ring)}
                style={{ background: worktopSwatch(w) }}
              />
            ))}
          </div>
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-x-2 ps-[112px] text-xs text-muted-foreground">
        {t(current.name)}
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
            {t('Use it for every worktop in {room}', { room: room.name })}
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
    if (n !== Math.round(v)) toast(t('TVs here go from 22″ to 110″'))
    updateSymbol(sym.id, (s) => void Object.assign(s, tvSize(n)))
  }
  return (
    <>
      <Field label={t('Screen size')}>{(id) => <NumberInput id={id} value={inches} step={1} suffix="″" onChange={set} />}</Field>
      <div className="flex flex-wrap gap-1 ps-[112px]">
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
        <Lock className="size-3.5 text-muted-foreground" /> {t('Keep when designing')}
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
      <Field label={t('Used as')}>
        {(id) => (
          <Select value={room.use ?? 'none'} onValueChange={(v) => updateRoom(room.id, (r) => void (v === 'none' ? delete r.use : (r.use = v as RoomUse)))}>
            <SelectTrigger id={id} size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('Not set')}</SelectItem>
              {ROOM_USES.filter((u) => u.id !== 'balcony').map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {t(u.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Button variant="outline" size="sm" className="w-full" onClick={() => redesignRoom(room.id)}>
        <Sparkles className="text-primary" /> {tried ? t('Another idea') : t('Suggest a design')}
      </Button>
    </>
  )
}

/** Dividing a room in two with no wall between the parts (one space, two rooms), or joining such rooms back into one. */
function OpenSpaceControls({ room }: { room: Room }) {
  const floor = useFloor()
  const across = roomsAcross(room, floor.rooms)
  const names = across.map((r) => r.name).join(t(' and '))
  return (
    <div className="space-y-2">
      {across.length > 0 && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('Open to {names}, with no wall between: one space, but each has its own floor, ceiling and lights.', { names })}
        </p>
      )}
      {across.map((r) => {
        const joined = ceilingJoined(room, r)
        return (
          <div key={r.id} className="space-y-2">
            <label className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block">{t('One ceiling with {room}', { room: r.name })}</span>
                <span className="block text-xs leading-relaxed text-muted-foreground">
                  {joined
                    ? t('The gypsum runs on across the line where the two are level (a step where they’re not).')
                    : t('Each room’s gypsum stops at the line, with its own band along it.')}
                </span>
              </span>
              <Switch size="sm" checked={joined} onCheckedChange={(on) => setCeilingJoined(room.id, r.id, on)} />
            </label>
            {!beamAlong(floor, room, r) && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => addBeamAlong(room.id, r.id)}>
                <MoveHorizontal /> {t('A beam along the line')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                if (!joinRooms(room.id, r.id)) toast(t("These two can't be joined into one room"), { description: t('They need to make one piece together.') })
              }}
            >
              <Merge /> {t('Join with {room}', { room: r.name })}
            </Button>
          </div>
        )
      })}
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => {
          useEditor.getState().setTool('divide')
          toast(t('Click a wall where the line between the two rooms starts'), { description: t('Then across the room, where it ends.') })
        }}
      >
        <Scissors /> {t('Divide into two rooms')}
      </Button>
    </div>
  )
}

function RoomProps({ room, units }: { room: Room; units: Units }) {
  const floor = useFloor()
  const theme = usePlanTheme()
  const selection = useEditor((s) => s.selection)
  // Corners picked on the plan (Shift + click for several), and the wall picked there.
  const picked = selection?.kind === 'room' ? (selection.vertices ?? (selection.vertex !== undefined ? [selection.vertex] : [])) : []
  const pickedWall = selection?.kind === 'room' ? selection.edge : undefined
  const extra = extraCorners(room)
  const setHoverWall = useUi((s) => s.setHoverWall)
  // The wall picked on the plan: brought into view in the list.
  useEffect(() => {
    if (pickedWall !== undefined) document.querySelector(`[data-wall-row="${pickedWall}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [pickedWall])
  useEffect(() => () => setHoverWall(null), [setHoverWall])
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
        r.openEdges = undefined
        f.symbols = f.symbols.filter((s) => s.room !== r.id)
      } else {
        r.kind = undefined
        r.wallThickness = defaultWall
      }
    })
  return (
    <>
      <Section
        title={room.kind ? t(OUTDOOR[room.kind].name) : t('Room')}
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
            <Box /> {t('View in 3D')}
          </Button>
        }
      >
        <Field label={t('Name')}>
          {(id) => <TextInput id={id} value={room.name} onChange={(v) => renameRoom(room.id, v)} />}
        </Field>
        <Choice
          label={t('Type')}
          value={room.kind ?? 'room'}
          onChange={(v) => setKind(v === 'room' ? null : v)}
          options={[
            { value: 'room', label: t('Room') },
            { value: 'balcony', label: t('Balcony') },
            { value: 'terrace', label: t('Terrace') },
          ]}
        />
        {!balcony && <RoomUseControls room={room} />}
        {!balcony && <OpenSpaceControls room={room} />}
        {balcony && (
          <>
            <Field label={t('Railing')}>
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
                    <SelectItem value="glass">{t('Glass panels')}</SelectItem>
                    <SelectItem value="metal">{t('Metal balusters')}</SelectItem>
                    <SelectItem value="solid">{t('Solid wall (parapet)')}</SelectItem>
                    <SelectItem value="none">{t('No railing')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            {room.railing?.style !== 'none' && (
            <Field label={t('Railing height')}>
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
              {t("There's no railing where it meets the house. Put a door in the house wall to step out onto it.")}
            </p>
          </>
        )}
        <FloorSection room={room} units={units} />
        <Field label={room.floor ? t('Plan color') : t('Floor color')}>
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
                  aria-label={t('Color {c}', { c })}
                />
              ))}
            </div>
          )}
        </Field>
        <Field label={balcony ? t('Railing thickness') : t('Wall thickness')}>
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
            [t('Area'), formatArea(a, units)],
            [t('Perimeter'), formatLength(perimeter(room.points), units)],
            ...(balcony ? [] : [[t('Wall area'), formatArea(area(roomOuter(room)) - a, units)] as [string, string]]),
          ]}
        />
      </Section>
      <Separator />
      {!balcony && (
        <>
          <Section title={t('Gypsum ceiling')}>
            <CeilingSection room={room} units={units} />
          </Section>
          <Separator />
        </>
      )}
      {!balcony && (
        <>
          <Section title={t('Wall finishes')}>
            <WallsSection room={room} units={units} />
          </Section>
          <Separator />
        </>
      )}
      <Section title={t('Walls')}>
        <ol className="space-y-1">
          {room.points.map((p, i) => {
            const q = room.points[(i + 1) % room.points.length]
            const open = isOpen(room, i)
            // A room drawn next to it, with a wall between: the wall can come out.
            const next = !open && !balcony ? wallAcross(room, i, floor.rooms) : null
            return (
              <li
                key={i}
                data-wall-row={i}
                onMouseEnter={() => setHoverWall({ roomId: room.id, edge: i })}
                onMouseLeave={() => setHoverWall(null)}
                className={cn(
                  'grid grid-cols-[64px_1fr_auto] items-center gap-1.5 rounded-md px-1 py-0.5',
                  pickedWall === i && 'bg-primary/10 ring-1 ring-primary/40',
                )}
              >
                <button
                  type="button"
                  className={cn('flex items-center gap-1.5 text-start text-sm text-muted-foreground', open && 'italic')}
                  title={open ? t('No wall: open to the next room') : t('Show it on the plan')}
                  onClick={() => useEditor.getState().select({ kind: 'room', id: room.id, edge: i })}
                >
                  <span
                    className={cn(
                      'grid size-5 shrink-0 place-items-center rounded-full border border-primary text-[10px] font-bold tabular-nums',
                      pickedWall === i ? 'bg-primary text-primary-foreground' : 'text-primary',
                    )}
                  >
                    {i + 1}
                  </span>
                  {open ? t('Open') : t('Wall')}
                </button>
                <LengthInput
                  value={dist(p, q)}
                  units={units}
                  onChange={(v) => updateRoom(room.id, (r) => void (r.points = setWallLength(r.points, i, v)))}
                />
                <span className="flex">
                  {open && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-sm" onClick={() => closeWall(room.id, i)} aria-label={t('Build a wall here')}>
                          <BrickWall />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left">{t('Open to the next room: build a wall here instead')}</TooltipContent>
                    </Tooltip>
                  )}
                  {next && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('Open up to {room}', { room: next.room.name })}
                          onClick={() => {
                            const gone = openWall(room.id, i)
                            const opened = t('Opened up to {room}', { room: next.room.name })
                            if (gone > 0)
                              toast(opened, {
                                description: gone === 1 ? t('The door in that wall went with it.') : t('The {n} doors and windows in that wall went with it.', { n: gone }),
                              })
                            else if (gone === 0) toast(opened, { description: t('No wall between them now: each keeps its own floor, ceiling and lights.') })
                          }}
                        >
                          <DoorOpen />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left">{t('Take this wall away: open up to {room}', { room: next.room.name })}</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon-sm" onClick={() => splitWall(room.id, i)} aria-label={t('Split wall')}>
                        <SplitSquareHorizontal />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">{t('Split wall (add a corner)')}</TooltipContent>
                  </Tooltip>
                </span>
              </li>
            )
          })}
        </ol>
        {(picked.length > 0 || extra.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {picked.length > 0 && (
              <Button variant="outline" size="sm" disabled={room.points.length - picked.length < 3} onClick={() => removeVertices(room.id, picked)}>
                <Trash2 /> {picked.length === 1 ? t('Remove corner {n}', { n: picked[0] + 1 }) : t('Remove {n} corners', { n: picked.length })}
              </Button>
            )}
            {extra.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => removeVertices(room.id, extra)} title={t('Corners on a straight wall, or right on top of another, as detection can leave them')}>
                <Spline /> {extra.length === 1 ? t('Remove 1 extra corner') : t('Remove {n} extra corners', { n: extra.length })}
              </Button>
            )}
          </div>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('Drag corners to reshape and the wall handles to move walls. Double-click a wall to add a corner there. Shift + click corners to pick several: drag them together, or press Delete to remove them.')}
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
        <Section title={gap ? t('Shadow gap light') : t('Curtain pocket light')}>
          <p className="text-sm text-muted-foreground">
            {gap
              ? t("An LED strip in the shadow gap of {room}, washing the walls below. The room's ceiling settings choose the walls with a gap; here, which of them have light.", {
                  room: room?.name ?? t('the room'),
                })
              : t("An LED strip in the curtain pocket of {room}, lighting the curtains. The room's ceiling settings choose the walls with a pocket; here, which of them have light.", {
                  room: room?.name ?? t('the room'),
                })}
          </p>
          {room && <GrooveLightWalls room={room} sym={sym} units={units} />}
          <LightSection sym={sym} units={units} />
        </Section>
        <Separator />
        <Section>
          <Button variant="destructive" size="sm" onClick={deleteSelection}>
            <Trash2 /> {t('Delete')}
          </Button>
        </Section>
      </>
    )
  }
  return (
    <>
      <Section title={t('Cove / hidden light')}>
        <p className="text-sm text-muted-foreground">
          {t(
            room?.ceiling?.style === 'cove'
              ? 'An LED strip hidden around the ceiling of {room}, inside the cove, washing the ceiling with light.'
              : room?.ceiling?.style === 'floating'
                ? 'An LED strip hidden around the ceiling of {room}, on top of the floating panel, lighting the ceiling around it.'
                : sym.cove?.at === 'inner' && room && (room.ceiling?.style === 'tray' || room.ceiling?.style === 'stepped')
                  ? 'An LED strip hidden around the ceiling of {room}, inside the tray, lighting its raised middle.'
                  : 'An LED strip hidden around the ceiling of {room}, along the walls just below the ceiling.',
            { room: room?.name ?? t('the room') },
          )}
        </p>
        {room && <HiddenLightControls room={room} sym={sym} units={units} />}
        <LightSection sym={sym} units={units} />
      </Section>
      <Separator />
      <Section>
        <Button variant="destructive" size="sm" onClick={deleteSelection}>
          <Trash2 /> {t('Delete')}
        </Button>
      </Section>
    </>
  )
}

function DimensionProps({ dim, units }: { dim: Dimension; units: Units }) {
  return (
    <>
      <Section title={t('Dimension')}>
        <Stats rows={[[t('Length'), formatLength(dist(dim.a, dim.b), units)]]} />
        <Field label={t('Distance out')}>
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
        <p className="text-xs text-muted-foreground">{t('Drag the line to move it, or drag its end points onto other corners.')}</p>
      </Section>
      <Separator />
      <Section>
        <Button variant="destructive" size="sm" onClick={deleteSelection}>
          <Trash2 /> {t('Delete')}
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
          label={t('Fabric')}
          value={fabric}
          onChange={(v) => updateSymbol(sym.id, (s) => void (s.fabric = v))}
          options={[
            { value: 'screen', label: t('Screen') },
            { value: 'blackout', label: t('Blackout') },
          ]}
        />
      ) : (
        <Choice
          multiple
          label={t('Layers')}
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
            { value: 'sheer', label: t('Sheer') },
            { value: 'curtain', label: t('Curtain') },
            { value: 'blackout', label: t('Blackout') },
          ]}
        >
          <p className="text-xs text-muted-foreground">{t('Any of them together, from the window out: sheer, blackout, curtain.')}</p>
        </Choice>
      )}
      {!isBlind && (
        <Choice
          label={t('Opens to')}
          value={sym.openSide ?? 'both'}
          onChange={(v) => updateSymbol(sym.id, (s) => void (s.openSide = v === 'both' ? undefined : v))}
          options={[
            { value: 'left', label: t('Left') },
            { value: 'both', label: t('Both sides') },
            { value: 'right', label: t('Right') },
          ]}
        />
      )}
      <Field label={isBlind ? t('Rolled up') : t('Open')}>
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
/** A toilet's usual size (width, depth): standing on the floor, hung with its tank in a box, or in the wall. */
const TOILET_SIZES = { floor: [40, 65], box: [60, 74], wall: [38, 54] }

/**
 * The column on the same wall as a wall-hung toilet, near it (within a metre and a half along the wall): how deep it
 * is, to make the tank box as deep and line them up. None if there isn't one.
 */
function columnBeside(sym: PlanSymbol, floor: Floor): number | null {
  const pose = symbolPose(sym, floor.rooms)
  const at = wallBehind(pose, sym.depth, floor.rooms)
  if (!at) return null
  const a = at.room.points[at.edge]
  const b = at.room.points[(at.edge + 1) % at.room.points.length]
  const u = wallSign(at.room, at.edge) * dot(sub(pose, a), normalize(sub(b, a)))
  let best: { gap: number; depth: number } | null = null
  for (const c of wallColumns(floor, at.room, at.edge)) {
    const gap = Math.max(0, c.uL - (u + sym.width / 2), u - sym.width / 2 - c.uR)
    if (gap < 150 && (!best || gap < best.gap)) best = { gap, depth: c.depth }
  }
  return best && Math.round(best.depth * 10) / 10
}

/**
 * How a toilet's mounted: standing on the floor with its own tank, or hung on the wall with the tank concealed in a box
 * in front of the wall (half height with a shelf on top, or up to the ceiling) or in the wall itself. Each is made its
 * usual size, its back staying against the wall.
 */
function ToiletMount({ sym }: { sym: PlanSymbol }) {
  const box = sym.tankBox ?? 'ledge'
  const units = useEditor((s) => s.project.units)
  const floor = useFloor()
  const depth = tankBoxDepth(sym)
  const column = box !== 'none' ? columnBeside(sym, floor) : null
  const ledge = ledgeHeight(sym)
  const lined = linedUp(floor, sym).length
  // A higher or lower ledge: the half walls in its room lined up with it go with it.
  const setLedge = (v: number) =>
    useEditor.getState().commit((d) => {
      const f = draftFloor(d)
      const s = f.symbols.find((x) => x.id === sym.id)
      if (!s) return
      const next = Math.min(LEDGE_RANGE[1], Math.max(LEDGE_RANGE[0], Math.round(v * 10) / 10))
      for (const w of linedUp(f, s)) {
        if (w.type === 'shower') w.halfWall = next
        else w.height = next
      }
      if (next === LEDGE_HEIGHT) delete s.tankHeight
      else s.tankHeight = next
    })
  // A deeper or shallower box: the toilet as much deeper, its bowl the same, its back where it was (on the wall).
  const setDepth = (v: number) =>
    updateSymbol(sym.id, (s) => {
      const next = Math.min(TANK_BOX_RANGE[1], Math.max(TANK_BOX_RANGE[0], Math.round(v * 10) / 10))
      const total = s.depth - tankBoxDepth(s) + next
      if (next === TANK_BOX) delete s.tankDepth
      else s.tankDepth = next
      keepBack(s, total)
      s.depth = total
    })
  const reshape = (s: PlanSymbol, [w, d]: number[]) => {
    const r = (s.rotation * Math.PI) / 180
    const f = s.flipY ? -1 : 1
    const shift = (s.depth - d) / 2
    s.x += Math.sin(r) * f * shift
    s.y -= Math.cos(r) * f * shift
    s.width = w
    s.depth = d
  }
  return (
    <>
      <Choice
        label={t('Mounting')}
        value={sym.mount ?? 'floor'}
        onChange={(v) =>
          updateSymbol(sym.id, (s) => {
            if (v === 'wall') {
              s.mount = 'wall'
              reshape(s, s.tankBox === 'none' ? TOILET_SIZES.wall : [TOILET_SIZES.box[0], TOILET_SIZES.wall[1] + tankBoxDepth(s)])
            } else {
              delete s.mount
              delete s.tankBox
              reshape(s, TOILET_SIZES.floor)
            }
          })
        }
        options={[
          { value: 'floor', label: t('Floor-standing') },
          { value: 'wall', label: t('Wall-hung') },
        ]}
      />
      {sym.mount === 'wall' && (
        <Choice
          label={t('Concealed tank')}
          stacked
          value={box}
          onChange={(v) =>
            updateSymbol(sym.id, (s) => {
              if (v === 'ledge') delete s.tankBox
              else s.tankBox = v
              if ((box === 'none') !== (v === 'none')) reshape(s, v === 'none' ? TOILET_SIZES.wall : [TOILET_SIZES.box[0], TOILET_SIZES.wall[1] + tankBoxDepth(s)])
            })
          }
          options={[
            { value: 'ledge', label: t('Box with a shelf') },
            { value: 'full', label: t('Box to the ceiling') },
            { value: 'none', label: t('In the wall') },
          ]}
        >
          <p className="text-xs text-muted-foreground">
            {box === 'none'
              ? t('The tank is inside the wall: only its flush plate shows.')
              : t("The box is finished like the wall behind it (its tiles, if it's tiled), and can be as wide as the wall.")}
          </p>
        </Choice>
      )}
      {sym.mount === 'wall' && box !== 'none' && (
        <>
          <Field label={t('Box depth')}>
            {(id) => <LengthInput id={id} value={depth} units={units} min={TANK_BOX_RANGE[0]} onChange={setDepth} />}
          </Field>
          {column !== null && Math.abs(column - depth) > 0.5 && (
            <Button variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => setDepth(column)}>
              {t('Make it as deep as the column beside it ({depth})', { depth: formatLength(column, units) })}
            </Button>
          )}
          {box === 'ledge' && (
            <>
              <Field label={t('Box height')}>
                {(id) => <LengthInput id={id} value={ledge} units={units} min={LEDGE_RANGE[0]} onChange={setLedge} />}
              </Field>
              {lined > 0 && <p className="text-xs text-muted-foreground">{t('The half walls lined up with it here go up and down with it.')}</p>}
            </>
          )}
        </>
      )}
    </>
  )
}

/** A mirror's shape as a small icon, for choosing it. */
function MirrorIcon({ shape }: { shape: MirrorShape }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }
  return (
    <svg viewBox="0 0 20 20" className="size-5">
      {shape === 'rect' && <rect x={4} y={3} width={12} height={14} rx={0.5} {...p} />}
      {shape === 'rounded' && <rect x={4} y={3} width={12} height={14} rx={3} {...p} />}
      {shape === 'round' && <circle cx={10} cy={10} r={7} {...p} />}
      {shape === 'oval' && <ellipse cx={10} cy={10} rx={5.5} ry={7.5} {...p} />}
      {shape === 'arch' && <path d="M4.5 17.5 V9 A5.5 5.5 0 0 1 15.5 9 V17.5 Z" {...p} />}
      {shape === 'pill' && <rect x={5.5} y={2.5} width={9} height={15} rx={4.5} {...p} />}
    </svg>
  )
}

const MIRROR_SHAPES: [MirrorShape, string][] = [
  ['rect', 'Rectangle'],
  ['rounded', 'Rounded'],
  ['round', 'Round'],
  ['oval', 'Oval'],
  ['arch', 'Arch'],
  ['pill', 'Pill'],
]

const MIRROR_FRAME_COLORS: [NonNullable<PlanSymbol['mirrorFrame']> | 'none', string, string][] = [
  ['none', 'Frameless', 'linear-gradient(135deg, #e9eef3, #b9c4cf)'],
  ['black', 'Black', '#1f1f22'],
  ['brass', 'Brass', 'linear-gradient(135deg, #e3c27a, #a37b2c)'],
  ['wood', 'Wood', '#a07850'],
  ['white', 'White', '#f4f3ef'],
]

/**
 * A bathroom vanity's options: its basins (built in, bowls on top or under the top), one or two, where a single one
 * is, a washing machine under the top at one end, how it's mounted; what's on the wall over it (a mirror cabinet, a
 * mirror in its shape and frame, or nothing) and the light there.
 */
function VanityOptions({ sym, units }: { sym: PlanSymbol; units: Units }) {
  const lay = vanitySinks(sym)
  const above = sym.mirror ?? 'cabinet'
  const light = sym.led ? vanityLight(sym) : 'off'
  const ring = 'ring-2 ring-primary ring-offset-2 ring-offset-background'
  const lights: { value: string; label: string }[] =
    above === 'plain'
      ? [
          { value: 'back', label: t('Backlit') },
          { value: 'front', label: t('Front') },
          { value: 'bar', label: t('Bar above') },
        ]
      : above === 'cabinet'
        ? [
            { value: 'under', label: t('Under it') },
            { value: 'back', label: t('Backlit') },
          ]
        : [{ value: 'under', label: t('Under it') }]
  return (
    <div className="space-y-3 rounded-lg bg-muted/60 p-3">
      <Choice
        label={t('Basin')}
        value={sym.basin ?? 'integrated'}
        onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'integrated' ? delete s.basin : (s.basin = v)))}
        options={[
          { value: 'integrated', label: t('Built in') },
          { value: 'vessel', label: t('Bowl on top') },
          { value: 'undermount', label: t('Under the top') },
        ]}
      />
      {lay.x1 - lay.x0 >= 110 && (
        <Choice
          label={t('Sinks')}
          value={sym.sinks === 2 ? 'two' : 'one'}
          onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'two' ? (s.sinks = 2) : delete s.sinks))}
          options={[
            { value: 'one', label: t('One') },
            { value: 'two', label: t('Two') },
          ]}
        />
      )}
      {lay.xs.length === 1 && (
        <Choice
          physical
          label={t('Sink')}
          value={sym.sinkAt ?? 'middle'}
          onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'middle' ? delete s.sinkAt : (s.sinkAt = v)))}
          options={[
            { value: 'left', label: t('Left') },
            { value: 'middle', label: t('Middle') },
            { value: 'right', label: t('Right') },
          ]}
        />
      )}
      <Choice
        physical
        label={t('Washing machine')}
        value={sym.washer ?? 'none'}
        onChange={(v) =>
          updateSymbol(sym.id, (s) => {
            if (v === 'none') return void delete s.washer
            s.washer = v
            // Room for it: a bay beside the cabinet, deep and high enough to go under the top.
            const next = resized(s, { width: Math.max(s.width, WASHER_BAY + 60), depth: Math.max(s.depth, 55), height: Math.max(s.height, 90) })
            if (!s.wall) keepBack(s, next.depth)
            Object.assign(s, next)
          })
        }
        options={[
          { value: 'left', label: t('Left') },
          { value: 'none', label: t('None') },
          { value: 'right', label: t('Right') },
        ]}
      >
        {lay.washer && <p className="text-xs text-muted-foreground">{t('A front-loading washing machine under the top, the basin beside it.')}</p>}
      </Choice>
      {styleOf(sym) !== 'open' && (
        <Choice
          label={t('Mounted')}
          value={sym.onFloor ? 'floor' : 'wall'}
          onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'floor' ? (s.onFloor = true) : delete s.onFloor))}
          options={[
            { value: 'wall', label: t('On the wall') },
            { value: 'floor', label: t('On the floor') },
          ]}
        />
      )}
      <Choice
        label={t('Above it')}
        value={above}
        onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'cabinet' ? delete s.mirror : (s.mirror = v)))}
        options={[
          { value: 'cabinet', label: t('Mirror cabinet') },
          { value: 'plain', label: t('Mirror') },
          { value: 'none', label: t('Nothing') },
        ]}
      />
      {above === 'plain' && (
        <>
          <Field label={t('Shape')}>
            {(id) => (
              <div id={id} role="radiogroup" className="flex flex-wrap gap-1.5">
                {MIRROR_SHAPES.map(([shape, name]) => {
                  const on = (sym.mirrorShape ?? 'rect') === shape
                  return (
                    <button
                      key={shape}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      title={t(name)}
                      aria-label={t(name)}
                      onClick={() => updateSymbol(sym.id, (s) => void (shape === 'rect' ? delete s.mirrorShape : (s.mirrorShape = shape)))}
                      className={cn(
                        'grid size-8 place-items-center rounded-md border text-muted-foreground transition-colors hover:text-foreground',
                        on && 'border-primary bg-primary/10 text-primary hover:text-primary',
                      )}
                    >
                      <MirrorIcon shape={shape} />
                    </button>
                  )
                })}
              </div>
            )}
          </Field>
          <Field label={t('Frame')}>
            {(id) => (
              <div id={id} role="radiogroup" className="flex flex-wrap items-center gap-1.5 py-1">
                {MIRROR_FRAME_COLORS.map(([frame, name, look]) => {
                  const on = (sym.mirrorFrame ?? 'none') === frame
                  return (
                    <button
                      key={frame}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      title={t(name)}
                      aria-label={t(name)}
                      onClick={() => updateSymbol(sym.id, (s) => void (frame === 'none' ? delete s.mirrorFrame : (s.mirrorFrame = frame)))}
                      className={cn('size-6 rounded-full border shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', on && ring)}
                      style={{ background: look }}
                    />
                  )
                })}
              </div>
            )}
          </Field>
        </>
      )}
      <Choice
        label={above === 'none' ? t('Light under it') : t('Mirror light')}
        value={light}
        onChange={(v) =>
          updateSymbol(sym.id, (s) => {
            if (v === 'off') return void delete s.led
            s.led = true
            if (v === 'under' && above !== 'cabinet') delete s.mirrorLight
            else s.mirrorLight = v as NonNullable<PlanSymbol['mirrorLight']>
          })
        }
        options={[{ value: 'off', label: t('Off') }, ...lights]}
      />
      {sym.led && <LightSection sym={sym} units={units} />}
    </div>
  )
}

/**
 * A wall standing on its own: up to the ceiling, a half wall (or as high as it's made), with glass above it up to the
 * ceiling or open; finished like its room's walls or painted (see its finish).
 */
function PartitionOptions({ sym }: { sym: PlanSymbol }) {
  const units = useEditor((s) => s.project.units)
  const floor = useFloor()
  // Half height: the box of a wall-hung toilet in its room, if there's one; else as such boxes usually are.
  const toilet = ledgeNear(floor, sym)
  const half = toilet ?? LEDGE_HEIGHT
  const height = !sym.partial ? 'full' : sym.height === half ? 'half' : 'custom'
  return (
    <>
      <Choice
        label={t('Reaches')}
        value={height}
        onChange={(v) =>
          updateSymbol(sym.id, (s) => {
            if (v === 'full') {
              delete s.partial
              delete s.glassTop
              delete s.shelf
              return
            }
            s.partial = true
            // Half height is a wall-hung toilet's box's, and it gets a shelf as the box has: the two line up.
            if (v === 'half') {
              s.height = half
              if (height === 'full') s.shelf = true
            } else if (height === 'full' || s.height === half) s.height = Math.min(half + 40, 250)
          })
        }
        options={[
          { value: 'full', label: t('The ceiling') },
          { value: 'half', label: t('Half height') },
          { value: 'custom', label: t('Custom height') },
        ]}
      >
        {height === 'half' && (
          <p className="text-xs text-muted-foreground">
            {toilet !== undefined
              ? t("As high as the toilet's box here ({height}), and its shelf, so the two line up.", { height: formatLength(toilet, units) })
              : t("As high as a wall-hung toilet's box (and its shelf), so the two line up.")}
          </p>
        )}
      </Choice>
      {sym.partial && (
        <Choice
          label={t('Top')}
          value={sym.shelf ? 'shelf' : 'plain'}
          onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'shelf' ? (s.shelf = true) : delete s.shelf))}
          options={[
            { value: 'plain', label: t('Plain') },
            { value: 'shelf', label: t('Stone shelf') },
          ]}
        />
      )}
      {sym.partial && (
        <Choice
          label={t('Above it')}
          value={sym.glassTop ? 'glass' : 'open'}
          onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'glass' ? (s.glassTop = true) : delete s.glassTop))}
          options={[
            { value: 'open', label: t('Open') },
            { value: 'glass', label: t('Glass to the ceiling') },
          ]}
        />
      )}
      <p className="text-xs text-muted-foreground">
        {sym.frame ? t('Painted all round.') : t("Finished like the room's walls (their tiles, if they're tiled), on both sides and its ends.")}
      </p>
    </>
  )
}

function ShowerGlass({ sym }: { sym: PlanSymbol }) {
  const floor = useFloor()
  const units = useEditor((s) => s.project.units)
  const auto = !sym.screens
  const sides = sym.screens ?? openSides(sym, floor.rooms)
  // A half wall's height: a wall-hung toilet's box in the room, if there's one, to line up with it.
  const toilet = ledgeNear(floor, sym)
  // The side with its way in, and how long the fixed part of it is (on the half wall, if there's one).
  const doors = doorsOf(sym)
  const door = doorRun(showerRuns(sym, sides, floor.symbols))
  const doorLen = door ? door.u1 - door.u0 : 0
  const parts = wayIn(sym, doorLen, doors)
  return (
    <>
    <Choice
      multiple
      label={t('Glass on')}
      value={sides}
      onChange={(v) => updateSymbol(sym.id, (s) => void (s.screens = v))}
      options={[
        { value: 'front', label: tc('side', 'Front') },
        { value: 'left', label: tc('side', 'Left') },
        { value: 'right', label: tc('side', 'Right') },
        { value: 'back', label: tc('side', 'Back') },
      ]}
    >
      <p className="text-xs text-muted-foreground">
        {auto ? (
          t('Glass where there is no wall.')
        ) : (
          <>
            {t('Chosen by hand.')}{' '}
            <button className="underline underline-offset-2 hover:text-foreground" onClick={() => updateSymbol(sym.id, (s) => void delete s.screens)}>
              {t('Follow the walls')}
            </button>
          </>
        )}
      </p>
    </Choice>
    {sides.length > 0 && (
      <Choice
        label={t('Way in')}
        value={doors}
        onChange={(v) =>
          updateSymbol(sym.id, (s) => {
            if (v === 'walk-in') s.walkIn = true
            else {
              delete s.walkIn
              s.doors = v
            }
          })
        }
        options={[
          { value: 'hinged', label: t('Hinged door') },
          { value: 'sliding', label: t('Sliding door') },
          { value: 'walk-in', label: t('Open') },
        ]}
      >
        {sym.walkIn && (
          <p className="text-xs text-muted-foreground">{t('A fixed glass panel, with an open way in beside it. Mirror the shower for the way in at the other end.')}</p>
        )}
      </Choice>
    )}
    {sides.length > 0 && sym.walkIn && !sym.glassToCeiling && (
      <Choice
        label={t('Support bar')}
        value={sym.brace ?? 'none'}
        onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'none' ? delete s.brace : (s.brace = v)))}
        options={[
          { value: 'none', label: t('None') },
          { value: 'wall', label: t('To the wall') },
          { value: 'ceiling', label: t('To the ceiling') },
        ]}
      >
        <p className="text-xs text-muted-foreground">{t("A slim bar from the panel's free top corner, holding it steady.")}</p>
      </Choice>
    )}
    {sides.length > 0 && (
      <Choice
        label={t('Glass up to')}
        value={sym.glassToCeiling ? 'ceiling' : 'height'}
        onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'ceiling' ? (s.glassToCeiling = true) : delete s.glassToCeiling))}
        options={[
          { value: 'height', label: formatLength(sym.height, units) },
          { value: 'ceiling', label: t('The ceiling') },
        ]}
      >
        {sym.glassToCeiling && !sym.walkIn && (
          <p className="text-xs text-muted-foreground">{t('The door stays its height, with fixed glass over it up to the ceiling.')}</p>
        )}
      </Choice>
    )}
    {sides.length > 0 && (
      <Choice
        label={t('Glass stands on')}
        value={sym.halfWall ? 'wall' : 'floor'}
        onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'wall' ? (s.halfWall = toilet ?? LEDGE_HEIGHT) : delete s.halfWall))}
        options={[
          { value: 'floor', label: t('The floor') },
          { value: 'wall', label: t('A half wall') },
        ]}
      >
        {sym.halfWall !== undefined && (
          <p className="text-xs text-muted-foreground">
            {t("Its fixed glass stands on a half wall with a stone shelf, finished like the room's walls. The way in still reaches the floor.")}
          </p>
        )}
      </Choice>
    )}
    {sides.length > 0 && sym.halfWall !== undefined && (
      <>
        <Field label={t('Half wall height')}>
          {(id) => (
            <LengthInput
              id={id}
              value={sym.halfWall!}
              units={units}
              min={LEDGE_RANGE[0]}
              onChange={(v) => updateSymbol(sym.id, (s) => void (s.halfWall = Math.min(LEDGE_RANGE[1], Math.max(LEDGE_RANGE[0], Math.round(v * 10) / 10))))}
            />
          )}
        </Field>
        {toilet !== undefined && Math.abs(toilet - sym.halfWall) > 0.05 && (
          <Button variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => updateSymbol(sym.id, (s) => void (s.halfWall = toilet))}>
            {t("Line it up with the toilet's box ({height})", { height: formatLength(toilet, units) })}
          </Button>
        )}
      </>
    )}
    {door && (
      <>
        <Field label={sym.halfWall !== undefined ? t('Half wall length') : sym.walkIn ? t('Panel length') : t('Fixed pane length')}>
          {(id) => (
            <LengthInput
              id={id}
              value={Math.round(parts.fixed * 10) / 10}
              units={units}
              min={15}
              onChange={(v) => updateSymbol(sym.id, (s) => void (s.fixedLength = Math.round(v * 10) / 10))}
            />
          )}
        </Field>
        <Field label={sym.walkIn ? t('Way in width') : t('Door width')}>
          {(id) => (
            <LengthInput
              id={id}
              value={Math.round(parts.door * 10) / 10}
              units={units}
              min={30}
              onChange={(v) => updateSymbol(sym.id, (s) => void (s.doorWidth = Math.round(v * 10) / 10))}
            />
          )}
        </Field>
        <p className="text-xs text-muted-foreground">
          {parts.rest > 0
            ? sym.halfWall !== undefined
              ? t('Past it, the half wall and its glass carry on to the end of the side.')
              : t('Past it, fixed glass to the end of the side.')
            : t('It takes the rest of the side.')}{' '}
          {(sym.fixedLength !== undefined || sym.doorWidth !== undefined) && (
            <button
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() =>
                updateSymbol(sym.id, (s) => {
                  delete s.fixedLength
                  delete s.doorWidth
                })
              }
            >
              {t('As usual')}
            </button>
          )}
        </p>
        {doors === 'hinged' && (
          <>
            <Choice
              label={t('Opens')}
              value={sym.swingIn ? 'in' : 'out'}
              onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'in' ? (s.swingIn = true) : delete s.swingIn))}
              options={[
                { value: 'out', label: t('Outwards') },
                { value: 'in', label: t('Inwards') },
              ]}
            />
            <Choice
              label={t('Hinges')}
              value={sym.hingeFar ? 'far' : 'near'}
              onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'far' ? (s.hingeFar = true) : delete s.hingeFar))}
              options={[
                { value: 'near', label: sym.halfWall !== undefined ? t('On the half wall side') : t('By the fixed glass') },
                { value: 'far', label: t('At the other end') },
              ]}
            />
          </>
        )}
      </>
    )}
    </>
  )
}

/**
 * Where the shower head goes: tap or drag along a wall on the little plan of the shower (turned as it is on the plan),
 * or have it come down from the ceiling (a rain shower).
 */
function ShowerHeadPicker({ sym }: { sym: PlanSymbol }) {
  const floor = useFloor()
  const units = useEditor((s) => s.project.units)
  const theme = usePlanTheme()
  const gRef = useRef<SVGGElement>(null)
  const glass = showerGlass(sym, () => openSides(sym, floor.rooms))
  const place = headOf(sym, glass)
  const walls = (['back', 'left', 'right', 'front'] as const).filter((s) => !glass.includes(s))
  const w = sym.width
  const d = sym.depth
  const set = (head: PlanSymbol['showerHead'], live = false) => {
    const st = useEditor.getState()
    const recipe = (p: Project) => {
      const s = draftFloor(p).symbols.find((x) => x.id === sym.id)
      if (!s) return
      if (head) s.showerHead = head
      else delete s.showerHead
    }
    if (live) st.mutate(recipe)
    else st.commit(recipe)
  }
  /** The wall nearest a pointer, and how far along it. */
  const spotAt = (e: { clientX: number; clientY: number }) => {
    const g = gRef.current
    const m = g?.getScreenCTM()
    if (!g || !m || !walls.length) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    let best: { side: (typeof walls)[number]; at: number; gap: number } | null = null
    for (const side of walls) {
      const along = side === 'back' || side === 'front'
      const len = along ? w : d
      const at = Math.min(1, Math.max(0, ((along ? p.x : p.y) + len / 2) / len))
      const gap = Math.abs(along ? p.y - (side === 'back' ? -d / 2 : d / 2) : p.x - (side === 'left' ? -w / 2 : w / 2))
      if (!best || gap < best.gap) best = { side, at, gap }
    }
    if (!best) return null
    // Right in the middle when close to it.
    const at = Math.abs(best.at - 0.5) < 0.06 ? 0.5 : Math.round(best.at * 1000) / 1000
    return { side: best.side, at }
  }
  const dragging = useRef(false)
  const head = place.side === 'ceiling' ? null : headPoint(place, w, d)
  const len = place.side === 'back' || place.side === 'front' ? w : d
  const fromCorner = Math.min(place.at, 1 - place.at) * len
  const pad = Math.max(w, d) * 0.18
  const r = Math.max(w, d)

  return (
    <div className="space-y-1.5">
      <Choice
        label={t('Shower head')}
        value={place.side === 'ceiling' ? 'ceiling' : 'wall'}
        onChange={(v) => set(v === 'ceiling' ? { side: 'ceiling' } : undefined)}
        options={[
          ...(walls.length ? [{ value: 'wall' as const, label: t('On a wall') }] : []),
          { value: 'ceiling', label: t('From the ceiling'), title: t('A rain shower over the middle') },
        ]}
      />
      <svg
        viewBox={`${-r / 2 - pad} ${-r / 2 - pad} ${r + pad * 2} ${r + pad * 2}`}
        className="h-36 w-full touch-none rounded-md bg-muted/60"
        role="application"
        aria-label={t('Tap a wall of the shower to put the head there')}
        onPointerDown={(e) => {
          const spot = spotAt(e)
          if (!spot) return
          e.currentTarget.setPointerCapture(e.pointerId)
          dragging.current = true
          useEditor.getState().checkpoint()
          set(spot, true)
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return
          const spot = spotAt(e)
          if (spot) set(spot, true)
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <g ref={gRef} transform={`rotate(${sym.rotation})`}>
          <rect x={-w / 2} y={-d / 2} width={w} height={d} fill={theme.paper} stroke={theme.ink} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          {walls.map((side) => {
            const [x1, y1, x2, y2] =
              side === 'back' ? [-w / 2, -d / 2, w / 2, -d / 2] : side === 'front' ? [-w / 2, d / 2, w / 2, d / 2] : side === 'left' ? [-w / 2, -d / 2, -w / 2, d / 2] : [w / 2, -d / 2, w / 2, d / 2]
            return <line key={side} x1={x1} y1={y1} x2={x2} y2={y2} stroke={theme.wall} strokeWidth={8} strokeLinecap="square" vectorEffect="non-scaling-stroke" className="cursor-pointer" />
          })}
          {head ? (
            <g pointerEvents="none">
              <line x1={head.x} y1={head.y} x2={head.x + head.nx * 22} y2={head.y + head.ny * 22} stroke="var(--primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              <circle cx={head.x + head.nx * 22} cy={head.y + head.ny * 22} r={Math.max(w, d) * 0.08} fill="var(--primary)" />
            </g>
          ) : (
            <circle cx={0} cy={0} r={Math.max(w, d) * 0.16} fill="none" stroke="var(--primary)" strokeWidth={2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />
          )}
        </g>
      </svg>
      <p className="text-xs text-muted-foreground">
        {place.side === 'ceiling'
          ? t('From the ceiling, over the middle.')
          : place.at === 0.5
            ? t('In the middle of its wall. Tap or drag along a wall to move it.')
            : t('{length} from the nearer corner. Tap or drag along a wall to move it.', { length: formatLength(fromCorner, units) })}
      </p>
    </div>
  )
}

/** Swatches for the frame finishes an item comes in, plus any custom color. */
function FramePicker({ sym, frames, label }: { sym: PlanSymbol; frames: FrameColor[]; label?: string }) {
  const current = frameOf(sym) ?? frames[0]
  const custom = !frames.some((f) => f.hex === current.hex)
  const set = (hex: string) => updateSymbol(sym.id, (s) => void (s.frame = hex))
  const swatch = (f: FrameColor) => (f.metal ? `linear-gradient(135deg, ${f.hex} 20%, #ffffff 50%, ${f.hex} 80%)` : f.hex)
  const ring = 'ring-2 ring-primary ring-offset-2 ring-offset-background'
  return (
    <Field label={label ?? t('Frame')}>
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
            title={t('Custom color')}
            className={cn('relative size-6 cursor-pointer overflow-hidden rounded-full border shadow-sm', custom && ring)}
            style={{ background: custom ? current.hex : 'conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)' }}
          >
            <input
              type="color"
              aria-label={t('Custom frame color')}
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
  const way = dir.y === 0 ? t('left to right') : dir.x === 0 ? t('top to bottom') : t('at an angle')
  const counts = rows.map((r) => r.length)
  const groups = syms.some((u) => u.group)
  const ofGroups = syms.every((u) => u.group)
  const rowsText =
    counts.length === 1
      ? ofGroups
        ? t('1 row of {n} groups', { n: counts[0] })
        : t('1 row of {n}', { n: counts[0] })
      : counts.every((c) => c === counts[0])
        ? ofGroups
          ? t('{rows} rows of {n} groups', { rows: counts.length, n: counts[0] })
          : t('{rows} rows of {n}', { rows: counts.length, n: counts[0] })
        : t('{rows} rows ({counts})', { rows: counts.length, counts: counts.join(' + ') })
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
        <p className="text-sm font-medium">{t('Arrange')}</p>
        <span className="truncate text-xs text-muted-foreground">
          {rowsText}, {way}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" disabled={!canLine} onClick={() => arrangeSelection('line')}>
          <LineIcon /> {canLine ? t('Line up') : t('Lined up')}
        </Button>
        <Button variant="outline" size="sm" disabled={!canEven} onClick={() => arrangeSelection('even')}>
          <EvenIcon /> {canEven ? t('Space evenly') : t('Even')}
        </Button>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={!canFill}
        title={inRoom ? undefined : t('They need to be inside a room')}
        onClick={() => arrangeSelection('fill')}
      >
        <FillIcon /> {t('Spread over the room')}
      </Button>
      {spacing && (
        <Field label={t('Spacing')}>
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
        {uneven && <>{t('Now {min} to {max} apart.', { min: formatLength(spacing.min, units), max: formatLength(spacing.max, units) })} </>}
        {groups && `${t('Each group moves as one piece.')} `}
        {t('Spacing is center to center. Spreading over the room leaves half a space at the walls, the usual layout for ceiling lights.')}
      </p>
    </div>
  )
}

function MultiProps({ items }: { items: ItemRef[] }) {
  const floor = useFloor()
  const count = (k: ItemRef['kind']) => items.filter((r) => r.kind === k).length
  const parts = (
    [
      [count('room'), t('1 room'), '{n} rooms'],
      [count('symbol'), t('1 item'), '{n} items'],
      [count('dimension'), t('1 dimension'), '{n} dimensions'],
      [count('view'), t('1 saved view'), '{n} saved views'],
    ] as [number, string, string][]
  )
    .filter(([n]) => n)
    .map(([n, one, many]) => (n === 1 ? one : t(many, { n })))
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
    if (into === 'wall' && n < of) toast(t('Built {n} of {of} columns into the walls', { n, of }), { description: t('The others have no wall near them.') })
  }
  return (
    <>
      <Section title={t('{n} selected', { n: items.length })}>
        <p className="text-sm text-muted-foreground">{parts.join(t(', '))}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => rotateSelection(-90)}>
            <RotateCw className="-scale-x-100" /> 90°
          </Button>
          <Button variant="outline" size="sm" onClick={() => rotateSelection(90)}>
            <RotateCw /> 90°
          </Button>
          <span className="self-center text-xs text-muted-foreground">{t('or drag the handle above them')}</span>
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
                <Columns2 /> {columns === 1 ? t('Build the column into the walls') : t('Build {n} columns into the walls', { n: columns })}
              </Button>
            )}
            {inWalls > 0 && (
              <Button variant="outline" size="sm" onClick={() => convert('free', inWalls)}>
                <Columns2 /> {inWalls === 1 ? t('Make the wall column free-standing') : t('Make {n} wall columns free-standing', { n: inWalls })}
              </Button>
            )}
          </div>
        )}
        {Object.keys(gaps).length > 0 && (
          <div className="space-y-2 rounded-lg bg-muted/60 p-3">
            <p className="text-sm font-medium">{t('Position in the room')}</p>
            {(
              [
                [t('Side to side'), 'across', gaps.left, gaps.right, across],
                [t('Top to bottom'), 'depth', gaps.back, gaps.front, depthwise],
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
                    {centered ? t('Centered') : t('Center')}
                  </Button>
                </div>
              )
            })}
            {across && depthwise && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => centerSelection('both')}>
                <AlignHorizontalJustifyCenter /> {t('Center in the room')}
              </Button>
            )}
            <PushRow gaps={gaps} rotation={0} onPush={pushSelection} fmt={fmt} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {grouped ? (
            <Button variant="outline" size="sm" onClick={() => groupSelection(false)}>
              <Ungroup /> {t('Ungroup')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => groupSelection(true)}>
              <Group /> {t('Group')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={duplicateSelection}>
            <Copy /> {t('Duplicate')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const n = copySelection()
              const note = copiedNote(n)
              if (n) toast(note.title, { description: note.description })
            }}
          >
            <ClipboardCopy /> {t('Copy')}
          </Button>
          <Button variant="destructive" size="sm" onClick={deleteSelection}>
            <Trash2 /> {t('Delete')}
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('Drag any of them to move them all, or use the arrow keys.')} {grouped ? t('Alt + click picks one item in the group.') : t('Group them to keep them together.')}{' '}
          {t('Shortcuts: Ctrl+G group, Ctrl+Shift+G ungroup, Ctrl+C / X / V, Ctrl+D, Delete.')}
        </p>
      </Section>
      {lit && (
        <>
          <Separator />
          <Section title={t('Lights')}>
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
            <Video className="size-4" /> {t('Saved 3D view')}
          </span>
        }
      >
        <Field label={t('Name')}>
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
        <Field label={t('Eye height')}>
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
          <Box /> {t('Look from here in 3D')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('Drag the camera to move it, and its round handle to turn it. Arrow keys nudge it.')}</p>
      </Section>
      <Separator />
      <Section>
        <Button variant="destructive" size="sm" onClick={deleteSelection}>
          <Trash2 /> {t('Delete')}
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
            {t(p.name)} · {formatLength(p.height, units)}
          </Button>
        ))}
      </div>
      <Field label={t('Height')}>
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
      <Field label={t('Shoulders')}>
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
      <Field label={t('Skin')}>
        {() => (
          <div className="flex flex-wrap items-center gap-1.5 py-1">
            {SKIN_TONES.map((c) => {
              const on = personLook(sym).skin === c.hex
              return (
                <button
                  key={c.hex}
                  type="button"
                  title={t(c.name)}
                  aria-label={t('Skin: {name}', { name: t(c.name) })}
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
        label={t('Pose')}
        value={pose}
        onChange={(v) => updatePerson(sym.id, { pose: v })}
        options={(['stand', 'sit', 'lie'] as const).map((p) => ({ value: p, label: t(POSE_NAMES[p]) }))}
      >
        <p className="text-xs text-muted-foreground">
          {pose === 'stand'
            ? t('Drag them onto a chair, sofa or bed and pick sitting or lying: they settle onto it.')
            : on
              ? t('{pose} on the {item}, {height} up. Drag them to another spot on it.', { pose: t(POSE_NAMES[pose]), item: t(on.name), height: formatLength(on.height, units) })
              : pose === 'sit'
                ? t('Sitting on the floor. Drag them onto a chair, sofa, bed or toilet to sit on it.')
                : t('Lying on the floor. Drag them onto a bed or sofa to lie on it.')}
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
  const beam = sym.type === 'beam'
  const partition = sym.type === 'partition'
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
  // Right up against the wall on one side, or turned round to stand with its back to the nearest one.
  const sides = free ? sideGaps(sym, floor) : {}
  const pushTo = (side: Side) => {
    const p = pushedTo(sym, floor, side)
    if (p) updateSymbol(sym.id, (s) => Object.assign(s, p))
  }
  const backed = free && BACK_TO_WALL.has(sym.type) ? backToNearestWall(sym, floor) : null
  const isBacked = !!backed && Math.abs(backed.x - sym.x) < 0.5 && Math.abs(backed.y - sym.y) < 0.5 && Math.abs(backed.rotation - sym.rotation) < 0.5
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
          <Field label={def?.fixture === 'switch' ? t('Name') : t('Text')}>
            {(id) => (
              <TextInput id={id} value={sym.label ?? ''} onChange={(v) => updateSymbol(sym.id, (s) => void (s.label = v))} />
            )}
          </Field>
        )}
        {sym.type === 'tv' && <TvSize sym={sym} />}
        {(
          [
            ['width', isRound(sym.type) ? t('Diameter') : beam || partition ? t('Length') : t('Width'), true],
            ['depth', isLabel ? t('Text size') : beam ? t('Width') : partition ? t('Thickness') : t('Depth'), !sym.wall && !isRound(sym.type)],
            [
              'height',
              sym.type === 'gypsum-box'
                ? t('Drop')
                : beam
                  ? t('Below the ceiling')
                  : def?.fixture === 'switch'
                    ? t('Mount height')
                    : sym.type === 'shower' && sym.glassToCeiling
                      ? t('Door height')
                      : t('Height'),
              // A wall-hung toilet's is its box's (see its mounting); a walk-in shower's glass up to the ceiling has none.
              !isLabel &&
                !def?.fullHeight &&
                (!partition || !!sym.partial) &&
                !(sym.type === 'toilet' && sym.mount === 'wall') &&
                !(sym.type === 'shower' && sym.glassToCeiling && sym.walkIn),
            ],
          ] as [Dim, string, boolean][]
        ).map(([dim, label, shown]) => {
          if (!shown || sym.type === 'person') return null
          const rule = sizeRule(sym, dim)
          return (
            <Field key={dim} label={label}>
              {(id) =>
                rule?.fixed ? (
                  <div id={id} className="flex h-8 items-center gap-1.5 text-sm tabular-nums">
                    {formatLength(rule.min, units)}
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="size-3" /> {t('standard size')}
                    </span>
                  </div>
                ) : (
                  <LengthInput
                    id={id}
                    value={sym[dim]}
                    units={units}
                    onChange={(v) => {
                      if (rule && (v < rule.min || v > rule.max)) {
                        toast(t('{item}: {size} {min} to {max}', { item: def ? t(def.name) : t('This item'), size: label, min: formatLength(rule.min, units), max: formatLength(rule.max, units) }), {
                          description: t('Kept to a size it comes in.'),
                        })
                      }
                      updateSymbol(sym.id, (s) => {
                        const next = resized(s, { [dim]: v })
                        // Against a wall, it keeps its back there as it's made deeper or shallower.
                        if (dim === 'depth' && !s.wall && (def?.wallMount || BACK_TO_WALL.has(s.type))) keepBack(s, next.depth)
                        Object.assign(s, next)
                      })
                    }}
                  />
                )
              }
            </Field>
          )
        })}
        {def?.fullHeight && <p className="text-xs text-muted-foreground">{t("Floor to ceiling, whatever the room's height.")}</p>}
        {sym.type === 'shower' && <ShowerGlass sym={sym} />}
        {(sym.type === 'shower' || sym.type === 'shower-quadrant') && <ShowerHeadPicker sym={sym} />}
        {sym.type === 'toilet' && <ToiletMount sym={sym} />}
        {partition && <PartitionOptions sym={sym} />}
        {STYLES[sym.type] && (
          <Field label={t('Style')}>
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
                      <SelectLabel>{t(kind)}</SelectLabel>
                      {STYLES[sym.type].filter((p) => p.kind === kind).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {t(p.name)}
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
        {NICHES.has(sym.type) && (
          <div className="space-y-3 rounded-lg bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">
              {sym.type === 'shower-niche'
                ? t("Recessed into the wall and lined with the wall's finish (its tiles, if it's tiled).")
                : t("Recessed into the wall and finished like it: painted, or its tiles if it's tiled.")}
            </p>
            <Field label={t('Height from floor')}>
              {(id) => (
                <LengthInput
                  id={id}
                  value={sym.elevation ?? def?.sill ?? 0}
                  units={units}
                  min={0}
                  onChange={(v) => updateSymbol(sym.id, (s) => void (s.elevation = v))}
                />
              )}
            </Field>
            <p className="-mt-2 text-xs text-muted-foreground">{t('To the bottom of the niche, its sill.')}</p>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>{t('Glass shelf')}</span>
              <Switch size="sm" checked={!!sym.shelf} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (s.shelf = on || undefined))} />
            </label>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5">
                <Lightbulb className="size-4" /> {t('LED strip')}
              </span>
              <Switch size="sm" checked={!!sym.led} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (s.led = on || undefined))} />
            </label>
            {sym.led && <LightSection sym={sym} units={units} />}
          </div>
        )}
        {sym.type === 'oven-tower' && (
          <Choice
            label={t('Built in')}
            value={sym.appliances ?? 'micro'}
            onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'micro' ? delete s.appliances : (s.appliances = v as 'oven' | 'two-ovens')))}
            options={[
              { value: 'micro', label: t('Oven + microwave') },
              { value: 'oven', label: t('Oven') },
              { value: 'two-ovens', label: t('Two ovens') },
            ]}
          />
        )}
        {sym.type === 'kitchen-island' && (
          <div className="space-y-3 rounded-lg bg-muted/60 p-3">
            <Choice
              label={t('In the top')}
              value={sym.islandTop ?? 'none'}
              onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'none' ? delete s.islandTop : (s.islandTop = v as 'hob' | 'sink')))}
              options={[
                { value: 'none', label: t('Nothing') },
                { value: 'hob', label: t('Hob') },
                { value: 'sink', label: t('Sink') },
              ]}
            />
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>{t('Stools')}</span>
              <Switch size="sm" checked={sym.stool !== false} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (on ? delete s.stool : (s.stool = false)))} />
            </label>
          </div>
        )}
        {sym.type === 'wall-cabinet' && (
          <div className="space-y-3 rounded-lg bg-muted/60 p-3">
            <Choice
              label={t('Fronts')}
              value={sym.fronts ?? 'doors'}
              onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'doors' ? delete s.fronts : (s.fronts = v as 'glass' | 'open')))}
              options={[
                { value: 'doors', label: t('Doors') },
                { value: 'glass', label: t('Glass doors') },
                { value: 'open', label: t('Open shelves') },
              ]}
            />
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5">
                <Lightbulb className="size-4" /> {t('Light under it')}
              </span>
              <Switch size="sm" checked={!!sym.led} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (s.led = on || undefined))} />
            </label>
            {sym.led && <LightSection sym={sym} units={units} />}
          </div>
        )}
        {sym.type === 'range-hood' && (
          <div className="space-y-3 rounded-lg bg-muted/60 p-3">
            {styleOf(sym) !== 'built-in' && <p className="text-xs text-muted-foreground">{t('Its chimney goes up to the ceiling.')}</p>}
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5">
                <Lightbulb className="size-4" /> {t('Hood lights')}
              </span>
              <Switch size="sm" checked={!!sym.led} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (s.led = on || undefined))} />
            </label>
            {sym.led && <LightSection sym={sym} units={units} />}
          </div>
        )}
        {(sym.type === 'towel-rail' || sym.type === 'towel-radiator') && (
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{t('Towel on it')}</span>
            <Switch size="sm" checked={sym.towel !== false} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (on ? delete s.towel : (s.towel = false)))} />
          </label>
        )}
        {sym.type === 'bath-vanity' && <VanityOptions sym={sym} units={units} />}
        {sym.type === 'dressing-table' && (
          <div className="space-y-3 rounded-lg bg-muted/60 p-3">
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>{t('Stool')}</span>
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
                <span>{t('Glass doors')}</span>
                <Switch size="sm" checked={hasGlass(sym)} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (s.glass = on))} />
              </label>
            )}
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5">
                <Lightbulb className="size-4" /> {t('LED lighting inside')}
              </span>
              <Switch size="sm" checked={!!sym.led} onCheckedChange={(on) => updateSymbol(sym.id, (s) => void (s.led = on || undefined))} />
            </label>
            {sym.led && <LightSection sym={sym} units={units} />}
          </div>
        )}
        {def?.frames && <FramePicker sym={sym} frames={def.frames} label={def.frameLabel} />}
        {sym.type === 'shower-bench' && styleOf(sym) !== 'fold-down' && (
          <Choice
            label={t('Base')}
            value={sym.floating ? 'floating' : 'floor'}
            onChange={(v) => updateSymbol(sym.id, (s) => void (v === 'floating' ? (s.floating = true) : delete s.floating))}
            options={[
              { value: 'floor', label: t('To the floor') },
              { value: 'floating', label: t('Floating') },
            ]}
          >
            <p className="text-xs text-muted-foreground">
              {sym.floating ? t("Held on the wall, clear of the floor, so it's easy to clean under.") : t('Built up from the floor.')}{' '}
              {t("Finished like the wall behind it (its tiles, if it's tiled), with a stone top.")}
            </p>
          </Choice>
        )}
        {hasWorktop(sym) && <WorktopPicker sym={sym} label={sym.type === 'shower-bench' ? t('Top') : undefined} />}
        {def?.sill !== undefined && !NICHES.has(sym.type) && (
          <Field label={t('Sill height')}>
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
          <Field label={t('Above the floor')}>
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
        {free && (across || depthwise || Object.keys(sides).length > 0) && (
          <div className="space-y-2 rounded-lg bg-muted/60 p-3">
            <p className="text-sm font-medium">{t('Position in the room')}</p>
            {(
              [
                [t('Side to side'), 'across', gaps.left, gaps.right, across],
                [t('Front to back'), 'depth', gaps.back, gaps.front, depthwise],
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
                    {centered ? t('Centered') : t('Center')}
                  </Button>
                </div>
              )
            })}
            {across && depthwise && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => centerIn('both')}>
                <AlignHorizontalJustifyCenter /> {t('Center in the room')}
              </Button>
            )}
            <PushRow gaps={sides} rotation={sym.rotation} onPush={pushTo} fmt={fmt} piece />
            {backed && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={isBacked}
                onClick={() => updateSymbol(sym.id, (s) => void Object.assign(s, { x: backed.x, y: backed.y, rotation: backed.rotation }))}
              >
                <ArrowUpToLine /> {isBacked ? t('Against the wall') : t('Back to the nearest wall')}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              {backed
                ? t("Gaps to the nearest wall on each side. Dragged close to a wall it's pulled right up against it, turned to face the room, and it lines up with the pieces around it; near the middle it snaps to that. Hold Ctrl to place it freely.")
                : t("Gaps to the nearest wall on each side. Dragged close to a wall it's pulled right up against it and it lines up with the pieces around it; near the middle it snaps to that. Hold Ctrl to place it freely.")}
            </p>
          </div>
        )}
        {DOOR_DEFAULT[sym.type] && sym.type !== 'shower' && (
          <Choice
            label={t('Doors')}
            value={sym.doors ?? DOOR_DEFAULT[sym.type]}
            onChange={(v) => updateSymbol(sym.id, (s) => void (s.doors = v))}
            options={[
              { value: 'hinged', label: t('Hinged') },
              { value: 'sliding', label: t('Sliding') },
            ]}
          />
        )}
        {sym.type.startsWith('wardrobe') && (
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{t('Glass doors')}</span>
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
                if (!placeBehindSofa(sym.id)) toast.error(t('There is no sofa near it. Move it close to the back of one first.'))
              }}
            >
              <Sofa /> {t('Put it behind the sofa')}
            </Button>
            <p className="text-xs text-muted-foreground">{t("Drag it near a sofa's back (or either back of a corner sofa) and it tucks in behind it.")}</p>
          </div>
        )}
        {beam && (
          <div className="space-y-1.5">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                const span = beamSpan(sym, floor.rooms, sym.rotation)
                if (span) updateSymbol(sym.id, (b) => void Object.assign(b, span))
                else toast.error(t('There are no walls either side of it that way.'))
              }}
            >
              <MoveHorizontal /> {t('Wall to wall')}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t("Hung from the ceiling slab, drawn dashed as plans show what's overhead. A gypsum ceiling lower than it hides it. Suggested designs keep tall furniture and ceiling spots clear of it.")}
            </p>
          </div>
        )}
        {(sym.type === 'column' || sym.type === 'wall-post') && (
          <div className="space-y-1.5">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                if (!convertColumns([sym.id], sym.type === 'column' ? 'wall' : 'free')) toast.error(t('There is no wall near it. Move it up to a wall first.'))
              }}
            >
              <Columns2 /> {sym.type === 'column' ? 'Build it into the wall' : 'Make it free-standing'}
            </Button>
            <p className="text-xs text-muted-foreground">
              {sym.type === 'column'
                ? t('Moves it against the nearest wall, standing out of it into the room. The gypsum ceiling, hidden lights and shadow gaps then go around it.')
                : t('Makes it a column on its own, away from the walls, where it is now.')}
            </p>
          </div>
        )}
        {(sym.type === 'sofa-corner' || sym.type === 'wardrobe-corner') && (
          <Choice
            label={t('Corner on')}
            value={sym.flipX ? 'right' : 'left'}
            onChange={(v) => updateSymbol(sym.id, (s) => void (s.flipX = v === 'right'))}
            options={[
              { value: 'left', label: t('Left') },
              { value: 'right', label: t('Right') },
            ]}
          />
        )}
        {!sym.wall && !sym.room && sym.type !== 'label' && (
          <KeepSwitch checked={!!sym.keep} onChange={(on) => updateSymbol(sym.id, (s) => void (on ? (s.keep = true) : delete s.keep))} />
        )}
        {!sym.wall && (
          <Field label={t('Rotation')}>
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
            <FlipHorizontal2 /> {sym.wall ? t('Hinge side') : tc('flip', 'Mirror')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => updateSymbol(sym.id, (s) => void (s.flipY = !s.flipY))}>
            <FlipVertical2 /> {sym.wall ? t('Swing side') : t('Flip front/back')}
          </Button>
        </div>
        {sym.wall && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm">
            <span>
              {t('In wall {n} of {room}', { n: sym.wall.edge + 1, room: wallRoom?.name ?? t('the room') })}
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
              <Link2Off /> {t('Detach')}
            </Button>
          </div>
        )}
        {sym.wall && wallLen > 0 && (
          <div className="space-y-2">
            <Field label={t('Gap to wall start')}>
              {(id) => (
                <LengthInput id={id} value={Math.max(0, gapStart)} units={units} min={0} onChange={(v) => setOffset(v + sym.width / 2)} />
              )}
            </Field>
            <Field label={t('Gap to wall end')}>
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
              <AlignHorizontalJustifyCenter /> {Math.abs(gapStart - gapEnd) < 0.5 ? t('Centered on the wall') : t('Center on wall')}
            </Button>
          </div>
        )}
        {def?.wall && !sym.wall && <p className="text-xs text-muted-foreground">{t('Drag it onto a wall to insert it.')}</p>}
      </Section>
      {def?.fixture && (
        <>
          <Separator />
          <Section title={def.fixture === 'switch' ? t('Switch wiring') : tc('section', 'Light')}>
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
      <Section title={t('Floor')}>
        <Field label={t('Name')}>
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
            toast(n ? t('Added overall dimensions.') : t('Overall dimensions are already there (or the floor is empty).'))
          }}
        >
          <Ruler /> {t('Add overall dimensions')}
        </Button>
        <Field label={t('Wall height')}>
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
          <Section title={t('Background drawing')}>
            <label className="flex items-center justify-between text-sm">
              {t('Show while editing')}
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
                <span className="text-muted-foreground">{t('Opacity')}</span>
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
            <p className="text-xs text-muted-foreground">{t("Only shown while editing. It isn't exported or shown in 3D.")}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                commit((d) => {
                  draftFloor(d).underlay = undefined
                })
              }
            >
              <ImageOff /> {t('Remove drawing')}
            </Button>
          </Section>
        </>
      )}
      <Separator />
      <Section title={t('Project')}>
        <Field label={t('Name')}>
          {(id) => <TextInput id={id} value={project.name} onChange={(v) => commit((d) => void (d.name = v))} />}
        </Field>
        <Field label={t('Units')}>
          {(id) => (
            <Select value={project.units} onValueChange={(v) => commit((d) => void (d.units = v as Units))}>
              <SelectTrigger id={id} className="w-full" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="metric">{t('Metric (m, cm)')}</SelectItem>
                <SelectItem value="imperial">{t('Imperial (ft, in)')}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label={t('Default wall')}>
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
      <Section title={t('Getting started')}>
        <ul className="list-disc space-y-1.5 ps-4 text-xs leading-relaxed text-muted-foreground">
          <li>{t('Press R and drag to draw a rectangular room, or P to click out any shape.')}</li>
          <li>{t('While drawing, type a length (e.g. 3.5) and press Enter for exact walls.')}</li>
          <li>{t("Add doors, windows and furniture from the Library tab. Dragged up to a wall, they're pulled flush against it.")}</li>
          <li>
            {t('One open space with two looks (a reception and its corridor)? Divide it with S: two rooms, each with its own floor, ceiling and lights, and no wall between them.')}
          </li>
          <li>{t('Scroll to zoom, drag empty space to pan, double-click a room to zoom to it. Switch to 3D at the top.')}</li>
        </ul>
        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={startTour}>
          <CircleHelp /> {t('Take the tour')}
        </Button>
      </Section>
    </>
  )
}

/** Buttons that push a piece (or several) right up against the wall on one side; each arrow points the way it goes. */
function PushRow({
  gaps,
  rotation,
  onPush,
  fmt,
  piece,
}: {
  gaps: Partial<Record<Side, number>>
  rotation: number
  onPush: (side: Side) => void
  fmt: (v?: number) => string
  /** One piece, whose sides are its own (else: up, down, left and right on the plan). */
  piece?: boolean
}) {
  const turn: Record<Side, number> = { right: 0, front: 90, left: 180, back: 270 }
  const label = (side: Side) =>
    piece
      ? t({ back: 'Its back up to the wall', front: 'Its front up to the wall', left: 'This side up to the wall', right: 'This side up to the wall' }[side])
      : t({ back: 'Move them up to the wall', front: 'Move them down to the wall', left: 'Move them left to the wall', right: 'Move them right to the wall' }[side])
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{t('Up to the wall')}</span>
      <div className="flex gap-1">
        {(['left', 'back', 'front', 'right'] as const)
          // In the order they point on screen: left, up, down, right.
          .map((side) => ({ side, way: Math.round((((rotation + turn[side]) % 360) + 360) % 360 / 90) % 4 }))
          .sort((a, b) => [2, 3, 1, 0].indexOf(a.way) - [2, 3, 1, 0].indexOf(b.way))
          .map(({ side }) => {
            const g = gaps[side]
            const there = g !== undefined && Math.abs(g) < 0.5
            return (
              <Tooltip key={side}>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      size="icon-xs"
                      disabled={g === undefined || there}
                      onClick={() => onPush(side)}
                      aria-label={label(side)}
                    >
                      <ArrowRight style={{ transform: `rotate(${rotation + turn[side]}deg)` }} />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {g === undefined ? t('No wall that way') : there ? t('Against the wall') : t('{what}, {gap} away', { what: label(side), gap: fmt(g) })}
                </TooltipContent>
              </Tooltip>
            )
          })}
      </div>
    </div>
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
