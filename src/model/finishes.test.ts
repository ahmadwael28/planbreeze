import { describe, expect, it } from 'vitest'
import { finishOf, PALETTE_SIZE, withColor } from './finishes'

describe('how shiny tiles are', () => {
  it('is as their kind usually is until chosen, at the roughness they always had', () => {
    expect(finishOf({ finish: 'ceramic' })).toMatchObject({ gloss: 'satin', roughness: 0.4 })
    expect(finishOf({ finish: 'porcelain' })).toMatchObject({ gloss: 'glossy', roughness: 0.22 })
    expect(finishOf({ finish: 'marble' }, 'wall')).toMatchObject({ gloss: 'polished', roughness: 0.12 })
  })

  it('is as chosen', () => {
    expect(finishOf({ finish: 'porcelain', gloss: 'matte' })).toMatchObject({ gloss: 'matte', roughness: 0.72 })
    expect(finishOf({ finish: 'marble', gloss: 'satin' })).toMatchObject({ gloss: 'satin', roughness: 0.4 })
  })

  it('is only for tiles: other finishes keep their own roughness', () => {
    expect(finishOf({ finish: 'parquet', gloss: 'polished' })).toMatchObject({ gloss: undefined, roughness: 0.48 })
    expect(finishOf({ finish: 'paint', gloss: 'glossy' }, 'wall').gloss).toBeUndefined()
  })
})

describe('the colors a plan keeps', () => {
  it('takes a color once, in the order they came', () => {
    expect(withColor(undefined, '#3D6FA8')).toEqual(['#3d6fa8'])
    expect(withColor(['#3d6fa8'], '#C0574F')).toEqual(['#3d6fa8', '#c0574f'])
    expect(withColor(['#3d6fa8', '#c0574f'], '#3D6FA8')).toEqual(['#3d6fa8', '#c0574f'])
  })

  it('keeps no more than it holds, the oldest going first', () => {
    const full = Array.from({ length: PALETTE_SIZE }, (_, i) => `#0000${String(i).padStart(2, '0')}`)
    const more = withColor(full, '#ffffff')
    expect(more).toHaveLength(PALETTE_SIZE)
    expect(more[0]).toBe('#000001')
    expect(more.at(-1)).toBe('#ffffff')
  })
})
