import { useMemo } from 'react'
import { t } from '@/i18n'
import { finishOf } from '@/model/finishes'
import { SHELF_STONE, takeoff } from '@/model/takeoff'
import { WORKTOPS } from '@/model/symbols'
import type { TakeoffPart, TakeoffPlace } from '@/model/takeoff'
import type { ProjectImage, Surface } from '@/model/types'
import { useFloor } from '@/store/editor'

/** The takeoff of the floor being looked at (see model/takeoff), worked out again only when it changes. */
export function useTakeoff(): TakeoffPart[] {
  const floor = useFloor()
  return useMemo(() => takeoff(floor), [floor])
}

/** What a finish is called, and which one (its color or photo, its size, its design). */
export function finishLabel(surface: Surface | undefined, place: TakeoffPlace, images?: ProjectImage[]) {
  if (!surface) return { name: t('No finish chosen'), detail: '' }
  const f = finishOf(surface, place === 'floor' ? 'floor' : 'wall')
  const kind = f.def.kind
  const photo = surface.image && images?.find((i) => i.id === surface.image)
  const color = f.def.colors.find((c) => c.hex.toLowerCase() === f.color.toLowerCase())?.name
  const what = photo ? photo.name : place === 'ceiling' ? t('Ceiling white') : color ? t(color) : t('Custom color')
  const size = f.size && (kind === 'tile' || kind === 'plank') ? ` · ${f.size[0]}×${f.size[1]}` : ''
  return { name: t(f.def.name), detail: `${what}${size}${f.design && !photo ? ` · ${t(f.design.name)}` : ''}` }
}

/** What a stone's called (a worktop's, or the light stone shelves are made of). */
export const stoneName = (id?: string) => (id === SHELF_STONE ? t('Light stone (shelves)') : t(WORKTOPS.find((w) => w.id === id)?.name ?? 'Stone'))
