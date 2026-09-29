import { useId } from 'react'
import type { ReactNode } from 'react'
import { Box, Copy, FlipHorizontal2, FlipVertical2, ImageOff, Link2Off, Ruler, RotateCw, SplitSquareHorizontal, Trash2, Video } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { usePlanTheme } from '@/hooks/use-plan-theme'
import { cn } from '@/lib/utils'
import { area, dist, perimeter } from '@/model/geometry'
import { ROOM_COLORS, roomOuter, setWallLength, symbolPose } from '@/model/project'
import { SYMBOL_MAP } from '@/model/symbols'
import { formatArea, formatLength } from '@/model/units'
import type { Dimension, PlanSymbol, Room, SavedView, Units } from '@/model/types'
import {
  autoDimension,
  currentFloor,
  deleteSelection,
  draftFloor,
  duplicateSelection,
  removeVertex,
  splitWall,
  useEditor,
  useFloor,
  useSelectedRoom,
  useSelectedSymbol,
} from '@/store/editor'
import { useUi } from '@/store/ui'
import { LengthInput, NumberInput, TextInput } from './LengthInput'
import { CeilingSection, LightSection, SwitchSection } from './LightingProps'

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
  return (
    <>
      <Section title="Room">
        <Field label="Name">
          {(id) => <TextInput id={id} value={room.name} onChange={(v) => updateRoom(room.id, (r) => void (r.name = v))} />}
        </Field>
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
        <Field label="Wall thickness">
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
            ['Wall area', formatArea(area(roomOuter(room)) - a, units)],
          ]}
        />
      </Section>
      <Separator />
      <Section title="Gypsum ceiling">
        <CeilingSection room={room} units={units} />
      </Section>
      <Separator />
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
  return (
    <>
      <Section title="Cove / hidden light">
        <p className="text-sm text-muted-foreground">
          An LED strip hidden around the ceiling of <b className="text-foreground">{room?.name ?? 'the room'}</b>
          {room?.ceiling?.style === 'cove'
            ? ', inside the cove, washing the ceiling with light.'
            : room?.ceiling?.style === 'floating'
              ? ', on top of the floating panel, lighting the ceiling around it.'
              : ', in a shadow gap along the walls.'}
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
        <Field label="Width">
          {(id) => (
            <LengthInput id={id} value={sym.width} units={units} onChange={(v) => updateSymbol(sym.id, (s) => void (s.width = v))} />
          )}
        </Field>
        {!sym.wall && (
          <Field label={isLabel ? 'Text size' : 'Depth'}>
            {(id) => (
              <LengthInput id={id} value={sym.depth} units={units} onChange={(v) => updateSymbol(sym.id, (s) => void (s.depth = v))} />
            )}
          </Field>
        )}
        {!isLabel && (
          <Field label={sym.type === 'gypsum-box' ? 'Drop' : def?.fixture === 'switch' ? 'Mount height' : 'Height'}>
            {(id) => (
              <LengthInput id={id} value={sym.height} units={units} onChange={(v) => updateSymbol(sym.id, (s) => void (s.height = v))} />
            )}
          </Field>
        )}
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
            <FlipHorizontal2 /> Flip
          </Button>
          <Button variant="outline" size="sm" onClick={() => updateSymbol(sym.id, (s) => void (s.flipY = !s.flipY))}>
            <FlipVertical2 /> {sym.wall ? 'Swing side' : 'Flip'}
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
  if (room) return <RoomProps room={room} units={units} />
  if (sym?.room) return <CoveProps sym={sym} units={units} />
  if (sym) return <SymbolProps sym={sym} units={units} />
  if (dim) return <DimensionProps dim={dim} units={units} />
  if (view) return <ViewProps view={view} units={units} />
  return <FloorAndProjectProps />
}
