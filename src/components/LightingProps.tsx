import { useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Cable, Lightbulb, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { bbox, dist, polygonPath } from '@/model/geometry'
import { bandAt, bandInset, CEILING_STYLES, ceilingRoom, hasTrayEdge, LIGHT_COLORS, pocketWidth, pruneControls, roomColumns, switchesFor, WIRE_COLORS } from '@/model/lighting'
import { newSymbol, uid } from '@/model/project'
import { SYMBOL_MAP } from '@/model/symbols'
import { formatLength } from '@/model/units'
import type { CeilingStyle, LightColor, PlanSymbol, Room, TrackModule, Units } from '@/model/types'
import { applyCeiling, draftFloor, toggleWire, useEditor, useFloor } from '@/store/editor'
import { LengthInput } from './LengthInput'

export function updateSymbol(id: string, recipe: (s: PlanSymbol) => void) {
  useEditor.getState().commit((d) => {
    const s = draftFloor(d).symbols.find((x) => x.id === id)
    if (s) recipe(s)
  })
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_1fr] items-center gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Warm / white / cool picker. */
export function LightColorPicker({ value, onChange }: { value: LightColor; onChange: (c: LightColor) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
      {(Object.keys(LIGHT_COLORS) as LightColor[]).map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-md py-1 text-xs font-medium transition-colors',
            value === c ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
          title={`${LIGHT_COLORS[c].label} · ${LIGHT_COLORS[c].kelvin} K`}
        >
          <span className="size-3 rounded-full border border-black/10" style={{ background: LIGHT_COLORS[c].hex }} />
          {LIGHT_COLORS[c].label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Picking walls

/**
 * The room's outline with each wall clickable, for per-wall settings (hidden light, shadow gaps).
 * Walls in `on` are drawn in the accent color.
 */
export function WallPicker({
  room,
  on,
  onChange,
  units,
  tone,
  label,
}: {
  room: Room
  on: number[]
  onChange: (walls: number[]) => void
  units: Units
  tone: 'light' | 'dark'
  label: string
}) {
  const pts = room.points
  const b = bbox(pts)
  const w = Math.max(1, b.maxX - b.minX)
  const h = Math.max(1, b.maxY - b.minY)
  const pad = Math.max(w, h) * 0.08
  const color = tone === 'light' ? '#f59e0b' : 'var(--foreground)'
  const set = new Set(on)
  const toggle = (i: number) => onChange(set.has(i) ? on.filter((x) => x !== i) : [...on, i].sort((p, q) => p - q))
  return (
    <div className="space-y-1.5">
      <svg
        viewBox={`${b.minX - pad} ${b.minY - pad} ${w + pad * 2} ${h + pad * 2}`}
        className="h-32 w-full rounded-md bg-muted/60"
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={label}
      >
        <path d={polygonPath(pts)} className="fill-background" />
        {pts.map((a, i) => {
          const p = pts[(i + 1) % pts.length]
          const active = set.has(i)
          const name = `Wall ${i + 1}, ${formatLength(dist(a, p), units)}`
          return (
            <g
              key={i}
              role="checkbox"
              aria-checked={active}
              aria-label={name}
              tabIndex={0}
              className="cursor-pointer outline-none [&:focus-visible>line:last-child]:stroke-ring"
              onClick={() => toggle(i)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggle(i)
                }
              }}
            >
              <title>{`${name} · click to ${active ? 'remove' : 'add'}`}</title>
              <line x1={a.x} y1={a.y} x2={p.x} y2={p.y} stroke="transparent" strokeWidth={18} vectorEffect="non-scaling-stroke" />
              <line
                x1={a.x}
                y1={a.y}
                x2={p.x}
                y2={p.y}
                stroke={active ? color : 'var(--muted-foreground)'}
                strokeOpacity={active ? 1 : 0.35}
                strokeWidth={active ? 5 : 3}
                strokeDasharray={active ? undefined : '4 4'}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )
        })}
      </svg>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {on.length === pts.length ? 'All walls' : on.length ? `${on.length} of ${pts.length} walls` : 'No walls'} · click a wall to switch it
        </span>
        <span className="flex gap-2">
          <button className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => onChange(pts.map((_, i) => i))}>
            All
          </button>
          <button className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => onChange([])}>
            None
          </button>
        </span>
      </div>
    </div>
  )
}

/** Where a room's hidden LED strip runs: in a tray, along the walls or inside; and which walls it's on. */
/** Going around columns built into the walls, or stopping at them. */
function AtColumns({ value, onChange }: { value: 'wrap' | 'stop'; onChange: (v: 'wrap' | 'stop') => void }) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm text-muted-foreground">At columns in the walls</span>
      <ToggleGroup type="single" size="sm" variant="outline" value={value} onValueChange={(v) => v && onChange(v as 'wrap' | 'stop')} className="w-full">
        <ToggleGroupItem value="wrap" className="flex-1">
          Go around
        </ToggleGroupItem>
        <ToggleGroupItem value="stop" className="flex-1">
          Stop
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}

