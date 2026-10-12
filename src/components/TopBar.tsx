import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useTheme } from '@/components/theme-provider'
import type { Theme } from '@/components/theme-provider'
import {
  CircleHelp,
  Download,
  Ellipsis,
  Eye,
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
  Ruler,
  ScanLine,
  Settings2,
  Share2,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLayout } from '@/hooks/use-layout'
import { cn } from '@/lib/utils'
import { useCloud } from '@/cloud/store'
import { openDesign } from '@/store/design'
import { currentFloor, isViewOnly, useEditor } from '@/store/editor'
import { useUi } from '@/store/ui'
import { AccountButton, AccountMenuItems, SaveStatus } from './AccountControls'
import { ShareControls, share } from './ShareControls'
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

const project = () => useEditor.getState().project
const floor = () => currentFloor(useEditor.getState())

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** What the plan shows (snapping, grid, lengths, …), as menu items. */
function ViewOptionItems() {
  const settings = useEditor((s) => s.settings)
  const setSettings = useEditor((s) => s.setSettings)
  return (
    <>
      <DropdownMenuCheckboxItem checked={settings.snap} onCheckedChange={(v) => setSettings({ snap: v })}>
        {t('Snap to grid & walls')}
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem checked={settings.showGrid} onCheckedChange={(v) => setSettings({ showGrid: v })}>
        {t('Show grid')}
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem checked={settings.showWallLengths} onCheckedChange={(v) => setSettings({ showWallLengths: v })}>
        {t('Show wall lengths')}
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem checked={settings.showAreas} onCheckedChange={(v) => setSettings({ showAreas: v })}>
        {t('Show room areas')}
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem checked={settings.showDimensions} onCheckedChange={(v) => setSettings({ showDimensions: v })}>
        {t('Show dimension lines')}
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem checked={settings.showFloorBelow} onCheckedChange={(v) => setSettings({ showFloorBelow: v })}>
        {t('Show floor below')}
      </DropdownMenuCheckboxItem>
    </>
  )
}

/** Printing, exporting and opening files, as menu items. `openFile` asks for a project file. */
function ExportItems({ openFile }: { openFile: () => void }) {
  return (
    <>
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
      <DropdownMenuItem onSelect={openFile}>
        <FileUp /> {t('Open project file…')}
      </DropdownMenuItem>
    </>
  )
}

