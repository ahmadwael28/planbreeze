import { t } from '@/i18n'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { SLATS_BESIDE, slatSideNames } from '@/model/doors'
import { FINISHES } from '@/model/finishes'
import type { Floor, PlanSymbol, Units } from '@/model/types'
import { draftFloor, useEditor } from '@/store/editor'
import { Choice } from './Choice'
import { KeptColors } from './KeptColors'
import { LengthInput } from './LengthInput'

/** Change a door's slats (none: take them away), as one undo step. */
function setSlats(id: string, next: PlanSymbol['slats'] | ((s: NonNullable<PlanSymbol['slats']>) => void)) {
  useEditor.getState().commit((d) => {
    const s = draftFloor(d).symbols.find((x) => x.id === id)
    if (!s) return
    if (typeof next === 'function') {
      if (s.slats) next(s.slats)
    } else if (next) s.slats = next
    else delete s.slats
  })
}

/**
 * Wood slats round a door: none, or on the wall beside it (as far as chosen) and over it up to the ceiling, on one face
 * of its wall or both, in a wood.
 */
export function DoorSlats({ sym, floor, units }: { sym: PlanSymbol; floor: Floor; units: Units }) {
  const s = sym.slats
  const names = slatSideNames(sym, floor)
  const color = s?.color ?? FINISHES.slats.colors[0].hex
  const ring = 'ring-2 ring-primary ring-offset-2 ring-offset-background'
  return (
    <>
      <Choice
        label={t('Slats')}
        value={s ? 'on' : 'none'}
        onChange={(v) => setSlats(sym.id, v === 'on' ? { width: SLATS_BESIDE } : undefined)}
        options={[
          { value: 'none', label: t('None') },
          { value: 'on', label: t('Round it') },
        ]}
      >
        <p className="text-xs text-muted-foreground">
          {s
            ? t('Fluted wood on a dark backing, beside the door from the floor and over it, up to the ceiling.')
            : t('Wood slats on the wall round the door, up to the ceiling.')}
        </p>
      </Choice>
      {s && (
        <>
          <div data-field className="grid grid-cols-[104px_1fr] items-center gap-2">
            <Label htmlFor={`${sym.id}-slats`} className="font-normal text-muted-foreground">
              {t('Beside it')}
            </Label>
            <LengthInput id={`${sym.id}-slats`} value={s.width} units={units} min={5} onChange={(v) => setSlats(sym.id, (x) => void (x.width = Math.min(400, v)))} />
          </div>
          <Choice
            label={t('Slats on')}
            value={s.side ?? 'home'}
            onChange={(v) => setSlats(sym.id, (x) => void (v === 'home' ? delete x.side : (x.side = v)))}
            options={[
              { value: 'home', label: names.home },
              { value: 'other', label: names.other },
              { value: 'both', label: t('Both sides') },
            ]}
          />
          <div data-field className="grid grid-cols-[104px_1fr] items-start gap-2">
            <Label className="pt-1.5 font-normal text-muted-foreground">{t('Wood')}</Label>
            <div className="space-y-1.5 py-1">
              <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t('Wood')}>
                {FINISHES.slats.colors.map((c) => {
                  const on = c.hex.toLowerCase() === color.toLowerCase()
                  return (
                    <button
                      key={c.hex}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      title={t(c.name)}
                      aria-label={t(c.name)}
                      onClick={() => setSlats(sym.id, (x) => void (c.hex === FINISHES.slats.colors[0].hex ? delete x.color : (x.color = c.hex)))}
                      className={cn('size-6 shrink-0 rounded-full border shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', on && ring)}
                      style={{ background: c.hex }}
                    />
                  )
                })}
              </div>
              <KeptColors current={color} keep={color} onPick={(hex) => setSlats(sym.id, (x) => void (x.color = hex))} />
            </div>
          </div>
        </>
      )}
    </>
  )
}
