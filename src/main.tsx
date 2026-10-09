import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Direction } from 'radix-ui'
import { useLang } from '@/i18n'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import './index.css'
import App from './App.tsx'

/** The app in the language chosen (right to left for Arabic). */
function Root() {
  const lang = useLang()
  return (
    <Direction.Provider dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <TooltipProvider delayDuration={300}>
        <App />
        <Toaster key={`t-${lang}`} position={lang === 'ar' ? 'bottom-left' : 'bottom-right'} />
      </TooltipProvider>
    </Direction.Provider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  </StrictMode>,
)
