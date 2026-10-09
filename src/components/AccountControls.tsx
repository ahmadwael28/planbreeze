import { t } from '@/i18n'
import { useEffect, useState } from 'react'
import { CloudAlert, CloudCheck, CloudOff, HardDrive, LogIn, LogOut, RefreshCw, TriangleAlert } from 'lucide-react'
import type { ComponentType } from 'react'
import { Loader } from '@/components/ui/loader'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useCloud } from '@/cloud/store'
import type { SaveState } from '@/cloud/store'
import { reconcile, saveNow, signOut } from '@/cloud/sync'
import { useEditor } from '@/store/editor'

function ago(at: number | null, now: number) {
  if (!at) return ''
  const s = Math.round((now - at) / 1000)
  if (s < 10) return t('just now')
  if (s < 60) return t('{s}s ago', { s })
  const m = Math.round(s / 60)
  return m < 60 ? t('{m} min ago', { m }) : new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const STATES: Record<SaveState, { icon: ComponentType<{ className?: string }>; label: string; className?: string }> = {
  local: { icon: HardDrive, label: 'Saved on this device' },
  saving: { icon: (p) => <Loader label={t('Saving')} {...p} />, label: 'Saving…' },
  saved: { icon: CloudCheck, label: 'Saved' },
  offline: { icon: CloudOff, label: 'Offline', className: 'text-amber-600 dark:text-amber-400' },
  error: { icon: CloudAlert, label: 'Not saved', className: 'text-destructive' },
  conflict: { icon: TriangleAlert, label: 'Needs your choice', className: 'text-amber-600 dark:text-amber-400' },
}

/** Autosave status. Changes are always saved on the device; when signed in, also to the cloud. */
export function SaveStatus() {
  const state = useCloud((s) => s.saveState)
  const lastSaved = useCloud((s) => s.lastSaved)
  const error = useCloud((s) => s.error)
  const signedIn = useCloud((s) => !!s.user)
  const viewOnly = useEditor((s) => s.project.access?.role === 'viewer')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(id)
  }, [])

  const { icon: Icon, className } = STATES[state]
  const label = t(STATES[state].label)
  const detail = {
    local: t('Every change is saved in this browser automatically. Sign in to also save to the cloud.'),
    saving: t('Saving your latest changes to your account…'),
    saved: t('All changes saved to your account {when}.', { when: ago(lastSaved, now) }),
    offline: t("You're offline. Changes are saved on this device and will upload when you're back online."),
    error: error
      ? t("Couldn't save to your account: {error}. Changes are still saved on this device. Click to retry.", { error })
      : t("Couldn't save to your account. Changes are still saved on this device. Click to retry."),
    conflict: t('This plan was also changed on another device. Choose which version to keep.'),
  }[state]

  const retry = () => {
    if (state === 'error' || state === 'offline') void reconcile().then(() => saveNow())
  }

  // Someone else's plan, shared to view: nothing to save (the View only badge says so), unless it couldn't be reached.
  if (viewOnly && state !== 'error') return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={retry}
          className={cn(
            'flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted [&>svg]:size-4',
            className,
          )}
          aria-label={label}
        >
          <Icon />
          <span className={cn('hidden xl:inline', signedIn && state === 'saved' && 'lg:inline')}>{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{detail}</TooltipContent>
    </Tooltip>
  )
}

function Avatar({ name, src }: { name: string; src?: string }) {
  const [broken, setBroken] = useState(false)
  if (src && !broken) {
    return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-7 rounded-full object-cover" />
  }
  return (
    <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** Sign-in button, or the signed-in user's menu. Hidden when the cloud isn't configured. */
export function AccountButton() {
  const configured = useCloud((s) => s.configured)
  const ready = useCloud((s) => s.ready)
  const user = useCloud((s) => s.user)
  const openSignIn = useCloud((s) => s.openSignIn)
  if (!configured) return null
  if (!user) {
    return (
      <Button variant="outline" size="sm" disabled={!ready} onClick={() => openSignIn(true)} className="shrink-0">
        <LogIn /> <span className="max-sm:hidden">{t('Sign in')}</span>
      </Button>
    )
  }
  const name = user.name || user.email || t('Account')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="shrink-0 rounded-full" aria-label={t('Account')}>
          <Avatar name={name} src={user.avatar} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{name}</div>
          {user.email && user.email !== name && <div className="truncate text-xs text-muted-foreground">{user.email}</div>}
          {user.provider && (
            <div className="text-xs text-muted-foreground">
              {t('Signed in with {how}', { how: ({ github: 'GitHub', google: 'Google', email: t('an email link') } as Record<string, string>)[user.provider] ?? user.provider })}
            </div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void reconcile()}>
          <RefreshCw /> {t('Sync now')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut(false)}>
          <LogOut /> {t('Sign out')}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => void signOut(true)}>
          <LogOut /> {t('Sign out and remove plans from this device')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
