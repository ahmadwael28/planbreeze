import { useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import {
  Aperture,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  Download,
  Ellipsis,
  Eye,
  FileJson,
  FileUp,
  ImageIcon,
  Languages,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Printer,
  RefreshCw,
  Ruler,
  ScanLine,
  Share2,
  Sparkles,
  Sun,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useTheme } from '@/components/theme-provider'
import type { Theme } from '@/components/theme-provider'
import { cn } from '@/lib/utils'
import { useCloud } from '@/cloud/store'
import { reconcile, signOut } from '@/cloud/sync'
import { openDesign } from '@/store/design'
import { currentFloor, isViewOnly, useEditor } from '@/store/editor'
import type { Settings } from '@/store/editor'
import { useUi } from '@/store/ui'
import { share } from './ShareControls'
import { takeSnapshot } from '@/utils/snapshot'
import { startTour } from './tour'
import { LANGS, setLang, t, useLang } from '@/i18n'
import type { Lang } from '@/i18n'

type Page = 'main' | 'view' | 'units' | 'files' | 'language' | 'theme' | 'account'

/** A row in a list: an icon in a colored tile, its name, and what it's set to, a check, or a way in. */
function Row({
  icon: Icon,
  tint,
  label,
  detail,
  onClick,
  more,
  checked,
  control,
  danger,
}: {
  icon?: ComponentType<{ className?: string }>
  tint?: string
  label: string
  detail?: string
  onClick?: () => void
  more?: boolean
  checked?: boolean
  control?: ReactNode
  danger?: boolean
}) {
  const body = (
    <>
      {Icon && (
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg text-white', tint ?? 'bg-muted-foreground')}>
          <Icon className="size-[18px]" />
        </span>
      )}
      <span className={cn('min-w-0 flex-1 truncate text-start text-[16px]', danger && 'text-destructive')}>{label}</span>
      {detail && <span className="max-w-[45%] shrink-0 truncate text-[15px] text-muted-foreground">{detail}</span>}
      {checked && <Check className="size-5 shrink-0 text-primary" />}
      {control}
      {more && <ChevronRight className="rtl-flip size-5 shrink-0 text-muted-foreground/70" />}
    </>
  )
  const cls = 'flex min-h-[52px] w-full items-center gap-3 px-4 py-2 transition-colors'
  return onClick ? (
    <button type="button" className={cn(cls, 'active:bg-foreground/8')} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** Rows grouped on a card, with hairlines between them, and an optional heading and note. */
function Group({ title, note, children }: { title?: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      {title && <h3 className="px-4 text-[13px] font-medium text-muted-foreground uppercase">{title}</h3>}
      <div className="divide-y divide-sheet-sep overflow-hidden rounded-[14px] bg-sheet-card">{children}</div>
      {note && <p className="px-4 text-[13px] leading-snug text-muted-foreground">{note}</p>}
    </section>
  )
}

/** One of the menu's pages: a header (back, and its name) over its lists, sliding in from the side. */
function PageView({ title, onBack, children, dir }: { title: string; onBack?: () => void; children: ReactNode; dir: 'in' | 'out' }) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', dir === 'in' ? 'animate-in slide-in-from-right-8 rtl:slide-in-from-left-8 fade-in-0' : 'animate-in slide-in-from-left-8 rtl:slide-in-from-right-8 fade-in-0', 'duration-200')}>
      <div className="relative flex h-11 shrink-0 items-center justify-center px-12">
        {onBack && (
          <Button variant="ghost" className="absolute start-1 h-10 gap-0.5 px-2 text-[16px] text-primary hover:text-primary" onClick={onBack}>
            <ChevronRight className="rtl-flip size-5 rotate-180" /> {t('Back')}
          </Button>
        )}
        <span className="truncate text-[17px] font-semibold">{title}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-3 pt-2 pb-3">{children}</div>
    </div>
  )
}

async function run(fn: (mod: typeof import('@/utils/export')) => unknown, success?: string) {
  try {
    await fn(await import('@/utils/export'))
    if (success) toast.success(success)
  } catch (e) {
    toast.error((e as Error).message)
  }
}

function exportOpts() {
  const st = useEditor.getState()
  return {
    units: st.project.units,
    showWallLengths: st.settings.showWallLengths,
    showAreas: st.settings.showAreas,
    title: `${st.project.name} — ${currentFloor(st).name}`,
  }
}

const VIEW_OPTIONS: [keyof Settings, string][] = [
  ['snap', 'Snap to grid & walls'],
  ['showGrid', 'Show grid'],
  ['showWallLengths', 'Show wall lengths'],
  ['showAreas', 'Show room areas'],
  ['showDimensions', 'Show dimension lines'],
  ['showFloorBelow', 'Show floor below'],
]

/**
 * The top bar's menu on a phone: a sheet from the bottom with its lists, as an app's settings are. Pages (view
 * options, units, files, language…) slide in with a way back, instead of menus opening off the side of the screen.
 */
export function PhoneMenu() {
  const [open, setOpen] = useState(false)
  const [stack, setStack] = useState<Page[]>(['main'])
  const [dir, setDir] = useState<'in' | 'out'>('in')
  const page = stack[stack.length - 1]
  const go = (p: Page) => {
    setDir('in')
    setStack((s) => [...s, p])
  }
  const back = () => {
    setDir('out')
    setStack((s) => s.slice(0, -1))
  }
  const close = () => setOpen(false)
  /** Do something and put the menu away. */
  const act = (fn: () => void) => () => {
    close()
    fn()
  }

  const settings = useEditor((s) => s.settings)
  const setSettings = useEditor((s) => s.setSettings)
  const units = useEditor((s) => s.project.units)
  const viewOnly = useEditor((s) => isViewOnly(s.project))
  const shared = useEditor((s) => !!s.project.access)
  const cloud = useCloud((s) => s.configured)
  const ready = useCloud((s) => s.ready)
  const user = useCloud((s) => s.user)
  const openSignIn = useCloud((s) => s.openSignIn)
  const lang = useLang()
  const { theme, setTheme } = useTheme()
  const fileRef = useRef<HTMLInputElement>(null)

  const project = () => useEditor.getState().project
  const floor = () => currentFloor(useEditor.getState())
  const themeName = { light: t('Light'), dark: t('Dark'), system: t('System') }[theme]
  const unitName = units === 'metric' ? t('Metric (m, cm)') : t('Imperial (ft, in)')
  const name = user ? user.name || user.email || t('Account') : ''

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('More')}
        data-tour="export"
        onClick={() => {
          setStack(['main'])
          setDir('in')
          setOpen(true)
        }}
      >
        <Ellipsis />
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) await run(async (m) => useEditor.getState().loadProject(await m.importJson(file)), t('Opened “{name}”', { name: file.name }))
        }}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[min(86dvh,720px)] flex-col gap-0 overflow-hidden bg-sheet p-0 pt-2" showCloseButton={false}>
          <DialogTitle className="sr-only">{t('Menu')}</DialogTitle>
          <DialogDescription className="sr-only">{t('Settings, files and your account')}</DialogDescription>
          {page === 'main' && (
            <PageView key="main" title={project().name} dir={dir}>
              {(!viewOnly || (cloud && !shared)) && (
                <Group>
                  {!viewOnly && <Row icon={Sparkles} tint="bg-violet-500" label={t('Suggest an interior design')} onClick={act(openDesign)} more />}
                  {cloud && !shared && <Row icon={Share2} tint="bg-sky-500" label={t('Share')} onClick={act(share)} more />}
                </Group>
              )}
              <Group title={t('Plan')}>
                <Row icon={Camera} tint="bg-pink-500" label={t('Snapshot')} onClick={act(takeSnapshot)} />
                {useEditor.getState().viewMode === '3d' && (
                  <Row icon={Aperture} tint="bg-orange-500" label={t('Realistic render')} detail={t('Beta')} onClick={act(() => useUi.getState().openRender(true))} more />
                )}
                <Row icon={Eye} tint="bg-emerald-500" label={t('View options')} onClick={() => go('view')} more />
                <Row icon={Ruler} tint="bg-amber-500" label={t('Units')} detail={unitName} onClick={() => go('units')} more />
                <Row icon={Download} tint="bg-blue-500" label={t('Export & files')} onClick={() => go('files')} more />
              </Group>
              <Group title={t('App')}>
                <Row icon={Languages} tint="bg-indigo-500" label={t('Language')} detail={LANGS.find((l) => l.id === lang)?.name} onClick={() => go('language')} more />
                <Row icon={theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor} tint="bg-slate-500" label={t('Theme')} detail={themeName} onClick={() => go('theme')} more />
                <Row icon={CircleHelp} tint="bg-teal-500" label={t('Take the tour')} onClick={act(startTour)} />
              </Group>
              {cloud && (
                <Group title={t('Account')}>
                  {user ? (
                    <Row icon={UserRound} tint="bg-primary" label={name} onClick={() => go('account')} more />
                  ) : (
                    <Row icon={LogIn} tint="bg-primary" label={t('Sign in')} detail={ready ? undefined : '…'} onClick={ready ? act(() => openSignIn(true)) : undefined} more />
                  )}
                </Group>
              )}
            </PageView>
          )}
          {page === 'view' && (
            <PageView key="view" title={t('View options')} onBack={back} dir={dir}>
              <Group title={t('Plan view')}>
                {VIEW_OPTIONS.map(([k, label]) => (
                  <Row
                    key={k}
                    label={t(label)}
                    control={<Switch checked={!!settings[k]} onCheckedChange={(v) => setSettings({ [k]: v } as Partial<Settings>)} aria-label={t(label)} />}
                  />
                ))}
              </Group>
            </PageView>
          )}
          {page === 'units' && (
            <PageView key="units" title={t('Units')} onBack={back} dir={dir}>
              <Group>
                {(['metric', 'imperial'] as const).map((u) => (
                  <Row
                    key={u}
                    label={u === 'metric' ? t('Metric (m, cm)') : t('Imperial (ft, in)')}
                    checked={units === u}
                    onClick={() => useEditor.getState().commit((d) => void (d.units = u))}
                  />
                ))}
              </Group>
            </PageView>
          )}
          {page === 'files' && (
            <PageView key="files" title={t('Export & files')} onBack={back} dir={dir}>
              <Group title={t('Export current floor')} note={t('Saved or sent on with your phone’s share sheet.')}>
                <Row icon={Printer} tint="bg-rose-500" label={t('Print to scale (PDF)…')} onClick={act(() => useUi.getState().openPrint(true))} more />
                <Row icon={ImageIcon} tint="bg-blue-500" label={t('PNG image')} onClick={act(() => void run((m) => m.exportPng(project(), floor(), exportOpts())))} />
                <Row icon={ImageIcon} tint="bg-cyan-600" label={t('SVG vector')} onClick={act(() => void run((m) => m.exportSvg(project(), floor(), exportOpts())))} />
              </Group>
              <Group title={t('Import')}>
                <Row icon={ScanLine} tint="bg-emerald-500" label={t('Sketch or photo of a plan…')} onClick={act(() => useUi.getState().openImport('current'))} more />
              </Group>
              <Group title={t('Project file')}>
                <Row icon={FileJson} tint="bg-amber-500" label={t('Save project (.json)')} onClick={act(() => void run((m) => m.exportJson(project())))} />
                <Row icon={FileUp} tint="bg-slate-500" label={t('Open project file…')} onClick={() => {
                    close()
                    fileRef.current?.click()
                  }}
                />
              </Group>
            </PageView>
          )}
          {page === 'language' && (
            <PageView key="language" title={t('Language')} onBack={back} dir={dir}>
              <Group>
                {LANGS.map((l) => (
                  <Row key={l.id} label={l.name} checked={lang === l.id} onClick={act(() => setLang(l.id as Lang))} />
                ))}
              </Group>
            </PageView>
          )}
          {page === 'theme' && (
            <PageView key="theme" title={t('Theme')} onBack={back} dir={dir}>
              <Group>
                {(['light', 'dark', 'system'] as Theme[]).map((th) => (
                  <Row
                    key={th}
                    icon={th === 'light' ? Sun : th === 'dark' ? Moon : Monitor}
                    tint={th === 'light' ? 'bg-amber-500' : th === 'dark' ? 'bg-slate-700' : 'bg-slate-500'}
                    label={{ light: t('Light'), dark: t('Dark'), system: t('System') }[th]}
                    checked={theme === th}
                    onClick={() => setTheme(th)}
                  />
                ))}
              </Group>
            </PageView>
          )}
          {page === 'account' && user && (
            <PageView key="account" title={t('Account')} onBack={back} dir={dir}>
              <Group note={user.email && user.email !== name ? user.email : undefined}>
                <Row icon={UserRound} tint="bg-primary" label={name} />
              </Group>
              <Group>
                <Row icon={RefreshCw} tint="bg-sky-500" label={t('Sync now')} onClick={act(() => void reconcile())} />
              </Group>
              <Group>
                <Row label={t('Sign out')} icon={LogOut} tint="bg-slate-500" onClick={act(() => void signOut(false))} />
                <Row label={t('Sign out and remove plans from this device')} icon={LogOut} tint="bg-destructive" danger onClick={act(() => void signOut(true))} />
              </Group>
            </PageView>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
