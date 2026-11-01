import { Component, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Archive, Check, Copy, Download, FolderOpen, RotateCw, TriangleAlert, Undo2, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'
import { backupName, download, localBackup, safeName } from '@/store/backup'
import { useEditor } from '@/store/editor'
import type { Project } from '@/model/types'
import { isOffline, isUpdateError, saveNow, startSafely } from '@/store/recovery'

interface Props {
  children: ReactNode
  /** What shows instead, given what went wrong and a way to try again. */
  fallback: (error: Error, retry: () => void) => ReactNode
  /** When this changes, what failed is tried again (e.g. something else picked). A string or a number. */
  resetKey?: string | number
  onError?: (error: Error) => void
}

/** A failure in part of the app stays there: the rest carries on, and the user has a way on. */
export class ErrorBoundary extends Component<Props, { error: Error | null; key: Props['resetKey'] }> {
  state = { error: null as Error | null, key: this.props.resetKey }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  static getDerivedStateFromProps(props: Props, state: { key: Props['resetKey'] }) {
    return props.resetKey === state.key ? null : { error: null, key: props.resetKey }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
    this.props.onError?.(error)
  }

  retry = () => this.setState({ error: null })

  render() {
    return this.state.error ? this.props.fallback(this.state.error, this.retry) : this.props.children
  }
}

/**
 * Round a dialog: if it fails, it closes (saying so) and opens as usual next time; unless it fails again as it's put
 * back, closed, when it stays away (`fallback` showing instead, if there is one) until the page is reloaded.
 */
export class DialogGuard extends Component<{ children: ReactNode; close: () => void; fallback?: ReactNode }, { down: boolean }> {
  state = { down: false }
  /** Put back after failing, and not shown yet since. */
  retrying = false

  static getDerivedStateFromError() {
    return { down: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
    if (this.retrying) return
    toast.error(t('That window ran into a problem and was closed. Your plan is safe.'))
    this.props.close()
    this.retrying = true
    setTimeout(() => this.setState({ down: false }))
  }

  componentDidUpdate() {
    if (!this.state.down) this.retrying = false
  }

  render() {
    return this.state.down ? (this.props.fallback ?? null) : this.props.children
  }
}

/** What went wrong, folded away, to copy for a bug report. */
function Details({ error }: { error: Error }) {
  const [copied, setCopied] = useState(false)
  const text = [error.message, ...(error.stack?.split('\n').slice(1, 8) ?? [])].join('\n')
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none">{t('Details')}</summary>
      <pre dir="ltr" className="mt-2 max-h-40 overflow-auto rounded-md bg-muted p-2 text-start break-words whitespace-pre-wrap">
        {text}
      </pre>
      <Button
        variant="ghost"
        size="sm"
        className="mt-1"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true))
        }}
      >
        {copied ? <Check /> : <Copy />} {copied ? t('Copied') : t('Copy details')}
      </Button>
    </details>
  )
}

/** A part of the app couldn't be fetched: a new version published (reload for it), or there's no connection. */
function missing(error: Error) {
  if (!isUpdateError(error)) return null
  return isOffline()
    ? { offline: true, title: t('This needs a connection'), note: t("It's downloaded the first time it's opened. Your plans are safe: reload once you're back online.") }
    : { offline: false, title: t('Planbreeze has been updated'), note: t('Reload to get the new version. Your plans are saved in this browser.') }
}

/** Nothing on it: not worth a file (the app failed before a plan was opened). */
const isEmpty = (p: Project) => p.floors.every((f) => !f.rooms.length && !f.symbols.length)

/** The whole app failed: what happened, and the ways on (the plans are safe in this browser). */
export function CrashScreen({ error }: { error: Error }) {
  const gone = missing(error)
  const update = !!gone
  const plan = useEditor.getState().project
  const canUndo = useEditor.getState().past.length > 0
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-4 text-foreground">
      <div role="alert" className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-500" />
          <div className="space-y-1">
            <h1 className="text-base font-semibold">{gone ? gone.title : t('Something went wrong')}</h1>
            <p className="text-sm text-muted-foreground">
              {gone ? gone.note : t('Planbreeze ran into a problem. Your plans are saved in this browser: reload to carry on, or keep a copy first.')}
            </p>
          </div>
        </div>
        <div className="grid gap-2">
          <Button onClick={() => window.location.reload()}>
            {gone?.offline ? <WifiOff /> : <RotateCw />} {t('Reload')}
          </Button>
          {!update && canUndo && (
            <Button
              variant="outline"
              onClick={() => {
                useEditor.getState().undo()
                void saveNow().then(() => window.location.reload())
              }}
            >
              <Undo2 /> {t('Undo the last change and reload')}
            </Button>
          )}
          {!update && (
            <Button variant="outline" onClick={startSafely}>
              <FolderOpen /> {t('Start without this plan')}
            </Button>
          )}
          {!isEmpty(plan) && (
            <Button variant="outline" onClick={() => download(plan, `${safeName(plan.name)}.floorplan.json`)}>
              <Download /> {t('Download this plan')}
            </Button>
          )}
          <Button variant="outline" onClick={() => void localBackup().then((b) => download(b, backupName()))}>
            <Archive /> {t('Download all my plans')}
          </Button>
        </div>
        <Details error={error} />
      </div>
    </div>
  )
}

/** A part of the app failed, the rest carrying on: what, and the ways on (`children`: more of them). */
export function PartCrash({ title, error, retry, className, children }: { title: string; error: Error; retry: () => void; className?: string; children?: ReactNode }) {
  const gone = missing(error)
  const update = !!gone
  return (
    <div role="alert" className={cn('m-3 space-y-3 rounded-lg border bg-card p-4 text-sm shadow-sm', className)}>
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <div className="space-y-1">
          <p className="font-medium">{gone ? gone.title : title}</p>
          <p className="text-muted-foreground">{gone ? gone.note : t('Your plan is safe. Try again, or carry on with the rest of the app.')}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {update ? (
          <Button size="sm" onClick={() => window.location.reload()}>
            <RotateCw /> {t('Reload')}
          </Button>
        ) : (
          <Button size="sm" onClick={retry}>
            <RotateCw /> {t('Try again')}
          </Button>
        )}
        {children}
      </div>
      {!update && <Details error={error} />}
    </div>
  )
}
