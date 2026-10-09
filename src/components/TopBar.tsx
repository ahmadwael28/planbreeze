import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useTheme } from '@/components/theme-provider'
import type { Theme } from '@/components/theme-provider'
import {
  CircleHelp,
  Download,
  FileJson,
  FileUp,
  FolderOpen,
  ImageIcon,
  Languages,
  Monitor,
  Moon,
  PanelRight,
  Printer,
  Redo2,
  ScanLine,
  Settings2,
  Sparkles,
  Sun,
  Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { openDesign } from '@/store/design'
import { currentFloor, isViewOnly, useEditor } from '@/store/editor'
import { useUi } from '@/store/ui'
import { AccountButton, SaveStatus } from './AccountControls'
import { ShareControls } from './ShareControls'
import { startTour } from './tour'
import { Logo } from './Logo'
import type { ViewMode } from '@/store/editor'
import { LANGS, setLang, t, useLang } from '@/i18n'
import type { Lang } from '@/i18n'

interface Props {
  onToggleSidebar: () => void
  sidebarOpen: boolean
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

/** Run an action, reporting failures as a toast. The export module is loaded on demand. */
async function run(fn: (mod: typeof import('@/utils/export')) => unknown, success?: string) {
  try {
    await fn(await import('@/utils/export'))
    if (success) toast.success(success)
  } catch (e) {
    toast.error((e as Error).message)
  }
}

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** English or Arabic. */
function LanguageMenu() {
  const lang = useLang()
  return (
    <DropdownMenu>
      <Tip label={t('Language')}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('Language')}>
            <Languages />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={lang} onValueChange={(v) => setLang(v as Lang)}>
          {LANGS.map((l) => (
            <DropdownMenuRadioItem key={l.id} value={l.id} lang={l.id}>
              {l.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ThemeMenu() {
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenu>
      <Tip label={t('Theme')}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('Theme')}>
            <Sun className="dark:hidden" />
            <Moon className="hidden dark:block" />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <DropdownMenuRadioItem value="light">
            <Sun /> {t('Light')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> {t('Dark')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> {t('System')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TopBar({ onToggleSidebar, sidebarOpen }: Props) {
  const name = useEditor((s) => s.project.name)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const settings = useEditor((s) => s.settings)
  const setSettings = useEditor((s) => s.setSettings)
  const units = useEditor((s) => s.project.units)
  const commit = useEditor((s) => s.commit)
  const viewMode = useEditor((s) => s.viewMode)
  const setViewMode = useEditor((s) => s.setViewMode)
  const fileRef = useRef<HTMLInputElement>(null)
  const viewOnly = useEditor((s) => isViewOnly(s.project))

  const project = () => useEditor.getState().project
  const floor = () => currentFloor(useEditor.getState())

  return (
    <header className="z-10 flex h-13 shrink-0 items-center gap-1 overflow-hidden border-b bg-background px-2 sm:gap-2 sm:px-3">
      <div className="me-1 hidden items-center gap-2 sm:flex">
        <Logo className="size-8" />
        <span className="hidden text-[15px] font-semibold tracking-tight lg:inline">Planbreeze</span>
      </div>

      <Button variant="outline" onClick={() => useUi.getState().openProjects(true)} className="max-w-32 min-w-0 sm:max-w-64" data-tour="projects">
        <FolderOpen />
        <span className="truncate">{name}</span>
      </Button>
      <SaveStatus />
      <ShareControls />

      <div className="flex shrink-0 items-center">
        <Tip label={t('Undo (Ctrl+Z)')}>
          <Button variant="ghost" size="icon" disabled={!canUndo} onClick={undo} aria-label={t('Undo')}>
            <Undo2 className="rtl-flip" />
          </Button>
        </Tip>
        <Tip label={t('Redo (Ctrl+Y)')}>
          <Button variant="ghost" size="icon" disabled={!canRedo} onClick={redo} aria-label={t('Redo')}>
            <Redo2 className="rtl-flip" />
          </Button>
        </Tip>
      </div>

      <div className="flex flex-1 justify-center">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={viewMode}
          onValueChange={(v) => v && setViewMode(v as ViewMode)}
          aria-label={t('View mode')}
          data-tour="view-mode"
        >
          <ToggleGroupItem value="2d" className="px-3 font-semibold data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
            2D
          </ToggleGroupItem>
          <ToggleGroupItem value="3d" className="px-3 font-semibold data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
            3D
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="flex shrink-0 items-center">
        {!viewOnly && (
          <Tip label={t('Suggest an interior design')}>
            <Button variant="ghost" onClick={openDesign} className="gap-1.5 px-2.5" data-tour="design">
              <Sparkles className="text-primary" />
              <span className="max-lg:hidden">{t('Design')}</span>
            </Button>
          </Tip>
        )}
        <Tip label={t('Switch units')}>
          <Button
            variant="ghost"
            size="icon"
            className="font-semibold"
            onClick={() => commit((d) => void (d.units = units === 'metric' ? 'imperial' : 'metric'))}
          >
            {units === 'metric' ? 'm' : 'ft'}
          </Button>
        </Tip>

        <DropdownMenu>
          <Tip label={t('View options')}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('View options')}>
                <Settings2 />
              </Button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{t('Plan view')}</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={settings.snap} onCheckedChange={(v) => setSettings({ snap: v })}>
              {t('Snap to grid & walls')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={settings.showGrid} onCheckedChange={(v) => setSettings({ showGrid: v })}>
              {t('Show grid')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={settings.showWallLengths}
              onCheckedChange={(v) => setSettings({ showWallLengths: v })}
            >
              {t('Show wall lengths')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={settings.showAreas} onCheckedChange={(v) => setSettings({ showAreas: v })}>
              {t('Show room areas')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={settings.showDimensions}
              onCheckedChange={(v) => setSettings({ showDimensions: v })}
            >
              {t('Show dimension lines')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={settings.showFloorBelow}
              onCheckedChange={(v) => setSettings({ showFloorBelow: v })}
            >
              {t('Show floor below')}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <Tip label={t('Export / import')}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('Export or import')} data-tour="export">
                <Download />
              </Button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={() => useUi.getState().openPrint(true)}>
              <Printer /> {t('Print to scale (PDF)…')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('Export current floor')}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => run((m) => m.exportPng(project(), floor(), exportOpts()))}>
              <ImageIcon /> {t('PNG image')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((m) => m.exportSvg(project(), floor(), exportOpts()))}>
              <ImageIcon /> {t('SVG vector')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('Import')}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => useUi.getState().openImport('current')}>
              <ScanLine /> {t('Sketch or photo of a plan…')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('Project file')}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => run((m) => m.exportJson(project()))}>
              <FileJson /> {t('Save project (.json)')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
              <FileUp /> {t('Open project file…')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) {
              await run(
                async (m) => useEditor.getState().loadProject(await m.importJson(file)),
                t('Opened “{name}”', { name: file.name }),
              )
            }
          }}
        />

        <LanguageMenu />
        <ThemeMenu />
        <Tip label={t('Take the tour')}>
          <Button variant="ghost" size="icon" onClick={startTour} aria-label={t('Take the tour')} data-tour="help">
            <CircleHelp />
          </Button>
        </Tip>
        <AccountButton />

        <Separator orientation="vertical" className="mx-1 hidden h-5! sm:block" />
        <Tip label={sidebarOpen ? t('Hide panel') : t('Show panel')}>
          <Button
            variant={sidebarOpen ? 'secondary' : 'ghost'}
            size="icon"
            onClick={onToggleSidebar}
            aria-label={t('Toggle panel')}
          >
            <PanelRight className="rtl-flip" />
          </Button>
        </Tip>
      </div>
    </header>
  )
}
