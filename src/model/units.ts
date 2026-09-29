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

/**
 * Parse a user-entered length into centimeters.
 * Metric: "3.45" (meters), "3.45 m", "345 cm", "3450 mm".
 * Imperial: "12' 3\"", "12'3", "12.5'", "147\"", "12 ft 3 in", "12" (feet).
 */
export function parseLength(input: string, units: Units): number | null {
  const s = input.trim().toLowerCase().replace(',', '.')
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
    return units === 'metric' ? v * 100 : v * 12 * CM_PER_INCH
  }
  return null
}

/** Grid spacing (minor, major) in cm. */
export function gridSpacing(units: Units): [number, number] {
  return units === 'metric' ? [10, 100] : [CM_PER_INCH * 6, CM_PER_INCH * 12 * 5]
}

/** Default snap step in cm. */
export function snapStep(units: Units): number {
  return units === 'metric' ? 5 : CM_PER_INCH * 2
}
