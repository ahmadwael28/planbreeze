/**
 * The app in English or Arabic. Text is written in English in the code and looked up in the Arabic dictionary when
 * Arabic is chosen (anything not translated yet still shows, in English). Arabic reads right to left: the page turns
 * round, but the plan and the 3D view don't.
 */
import { useSyncExternalStore } from 'react'
import { AR } from './ar'

export type Lang = 'en' | 'ar'

export const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'ar', name: 'العربية' },
]

const KEY = 'planbreeze.lang'

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'en' || saved === 'ar') return saved
  } catch {
    // Storage blocked: go by the browser's language.
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

let lang: Lang = initial()
const listeners = new Set<() => void>()

function apply() {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
}
apply()

export const getLang = () => lang
/** Whether the page reads right to left. */
export const isRtl = () => lang === 'ar'

export function setLang(next: Lang) {
  if (next === lang) return
  lang = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // Only for now, then.
  }
  apply()
  for (const f of listeners) f()
}

/** The language chosen, re-rendering when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => lang,
  )
}

/** Untranslated text met while running in Arabic (for finding what's left to translate). */
const missing = new Set<string>()
const DEV = !!import.meta.env?.DEV
if (DEV && typeof window !== 'undefined') (window as unknown as { __missing: Set<string> }).__missing = missing

/** `s` in the chosen language, with each `{name}` in it filled in from `vars`. */
export function t(s: string, vars?: Record<string, string | number>): string {
  let out = s
  if (lang === 'ar') {
    const a = AR[s]
    if (a !== undefined) out = a
    else if (DEV) missing.add(s)
  }
  return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : out
}

/**
 * Like t, for English that means different things in different places ("Back" a button, or the back of something):
 * the Arabic for `context|s` if there is one, else as t.
 */
export function tc(context: string, s: string, vars?: Record<string, string | number>): string {
  const a = lang === 'ar' ? AR[`${context}|${s}`] : undefined
  return a === undefined ? t(s, vars) : vars ? a.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : a
}
