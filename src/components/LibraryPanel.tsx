import { useState } from 'react'
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Eye, EyeOff, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { usePlanTheme } from '@/hooks/use-plan-theme'
import { findWallSnap, newSymbol } from '@/model/project'
import { CATEGORIES, SYMBOLS } from '@/model/symbols'
import type { SymbolDef } from '@/model/symbols'
import type { PlanTheme } from '@/model/theme'
import { addSymbol, currentFloor, toggleFaded, useEditor, viewCenter } from '@/store/editor'
import { useUi } from '@/store/ui'
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
      ? [
          ...CATEGORIES.filter((c) => c === 'Lighting' || c === 'Ceilings'),
          ...CATEGORIES.filter((c) => c !== 'Lighting' && c !== 'Ceilings'),
        ]
      : CATEGORIES
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  // Folded categories live in the UI store, so they survive switching sidebar tabs.
  const faded = useEditor((s) => s.settings.faded)
  const collapsed = useUi((s) => s.libraryCollapsed)
  const setCollapsed = useUi((s) => s.setLibraryCollapsed)
  const searching = !!q
  const toggle = (cat: string, open: boolean) => setCollapsed(open ? collapsed.filter((c) => c !== cat) : [...collapsed, cat])
  return (
    <div className="space-y-3 p-4">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search symbols…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
      </div>
      <p className="text-xs text-muted-foreground">Click to add at the center of the view, or drag onto the plan.</p>
      {!searching && (
        <div className="-mx-1.5 flex gap-1">
          <Button variant="ghost" size="xs" onClick={() => setCollapsed([])} disabled={!collapsed.length}>
            <ChevronsUpDown /> Expand all
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setCollapsed([...CATEGORIES])} disabled={collapsed.length === CATEGORIES.length}>
            <ChevronsDownUp /> Collapse all
          </Button>
        </div>
      )}
      {order.map((cat) => {
        const items = SYMBOLS.filter((s) => s.category === cat && (!q || s.name.toLowerCase().includes(q)))
        if (!items.length) return null
        // While searching, every category with a match is shown open.
        const open = searching || !collapsed.includes(cat)
        return (
          <Collapsible key={cat} open={open} onOpenChange={(o) => toggle(cat, o)} asChild>
            <section className="space-y-2">
              <div className="flex items-center gap-1">
                <CollapsibleTrigger
                  disabled={searching}
                  className="group flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:hover:text-muted-foreground"
                >
                  <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
                  <span className="flex-1 text-left">{cat === 'Ceilings' ? 'Gypsum ceilings' : cat}</span>
                  <span className="font-normal tabular-nums normal-case">{items.length}</span>
                </CollapsibleTrigger>
                <button
                  onClick={() => toggleFaded(cat)}
                  className="rounded p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={faded.includes(cat) ? `Show ${cat} on the plan` : `Fade ${cat} on the plan`}
                  title={faded.includes(cat) ? 'Faded on the plan: click to show' : 'Fade on the plan'}
                >
                  {faded.includes(cat) ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
              <CollapsibleContent className="space-y-2">
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
              </CollapsibleContent>
            </section>
          </Collapsible>
        )
      })}
    </div>
  )
}
