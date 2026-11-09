import { t } from '@/i18n'
import { useState } from 'react'
import type { ComponentProps } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** A password field, with a button at its end to show what's typed (and hide it again). */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<typeof Input>, 'type'>) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <Input {...props} type={shown ? 'text' : 'password'} spellCheck={false} autoCapitalize="none" className={cn('pe-9', className)} />
      <button
        type="button"
        onClick={() => setShown(!shown)}
        aria-label={shown ? t('Hide password') : t('Show password')}
        aria-pressed={shown}
        className="absolute inset-y-0 end-0 grid w-9 place-items-center rounded-e-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}
