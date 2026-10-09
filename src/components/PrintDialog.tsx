import { t, tc } from '@/i18n'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { FileDown } from 'lucide-react'
import { Loader } from '@/components/ui/loader'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { currentFloor, useEditor } from '@/store/editor'
import { useUi } from '@/store/ui'
import {
  IMPERIAL_SCALES,
  layoutPage,
  MARGIN,
  METRIC_SCALES,
  PAPERS,
  PrintPlan,
  scaleBar,
  scaleLabel,
  TITLE_H,
} from '@/utils/print-layout'
import type { Paper, PrintOptions } from '@/utils/print-layout'

const on = 'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] items-center gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function PrintDialog() {
  const open = useUi((s) => s.printOpen)
  const setOpen = useUi((s) => s.openPrint)
  const project = useEditor((s) => s.project)
  const floor = useEditor(currentFloor)
  const layer = useEditor((s) => s.layer)
  const settings = useEditor((s) => s.settings)
  const units = project.units

  const [opts, setOpts] = useState<PrintOptions>(() => ({
    paper: units === 'imperial' ? 'Letter' : 'A4',
    orientation: 'landscape',
    scale: 'fit',
    layer,
    floors: 'current',
    showDimensions: settings.showDimensions,
    showAreas: settings.showAreas,
    showWallLengths: settings.showWallLengths,
    showFurniture: true,
    color: true,
  }))
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<PrintOptions>) => setOpts((o) => ({ ...o, ...patch }))

  // Follow the layer being edited when the dialog opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open && opts.layer !== layer) set({ layer })
  }

  const layout = useMemo(() => layoutPage(floor, opts, units), [floor, opts, units])
  const scales = units === 'imperial' ? IMPERIAL_SCALES : METRIC_SCALES
  const bar = scaleBar(layout.scale, units)

  const download = async () => {
    setBusy(true)
    try {
      const { exportPdf } = await import('@/utils/pdf')
      const floors = opts.floors === 'all' ? project.floors.filter((f) => f.rooms.length) : [floor]
      await exportPdf(project, floors.length ? floors : [floor], opts)
      toast.success(t('PDF saved. Print it at 100% (actual size) to keep the scale.'))
      setOpen(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const { pageW, pageH, area, viewBox: vb } = layout
  const tbY = pageH - MARGIN - TITLE_H

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{t('Print to scale')}</DialogTitle>
          <DialogDescription>{t('A vector PDF at an exact scale, with a title block and a scale bar.')}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[1fr_320px] md:overflow-hidden">
          {/* page preview */}
          <div className="grid min-h-[40vh] place-items-center bg-muted/50 p-5 md:min-h-0">
            <svg
              viewBox={`0 0 ${pageW} ${pageH}`}
              className="max-h-[62vh] w-full rounded-sm bg-white shadow-lg ring-1 ring-black/10"
              preserveAspectRatio="xMidYMid meet"
            >
              <rect width={pageW} height={pageH} fill="#fff" />
              <svg x={area.x} y={area.y} width={area.w} height={area.h} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}>
                <PrintPlan floor={floor} units={units} layout={layout} opts={opts} />
              </svg>
              <g fill="none" stroke="#1f1f1f" strokeWidth={0.35}>
                <rect x={MARGIN} y={MARGIN} width={pageW - MARGIN * 2} height={pageH - MARGIN * 2} />
                <line x1={MARGIN} y1={tbY} x2={pageW - MARGIN} y2={tbY} />
              </g>
              <g fontFamily="Helvetica, Arial, sans-serif" fill="#141414">
                <text x={MARGIN + 4} y={tbY + 7.5} fontSize={4.2} fontWeight={700}>
                  {project.name}
                </text>
                <text x={MARGIN + 4} y={tbY + 13} fontSize={3.2}>
                  {floor.name} · {opts.layer === 'lighting' ? 'Ceiling & lighting plan' : 'Floor plan'}
                </text>
                <text x={pageW - MARGIN - 4} y={tbY + 7.5} fontSize={3.5} fontWeight={700} textAnchor="end">
                  Scale {scaleLabel(layout.scale, units)}
                </text>
                {Array.from({ length: 4 }, (_, i) => (
                  <rect
                    key={i}
                    x={pageW - MARGIN - 14 - bar.mm + (i * bar.mm) / 4}
                    y={tbY + 14.5}
                    width={bar.mm / 4}
                    height={1.8}
                    fill={i % 2 ? '#fff' : '#1f1f1f'}
                    stroke="#1f1f1f"
                    strokeWidth={0.2}
                  />
                ))}
                <text x={pageW - MARGIN - 14} y={tbY + 18.9} fontSize={2.3} textAnchor="middle">
                  {bar.label}
                </text>
              </g>
            </svg>
          </div>

          {/* options */}
          <div className="flex min-h-0 flex-col border-t md:border-t-0 md:border-l">
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <Row label={t('Paper')}>
                <Select value={opts.paper} onValueChange={(v) => set({ paper: v as Paper })}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PAPERS) as Paper[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        {p} · {PAPERS[p][0]} × {PAPERS[p][1]} mm
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <Row label={t('Orientation')}>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={opts.orientation}
                  onValueChange={(v) => v && set({ orientation: v as PrintOptions['orientation'] })}
                  className="w-full"
                >
                  <ToggleGroupItem value="portrait" className={`flex-1 ${on}`}>
                    {t('Portrait')}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="landscape" className={`flex-1 ${on}`}>
                    {t('Landscape')}
                  </ToggleGroupItem>
                </ToggleGroup>
              </Row>
              <Row label={t('Scale')}>
                <Select
                  value={String(opts.scale)}
                  onValueChange={(v) => set({ scale: v === 'fit' ? 'fit' : Number(v) })}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fit">Fit to page ({scaleLabel(layout.fitScale, units)})</SelectItem>
                    {scales.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {scaleLabel(n, units)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              {!layout.fits && (
                <p className="rounded-md bg-amber-500/15 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300">
                  {t('The plan is cut off at {scale}. Pick {fit}, a bigger paper, or the other orientation.', {
                    scale: scaleLabel(layout.scale, units),
                    fit: scaleLabel(layout.fitScale, units),
                  })}
                </p>
              )}
              <Row label={t('Plan')}>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={opts.layer}
                  onValueChange={(v) => v && set({ layer: v as PrintOptions['layer'] })}
                  className="w-full"
                >
                  <ToggleGroupItem value="plan" className={`flex-1 ${on}`}>
                    {t('Floor plan')}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="lighting" className={`flex-1 ${on}`}>
                    {t('Lighting')}
                  </ToggleGroupItem>
                </ToggleGroup>
              </Row>
              {project.floors.length > 1 && (
                <Row label={tc('levels', 'Floors')}>
                  <Select value={opts.floors} onValueChange={(v) => set({ floors: v as PrintOptions['floors'] })}>
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="current">{t('This floor')}</SelectItem>
                      <SelectItem value="all">{t('All floors (one page each)')}</SelectItem>
                    </SelectContent>
                  </Select>
                </Row>
              )}
              <div className="space-y-2.5 border-t pt-3">
                {(
                  [
                    ['showDimensions', 'Dimension lines'],
                    ['showWallLengths', 'Wall lengths'],
                    ['showAreas', 'Room areas'],
                    ['showFurniture', 'Furniture'],
                    ['color', 'Colored rooms'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between text-sm">
                    {t(label)}
                    <Switch checked={opts[key]} onCheckedChange={(v) => set({ [key]: v })} />
                  </label>
                ))}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('When printing the PDF, choose “Actual size / 100%”. Check the scale bar with a ruler.')}
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t p-4">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t('Cancel')}
              </Button>
              <Button onClick={download} disabled={busy || layout.empty}>
                {busy ? <Loader label={t('Making the PDF')} /> : <FileDown />} Download PDF
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
