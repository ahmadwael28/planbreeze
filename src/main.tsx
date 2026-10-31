import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Direction } from 'radix-ui'
import { useLang } from '@/i18n'
import { useLayout } from '@/hooks/use-layout'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CrashScreen, ErrorBoundary } from '@/components/ErrorBoundary'
import { reloadOnUpdate } from '@/store/recovery'
import './index.css'
import App from './App.tsx'

/** The app in the language chosen (right to left for Arabic). */
function Root() {
  const lang = useLang()
  // On a phone, at the top: the bottom has the tools and what's picked.
  const compact = useLayout().compact
  return (
    <Direction.Provider dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <TooltipProvider delayDuration={300}>
        <App />
        <Toaster key={`t-${lang}`} position={compact ? 'top-center' : lang === 'ar' ? 'bottom-left' : 'bottom-right'} />
      </TooltipProvider>
    </Direction.Provider>
  )
}

reloadOnUpdate()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ErrorBoundary fallback={(error) => <CrashScreen error={error} />}>
        <Root />
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
)
