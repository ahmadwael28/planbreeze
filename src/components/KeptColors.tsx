import { t } from '@/i18n'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEditor } from '@/store/editor'
import { forgetColor, keepColor } from '@/store/palette'

/**
 * The colors a plan keeps to use again, on any floor or wall in it (see Project.palette): each one picks it, and can be
 * taken away. With `keep` (the color now chosen), a way to keep that one too.
 */
export function KeptColors({
  current,
  keep,
  onPick,
  size = 'md',
}: {
  current?: string
  keep?: string
  onPick: (hex: string) => void
  /** Round swatches (sm, md), or square tiles (lg). */
  size?: 'sm' | 'md' | 'lg'
}) {
  const palette = useEditor((s) => s.project.palette) ?? []
  const viewOnly = useEditor((s) => s.project.access?.role === 'viewer')
  const kept = (hex: string) => palette.some((p) => p.toLowerCase() === hex.toLowerCase())
  const canKeep = !!keep && !kept(keep) && !viewOnly
  if (!palette.length) {
    if (!canKeep || size === 'lg') return null
    return (
      <button type="button" onClick={() => keepColor(keep!)} className="flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">
        <Plus className="size-3.5" /> {t('Keep this color for other floors and walls')}
      </button>
    )
  }
  const box = size === 'lg' ? 'size-10 rounded-md' : size === 'sm' ? 'size-5 rounded-full' : 'size-6 rounded-full'
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{t('Your colors')}</p>
      <div className="flex flex-wrap items-center gap-2">
        {palette.map((hex) => {
          const on = !!current && current.toLowerCase() === hex.toLowerCase()
          return (
            <span key={hex} className="group relative">
              <button
                type="button"
                title={hex}
                aria-label={t('Your color {hex}', { hex })}
                aria-pressed={on}
                onClick={() => onPick(hex)}
                className={cn(
                  'block shrink-0 border shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  box,
                  on && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                )}
                style={{ background: hex }}
              />
              {!viewOnly && (
                <button
                  type="button"
                  aria-label={t('Remove {hex} from your colors', { hex })}
                  title={t('Remove from your colors')}
                  onClick={() => forgetColor(hex)}
                  className="absolute -end-1.5 -top-1.5 hidden size-4 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm group-focus-within:flex group-hover:flex hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </span>
          )
        })}
        {canKeep && (
          <button
            type="button"
            title={t('Keep this color for other floors and walls')}
            aria-label={t('Keep this color for other floors and walls')}
            onClick={() => keepColor(keep!)}
            className={cn('grid shrink-0 place-items-center border border-dashed text-muted-foreground hover:bg-muted hover:text-foreground', box)}
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
