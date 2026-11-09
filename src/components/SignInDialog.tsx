import { t } from '@/i18n'
import { useId, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Mail, MailCheck } from 'lucide-react'
import { Loader } from '@/components/ui/loader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthProblem, checkEmail, checkPassword, MIN_PASSWORD } from '@/cloud/auth-errors'
import { useCloud } from '@/cloud/store'
import { dismissPendingShare, resendConfirmation, sendPasswordReset, signInWithEmail, signInWithPassword, signInWithProvider, signUpWithPassword } from '@/cloud/sync'
import type { OAuthProvider } from '@/cloud/sync'
import { GitHubIcon, GoogleIcon } from './BrandIcons'
import { PasswordInput } from './PasswordInput'

/** Signing in to an account, making one, or asking for a link to reset its password. */
type Mode = 'signin' | 'signup' | 'reset'

/** What was emailed, and to whom: a link that signs in, one to confirm a new account's email, or one to reset its password. */
interface Sent {
  kind: 'link' | 'confirm' | 'reset'
  email: string
}

/** What's being waited on. */
type Busy = OAuthProvider | 'password' | 'link' | 'reset' | 'resend'

/**
 * Signing in: with Google or GitHub, or with an email and password (or a link emailed to sign in with); making an
 * account the same ways; and resetting a forgotten password.
 */
export function SignInDialog() {
  const open = useCloud((s) => s.signInOpen)
  const setOpen = useCloud((s) => s.openSignIn)
  const note = useCloud((s) => s.signInNote)

  const close = (o: boolean) => {
    // Closed without signing in: forget the shared plan's link that asked for it.
    if (!o && note) dismissPendingShare()
    setOpen(o)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-sm">
        {/* Inside the dialog, so it starts afresh each time it opens (nothing typed kept, no password above all). */}
        <SignInBody note={note} />
      </DialogContent>
    </Dialog>
  )
}

/** A link-like button in a line of text. */
function TextButton({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50">
      {children}
    </button>
  )
}

/** A line with `{email}` in it, the address in bold. */
function withEmail(text: string, email: string) {
  return text.split(/(\{email\})/).map((part, i) =>
    part === '{email}' ? (
      <b key={i} className="text-foreground" dir="ltr">
        {email}
      </b>
    ) : (
      part
    ),
  )
}