export function HiddenLightControls({ room, sym, units }: { room: Room; sym: PlanSymbol; units: Units }) {
  const floor = useFloor()
  const columns = roomColumns(room, floor).length > 0
  const off = new Set(sym.cove?.off ?? [])
  const lit = room.points.map((_, i) => i).filter((i) => !off.has(i))
  const style = room.ceiling?.style
  return (
    <div className="space-y-3">
      {hasTrayEdge(room) && (
        <div className="space-y-1.5">
          <span className="text-sm text-muted-foreground">Where</span>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={sym.cove?.at ?? 'walls'}
            onValueChange={(v) => v && updateSymbol(sym.id, (s) => void (s.cove = { ...s.cove, at: v as 'walls' | 'inner' }))}
            className="w-full"
          >
            <ToggleGroupItem value="walls" className="flex-1">
              Along the walls
            </ToggleGroupItem>
            <ToggleGroupItem value="inner" className="flex-1">
              Inside the {style === 'stepped' ? 'steps' : 'tray'}
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            {sym.cove?.at === 'inner'
              ? 'On top of the lowered band, hidden behind its edge, washing the raised middle with light.'
              : 'Just below the ceiling along the walls, washing them with light.'}
          </p>
        </div>
      )}
      <WallPicker
        room={room}
        on={lit}
        units={units}
        tone="light"
        label="Walls with light"
        onChange={(walls) =>
          updateSymbol(sym.id, (s) => {
            const next = room.points.map((_, i) => i).filter((i) => !walls.includes(i))
            s.cove = { ...s.cove, off: next.length ? next : undefined }
          })
        }
      />
      {columns && (
        <AtColumns value={sym.cove?.columns ?? 'wrap'} onChange={(v) => updateSymbol(sym.id, (s) => void (s.cove = { ...s.cove, columns: v === 'stop' ? 'stop' : undefined }))} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Room ceiling

/** A different band width on some walls (e.g. deeper over a wardrobe): pick a wall on the little plan, set its width. */
function WallBands({ room, units, set }: { room: Room; units: Units; set: (recipe: (r: Room) => void) => void }) {
  const floor = useFloor()
  const [wall, setWall] = useState<number | null>(null)
  const c = room.ceiling!
  const pts = room.points
  const b = bbox(pts)
  const w = Math.max(1, b.maxX - b.minX)
  const h = Math.max(1, b.maxY - b.minY)
  const pad = Math.max(w, h) * 0.08
  const at = wall !== null && wall < pts.length ? wall : null
  const custom = (i: number) => c.bands?.[i] != null
  const setBand = (i: number, v: number | null) =>
    set((r) => {
      const ceiling = r.ceiling!
      const bands = pts.map((_, k) => (k === i ? (v === ceiling.band ? null : v) : (ceiling.bands?.[k] ?? null)))
      ceiling.bands = bands.some((x) => x !== null) ? bands : undefined
    })
  return (
    <div className="space-y-1.5">
      <svg
        viewBox={`${b.minX - pad} ${b.minY - pad} ${w + pad * 2} ${h + pad * 2}`}
        className="h-28 w-full rounded-md bg-muted/60"
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="Band width per wall"
      >
        <path d={polygonPath(pts)} className="fill-foreground/15" />
        <path d={polygonPath(bandInset(ceilingRoom(room, floor)))} className="fill-background" />
        {pts.map((a, i) => {
          const p = pts[(i + 1) % pts.length]
          const name = `Wall ${i + 1}, ${formatLength(dist(a, p), units)}: band ${formatLength(bandAt(room, i), units)}`
          return (
            <g
              key={i}
              role="button"
              aria-pressed={at === i}
              aria-label={name}
              tabIndex={0}
              className="cursor-pointer outline-none [&:focus-visible>line:last-child]:stroke-ring"
              onClick={() => setWall(i)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setWall(i)
                }
              }}
            >
              <title>{name}</title>
              <line x1={a.x} y1={a.y} x2={p.x} y2={p.y} stroke="transparent" strokeWidth={18} vectorEffect="non-scaling-stroke" />
              <line
                x1={a.x}
                y1={a.y}
                x2={p.x}
                y2={p.y}
                stroke={at === i ? 'var(--primary)' : custom(i) ? 'var(--foreground)' : 'var(--muted-foreground)'}
                strokeOpacity={at === i || custom(i) ? 1 : 0.4}
                strokeWidth={at === i ? 5 : 3}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )
        })}
      </svg>
      {at === null ? (
        <p className="text-xs text-muted-foreground">Click a wall to give it a different width, e.g. deeper over a wardrobe.</p>
      ) : (
        <div className="space-y-1">
          <Row label={`Wall ${at + 1}`}>
            <LengthInput value={bandAt(room, at)} units={units} min={c.style === 'floating' ? 5 : 10} onChange={(v) => setBand(at, v)} />
          </Row>
          {custom(at) && (
            <button className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setBand(at, null)}>
              Same as the other walls
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function CeilingSection({ room, units }: { room: Room; units: Units }) {
  const floor = useFloor()
  const c = room.ceiling
  const cove = floor.symbols.find((s) => s.room === room.id && s.type === 'cove-light')
  const gapLight = floor.symbols.find((s) => s.room === room.id && s.type === 'gap-light')
  const pocketLight = floor.symbols.find((s) => s.room === room.id && s.type === 'pocket-light')
  const canPocket = !!c && c.style !== 'floating'
  const set = (recipe: (r: Room) => void) =>
    useEditor.getState().commit((d) => {
      const r = draftFloor(d).rooms.find((x) => x.id === room.id)
      if (r) recipe(r)
    })
  const removeCove = () =>
    useEditor.getState().commit((d) => {
      const f = draftFloor(d)
      f.symbols = f.symbols.filter((s) => !(s.room === room.id && s.type === 'cove-light'))
      pruneControls(f)
    })
  /** Curtain pockets on these walls, and whether they have an LED (it goes with the last pocket). */
  const setPockets = (walls: number[], light = !!pocketLight) =>
    useEditor.getState().commit((d) => {
      const f = draftFloor(d)
      const r = f.rooms.find((x) => x.id === room.id)
      if (!r) return
      r.curtainPockets = walls.length ? walls : undefined
      const lit = f.symbols.some((s) => s.room === r.id && s.type === 'pocket-light')
      const want = walls.length > 0 && light
      if (want && !lit) f.symbols.push({ ...newSymbol('pocket-light', 0, 0), room: r.id })
      if (!want && lit) {
        f.symbols = f.symbols.filter((s) => !(s.room === r.id && s.type === 'pocket-light'))
        pruneControls(f)
      }
    })
  const selectLight = (id: string) => {
    const st = useEditor.getState()
    if (st.layer !== 'lighting') st.setLayer('lighting')
    st.select({ kind: 'symbol', id })
  }
  /** Shadow gaps on these walls; the first ones come with their LED, and with none left it goes. */
  const setGaps = (walls: number[], light?: boolean) =>
    useEditor.getState().commit((d) => {
      const f = draftFloor(d)
      const r = f.rooms.find((x) => x.id === room.id)
      if (!r) return
      const had = !!r.shadowGaps?.length
      r.shadowGaps = walls.length ? walls : undefined
      const lit = f.symbols.some((s) => s.room === r.id && s.type === 'gap-light')
      const want = walls.length > 0 && (light ?? (lit || !had))
      if (want && !lit) f.symbols.push({ ...newSymbol('gap-light', 0, 0), room: r.id })
      if (!want && lit) {
        f.symbols = f.symbols.filter((s) => !(s.room === r.id && s.type === 'gap-light'))
        pruneControls(f)
      }
    })
  return (
    <div className="space-y-3">
      <Row label="Style">
        <Select value={c?.style ?? 'none'} onValueChange={(v) => applyCeiling(room.id, v === 'none' ? null : (v as CeilingStyle))}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No gypsum ceiling</SelectItem>
            {(Object.keys(CEILING_STYLES) as CeilingStyle[]).map((s) => (
              <SelectItem key={s} value={s}>
                {CEILING_STYLES[s].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      {c && (
        <>
          <p className="text-xs text-muted-foreground">{CEILING_STYLES[c.style].description}.</p>
          <Row label="Drop">
            <LengthInput value={c.drop} units={units} min={5} onChange={(v) => set((r) => void (r.ceiling!.drop = v))} />
          </Row>
          {c.style !== 'flat' && (
            <>
              <Row label={c.style === 'floating' ? 'Gap to walls' : 'Band width'}>
                <LengthInput value={c.band} units={units} min={10} onChange={(v) => set((r) => void (r.ceiling!.band = v))} />
              </Row>
              <WallBands room={room} units={units} set={set} />
            </>
          )}
        </>
      )}
      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Lightbulb className="size-4" /> Hidden LED strip
          </span>
          {cove ? (
            <Button variant="ghost" size="xs" className="text-destructive hover:text-destructive" onClick={removeCove}>
              <Trash2 /> Remove
            </Button>
          ) : (
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                useEditor.getState().commit((d) => {
                  const f = draftFloor(d)
                  const r = f.rooms.find((x) => x.id === room.id)
                  if (r) f.symbols.push({ ...newSymbol('cove-light', 0, 0), room: r.id })
                })
              }
            >
              <Plus /> Add
            </Button>
          )}
        </div>
        {cove ? (
          <>
            <HiddenLightControls room={room} sym={cove} units={units} />
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                const st = useEditor.getState()
                if (st.layer !== 'lighting') st.setLayer('lighting')
                st.select({ kind: 'symbol', id: cove.id })
              }}
            >
              <SlidersHorizontal /> Color, brightness and switches
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">An LED strip hidden in the ceiling, lighting the walls or the ceiling itself.</p>
        )}
      </div>
      <div className="space-y-2 rounded-lg border p-3">
        <span className="text-sm font-medium">Curtain pocket</span>
        {canPocket ? (
          <>
            <p className="text-xs text-muted-foreground">A gap in the gypsum ceiling along a wall, up to the slab, that hides the curtain track.</p>
            <WallPicker
              room={room}
              on={room.curtainPockets ?? []}
              units={units}
              tone="dark"
              label="Walls with a curtain pocket"
              onChange={(walls) => setPockets(walls)}
            />
            {!!room.curtainPockets?.length && (
              <>
                <Row label="Width">
                  <LengthInput
                    value={pocketWidth(room)}
                    units={units}
                    min={8}
                    onChange={(v) => set((r) => void (r.pocketWidth = Math.min(40, v)))}
                  />
                </Row>
                <label className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5">
                    <Lightbulb className="size-4" /> LED light in the pocket
                  </span>
                  <Switch size="sm" checked={!!pocketLight} onCheckedChange={(on) => setPockets(room.curtainPockets ?? [], on)} />
                </label>
                {pocketLight && (
                  <Button variant="outline" size="sm" className="w-full" onClick={() => selectLight(pocketLight.id)}>
                    <SlidersHorizontal /> Color, brightness and switches
                  </Button>
                )}
              </>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Needs a gypsum ceiling (not a floating panel): choose a style above.</p>
        )}
      </div>
      <div className="space-y-2 rounded-lg border p-3">
        <span className="text-sm font-medium">Shadow gap</span>
        <p className="text-xs text-muted-foreground">A recessed groove where the wall meets the ceiling.</p>
        <WallPicker
          room={room}
          on={room.shadowGaps ?? []}
          units={units}
          tone="dark"
          label="Walls with a shadow gap"
          onChange={(walls) => setGaps(walls)}
        />
        {!!room.shadowGaps?.length && (
          <>
            {roomColumns(room, floor).length > 0 && (
              <AtColumns value={room.gapsAtColumns ?? 'wrap'} onChange={(v) => set((r) => void (r.gapsAtColumns = v === 'stop' ? 'stop' : undefined))} />
            )}
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5">
                <Lightbulb className="size-4" /> LED light in the gap
              </span>
              <Switch size="sm" checked={!!gapLight} onCheckedChange={(on) => setGaps(room.shadowGaps ?? [], on)} />
            </label>
            {gapLight && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  const st = useEditor.getState()
                  if (st.layer !== 'lighting') st.setLayer('lighting')
                  st.select({ kind: 'symbol', id: gapLight.id })
                }}
              >
                <SlidersHorizontal /> Color, brightness and switches
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Light fixtures

function TrackModules({ sym, units }: { sym: PlanSymbol; units: Units }) {
  const mods = sym.modules ?? []
  const add = (kind: TrackModule['kind']) =>
    updateSymbol(sym.id, (s) => {
      const list = s.modules ?? []
      // Put the new module in the biggest free stretch of track.
      const stops = [0, ...list.map((m) => m.offset).sort((a, b) => a - b), s.width]
      let at = s.width / 2
      let widest = 0
      for (let i = 0; i + 1 < stops.length; i++) {
        if (stops[i + 1] - stops[i] > widest) {
          widest = stops[i + 1] - stops[i]
          at = (stops[i] + stops[i + 1]) / 2
        }
      }
      s.modules = [...list, { id: uid(), kind, offset: Math.round(at) }]
    })
  return (
    <div className="space-y-2">
      <span className="text-sm text-muted-foreground">Modules on the track</span>
      <ul className="space-y-1.5">
        {mods.map((m, i) => (
          <li key={m.id} className="grid grid-cols-[1fr_96px_auto] items-center gap-1.5">
            <Select
              value={m.kind}
              onValueChange={(v) => updateSymbol(sym.id, (s) => void (s.modules![i].kind = v as TrackModule['kind']))}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="spot">Spot</SelectItem>
                <SelectItem value="linear">Linear light</SelectItem>
                <SelectItem value="grille">Grille (3 spots)</SelectItem>
              </SelectContent>
            </Select>
            <LengthInput
              value={m.offset}
              units={units}
              min={0}
              onChange={(v) => updateSymbol(sym.id, (s) => void (s.modules![i].offset = Math.min(v, s.width)))}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove module"
              onClick={() => updateSymbol(sym.id, (s) => void (s.modules = s.modules!.filter((x) => x.id !== m.id)))}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1.5">
        {(['spot', 'linear', 'grille'] as const).map((k) => (
          <Button key={k} variant="outline" size="xs" onClick={() => add(k)}>
            <Plus /> {k === 'spot' ? 'Spot' : k === 'linear' ? 'Linear' : 'Grille'}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Positions are measured from the left end of the track. Making the track longer or shorter adds or removes modules to fill
        it.
      </p>
    </div>
  )
}

export function LightSection({ sym, units }: { sym: PlanSymbol; units: Units }) {
  const floor = useFloor()
  const def = SYMBOL_MAP.get(sym.type)
  const light = sym.light ?? { color: 'warm', brightness: 1 }
  const switches = switchesFor(floor, sym.id)
  const allSwitches = floor.symbols.filter((s) => s.type === 'switch')
  const hangs = def?.fixture === 'pendant' || def?.fixture === 'linear-pendant' || def?.fixture === 'chandelier'
  return (
    <div className="space-y-3">
      <LightColorPicker value={light.color} onChange={(c) => updateSymbol(sym.id, (s) => void (s.light = { ...light, color: c }))} />
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Brightness</span>
          <span className="tabular-nums">{Math.round(light.brightness * 100)}%</span>
        </div>
        <Slider
          min={0.1}
          max={1}
          step={0.05}
          value={[light.brightness]}
          onValueChange={([v]) =>
            useEditor.getState().mutate((d) => {
              const s = draftFloor(d).symbols.find((x) => x.id === sym.id)
              if (s) s.light = { ...light, brightness: v }
            })
          }
        />
      </div>
      {(hangs || def?.fixture === 'wall') && (
        <Row label={hangs ? 'Hang height' : 'Mount height'}>
          <LengthInput
            value={sym.elevation ?? def?.elevation ?? 170}
            units={units}
            min={20}
            onChange={(v) => updateSymbol(sym.id, (s) => void (s.elevation = v))}
          />
        </Row>
      )}
      {def?.fixture === 'track' && <TrackModules sym={sym} units={units} />}
      <div className="space-y-1.5">
        <span className="text-sm text-muted-foreground">Switched by</span>
        {allSwitches.length ? (
          <div className="flex flex-wrap gap-1.5">
            {allSwitches.map((sw) => {
              const on = switches.includes(sw)
              const color = WIRE_COLORS[allSwitches.indexOf(sw) % WIRE_COLORS.length]
              return (
                <button
                  key={sw.id}
                  onClick={() => toggleWire(sw.id, sym.id)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                    on ? 'text-white' : 'text-muted-foreground hover:text-foreground',
                  )}
                  style={on ? { background: color, borderColor: color } : undefined}
                >
                  {sw.label || 'Switch'}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Add a light switch from the Library to control this light.</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Switches

export function SwitchSection({ sym }: { sym: PlanSymbol }) {
  const floor = useFloor()
  const byId = new Map(floor.symbols.map((s) => [s.id, s]))
  const lights = (sym.controls ?? []).map((id) => byId.get(id)).filter((s): s is PlanSymbol => !!s)
  const wiring = useEditor((s) => s.tool === 'wire' && s.wireSwitch === sym.id)
  const name = (s: PlanSymbol) => {
    if (s.room) return `${s.type === 'gap-light' ? 'Shadow gap light' : s.type === 'pocket-light' ? 'Curtain pocket light' : 'Hidden LED'} · ${floor.rooms.find((r) => r.id === s.room)?.name ?? 'room'}`
    return SYMBOL_MAP.get(s.type)?.name ?? s.type
  }
  const startWiring = () => {
    const st = useEditor.getState()
    st.setLayer('lighting')
    st.setTool('wire')
    st.setWireSwitch(sym.id)
    st.select({ kind: 'symbol', id: sym.id })
  }
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <span className="text-sm text-muted-foreground">
          Controls {lights.length} light{lights.length === 1 ? '' : 's'}
        </span>
        {lights.length > 0 && (
          <ul className="space-y-1">
            {lights.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/60 px-2 py-1 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: LIGHT_COLORS[l.light?.color ?? 'warm'].hex }} />
                  <span className="truncate">{name(l)}</span>
                </span>
                <Button variant="ghost" size="icon-xs" aria-label="Disconnect" onClick={() => toggleWire(sym.id, l.id)}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {wiring ? (
        <Button className="w-full" onClick={() => useEditor.getState().setTool('select')}>
          Done connecting
        </Button>
      ) : (
        <Button variant="outline" className="w-full" onClick={startWiring}>
          <Cable /> Connect lights
        </Button>
      )}
      {wiring && <p className="text-xs text-muted-foreground">Click lights on the plan to connect or disconnect them.</p>}
    </div>
  )
}
