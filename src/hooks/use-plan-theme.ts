import { useTheme } from '@/components/theme-provider'
import { DARK_THEME, LIGHT_THEME } from '@/model/theme'
import type { PlanTheme } from '@/model/theme'

/** Plan drawing colors that follow the app's light/dark mode. */
export function usePlanTheme(): PlanTheme {
  const { resolvedTheme } = useTheme()
  return resolvedTheme === 'dark' ? DARK_THEME : LIGHT_THEME
}
