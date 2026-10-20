import { renderToStaticMarkup } from 'react-dom/server'
import { PlanLayers } from '@/components/PlanLayers'
import { DARK_THEME, LIGHT_THEME } from '@/model/theme'
import { currentFloor, useEditor } from '@/store/editor'

/**
 * The plan as it's seen now, without the editor round it: what's on screen (the same part of it, in the same colors and
 * layer, its labels the same size), drawn afresh with no handles, guides or selection, sharper than the screen.
 */
export async function planSnapshot(): Promise<Blob> {
  const st = useEditor.getState()
  const floor = currentFloor(st)
  const { zoom, panX, panY } = st.view
  const { w, h } = st.viewport
  const theme = document.documentElement.classList.contains('dark') ? DARK_THEME : LIGHT_THEME
  const ratio = Math.min(3, Math.max(2, window.devicePixelRatio))
  const x = -panX / zoom
  const y = -panY / zoom
  const markup = renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" width={Math.round(w * ratio)} height={Math.round(h * ratio)} viewBox={`${x} ${y} ${w / zoom} ${h / zoom}`}>
      <rect x={x} y={y} width={w / zoom} height={h / zoom} fill={theme.paper} />
      <PlanLayers
        floor={floor}
        units={st.project.units}
        theme={theme}
        layer={st.layer}
        showDimensions={st.settings.showDimensions}
        scale={zoom}
        showWallLengths={st.settings.showWallLengths}
        showAreas={st.settings.showAreas}
        faded={st.settings.faded}
        images={st.project.images}
      />
    </svg>,
  )
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not draw the plan'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * ratio)
    canvas.height = Math.round(h * ratio)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error('Could not make the picture')
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}
