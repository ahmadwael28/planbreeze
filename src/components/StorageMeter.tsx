import { useEffect, useState } from 'react'
import { HardDrive, ShieldAlert, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import { keepPlans, storageKind, storageUse } from '@/store/storage'
import type { StorageUse } from '@/store/storage'

/** A size in bytes, in words: KB, MB or GB. */
function size(bytes: number): string {
  const mb = bytes / 1024 ** 2
  if (mb < 1) return t('{n} KB', { n: Math.max(1, Math.round(bytes / 1024)) })
  if (mb < 1024) return t('{n} MB', { n: mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb) })
  const gb = mb / 1024
  return t('{n} GB', { n: gb < 10 ? Math.round(gb * 10) / 10 : Math.round(gb) })
}

/** Measured again when this changes (plans deleted, put back). */
type Props = { version: string }

/**
 * How much room this browser's plans take, of what it allows; and whether it keeps them for sure, with a way to ask it
 * to (browsers may otherwise clear a site's storage when they run short of space, or Safari after a week unused).
 */
export function StorageMeter({ version }: Props) {
  const [use, setUse] = useState<StorageUse | null>(null)
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    let live = true
    void storageUse().then((u) => live && setUse(u))
    return () => {
      live = false
    }
  }, [version])
  if (!use) return null
  const share = use.quota ? Math.min(1, use.used / use.quota) : 0
  const nearlyFull = share > 0.9
  const keep = async () => {
    setAsking(true)
    try {
      if (await keepPlans()) setUse(await storageUse())
      else toast(t("The browser didn't agree to keep them for sure. Download a backup now and then, to be safe."), { duration: 8000 })
    } finally {
      setAsking(false)
    }
  }
  return (
    <div className="w-full space-y-1.5 text-xs text-muted-foreground">
      {storageKind() === 'idb' && use.quota > 0 && (
        <>
          <div className="flex items-center gap-1.5">
            <HardDrive className="size-3.5 shrink-0" />
            <span>{t('{used} used in this browser, of {quota}', { used: size(use.used), quota: size(use.quota) })}</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-label={t('Storage used')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(share * 100)}
          >
            <div className={cn('h-full rounded-full', nearlyFull ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${Math.max(1, share * 100)}%` }} />
          </div>
          {nearlyFull && (
            <p className="text-amber-700 dark:text-amber-400">{t('Nearly full: empty Recently deleted, or remove plans you no longer need (download a backup first).')}</p>
          )}
        </>
      )}
      {use.kept ? (
        <p className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          {t("Kept for sure: this browser won't clear your plans to make room.")}
        </p>
      ) : (
        <p className="flex items-start gap-1.5">
          <ShieldAlert className="mt-px size-3.5 shrink-0 text-amber-500" />
          <span>
            {t('This browser may clear your plans if it runs short of space.')}{' '}
            <button type="button" className="underline underline-offset-2 hover:text-foreground disabled:opacity-50" onClick={() => void keep()} disabled={asking}>
              {t('Ask it to keep them')}
            </button>
          </span>
        </p>
      )}
    </div>
  )
}
