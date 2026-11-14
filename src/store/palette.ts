/** The colors a plan keeps to use again on any floor or wall (see Project.palette). */
import { withColor } from '@/model/finishes'
import { useEditor } from './editor'

/** Keep a color in the plan to use again (picking one from the browser's picker: with that pick, no undo step of its own). */
export function keepColor(hex: string, live = false) {
  const st = useEditor.getState()
  const recipe = (d: { palette?: string[] }) => void (d.palette = withColor(d.palette, hex))
  if (live) st.mutate(recipe)
  else st.commit(recipe)
}

/** Stop keeping a color in the plan (floors and walls in it keep it all the same). */
export function forgetColor(hex: string) {
  useEditor.getState().commit((d) => {
    const left = (d.palette ?? []).filter((p) => p.toLowerCase() !== hex.toLowerCase())
    if (left.length) d.palette = left
    else delete d.palette
  })
}
