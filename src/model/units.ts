import type { Units } from './types'

const CM_PER_INCH = 2.54
const CM2_PER_FT2 = 929.0304

export function formatLength(cm: number, units: Units): string {
  if (units === 'metric') return `${(cm / 100).toFixed(2)} m`
  const totalIn = Math.round(Math.abs(cm) / CM_PER_INCH)
  const ft = Math.floor(totalIn / 12)
  const inch = totalIn % 12
  const sign = cm < 0 ? '-' : ''
  if (ft === 0) return `${sign}${inch}"`
  return `${sign}${ft}' ${inch}"`
}

export function formatArea(cm2: number, units: Units): string {
  if (units === 'metric') return `${(cm2 / 10000).toFixed(2)} m²`
  return `${(cm2 / CM2_PER_FT2).toFixed(1)} ft²`
}

/** What a plain length is taken to be near when there's nothing to go by: a wall's. */
const NEAR = 300

/**
 * Typed text as it's read below: Arabic-Indic and Persian digits as 0-9; the Arabic decimal point, or a lone comma, as
 * a point (several commas are thousands); unit words in Arabic as m, cm, mm, ft, in.
 */
function normalize(input: string): string {
  let s = input
    .trim()
    .toLowerCase()
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/\u066b/g, '.')
    .replace(/\u066c/g, '')
  const commas = (s.match(/[,\u060c]/g) ?? []).length
  s = commas === 1 ? s.replace(/[,\u060c]/, '.') : s.replace(/[,\u060c]/g, '')
  return s
    .replace(/أقدام|اقدام|قدم/g, 'ft')
    .replace(/بوصات|بوصة|إنشات|انشات|إنش|انش/g, 'in')
    .replace(/سنتيمترات|سنتيمتر|سنتي|سم/g, 'cm')
    .replace(/ملليمترات|مليمترات|ملليمتر|مليمتر|ملم|مم/g, 'mm')
    .replace(/أمتار|امتار|مترًا|مترا|متر|م/g, 'm')
}

/** Of two readings of a number, the one nearer (in proportion) what's expected. */
const nearer = (a: number, b: number, near: number) => (Math.abs(Math.log(a / near)) <= Math.abs(Math.log(b / near)) ? a : b)

/**
 * Parse a user-entered length into centimeters.
 * Metric: "3.45 m", "345 cm", "3450 mm" (also in Arabic: "345 سم", digits ٠-٩, "3٫45").
 * Imperial: "12' 3\"", "12'3", "12.5'", "147\"", "12 ft 3 in".
 * A plain number is metres or centimetres (feet or inches), whichever is nearer `near`, the length expected (a field's
 * value, where the cursor is): for a wall "3.5" and "350" are both 3.5 m, for a 10 cm band "15" is 15 cm.
 */
export function parseLength(input: string, units: Units, near = NEAR): number | null {
  const s = normalize(input)
  if (!s) return null
  const num = '(\\d+(?:\\.\\d+)?|\\.\\d+)'

  const withUnit = s.match(new RegExp(`^${num}\\s*(mm|cm|m)$`))
  if (withUnit) {
    const v = parseFloat(withUnit[1])
    return withUnit[2] === 'mm' ? v / 10 : withUnit[2] === 'cm' ? v : v * 100
  }

  const ftIn = s.match(new RegExp(`^(?:${num}\\s*(?:'|ft|feet))?\\s*(?:${num}\\s*(?:"|in|inch|inches)?)?$`))
  const hasFeetMark = /'|ft|feet/.test(s)
  const hasInchMark = /"|in/.test(s)
  if (ftIn && (hasFeetMark || hasInchMark)) {
    const ft = ftIn[1] ? parseFloat(ftIn[1]) : 0
    const inch = ftIn[2] ? parseFloat(ftIn[2]) : 0
    if (!hasFeetMark && hasInchMark) return inch * CM_PER_INCH
    return (ft * 12 + inch) * CM_PER_INCH
  }

  const plain = s.match(new RegExp(`^${num}$`))
  if (plain) {
    const v = parseFloat(plain[1])
    const to = near > 0 ? near : NEAR
    return units === 'metric' ? nearer(v * 100, v, to) : nearer(v * 12 * CM_PER_INCH, v * CM_PER_INCH, to)
  }
  return null
}

/** Longer than a room's wall would be (worth a second look when typed). */
export const isHuge = (cm: number) => cm > 3000

/** Whether a key typed could be part of a length ("3.5", "345 cm", "11' 2\"", "٣٥٠ سم"). */
export const isLengthKey = (key: string) => /^[0-9.,'" a-z\u0660-\u0669\u06f0-\u06f9\u066b\u066c\u060c\u0621-\u064a]$/i.test(key)

/** Grid spacing (minor, major) in cm. */
export function gridSpacing(units: Units): [number, number] {
  return units === 'metric' ? [10, 100] : [CM_PER_INCH * 6, CM_PER_INCH * 12 * 5]
}

/** Default snap step in cm. */
/**
 * The step things move and resize by with the mouse: finer the closer you look (1 cm once a cm is a pixel on screen,
 * 2 cm with a whole flat in view), so each step is still about a pixel of mouse movement. `zoom` is pixels per cm.
 */
export function snapStep(units: Units, zoom = 0.5): number {
  const steps = units === 'metric' ? [1, 2, 5, 10] : [CM_PER_INCH / 2, CM_PER_INCH, CM_PER_INCH * 2, CM_PER_INCH * 6]
  return steps.find((s) => s * zoom >= 0.9) ?? steps[steps.length - 1]
}
