/**
 * Print to scale: writes a vector PDF (jsPDF + svg2pdf.js) with a title block and a scale bar.
 * Loaded on demand.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import type { Floor, Project } from '@/model/types'
import { layoutPage, MARGIN, PrintPlan, scaleBar, scaleLabel, TITLE_H } from './print-layout'
import type { PrintOptions } from './print-layout'

async function renderPage(
  doc: import('jspdf').jsPDF,
  project: Project,
  floor: Floor,
  opts: PrintOptions,
) {
  const layout = layoutPage(floor, opts, project.units)
  const { area, viewBox: vb } = layout
  const markup = renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" width={area.w} height={area.h} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}>
      <PrintPlan floor={floor} units={project.units} layout={layout} opts={opts} />
    </svg>,
  )
  // The PDF's built-in fonts don't include system-ui; use Helvetica for every label.
  const pdfMarkup = markup.replace(/font-family="[^"]*"/g, 'font-family="helvetica"')
  const el = new DOMParser().parseFromString(pdfMarkup, 'image/svg+xml').documentElement
  // svg2pdf measures text through the DOM, so mount it off-screen while converting.
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden'
  holder.appendChild(el)
  document.body.appendChild(holder)
  try {
    await doc.svg(el, { x: area.x, y: area.y, width: area.w, height: area.h })
  } finally {
    holder.remove()
  }

  // Frame and title block.
  const { pageW, pageH } = layout
  const tbY = pageH - MARGIN - TITLE_H
  doc.setDrawColor(31, 31, 31)
  doc.setLineWidth(0.35)
  doc.rect(MARGIN, MARGIN, pageW - MARGIN * 2, pageH - MARGIN * 2)
  doc.line(MARGIN, tbY, pageW - MARGIN, tbY)
  doc.setTextColor(20, 20, 20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(project.name, MARGIN + 4, tbY + 7.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const layerName = opts.layer === 'lighting' ? 'Ceiling & lighting plan' : 'Floor plan'
  doc.text(`${floor.name} · ${layerName}`, MARGIN + 4, tbY + 13)
  doc.setFontSize(7.5)
  doc.setTextColor(110, 110, 110)
  doc.text(`${new Date().toLocaleDateString()} · Planbreeze`, MARGIN + 4, tbY + 17)

  // Scale and scale bar on the right.
  const right = pageW - MARGIN - 4
  doc.setTextColor(20, 20, 20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(`Scale ${scaleLabel(layout.scale, project.units)}`, right, tbY + 7.5, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(110, 110, 110)
  doc.text(`on ${opts.paper} · print at 100% (no "fit to page")`, right, tbY + 11.5, { align: 'right' })
  const bar = scaleBar(layout.scale, project.units)
  const seg = 4
  const x0 = right - bar.mm - 10
  const y0 = tbY + 14.5
  doc.setLineWidth(0.2)
  for (let i = 0; i < seg; i++) {
    const w = bar.mm / seg
    if (i % 2 === 0) doc.setFillColor(31, 31, 31)
    else doc.setFillColor(255, 255, 255)
    doc.rect(x0 + i * w, y0, w, 1.8, 'FD')
  }
  doc.setFontSize(6.5)
  doc.setTextColor(40, 40, 40)
  doc.text('0', x0, y0 + 4.4, { align: 'center' })
  doc.text(bar.label, x0 + bar.mm, y0 + 4.4, { align: 'center' })
}

/** Build the PDF; saves it as a download, or returns it as a Blob when `save` is false. */
export async function exportPdf(project: Project, floors: Floor[], opts: PrintOptions, save = true): Promise<Blob | void> {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])
  const doc = new jsPDF({ unit: 'mm', format: opts.paper.toLowerCase(), orientation: opts.orientation })
  for (let i = 0; i < floors.length; i++) {
    if (i > 0) doc.addPage(opts.paper.toLowerCase(), opts.orientation)
    await renderPage(doc, project, floors[i], opts)
  }
  if (!save) return doc.output('blob')
  const safe = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'floorplan'
  const suffix = floors.length === 1 ? `-${safe(floors[0].name)}` : ''
  doc.save(`${safe(project.name)}${suffix}-${opts.layer === 'lighting' ? 'lighting' : 'plan'}.pdf`)
}
