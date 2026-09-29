import { useState } from 'react'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { usePlanTheme } from '@/hooks/use-plan-theme'
import { findWallSnap, newSymbol } from '@/model/project'
import { CATEGORIES, SYMBOLS } from '@/model/symbols'
import type { SymbolDef } from '@/model/symbols'
import type { PlanTheme } from '@/model/theme'
import { addSymbol, currentFloor, useEditor, viewCenter } from '@/store/editor'
import { SYMBOL_DRAG_MIME } from './Canvas'

function Preview({ def, theme }: { def: SymbolDef; theme: PlanTheme }) {
  const pad = 14
  const w = def.width
  const d = def.wall ? 10 : def.depth
  const extra = def.wall ? def.width : def.type.includes('table') || def.type === 'desk' ? 40 : 0
  const vb = `${-w / 2 - pad} ${-d / 2 - pad - (def.wall ? 0 : extra / 2)} ${w + pad * 2} ${d + pad * 2 + extra}`
  return (
    <svg viewBox={vb} className="h-12 w-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
      {def.wall && <rect x={-w / 2 - pad} y={-d / 2} width={w + pad * 2} height={d} fill={theme.wall} />}
      {def.render(w, d, theme, { ...newSymbol(def.type, 0, 0), label: 'Abc' })}
    </svg>
  )
}

function place(def: SymbolDef) {
  const c = viewCenter()
  const st = useEditor.getState()
  if (def.ceilingStyle || def.fixture === 'cove') {
    if (!addSymbol(def.type, c)) toast('Select a room first, or drag this onto a room.')
    else if (st.layer !== 'lighting') st.setLayer('lighting')
    return
  }
  if ((def.category === 'Lighting' || def.category === 'Ceilings') && st.layer !== 'lighting') st.setLayer('lighting')
  if (def.wall) {
    // Insert into the wall nearest to the view center if there is one close enough.
    const att = findWallSnap(c, currentFloor(st).rooms, 400 / Math.max(st.view.zoom, 0.2))
    return addSymbol(def.type, c, 0, att ?? undefined)
  }
  addSymbol(def.type, c)
}

export function LibraryPanel() {
  const theme = usePlanTheme()
  const layer = useEditor((s) => s.layer)
  const order =
    layer === 'lighting'
      ? [...CATEGORIES.filter((c) => c === 'Lighting' || c === 'Ceilings'), ...CATEGORIES.filter((c) => c !== 'Lighting' && c !== 'Ceilings')]
      : CATEGORIES
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  return (
    <div className="space-y-4 p-4">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search symbols…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
      </div>
      <p className="text-xs text-muted-foreground">Click to add at the center of the view, or drag onto the plan.</p>
      {order.map((cat) => {
        const items = SYMBOLS.filter((s) => s.category === cat && (!q || s.name.toLowerCase().includes(q)))
        if (!items.length) return null
        return (
          <section key={cat} className="space-y-2">
            <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {cat === 'Ceilings' ? 'Gypsum ceilings' : cat}
            </h4>
            {cat === 'Ceilings' && (
              <p className="text-xs text-muted-foreground">Tap a style to apply it to the selected room, or drag it onto a room.</p>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              {items.map((def) => (
                <button
                  key={def.type}
                  className="flex flex-col items-center gap-1 rounded-lg border bg-card p-2 pb-1.5 text-[11px] text-card-foreground transition-colors hover:border-primary hover:bg-primary/5"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(SYMBOL_DRAG_MIME, def.type)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => place(def)}
                  title={def.name}
                >
                  <Preview def={def} theme={theme} />
                  <span className="w-full truncate text-center">{def.name}</span>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
