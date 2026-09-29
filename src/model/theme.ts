/** Colors used to draw the plan (SVG + 3D). Exports always use the light theme. */
export interface PlanTheme {
  dark: boolean
  paper: string
  gridMinor: string
  gridMajor: string
  wall: string
  ghost: string
  /** Symbol outlines. */
  ink: string
  /** Symbol body fill. */
  fill: string
  /** Secondary symbol fill (cushions, pillows, trims). */
  fill2: string
  /** Fill used to cut door/window openings out of walls. */
  opening: string
  label: string
  labelMuted: string
  lengthLabel: string
  /** Adapt a light pastel (room floor, fabric) to the theme. */
  tint: (hex: string) => string
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h
  const n = parseInt(full.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Linear mix of two hex colors; t = 0 → a, t = 1 → b. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a)
  const cb = parseHex(b)
  return (
    '#' +
    ca
      .map((v, i) => Math.round(v + (cb[i] - v) * t))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  )
}

export const LIGHT_THEME: PlanTheme = {
  dark: false,
  paper: '#fafafa',
  gridMinor: '#ececee',
  gridMajor: '#d4d4d8',
  wall: '#3f3f46',
  ghost: '#a1a1aa',
  ink: '#27272a',
  fill: '#ffffff',
  fill2: '#e4e4e7',
  opening: '#ffffff',
  label: '#18181b',
  labelMuted: '#52525b',
  lengthLabel: '#71717a',
  tint: (hex) => hex,
}

export const DARK_THEME: PlanTheme = {
  dark: true,
  paper: '#111113',
  gridMinor: '#1b1b1f',
  gridMajor: '#2c2c32',
  wall: '#d4d4d8',
  ghost: '#52525b',
  ink: '#d4d4d8',
  fill: '#26262b',
  fill2: '#3a3a41',
  opening: '#111113',
  label: '#fafafa',
  labelMuted: '#c4c4cc',
  lengthLabel: '#a1a1aa',
  tint: (hex) => mixHex(hex, '#18181b', 0.72),
}
