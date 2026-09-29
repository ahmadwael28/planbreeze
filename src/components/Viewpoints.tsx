import { useEffect, useRef, useState } from 'react'
import { Bookmark, BookmarkPlus, Camera, ChevronLeft, ChevronRight, Crosshair, MoreHorizontal, Pause, Pencil, Play, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Viewpoint } from '@/three/viewpoints'

/**
 * Clickable markers drawn over the 3D view. The viewer positions them every frame (and hides the
 * ones behind walls or behind the camera) through the elements passed to `register`.
 */
export function ViewpointMarkers({
  points,
  onGo,
  register,
}: {
  points: Viewpoint[]
  onGo: (id: string) => void
  register: (id: string, el: HTMLElement | null) => void
}) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {points.map((vp) => (
        <button
          key={vp.id}
          ref={(el) => {
            register(vp.id, el)
          }}
          onClick={() => onGo(vp.id)}
          aria-label={`Go to ${vp.label}`}
          style={{ visibility: 'hidden' }}
          className="group pointer-events-auto absolute top-0 left-0 flex flex-col items-center gap-1 rounded-full outline-none"
        >
          <span className="grid size-10 place-items-center rounded-full border-2 border-white bg-primary text-primary-foreground shadow-lg ring-4 ring-primary/25 transition-transform group-hover:scale-110 group-focus-visible:ring-ring">
            {vp.kind === 'room' ? (
              <Camera className="size-4.5" />
            ) : vp.kind === 'saved' ? (
              <Bookmark className="size-4.5" />
            ) : (
              <span className="text-lg leading-none">{vp.arrow}</span>
            )}
          </span>
          {vp.kind !== 'outside' && (
            <span className="rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground shadow">
              {vp.label}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

export interface SavedViewActions {
  onSave: () => void
  onRename: (savedId: string, name: string) => void
  /** Store the camera's current position and angle in a saved view. */
  onUpdate: (savedId: string) => void
  onDelete: (savedId: string) => void
}

/** Room names, saved views and outside corners to jump between, with previous / next, save, an automatic tour and exit. */
export function ViewpointBar({
  points,
  active,
  playing,
  onGo,
  onStep,
  onTogglePlay,
  onExit,
  saved: actions,
}: {
  points: Viewpoint[]
  active: string | null
  playing: boolean
  onGo: (id: string) => void
  onStep: (dir: 1 | -1) => void
  onTogglePlay: () => void
  onExit: () => void
  saved: SavedViewActions
}) {
  const rooms = points.filter((p) => p.kind === 'room')
  const saved = points.filter((p) => p.kind === 'saved')
  const outside = points.filter((p) => p.kind === 'outside')
  const listRef = useRef<HTMLDivElement>(null)
  const [renaming, setRenaming] = useState<Viewpoint | null>(null)

  // Keep the current place in view when the list scrolls (narrow screens).
  useEffect(() => {
    listRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [active])

  return (
    <div
      role="toolbar"
      aria-label="Viewpoints"
      className="absolute bottom-16 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-1 rounded-full border bg-background/95 p-1 shadow-lg backdrop-blur"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 rounded-full" onClick={() => onStep(-1)} aria-label="Previous viewpoint">
            <ChevronLeft />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Previous (Page Up)</TooltipContent>
      </Tooltip>
      <div ref={listRef} className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {rooms.map((vp) => (
          <Button
            key={vp.id}
            variant={vp.id === active ? 'default' : 'ghost'}
            className="shrink-0 rounded-full"
            aria-pressed={vp.id === active}
            onClick={() => onGo(vp.id)}
          >
            {vp.label}
          </Button>
        ))}
        {saved.length > 0 && (
          <div className={cn('flex shrink-0 items-center gap-1', rooms.length > 0 && 'ml-1 border-l pl-2')}>
            {saved.map((vp) => {
              const on = vp.id === active
              return (
                <div key={vp.id} className="flex shrink-0 items-center">
                  <Button
                    variant={on ? 'default' : 'ghost'}
                    className={cn('rounded-full', on && 'rounded-r-none pr-2')}
                    aria-pressed={on}
                    onClick={() => onGo(vp.id)}
                  >
                    <Bookmark /> {vp.label}
                  </Button>
                  {on && (
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" className="rounded-l-none rounded-r-full border-l border-primary-foreground/25" aria-label={`Options for ${vp.label}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="top" align="end">
                        <DropdownMenuItem onSelect={() => setRenaming(vp)}>
                          <Pencil /> Rename…
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => actions.onUpdate(vp.savedId!)}>
                          <Crosshair /> Keep the current angle
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => actions.onDelete(vp.savedId!)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {outside.length > 0 && (
          <div className={cn('flex shrink-0 items-center gap-0.5', rooms.length + saved.length > 0 && 'ml-1 border-l pl-2')}>
            <span className="pr-1 text-xs text-muted-foreground">Outside</span>
            {outside.map((vp) => (
              <Tooltip key={vp.id}>
                <TooltipTrigger asChild>
                  <Button
                    variant={vp.id === active ? 'default' : 'ghost'}
                    size="icon"
                    className="rounded-full text-lg"
                    aria-pressed={vp.id === active}
                    aria-label={vp.label}
                    onClick={() => onGo(vp.id)}
                  >
                    {vp.arrow}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{vp.label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 rounded-full" onClick={() => onStep(1)} aria-label="Next viewpoint">
            <ChevronRight />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Next (Page Down)</TooltipContent>
      </Tooltip>
      <div className="mx-0.5 h-6 w-px shrink-0 bg-border" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 rounded-full" onClick={actions.onSave} aria-label="Save this view">
            <BookmarkPlus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Save this view</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={playing ? 'secondary' : 'ghost'}
            size="icon"
            className="shrink-0 rounded-full"
            onClick={onTogglePlay}
            aria-label={playing ? 'Pause the tour' : 'Play a tour of every viewpoint'}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{playing ? 'Pause the tour' : 'Tour every viewpoint automatically'}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 rounded-full" onClick={onExit} aria-label="Leave viewpoints">
            <X />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Leave viewpoints (Esc)</TooltipContent>
      </Tooltip>
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename view</DialogTitle>
          </DialogHeader>
          {renaming && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const name = String(new FormData(e.currentTarget).get('name') ?? '').trim()
                if (name) actions.onRename(renaming.savedId!, name)
                setRenaming(null)
              }}
            >
              <Input name="name" defaultValue={renaming.label} aria-label="View name" autoFocus onFocus={(e) => e.currentTarget.select()} />
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                  Cancel
                </Button>
                <Button type="submit">Save</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