function SignInBody({ note }: { note: string | null }) {
  const configured = useCloud((s) => s.configured)
  const id = useId()
  const [mode, setMode] = useState<Mode>('signin')
  const [busy, setBusy] = useState<Busy | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState<Sent | null>(null)
  const [error, setError] = useState<{ text: string; code?: string } | null>(null)
  const [resent, setResent] = useState(false)
  const address = email.trim()

  const go = (m: Mode) => {
    setMode(m)
    setSent(null)
    setError(null)
    setResent(false)
  }

  /** Does something with the account server, saying what went wrong if it does. */
  const run = async (what: Busy, job: () => Promise<void>) => {
    setBusy(what)
    setError(null)
    setResent(false)
    try {
      await job()
    } catch (e) {
      setError({ text: (e as Error).message, code: e instanceof AuthProblem ? e.code : undefined })
    } finally {
      setBusy(null)
    }
  }

  const withProvider = async (p: OAuthProvider) => {
    setBusy(p)
    setError(null)
    try {
      await signInWithProvider(p) // navigates away to the provider
    } catch (e) {
      setError({ text: (e as Error).message })
      setBusy(null)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const bad = checkEmail(address) ?? (mode === 'signup' ? checkPassword(password) : mode === 'signin' && !password ? t('Enter your password.') : null)
    if (bad) return setError({ text: bad })
    if (mode === 'reset') {
      void run('reset', async () => {
        await sendPasswordReset(address)
        setSent({ kind: 'reset', email: address })
      })
    } else if (mode === 'signin') {
      // Signed in, the dialog closes (see onSession).
      void run('password', () => signInWithPassword(address, password))
    } else {
      void run('password', async () => {
        const made = await signUpWithPassword(address, password)
        if (made === 'confirm') setSent({ kind: 'confirm', email: address })
        else if (made === 'exists') {
          setMode('signin')
          throw new AuthProblem(t("There's already an account with {email}. Sign in with its password, or reset it if you've forgotten it.", { email: address }), 'exists')
        }
      })
    }
  }

  const withLink = () => {
    const bad = checkEmail(address)
    if (bad) return setError({ text: bad })
    void run('link', async () => {
      await signInWithEmail(address)
      setSent({ kind: 'link', email: address })
    })
  }

  // Keeping what's shown (that the email needs confirming), and saying it's been sent under it.
  const resend = async (to: string) => {
    setBusy('resend')
    try {
      await resendConfirmation(to)
      setResent(true)
    } catch (e) {
      setError({ text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const title = mode === 'signup' ? t('Create your account') : mode === 'reset' ? t('Reset your password') : note ? t('Sign in') : t('Save your plans to the cloud')
  const description =
    mode === 'signup'
      ? t('Keep your plans safe in your account, and open them on any device.')
      : mode === 'reset'
        ? t("Enter your account's email, and we'll send you a link to choose a new password.")
        : (note ?? t("Sign in to keep your plans safe and open them on any device. Without an account, they're saved in this browser only."))

  const problem = error && (
    <div role="alert" className="space-y-1 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <p>{error.text}</p>
      {error.code === 'email_not_confirmed' &&
        (resent ? (
          <p className="text-foreground">{t('Sent again: check your inbox.')}</p>
        ) : (
          <TextButton onClick={() => void resend(address)} disabled={!!busy}>
            {t('Send the link again')}
          </TextButton>
        ))}
    </div>
  )

  let body: ReactNode
  if (!configured) {
    body = <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{t("Cloud sign-in isn't set up for this copy of the app yet.")}</p>
  } else if (sent) {
    body = (
      <div className="flex flex-col items-center gap-2 py-2 text-center">
        <MailCheck className="size-9 text-primary" />
        <p className="font-medium">{t('Check your inbox')}</p>
        <p className="text-sm text-muted-foreground">
          {withEmail(
            sent.kind === 'link'
              ? t("We sent a sign-in link to {email}. You're signed in wherever you open it.")
              : sent.kind === 'confirm'
                ? t("We sent a link to {email}. Open it to confirm it's yours, and you're signed in.")
                : t("If there's an account for {email}, we sent it a link to choose a new password. Open it on any device."),
            sent.email,
          )}
        </p>
        {sent.kind === 'confirm' &&
          (resent ? (
            <p className="text-xs text-muted-foreground">{t('Sent again: check your inbox.')}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('Nothing there? Check your spam folder, or')}{' '}
              <TextButton onClick={() => void resend(sent.email)} disabled={!!busy}>
                {t('send it again')}
              </TextButton>
            </p>
          ))}
        {problem}
        <Button variant="ghost" size="sm" onClick={() => go(sent.kind === 'reset' ? 'signin' : mode)}>
          {sent.kind === 'reset' ? t('Back to sign in') : t('Use a different email')}
        </Button>
      </div>
    )
  } else {
    body = (
      <div className="space-y-3">
        {mode !== 'reset' && (
          <>
            <Button variant="outline" className="h-10 w-full" disabled={!!busy} onClick={() => withProvider('google')}>
              {busy === 'google' ? <Loader label={t('Signing in')} /> : <GoogleIcon className="size-4" />}
              {t('Continue with Google')}
            </Button>
            <Button variant="outline" className="h-10 w-full" disabled={!!busy} onClick={() => withProvider('github')}>
              {busy === 'github' ? <Loader label={t('Signing in')} /> : <GitHubIcon className="size-4" />}
              {t('Continue with GitHub')}
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {t('or')}
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}
        <form onSubmit={submit} noValidate className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-email`}>{t('Email')}</Label>
            <Input
              id={`${id}-email`}
              name="email"
              type="email"
              autoComplete={mode === 'reset' ? 'email' : 'username'}
              placeholder={t('you@example.com')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {mode !== 'reset' && (
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor={`${id}-password`}>{t('Password')}</Label>
                {mode === 'signin' && (
                  <button type="button" onClick={() => go('reset')} className="text-xs text-primary underline-offset-2 hover:underline">
                    {t('Forgot password?')}
                  </button>
                )}
              </div>
              <PasswordInput
                id={`${id}-password`}
                name="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby={mode === 'signup' ? `${id}-rule` : undefined}
              />
              {mode === 'signup' && (
                <p id={`${id}-rule`} className="text-xs text-muted-foreground">
                  {t('At least {n} characters.', { n: MIN_PASSWORD })}
                </p>
              )}
            </div>
          )}
          {problem}
          <Button type="submit" className="h-10 w-full" disabled={!!busy}>
            {(busy === 'password' || busy === 'reset') && <Loader label={mode === 'reset' ? t('Sending') : mode === 'signup' ? t('Creating your account') : t('Signing in')} />}
            {mode === 'signup' ? t('Create account') : mode === 'reset' ? t('Send reset link') : t('Sign in')}
          </Button>
        </form>
        {mode === 'signin' && (
          <Button variant="ghost" className="h-9 w-full text-muted-foreground" disabled={!!busy} onClick={withLink}>
            {busy === 'link' ? <Loader label={t('Sending')} /> : <Mail />}
            {t('Email me a sign-in link instead')}
          </Button>
        )}
        <p className="text-center text-sm text-muted-foreground">
          {mode === 'signin' ? (
            <>
              {t('New here?')} <TextButton onClick={() => go('signup')}>{t('Create an account')}</TextButton>
            </>
          ) : mode === 'signup' ? (
            <>
              {t('Already have an account?')} <TextButton onClick={() => go('signin')}>{t('Sign in')}</TextButton>
            </>
          ) : (
            <TextButton onClick={() => go('signin')}>{t('Back to sign in')}</TextButton>
          )}
        </p>
      </div>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {body}
      <p className="text-center text-xs text-muted-foreground">
        {mode === 'signup' ? t('By creating an account you agree to the') : t('By signing in you agree to the')}{' '}
        <a href="terms.html" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
          {t('Terms')}
        </a>{' '}
        {t('and')}{' '}
        <a href="privacy.html" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
          {t('Privacy Policy')}
        </a>
        .
      </p>
    </>
  )
}
