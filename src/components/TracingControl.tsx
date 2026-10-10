import { ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { t } from '@/i18n'
import { currentFloor, draftFloor, useEditor } from '@/store/editor'

/**
 * Tracing over a background drawing: how much of it shows, how solid the plan drawn over it is, or the drawing on top
 * of the plan, to read its lines and dimensions through what's been drawn. By the layer switch, so it's at hand while
 * tracing (the panel then shows the room being drawn).
 */
export function TracingControl() {
  const underlay = useEditor((s) => currentFloor(s).underlay)
  const planOpacity = useEditor((s) => s.settings.planOpacity)
  const onTop = useEditor((s) => s.settings.underlayOnTop)
  const setSettings = useEditor((s) => s.setSettings)
  if (!underlay) return null
  const setUnderlay = (patch: { visible?: boolean; opacity?: number }, commit = false) => {
    const recipe = (d: Parameters<Parameters<ReturnType<typeof useEditor.getState>['mutate']>[0]>[0]) => {
      const u = draftFloor(d).underlay
      if (u) Object.assign(u, patch)
    }
    if (commit) useEditor.getState().commit(recipe)
    else useEditor.getState().mutate(recipe)
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="bg-background/95 shadow-sm backdrop-blur" aria-label={t('Background drawing')}>
          <ImageIcon />
          <span className="max-sm:hidden">{t('Drawing')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <label className="flex items-center justify-between text-sm">
          {t('Show the drawing')}
          <Switch checked={underlay.visible} onCheckedChange={(v) => setUnderlay({ visible: v }, true)} />
        </label>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t('Drawing opacity')}</span>
            <span className="tabular-nums">{Math.round(underlay.opacity * 100)}%</span>
          </div>
          <Slider min={0.1} max={1} step={0.05} value={[underlay.opacity]} onValueChange={([v]) => setUnderlay({ opacity: v })} />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t('Plan opacity over it')}</span>
            <span className="tabular-nums">{Math.round(planOpacity * 100)}%</span>
          </div>
          <Slider min={0.15} max={1} step={0.05} value={[planOpacity]} onValueChange={([v]) => setSettings({ planOpacity: v })} />
        </div>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            <span className="block">{t('Drawing on top')}</span>
            <span className="block text-xs text-muted-foreground">{t('Its lines and dimensions show over the rooms you draw.')}</span>
          </span>
          <Switch checked={onTop} onCheckedChange={(v) => setSettings({ underlayOnTop: v })} />
        </label>
      </PopoverContent>
    </Popover>
  )
}
