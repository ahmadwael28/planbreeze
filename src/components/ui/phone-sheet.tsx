import * as React from 'react'
import { Drawer } from 'vaul'
import { ChevronLeft, X } from 'lucide-react'
import { useLayout } from '@/hooks/use-layout'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

/**
 * Whether menus, lists to choose from, small panels and dialogs show the phone way: as sheets up from the bottom, in
 * reach of a thumb, dragged down to put away (a phone, used by touch: see hooks/use-layout).
 */
export function usePhone() {
  const { compact, touch } = useLayout()
  return compact && touch
}

/** A name for a sheet from what opened it: its accessible name, its tooltip, or its text. */
export function nameOf(el: HTMLElement): string | undefined {
  const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.textContent
  return label?.trim() || undefined
}

/** The grip at the top of a sheet, to drag it down by. */
export function SheetGrip({ className }: { className?: string }) {
  return <div aria-hidden className={cn('mx-auto h-[5px] w-10 shrink-0 rounded-full bg-muted-foreground/35', className)} />
}

/**
 * A sheet up from the bottom of a phone's screen, over a dimmed screen: a grip, a header (its title, a way back to the
 * page before, and closing it) and what's in it, scrolling if it's long. Dragged down, or a tap on the screen behind
 * it, puts it away.
 */
export function PhoneSheet({
  open,
  onOpenChange,
  title,
  onBack,
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: React.ReactNode
  /** A page within it: back to the one before. */
  onBack?: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Drawer.Content
          data-slot="phone-sheet"
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-[22px] bg-sheet text-foreground outline-none"
        >
          <SheetGrip className="mt-2" />
          <div className="relative flex min-h-12 shrink-0 items-center justify-center px-24">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="absolute start-1 flex h-10 items-center gap-0.5 rounded-lg px-2 text-[16px] text-primary active:opacity-60"
              >
                <ChevronLeft className="rtl-flip size-5" /> {t('Back')}
              </button>
            )}
            <Drawer.Title className={cn('truncate text-[17px] font-semibold', !title && 'sr-only')}>{title ?? t('Options')}</Drawer.Title>
            <Drawer.Close
              aria-label={t('Close')}
              className="absolute end-3 grid size-[30px] place-items-center rounded-full bg-foreground/8 text-muted-foreground active:opacity-60"
            >
              <X className="size-[18px]" strokeWidth={2.5} />
            </Drawer.Close>
          </div>
          <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-1 pb-[calc(20px+env(safe-area-inset-bottom))]', className)}>
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

/** A switch's look, for a row that's tapped as a whole (a menu's on/off item). */
export function SheetToggle({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative ms-auto inline-flex h-[31px] w-[51px] shrink-0 rounded-full transition-colors',
        on ? 'bg-primary' : 'bg-foreground/15',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] size-[27px] rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.25)] transition-[inset-inline-start]',
          on ? 'start-[22px]' : 'start-[2px]',
        )}
      />
    </span>
  )
}
