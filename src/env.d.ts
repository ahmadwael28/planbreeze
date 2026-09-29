/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://abcd.supabase.co (optional: cloud features hide without it). */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase publishable (or legacy anon) key. Safe to ship to browsers; access is enforced by row-level security. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}
