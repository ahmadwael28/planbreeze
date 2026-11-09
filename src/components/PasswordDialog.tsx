import { t } from '@/i18n'
import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { toast } from 'sonner'
import { Loader } from '@/components/ui/loader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { checkPassword, MIN_PASSWORD } from '@/cloud/auth-errors'
import { useCloud } from '@/cloud/store'
import { setNewPassword } from '@/cloud/sync'
import { PasswordInput } from './PasswordInput'

/**
 * Choosing a new password for the signed-in account: back from a link to reset a forgotten one, or from the account
 * menu (changing it, or setting one to sign in with besides Google or GitHub).
 */
export function PasswordDialog() {
  const mode = useCloud((s) => s.passwordOpen)
  const openPassword = useCloud((s) => s.openPassword)
  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && openPassword(false)}>
      <DialogContent className="sm:max-w-sm">{mode && <PasswordBody recovery={mode === 'recovery'} />}</DialogContent>
    </Dialog>
  )
}

function PasswordBody({ recovery }: { recovery: boolean }) {
  const user = useCloud((s) => s.user)
  const openPassword = useCloud((s) => s.openPassword)
  const id = useId()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Signed in some other way than an email (Google, GitHub): a first password, to sign in with that too.
  const first = !recovery && !!user && user.provider !== 'email'

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const bad = checkPassword(password)
    if (bad) return setError(bad)
    setBusy(true)
    setError(null)
    try {
      await setNewPassword(password)
      toast.success(t('Your new password is saved.'))
      openPassword(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{recovery ? t('Choose a new password') : first ? t('Set a password') : t('Change your password')}</DialogTitle>
        <DialogDescription>
          {first
            ? t('Then you can also sign in with {email} and this password.', { email: user?.email ?? '' })
            : user?.email
              ? t('For signing in as {email}.', { email: user.email })
              : t('For signing in with your email.')}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={save} noValidate className="space-y-3">
        {/* Which account it's for, so a password manager files it there. */}
        {user?.email && <input type="email" name="username" autoComplete="username" value={user.email} readOnly hidden />}
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-password`}>{t('New password')}</Label>
          <PasswordInput
            id={`${id}-password`}
            name="new-password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={`${id}-rule`}
          />
          <p id={`${id}-rule`} className="text-xs text-muted-foreground">
            {t('At least {n} characters.', { n: MIN_PASSWORD })}
          </p>
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => openPassword(false)}>
            {recovery ? t('Not now') : t('Cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy && <Loader label={t('Saving')} />}
            {t('Save password')}
          </Button>
        </div>
      </form>
    </>
  )
}
