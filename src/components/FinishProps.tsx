import { useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { readPhoto } from '@/lib/images'
import { cn } from '@/lib/utils'
import { FINISHES, finishOf, FLOOR_GROUPS, PATTERN_NAMES, WALL_GROUPS, WALL_WHITE, wallSurfaceAt } from '@/model/finishes'
import type { Place } from '@/model/finishes'
import { bbox, dist, polygonPath } from '@/model/geometry'
import { uid } from '@/model/project'
import { formatLength } from '@/model/units'
import type { Finish, FloorFinish, FloorPattern, Project, ProjectImage, Room, Surface, Units, WallFinish, WallSurface } from '@/model/types'
import { draftFloor, useEditor } from '@/store/editor'
import { Choice } from './Choice'
import { LengthInput, NumberInput } from './LengthInput'

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

/** Change a room, and anything else in the project, as one undo step. */
function updateRoom(id: string, recipe: (r: Room, d: Project) => void) {
  useEditor.getState().commit((d) => {
    const r = draftFloor(d).rooms.find((x) => x.id === id)
    if (r) recipe(r, d)
  })
}

const sizeName = (kind: string, [a, b]: [number, number]) => (kind === 'slats' ? `${a} cm slats, ${b} cm gaps` : `${a} × ${b} cm`)

/** The preset size whose shape best matches a photo's (it's of one tile or plank). */
function sizeForPhoto(sizes: [number, number][], current: [number, number] | undefined, img: ProjectImage): [number, number] | undefined {
  const ratio = (s: [number, number]) => Math.log(Math.max(...s) / Math.min(...s))
  const want = Math.log(Math.max(img.w, img.h) / Math.min(img.w, img.h))
  if (current && Math.abs(ratio(current) - want) < 0.1) return current
  return [...sizes].sort((p, q) => Math.abs(ratio(p) - want) - Math.abs(ratio(q) - want))[0]
}

/** Choose a finish from groups, or none (the label says what that means). */
function FinishSelect<F extends Finish>({
  id,
  value,
  groups,
  none,
  onChange,
}: {
  id: string
  value: F | undefined
  groups: [string, F[]][]
  none: string
  onChange: (f: F | undefined) => void
}) {
  return (
    <Select value={value ?? 'none'} onValueChange={(v) => onChange(v === 'none' ? undefined : (v as F))}>
      <SelectTrigger id={id} size="sm" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{none}</SelectItem>
        {groups.map(([group, list]) => (
          <SelectGroup key={group}>
            <SelectLabel>{group}</SelectLabel>
            {list.map((k) => (
              <SelectItem key={k} value={k}>
                {FINISHES[k].name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Round color swatches, with the chosen one ringed. */
function Swatch({ color, name, on, onClick, small }: { color: string; name: string; on: boolean; onClick: () => void; small?: boolean }) {
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
        small ? 'size-5' : 'size-6',
        on && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}
      style={{ background: color }}
    />
  )
}

/** Any color, from the browser's color picker (one undo step however long it's dragged around). */
function CustomColor({ value, on, onChange }: { value: string; on: boolean; onChange: (c: string, first: boolean) => void }) {
  const started = useRef(false)
  return (
    <label
      title="Any color"
      className={cn(
        'relative size-6 shrink-0 cursor-pointer rounded-full border shadow-sm focus-within:ring-2 focus-within:ring-ring',
        on && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}
      style={{ background: on ? value : 'conic-gradient(#f87171, #facc15, #4ade80, #22d3ee, #818cf8, #e879f9, #f87171)' }}
    >
      <input
        type="color"
        aria-label="Any color"
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        value={value}
        onFocus={() => (started.current = false)}
        onChange={(e) => {
          onChange(e.target.value, !started.current)
          started.current = true
        }}
      />
    </label>
  )
}

/**
 * The choices for a floor's or wall's finish: its color or a photo of the real thing, its size, how its pieces are
 * laid and which way they run, and on walls how high tiles go.
 */
function SurfaceControls<S extends Surface>({
  surface,
  place,
  units,
  set,
}: {
  surface: S
  place: Place
  units: Units
  /** Change the finish (and anything else in the project) as one undo step; `live` changes skip the undo step. */
  set: (patch: Partial<S>, also?: (d: Project) => void, live?: boolean) => void
}) {
  const images = useEditor((s) => s.project.images) ?? []
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [customSize, setCustomSize] = useState(false)
  const f = finishOf(surface, place)
  const kind = f.def.kind
  const photo = surface.image ? images.find((i) => i.id === surface.image) : undefined
  const pieces = kind === 'tile' || kind === 'plank' || kind === 'slats'
  const preset = !!f.size && f.sizes.some((s) => s[0] === f.size![0] && s[1] === f.size![1])
  const showCustom = pieces && f.size && (customSize || !preset)
  const square = !!f.size && f.size[0] === f.size[1]
  const named = f.def.colors.find((c) => c.hex === f.color)?.name

  const addPhoto = async (file: File) => {
    setBusy(true)
    try {
      const img = await readPhoto(file, uid())
      // A photo of one tile or plank picks the size of its shape; one of a wallpaper or carpet covers a roll's width.
      const size = pieces
        ? sizeForPhoto(f.sizes, f.size, img)
        : ([kind === 'paper' ? 53 : 100, Math.round((kind === 'paper' ? 53 : 100) * (img.h / img.w))] as [number, number])
      set({ image: img.id, size } as Partial<S>, (d) => void (d.images = [...(d.images ?? []), img]))
    } catch {
      toast.error("That file couldn't be read as a picture.")
    } finally {
      setBusy(false)
    }
  }

  const removePhoto = (img: ProjectImage) =>
    set({} as Partial<S>, (d) => {
      d.images = (d.images ?? []).filter((i) => i.id !== img.id)
      // Nothing shows it any more.
      const clear = (s: Surface | null | undefined) => {
        if (s?.image === img.id) delete s.image
      }
      for (const fl of d.floors) {
        for (const r of fl.rooms) {
          clear(r.floor)
          clear(r.walls)
          r.wallFinishes?.forEach(clear)
        }
      }
    })

  return (
    <>
      {kind !== 'paint' && <p className="text-xs text-muted-foreground">{f.def.hint}</p>}
      <Field label="Color">
        {() => (
          <div className="space-y-1.5 py-1">
            <div className="flex flex-wrap items-center gap-2">
              {f.def.colors.map((c) => (
                <Swatch key={c.hex} color={c.hex} name={c.name} on={!photo && c.hex === f.color} onClick={() => set({ color: c.hex, image: undefined } as Partial<S>)} />
              ))}
              <CustomColor
                value={f.color}
                on={!photo && !named}
                onChange={(c, first) => set({ color: c, image: undefined } as Partial<S>, undefined, !first)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {images.map((img) => (
                <span key={img.id} className="group relative">
                  <button
                    type="button"
                    title={img.name}
                    aria-label={`Photo: ${img.name}`}
                    aria-pressed={photo?.id === img.id}
                    onClick={() => set({ image: img.id } as Partial<S>)}
                    className={cn(
                      'block size-7 overflow-hidden rounded-md border shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      photo?.id === img.id && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                    )}
                  >
                    <img src={img.src} alt="" className="size-full object-cover" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove photo ${img.name}`}
                    title="Remove this photo from the plan"
                    onClick={() => removePhoto(img)}
                    className="absolute -top-1.5 -right-1.5 hidden size-4 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm group-focus-within:flex group-hover:flex hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => fileRef.current?.click()}>
                <ImagePlus /> {images.length ? 'Add' : 'Use a photo'}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void addPhoto(file)
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {photo
                ? `${photo.name}: ${pieces ? `one ${kind === 'tile' ? 'tile' : kind === 'slats' ? 'slat' : 'plank'}, laid like the others` : 'repeated over the surface'}`
                : (named ?? 'Custom color')}
            </p>
          </div>
        )}
      </Field>
      {f.design && !photo && (
        <Field label="Design">
          {(id) => (
            <Select value={f.design!.id} onValueChange={(v) => set({ design: v } as Partial<S>)}>
              <SelectTrigger id={id} size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {f.def.designs!.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      )}
      {pieces && f.sizes.length > 0 && (
        <Field label={kind === 'tile' ? 'Tile size' : kind === 'slats' ? 'Slats' : 'Plank size'}>
          {(id) => (
            <Select
              value={showCustom ? 'custom' : f.size!.join('x')}
              onValueChange={(v) => {
                if (v === 'custom') return setCustomSize(true)
                setCustomSize(false)
                set({ size: v.split('x').map(Number) as [number, number] } as Partial<S>)
              }}
            >
              <SelectTrigger id={id} size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {f.sizes.map((s) => (
                  <SelectItem key={s.join('x')} value={s.join('x')}>
                    {sizeName(kind, s)}
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value="custom">Another size…</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
      )}
      {f.size && (showCustom || (!pieces && photo)) && (
        <Field label={pieces ? (kind === 'slats' ? 'Slat, gap (cm)' : 'Size (cm)') : 'Covers (cm)'}>
          {() => (
            <div className="grid grid-cols-2 gap-1.5">
              {[0, 1].map((k) => (
                <NumberInput
                  key={k}
                  value={f.size![k]}
                  step={0.5}
                  onChange={(v) => {
                    if (!(v > 0.2 && v <= 400)) return
                    const size = [...f.size!] as [number, number]
                    size[k] = v
                    set({ size } as Partial<S>)
                  }}
                />
              ))}
            </div>
          )}
        </Field>
      )}
      {f.patterns.length > 1 && (
        <Field label="Laying">
          {(id) => (
            <Select value={f.pattern} onValueChange={(v) => set({ pattern: v as FloorPattern } as Partial<S>)}>
              <SelectTrigger id={id} size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {f.patterns.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PATTERN_NAMES[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      )}
      {pieces && !(kind === 'tile' && square && (f.pattern === 'straight' || f.pattern === 'diagonal')) && (
        <Choice
          label="Direction"
          value={surface.turned ? 'across' : 'along'}
          onChange={(v) => set({ turned: v === 'across' || undefined } as Partial<S>)}
          options={(place === 'floor' ? ['Horizontal', 'Vertical'] : kind === 'slats' ? ['Upright', 'Lying'] : ['Lying', 'Upright']).map((label, i) => ({
            value: i ? 'across' : 'along',
            label,
          }))}
        />
      )}
      {f.pattern === 'herringbone' && (
        <Choice
          label="Angle"
          value={surface.parallel ? 'parallel' : 'diagonal'}
          onChange={(v) => set({ parallel: v === 'parallel' || undefined } as Partial<S>)}
          options={[
            { value: 'diagonal', label: 'At 45°', title: 'Planks at 45° to the walls: the classic herringbone' },
            { value: 'parallel', label: 'Along walls', title: 'Planks parallel to the walls: a straight herringbone' },
          ]}
        />
      )}
      {place === 'wall' && (kind === 'tile' || kind === 'slats') && <PartWay surface={surface as WallSurface} units={units} set={set as (p: Partial<WallSurface>) => void} />}
    </>
  )
}

/** Tiles or slats to the ceiling, or part way up (e.g. 120 cm in a bathroom) with paint above. */
function PartWay({ surface, units, set }: { surface: WallSurface; units: Units; set: (p: Partial<WallSurface>) => void }) {
  const above = surface.above ?? WALL_WHITE
  return (
    <>
      <Choice
        label="Up to"
        value={surface.height ? 'part' : 'full'}
        onChange={(v) => set({ height: v === 'part' ? 120 : undefined })}
        options={[
          { value: 'full', label: 'The ceiling' },
          { value: 'part', label: 'Part way' },
        ]}
      />
      {surface.height && (
        <>
          <Field label="Height">{(id) => <LengthInput id={id} value={surface.height!} units={units} min={10} onChange={(v) => set({ height: v })} />}</Field>
          <Field label="Paint above">
            {() => (
              <div className="flex flex-wrap items-center gap-1.5 py-1">
                {FINISHES.paint.colors.map((c) => (
                  <Swatch key={c.hex} small color={c.hex} name={c.name} on={c.hex === above} onClick={() => set({ above: c.hex })} />
                ))}
              </div>
            )}
          </Field>
        </>
      )}
    </>
  )
}

/** A room's floor finish: tiles, planks or another surface. */
export function FloorSection({ room, units }: { room: Room; units: Units }) {
  const floor = room.floor
  return (
    <div className="space-y-2.5 rounded-lg bg-muted/60 p-3">
      <Field label="Floor">
        {(id) => (
          <FinishSelect<FloorFinish>
            id={id}
            value={floor?.finish}
            groups={FLOOR_GROUPS}
            none="Plain color"
            onChange={(v) =>
              updateRoom(room.id, (r) => {
                if (!v) delete r.floor
                // Keeps a photo when switching between kinds of tile.
                else r.floor = { finish: v, image: FINISHES[v].kind === FINISHES[r.floor?.finish ?? v].kind ? r.floor?.image : undefined }
              })
            }
          />
        )}
      </Field>
      {floor && (
        <SurfaceControls
          surface={floor}
          place="floor"
          units={units}
          set={(patch, also, live) => {
            const recipe = (d: Project) => {
              also?.(d)
              const r = draftFloor(d).rooms.find((x) => x.id === room.id)
              if (r?.floor) r.floor = { ...r.floor, ...patch }
            }
            const st = useEditor.getState()
            if (live) st.mutate(recipe)
            else st.commit(recipe)
          }}
        />
      )}
    </div>
  )
}

/**
 * A room's wall finishes: one for all its walls (paint, wallpaper, tiles…), and a different one on any wall picked on
 * the little plan, e.g. an accent wall or tiles behind a sink.
 */
export function WallsSection({ room, units }: { room: Room; units: Units }) {
  const images = useEditor((s) => s.project.images)
  const [wall, setWall] = useState<number | null>(null)
  const pts = room.points
  const at = wall !== null && wall < pts.length ? wall : null
  const own = at !== null ? room.wallFinishes?.[at] : undefined
  const b = bbox(pts)
  const w = Math.max(1, b.maxX - b.minX)
  const h = Math.max(1, b.maxY - b.minY)
  const pad = Math.max(w, h) * 0.08

  /** Change the room's finish, or one wall's (null: back to the room's). */
  const setSurface = (edge: number | null, next: WallSurface | null, also?: (d: Project) => void, live?: boolean) => {
    const recipe = (d: Project) => {
      also?.(d)
      const r = draftFloor(d).rooms.find((x) => x.id === room.id)
      if (!r) return
      if (edge === null) {
        if (next) r.walls = next
        else delete r.walls
        return
      }
      const list = r.points.map((_, k) => (k === edge ? next : (r.wallFinishes?.[k] ?? null)))
      if (list.some((x) => x)) r.wallFinishes = list
      else delete r.wallFinishes
    }
    const st = useEditor.getState()
    if (live) st.mutate(recipe)
    else st.commit(recipe)
  }
  const pick = (current: WallSurface | undefined, v: WallFinish) => ({
    finish: v,
    image: current && FINISHES[v].kind === FINISHES[current.finish].kind ? current.image : undefined,
  })
  const toneOf = (s: WallSurface | undefined) => {
    if (!s) return WALL_WHITE
    return (s.image && images?.find((i) => i.id === s.image)?.tone) || finishOf(s, 'wall').color
  }

  return (
    <div className="space-y-2.5">
      <div className="space-y-2.5 rounded-lg bg-muted/60 p-3">
        <Field label="All walls">
          {(id) => (
            <FinishSelect<WallFinish>
              id={id}
              value={room.walls?.finish}
              groups={WALL_GROUPS}
              none="Plain white"
              onChange={(v) => setSurface(null, v ? pick(room.walls, v) : null)}
            />
          )}
        </Field>
        {room.walls && (
          <SurfaceControls
            surface={room.walls}
            place="wall"
            units={units}
            set={(patch, also, live) => setSurface(null, { ...room.walls!, ...patch }, also, live)}
          />
        )}
      </div>
      <div className="space-y-1.5">
        <svg
          viewBox={`${b.minX - pad} ${b.minY - pad} ${w + pad * 2} ${h + pad * 2}`}
          className="h-28 w-full rounded-md bg-muted/60"
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label="Finish per wall"
        >
          <path d={polygonPath(pts)} className="fill-background" />
          {pts.map((a, i) => {
            const p = pts[(i + 1) % pts.length]
            const s = wallSurfaceAt(room, i)
            const custom = !!room.wallFinishes?.[i]
            const name = `Wall ${i + 1}, ${formatLength(dist(a, p), units)}: ${s ? FINISHES[s.finish].name : 'plain'}`
            return (
              <g
                key={i}
                role="button"
                aria-pressed={at === i}
                aria-label={name}
                tabIndex={0}
                className="cursor-pointer outline-none [&:focus-visible>line:last-child]:stroke-ring"
                onClick={() => setWall(at === i ? null : i)}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setWall(at === i ? null : i)
                  }
                }}
              >
                <title>{name}</title>
                <line x1={a.x} y1={a.y} x2={p.x} y2={p.y} stroke="transparent" strokeWidth={18} vectorEffect="non-scaling-stroke" />
                {at === i && <line x1={a.x} y1={a.y} x2={p.x} y2={p.y} stroke="var(--primary)" strokeWidth={9} strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={p.x}
                  y2={p.y}
                  stroke={toneOf(s)}
                  strokeWidth={custom || at === i ? 5 : 3.5}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  style={{ filter: 'drop-shadow(0 0 0.6px rgb(0 0 0 / 0.6))' }}
                />
              </g>
            )
          })}
        </svg>
        {at === null ? (
          <p className="text-xs text-muted-foreground">Click a wall to give it a different finish, e.g. an accent wall or tiles behind the sink.</p>
        ) : (
          <div className="space-y-2.5 rounded-lg border p-3">
            <Field label={`Wall ${at + 1}`}>
              {(id) => (
                <FinishSelect<WallFinish>
                  id={id}
                  value={own?.finish}
                  groups={WALL_GROUPS}
                  none={room.walls ? 'Same as the others' : 'Plain white'}
                  onChange={(v) => setSurface(at, v ? pick(own ?? room.walls, v) : null)}
                />
              )}
            </Field>
            {own && <SurfaceControls surface={own} place="wall" units={units} set={(patch, also, live) => setSurface(at, { ...own, ...patch }, also, live)} />}
          </div>
        )}
      </div>
    </div>
  )
}
