/** Lengths as they're typed: units, Arabic digits and words, and a plain number read by the length expected. */
import { describe, expect, it } from 'vitest'
import { formatLength, isHuge, isLengthKey, parseLength } from './units'

const INCH = 2.54

describe('parseLength', () => {
  it('reads metric lengths with their units', () => {
    expect(parseLength('3.45 m', 'metric')).toBe(345)
    expect(parseLength('345 cm', 'metric')).toBe(345)
    expect(parseLength('3450 mm', 'metric')).toBe(345)
    expect(parseLength('345cm', 'metric')).toBe(345)
    expect(parseLength(' 3.45M ', 'metric')).toBe(345)
  })

  it('reads a plain number as metres or centimetres, whichever is nearer the length expected', () => {
    // A wall (by default): "350" and "3.5" are both 3.5 m.
    expect(parseLength('350', 'metric')).toBe(350)
    expect(parseLength('3.5', 'metric')).toBe(350)
    // A 10 cm wall's thickness: "15" is 15 cm; a 3 m wall: "15" is 15 m.
    expect(parseLength('15', 'metric', 10)).toBe(15)
    expect(parseLength('15', 'metric', 300)).toBe(1500)
    // Nothing to go by (0): as a wall.
    expect(parseLength('350', 'metric', 0)).toBe(350)
  })

  it('reads Arabic and Persian digits, the Arabic decimal point and a lone comma', () => {
    expect(parseLength('٣٥٠', 'metric')).toBe(350)
    expect(parseLength('۳۵۰', 'metric')).toBe(350)
    expect(parseLength('٣٫٥', 'metric')).toBe(350)
    expect(parseLength('3,5', 'metric')).toBe(350)
    expect(parseLength('٣،٥', 'metric')).toBe(350)
  })

  it('reads Arabic unit words', () => {
    expect(parseLength('٣٤٥ سم', 'metric')).toBe(345)
    expect(parseLength('3.45 م', 'metric')).toBe(345)
    expect(parseLength('٣ متر', 'metric')).toBe(300)
    expect(parseLength('٣٤٥٠ مم', 'metric')).toBe(345)
    expect(parseLength('١١ قدم', 'imperial')).toBeCloseTo(11 * 12 * INCH)
    expect(parseLength('٦ إنش', 'imperial')).toBeCloseTo(6 * INCH)
  })

  it('reads feet and inches', () => {
    const v = (12 * 12 + 3) * INCH
    expect(parseLength(`12' 3"`, 'imperial')).toBeCloseTo(v)
    expect(parseLength(`12'3`, 'imperial')).toBeCloseTo(v)
    expect(parseLength('12 ft 3 in', 'imperial')).toBeCloseTo(v)
    expect(parseLength('147"', 'imperial')).toBeCloseTo(v)
    expect(parseLength(`12.5'`, 'imperial')).toBeCloseTo(12.5 * 12 * INCH)
    // Units typed in a metric plan count too.
    expect(parseLength(`10'`, 'metric')).toBeCloseTo(10 * 12 * INCH)
  })

  it('reads a plain number as feet or inches in an imperial plan', () => {
    expect(parseLength('11', 'imperial')).toBeCloseTo(11 * 12 * INCH)
    expect(parseLength('6', 'imperial', 15)).toBeCloseTo(6 * INCH)
  })

  it("doesn't read what isn't a length", () => {
    for (const s of ['', '   ', 'abc', '3..5', '-3', '3 m 4', 'm', '3 kg']) expect(parseLength(s, 'metric')).toBeNull()
  })
})

describe('lengths', () => {
  it('flags lengths longer than a wall would be', () => {
    expect(isHuge(parseLength('1,500,000', 'metric')!)).toBe(true)
    expect(isHuge(3000)).toBe(false)
    expect(isHuge(3001)).toBe(true)
  })

  it('takes the keys a length is typed with', () => {
    for (const k of ['3', '.', ',', "'", '"', ' ', 'm', '٣', '۳', '٫', '،', 'س']) expect(isLengthKey(k)).toBe(true)
    for (const k of ['Enter', 'Escape', '-', '+', '/', 'ArrowLeft']) expect(isLengthKey(k)).toBe(false)
  })

  it('shows lengths in metres, or feet and inches', () => {
    expect(formatLength(345, 'metric')).toBe('3.45 m')
    expect(formatLength((12 * 12 + 3) * INCH, 'imperial')).toBe(`12' 3"`)
    expect(formatLength(6 * INCH, 'imperial')).toBe('6"')
  })
})
