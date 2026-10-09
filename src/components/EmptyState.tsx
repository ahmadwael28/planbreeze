import { LayoutTemplate, RectangleHorizontal, ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEditor, useFloor } from '@/store/editor'
import { useUi } from '@/store/ui'
import { t } from '@/i18n'

/** Shown on an empty floor so the first step is obvious. */
export function EmptyState() {
  const floor = useFloor()
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const openImport = useUi((s) => s.openImport)
  const openStart = useUi((s) => s.openStart)

  if (floor.rooms.length || floor.symbols.length || floor.underlay || tool !== 'select') return null

  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center p-4">
      <div className="pointer-events-auto w-full max-w-sm rounded-2xl border bg-background/95 p-5 text-center shadow-lg backdrop-blur">
        <h2 className="text-lg font-semibold">{t("Let's get your floor plan in")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('Pick whatever is quickest for you.')}</p>
        <div className="mt-4 grid gap-2">
          <Button size="lg" className="h-11 justify-start" onClick={() => openImport('current')}>
            <ScanLine /> {t('Import a sketch or photo')}
          </Button>
          <Button size="lg" variant="outline" className="h-11 justify-start" onClick={() => setTool('rect')}>
            <RectangleHorizontal /> {t('Draw a room')}
            <kbd className="ms-auto rounded border px-1.5 font-mono text-xs text-muted-foreground">R</kbd>
          </Button>
          <Button size="lg" variant="ghost" className="h-11 justify-start" onClick={() => openStart(true)}>
            <LayoutTemplate /> {t('Use a template')}
          </Button>
        </div>
      </div>
    </div>
  )
}
