import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Search, X } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * The properties of what's picked, as an inspector: a header that stays at the top (what it is, what can be done with
 * it, and a search through its settings), then its settings in panels, each about one thing (its size, its basin, its
 * light, where it is…), folded to a line saying how it's set and opened to change it. The same panels come in the same
 * order for everything, each open or folded as it was last left, so they're where they're expected.
 */

/** What every panel in an inspector shares: the search, and a "fold or unfold them all" (counted, so each is heard once). */
const InspectorContext = createContext<{ query: string; all: { open: boolean; n: number }; matched: () => void }>({ query: '', all: { open: true, n: 0 }, matched: () => {} })

const KEY = 'planbreeze.panels'
const saved: Record<string, boolean> = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
})()
function remember(id: string, open: boolean) {
  saved[id] = open
  try {
    localStorage.setItem(KEY, JSON.stringify(saved))
  } catch {
    // Not kept: it opens as usual next time.
  }
}

/** Text as it's searched: lower case, accents and Arabic vowel marks left out. */
const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ًͯ-ٰٟ]/g, '')

export function Inspector({
  title,
  kind,
  icon: Icon,
  actions,
  item,
  children,
}: {
  title: ReactNode
  /** What sort of thing it is (a badge by its name). */
  kind?: ReactNode
  icon?: ComponentType<{ className?: string }>
  /** Buttons for what can be done with it (duplicate, delete…). */
  actions?: ReactNode
  /** What's picked: a new one starts the search afresh. */
  item: string
  children: ReactNode
}) {
  const [text, setText] = useState('')
  const [all, setAll] = useState({ open: true, n: 0 })
  const [none, setNone] = useState(false)
  // Told when a panel starts or stops matching the search, to look again for any that do.
  const [, setTold] = useState(0)
  const matched = useCallback(() => setTold((n) => n + 1), [])
  const body = useRef<HTMLDivElement>(null)
  const query = plain(text.trim())
  // Something else picked: its settings from the top, unsearched.
  useEffect(() => {
    setText('')
    setNone(false)
  }, [item])
  // Nothing matching what's searched for (each panel hides itself first, see Panel). After every render, as what's
  // in the panels can change any time; it only sets what's changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const shown = body.current?.querySelectorAll('[data-panel]:not([hidden])').length ?? 0
    const nothing = !!query && shown === 0
    if (nothing !== none) setNone(nothing)
  })
  const unfold = !all.open
  return (
    <InspectorContext.Provider value={{ query, all, matched }}>
      <div className="sticky top-0 z-10 space-y-2 border-b bg-background/95 px-4 pt-3 pb-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="flex min-h-8 items-center gap-2">
          {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
          <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
          {kind}
          <div className="ms-auto flex shrink-0 items-center gap-0.5">{actions}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="relative flex min-w-0 flex-1 items-center">
            <Search className="pointer-events-none absolute start-2 size-3.5 text-muted-foreground" />
            <input
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && text) {
                  e.stopPropagation()
                  setText('')
                }
              }}
              placeholder={t('Find a setting…')}
              aria-label={t('Find a setting')}
              className="h-7 w-full min-w-0 rounded-md border bg-transparent ps-7 pe-7 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-search-cancel-button]:hidden"
            />
            {text && (
              <button type="button" className="absolute end-1.5 grid size-4 place-items-center rounded text-muted-foreground hover:text-foreground" onClick={() => setText('')} aria-label={t('Clear')}>
                <X className="size-3" />
              </button>
            )}
          </label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="size-7" disabled={!!query} onClick={() => setAll({ open: unfold, n: all.n + 1 })} aria-label={unfold ? t('Unfold every panel') : t('Fold every panel')}>
                {unfold ? <ChevronsUpDown /> : <ChevronsDownUp />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{unfold ? t('Unfold every panel') : t('Fold every panel')}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div ref={body}>{children}</div>
      {none && <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('No settings match “{text}”.', { text: text.trim() })}</p>}
    </InspectorContext.Provider>
  )
}

/**
 * One panel of an inspector: about one thing, folded to its title and a line saying how it's set (`summary`), opened
 * to change it. It opens (or not) as it was last left, wherever it's shown, and as `open` says the first time. While
 * searching it shows, open, only if something in it (its title, a setting's name, a choice) matches.
 */
export function Panel({
  id,
  icon: Icon,
  title,
  summary,
  open: first = false,
  reveal,
  children,
}: {
  /** The same for the same panel of anything (its size, its light…): it opens as it was left. */
  id: string
  icon: ComponentType<{ className?: string }>
  title: ReactNode
  summary?: ReactNode
  open?: boolean
  /** Something in it picked elsewhere (a wall on the plan): it opens to show it, each time this changes. */
  reveal?: string
  children: ReactNode
}) {
  const { query, all, matched } = useContext(InspectorContext)
  const [open, setOpen] = useState(() => saved[id] ?? first)
  const [match, setMatch] = useState(true)
  const ref = useRef<HTMLElement>(null)
  const bodyId = useId()
  useEffect(() => {
    if (!all.n) return
    setOpen(all.open)
    remember(id, all.open)
  }, [all, id])
  useEffect(() => {
    if (reveal) setOpen(true)
  }, [reveal])
  // While searching: whether anything in it matches (hidden settings too; it's all there, only folded). After every
  // render, as what's in it can change any time; it only sets what's changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const m = !query || plain(ref.current?.textContent ?? '').includes(query)
    if (m !== match) {
      setMatch(m)
      matched()
    }
  })
  const searching = !!query
  const shown = !searching || match
  const expanded = searching ? match : open
  return (
    <section ref={ref} data-panel={id} hidden={!shown} className="border-b last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        disabled={searching}
        onClick={() => {
          setOpen(!open)
          remember(id, !open)
        }}
        className="group flex w-full items-center gap-2.5 px-4 py-2.5 text-start outline-none hover:bg-muted/50 focus-visible:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          {summary && !expanded && <span className="block truncate text-xs text-muted-foreground">{summary}</span>}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180', searching && 'opacity-0')} />
      </button>
      <div id={bodyId} hidden={!expanded} className="space-y-3 px-4 pt-1 pb-4">
        {children}
      </div>
    </section>
  )
}

/** A small action in an inspector's header: an icon with a tooltip. */
export function HeaderAction({ label, onClick, children, danger }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={cn('size-7', danger && 'text-destructive hover:bg-destructive/10 hover:text-destructive')} onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
