import type { ReactNode } from 'react'
import { Cable, Lightbulb, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { CEILING_STYLES, LIGHT_COLORS, switchesFor, WIRE_COLORS } from '@/model/lighting'
import { newSymbol, uid } from '@/model/project'
import { SYMBOL_MAP } from '@/model/symbols'
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
// Room ceiling

export function CeilingSection({ room, units }: { room: Room; units: Units }) {
  const floor = useFloor()
  const c = room.ceiling
  const hasCove = floor.symbols.some((s) => s.room === room.id)
  const set = (recipe: (r: Room) => void) =>
    useEditor.getState().commit((d) => {
      const r = draftFloor(d).rooms.find((x) => x.id === room.id)
      if (r) recipe(r)
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
            <Row label={c.style === 'floating' ? 'Gap to walls' : 'Band width'}>
              <LengthInput value={c.band} units={units} min={10} onChange={(v) => set((r) => void (r.ceiling!.band = v))} />
            </Row>
          )}
        </>
      )}
      {!hasCove && (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            useEditor.getState().commit((d) => {
              const f = draftFloor(d)
              const r = f.rooms.find((x) => x.id === room.id)
              if (r) f.symbols.push({ ...newSymbol('cove-light', 0, 0), room: r.id })
            })
          }
        >
          <Lightbulb /> Add hidden LED strip
        </Button>
      )}
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
      <p className="text-xs text-muted-foreground">Positions are measured from the left end of the track.</p>
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
    if (s.room) return `Hidden LED · ${floor.rooms.find((r) => r.id === s.room)?.name ?? 'room'}`
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
