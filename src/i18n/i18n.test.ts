/**
 * Every bit of English the app shows has its Arabic: each string in a t() call (its key, or the keys a ternary picks
 * between), and the names in the app's own lists that are shown through t() where they're used (given per file in
 * LISTS). The Arabic keeps the English's {name}s, to be filled in.
 */
import { describe, expect, it } from 'vitest'
import { AR } from './ar'

/** The app's source, but the dictionaries and the tests. */
const SOURCES = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/i18n/**', '!/src/**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * Lists of names shown through t(...) where they're used, by file: patterns whose groups are the English. A new list
 * of names shown so gets its pattern here.
 */
const LISTS: Record<string, RegExp[]> = {
  'components/Toolbar.tsx': [/label: '([^']+)'/g],
  'App.tsx': [/^ {2}[a-z]+: '([^']+)',$/gm, /^ {4}'([^']+)',$/gm],
  'components/VisibilityMenu.tsx': [/label: '([^']+)'/g, /'(Lights & switches|Gypsum boxes)'/g],
  'components/DrawingTips.tsx': [/^ {4}(?:title|body|good|bad): '([^']+)',$/gm],
  'model/symbols.tsx': [/name: '([^']+)'/g, /frameLabel: '([^']+)'/g, /kind: '([A-Z][a-z]+)'/g, /^ {2}'([A-Z][^']+)',$/gm],
  'components/AccountControls.tsx': [/label: '([^']+)'/g],
  'components/ShareDialog.tsx': [/(?:viewer|editor): '([^']+)'/g],
  'components/PrintDialog.tsx': [/\['\w+', '([^']+)'\]/g],
  'components/GuidedTour.tsx': [/^ {4}(?:title|body): ['"](.+)['"],$/gm],
  'components/DesignDialog.tsx': [/label: '([^']+)'/g, /hint: '([^']+)'/g],
  'components/LightingProps.tsx': [/kelvin: \d+, name: '([^']+)'/g],
  'components/FinishProps.tsx': [/none="([^"]+)"/g, /none=\{[^}]*'([^']+)' : '([^']+)'/g, /\['(Horizontal|Vertical|Upright|Lying)'/g],
  'three/viewpoints.ts': [/(?:label|hint): '([^']+)'/g],
  'three/keyboardNav.ts': [/^ {2}\['[^']+', '([^']+)'\],$/gm],
  'model/finishes.ts': [/name: '([^']+)'/g, /hint: '([^']+)'/g, /^ {2}\['([^']+)', \[/gm, /^ {2}\w+: '([^']+)',$/gm],
  'model/lighting.ts': [/name: '([^']+)'/g, /description: '([^']+)'/g],
  'model/design/styles.ts': [/^ {4}name: '([^']+)'/gm, /^ {4}hint: '([^']+)'/gm],
  'model/design/roles.ts': [/name: '([^']+)'/g, /hint: '([^']+)'/g],
  'model/project.ts': [/(?:balcony|terrace): \{ name: '([^']+)'/g],
  'model/people.ts': [/name: '([^']+)'/g, /(?:stand|sit|lie): '([^']+)'/g],
  'model/templates.ts': [/\.(?:room|outdoor)\('([^']+)'/g, /name: '([^']+)', build/g],
  'components/PropertiesPanel.tsx': [/\[count\('\w+'\), t\('[^']+'\), '([^']+)'\]/g],
  'model/takeoff.ts': [/stone\(ctx, room, '([^']+)'/g, /what: '([^']+)'/g, /push\('([^']+)'/g, /'([A-Z][^']*)' :/g, /: '([A-Z][^']*)'(?:,|$| \})/gm],
  'components/RenderDialog.tsx': [/id: '(?:draft|good|best|off|soft|strong)', name: '([^']+)'/g],
}

/** A string literal: '…', "…", or `…` with nothing filled in. */
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.)*`/g

const unquote = (lit: string) =>
  lit
    .slice(1, -1)
    .replace(/\\(['"`\\n])/g, (_, c: string) => (c === 'n' ? '\n' : c))

/** The text of the first argument of the call whose `(` ends at i. */
function firstArg(text: string, i: number): string {
  let depth = 0
  let j = i
  const at = new RegExp(LITERAL.source, 'y')
  while (j < text.length) {
    const ch = text[j]
    if (ch === "'" || ch === '"' || ch === '`') {
      at.lastIndex = j
      j = at.exec(text) ? at.lastIndex : j + 1
      continue
    }
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) {
      if (depth === 0) return text.slice(i, j)
      depth--
    } else if (ch === ',' && depth === 0) return text.slice(i, j)
    j++
  }
  return text.slice(i, j)
}

/** English worth translating: two letters in a row, and not an id (lower case, no spaces). */
const isText = (s: string) => /[A-Za-z]{2}/.test(s) && !/^[a-z][\w-]*$/.test(s)

/** Each piece of English the app shows, and the files it's in. */
function shown(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const add = (s: string, file: string) => {
    if (!out.has(s)) out.set(s, new Set())
    out.get(s)!.add(file)
  }
  for (const [path, raw] of Object.entries(SOURCES)) {
    const file = path.replace(/^\/src\//, '')
    const text = raw.replace(/\r\n/g, '\n')
    for (const m of text.matchAll(/(?<![\w.$])t\(/g)) {
      for (const [lit] of firstArg(text, m.index + m[0].length).matchAll(LITERAL)) {
        const s = unquote(lit)
        if (isText(s)) add(s, file)
      }
    }
    for (const rx of LISTS[file] ?? []) {
      for (const m of text.matchAll(rx)) for (const s of m.slice(1)) if (s && /[A-Za-z]{2}/.test(s)) add(s, file)
    }
  }
  return out
}

const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('Arabic', () => {
  it('has the source to look through', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100)
    for (const file of Object.keys(LISTS)) expect(SOURCES[`/src/${file}`], file).toBeDefined()
  })

  it('has every bit of English the app shows', () => {
    const all = shown()
    // (Found it all: there's well over a thousand.)
    expect(all.size).toBeGreaterThan(1500)
    const missing = [...all].filter(([s]) => AR[s] === undefined).map(([s, files]) => `${[...files].sort()[0]}: ${JSON.stringify(s)}`)
    expect(missing.sort(), 'Add these to src/i18n/ar/*.ts').toEqual([])
  })

  it('keeps the {names} to be filled in, and leaves nothing empty', () => {
    const wrong = Object.entries(AR)
      .filter(([en, ar]) => !ar.trim() || names(en).join() !== names(ar).join())
      .map(([en, ar]) => `${JSON.stringify(en)} → ${JSON.stringify(ar)}`)
    expect(wrong).toEqual([])
  })
})