function LanguageItems() {
  const lang = useLang()
  return (
    <DropdownMenuRadioGroup value={lang} onValueChange={(v) => setLang(v as Lang)}>
      {LANGS.map((l) => (
        <DropdownMenuRadioItem key={l.id} value={l.id} lang={l.id}>
          {l.name}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

function ThemeItems() {
  const { theme, setTheme } = useTheme()
  return (
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
  )
}

function UnitItems() {
  const units = useEditor((s) => s.project.units)
  const commit = useEditor((s) => s.commit)
  return (
    <DropdownMenuRadioGroup value={units} onValueChange={(v) => commit((d) => void (d.units = v as 'metric' | 'imperial'))}>
      <DropdownMenuRadioItem value="metric">{t('Metric (m, cm)')}</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="imperial">{t('Imperial (ft, in)')}</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  )
}

/**
 * The top bar's menu on smaller screens: what doesn't fit beside the essentials. On a phone (`compact`) that's
 * also designing, sharing and the account.
 */
function MoreMenu({ compact, openFile }: { compact: boolean; openFile: () => void }) {
  const viewOnly = useEditor((s) => isViewOnly(s.project))
  const cloud = useCloud((s) => s.configured)
  const shared = useEditor((s) => !!s.project.access)
  return (
    <DropdownMenu>
      <Tip label={t('More')}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('More')} data-tour="export">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-64">
        {compact && !viewOnly && (
          <DropdownMenuItem onSelect={openDesign}>
            <Sparkles className="text-primary" /> {t('Suggest an interior design')}
          </DropdownMenuItem>
        )}
        {compact && cloud && !shared && (
          <DropdownMenuItem onSelect={share}>
            <Share2 /> {t('Share')}
          </DropdownMenuItem>
        )}
        {compact && (!viewOnly || (cloud && !shared)) && <DropdownMenuSeparator />}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Eye /> {t('View options')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            <ViewOptionItems />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Ruler /> {t('Units')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <UnitItems />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Download /> {t('Export / import')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-60">
            <ExportItems openFile={openFile} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages /> {t('Language')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <LanguageItems />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Sun className="dark:hidden" />
            <Moon className="hidden dark:block" /> {t('Theme')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <ThemeItems />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={startTour}>
          <CircleHelp /> {t('Take the tour')}
        </DropdownMenuItem>
        {compact && <AccountMenuItems before={<DropdownMenuSeparator />} />}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The bar along the top. Wide screens show everything; smaller ones keep the essentials (plans, saving, undo, 2D / 3D)
 * and put the rest in a menu, so nothing is cut off.
 */
export function TopBar({ onToggleSidebar, sidebarOpen }: Props) {
  const name = useEditor((s) => s.project.name)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const units = useEditor((s) => s.project.units)
  const commit = useEditor((s) => s.commit)
  const viewMode = useEditor((s) => s.viewMode)
  const setViewMode = useEditor((s) => s.setViewMode)
  const fileRef = useRef<HTMLInputElement>(null)
  const viewOnly = useEditor((s) => isViewOnly(s.project))
  const layout = useLayout()
  const full = layout.topBar === 'full'
  const compact = layout.topBar === 'compact'
  const openFile = () => fileRef.current?.click()

  return (
    <header className="z-10 flex h-13 shrink-0 items-center gap-1 overflow-hidden border-b bg-background px-2 sm:gap-2 sm:px-3">
      <div className="me-1 hidden items-center gap-2 sm:flex">
        <Logo className="size-8" />
        <span className="hidden text-[15px] font-semibold tracking-tight lg:inline">Planbreeze</span>
      </div>

      <Button
        variant="outline"
        onClick={() => useUi.getState().openProjects(true)}
        className={cn('min-w-0 shrink', compact ? 'max-w-40 px-2.5' : 'max-w-32 sm:max-w-64')}
        data-tour="projects"
      >
        <FolderOpen />
        <span className="truncate">{name}</span>
      </Button>
      <SaveStatus />
      <ShareControls inMenu={compact} />

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
          <ToggleGroupItem value="2d" className={cn('font-semibold data-[state=on]:bg-primary data-[state=on]:text-primary-foreground', compact ? 'px-2.5' : 'px-3')}>
            2D
          </ToggleGroupItem>
          <ToggleGroupItem value="3d" className={cn('font-semibold data-[state=on]:bg-primary data-[state=on]:text-primary-foreground', compact ? 'px-2.5' : 'px-3')}>
            3D
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="flex shrink-0 items-center">
        {!compact && !viewOnly && (
          <Tip label={t('Suggest an interior design')}>
            <Button variant="ghost" onClick={openDesign} className="gap-1.5 px-2.5" data-tour="design">
              <Sparkles className="text-primary" />
              <span className="max-lg:hidden">{t('Design')}</span>
            </Button>
          </Tip>
        )}
        {full && (
          <>
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
                <ViewOptionItems />
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
                <ExportItems openFile={openFile} />
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <Tip label={t('Language')}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t('Language')}>
                    <Languages />
                  </Button>
                </DropdownMenuTrigger>
              </Tip>
              <DropdownMenuContent align="end">
                <LanguageItems />
              </DropdownMenuContent>
            </DropdownMenu>
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
                <ThemeItems />
              </DropdownMenuContent>
            </DropdownMenu>
            <Tip label={t('Take the tour')}>
              <Button variant="ghost" size="icon" onClick={startTour} aria-label={t('Take the tour')} data-tour="help">
                <CircleHelp />
              </Button>
            </Tip>
          </>
        )}
        {!full && <MoreMenu compact={compact} openFile={openFile} />}
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
        {!compact && <AccountButton />}

        {/* With the tools along the bottom, the panel has its own button there. */}
        {!layout.bottomBar && (
          <>
            <Separator orientation="vertical" className="mx-1 hidden h-5! sm:block" />
            <Tip label={sidebarOpen ? t('Hide panel') : t('Show panel')}>
              <Button variant={sidebarOpen ? 'secondary' : 'ghost'} size="icon" onClick={onToggleSidebar} aria-label={t('Toggle panel')}>
                <PanelRight className="rtl-flip" />
              </Button>
            </Tip>
          </>
        )}
      </div>
    </header>
  )
}
