import { t } from '@/i18n'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Mail, MailCheck } from 'lucide-react'
import { Loader } from '@/components/ui/loader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useCloud } from '@/cloud/store'
import { dismissPendingShare, signInWithEmail, signInWithProvider } from '@/cloud/sync'
import type { OAuthProvider } from '@/cloud/sync'
import { GitHubIcon, GoogleIcon } from './BrandIcons'

export function SignInDialog() {
  const open = useCloud((s) => s.signInOpen)
  const setOpen = useCloud((s) => s.openSignIn)
  const configured = useCloud((s) => s.configured)
  const note = useCloud((s) => s.signInNote)
  const [busy, setBusy] = useState<OAuthProvider | 'email' | null>(null)
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const withProvider = async (p: OAuthProvider) => {
    setBusy(p)
    setError(null)
    try {
      await signInWithProvider(p) // navigates away to the provider
    } catch (e) {
      setError((e as Error).message)
      setBusy(null)
    }
  }

  const withEmail = async (e: FormEvent) => {
    e.preventDefault()
    const address = email.trim()
    if (!/^\S+@\S+\.\S+$/.test(address)) {
      setError(t('Enter a valid email address.'))
      return
    }
    setBusy('email')
    setError(null)
    try {
      await signInWithEmail(address)
      setSentTo(address)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const close = (o: boolean) => {
    // Closed without signing in: forget the shared plan's link that asked for it.
    if (!o && note) dismissPendingShare()
    setOpen(o)
    if (!o) {
      setSentTo(null)
      setError(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{note ? t('Sign in') : t('Save your plans to the cloud')}</DialogTitle>
          <DialogDescription>
            {note ?? t("Sign in to keep your plans safe and open them on any device. Without an account, they're saved in this browser only.")}
          </DialogDescription>
        </DialogHeader>

        {!configured ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            {t("Cloud sign-in isn't set up for this copy of the app yet.")}
          </p>
        ) : sentTo ? (
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <MailCheck className="size-9 text-primary" />
            <p className="font-medium">{t('Check your inbox')}</p>
            <p className="text-sm text-muted-foreground">
              We sent a sign-in link to <b className="text-foreground">{sentTo}</b>. Open it in this browser to finish signing in.
            </p>
            <Button variant="ghost" size="sm" onClick={() => setSentTo(null)}>
              {t('Use a different email')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Button variant="outline" className="h-10 w-full" disabled={!!busy} onClick={() => withProvider('google')}>
              {busy === 'google' ? <Loader label={t('Signing in')} /> : <GoogleIcon className="size-4" />}
              Continue with Google
            </Button>
            <Button variant="outline" className="h-10 w-full" disabled={!!busy} onClick={() => withProvider('github')}>
              {busy === 'github' ? <Loader label={t('Signing in')} /> : <GitHubIcon className="size-4" />}
              Continue with GitHub
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {t('or')}
              <span className="h-px flex-1 bg-border" />
            </div>
            <form onSubmit={withEmail} className="space-y-2">
              <Input
                type="email"
                autoComplete="email"
                placeholder={t('you@example.com')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label={t('Email address')}
              />
              <Button type="submit" className="h-10 w-full" disabled={!!busy}>
                {busy === 'email' ? <Loader label={t('Sending')} /> : <Mail />}
                Email me a sign-in link
              </Button>
            </form>
            {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          </div>
        )}
        <p className="text-center text-xs text-muted-foreground">
          {t('By signing in you agree to the')}{' '}
          <a href="terms.html" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
            {t('Terms')}
          </a>{' '}
          {t('and')}{' '}
          <a href="privacy.html" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
            {t('Privacy Policy')}
          </a>
          .
        </p>
      </DialogContent>
    </Dialog>
  )
}
