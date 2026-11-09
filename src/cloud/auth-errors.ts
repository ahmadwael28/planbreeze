/**
 * Signing in and up with an email and password: what's checked before anything's sent, and what went wrong after,
 * said plainly.
 */
import { t } from '@/i18n'

/** The shortest password an account can have (the Supabase project's own minimum is best set the same). */
export const MIN_PASSWORD = 8

/** Something wrong with signing in or up, said plainly; `code` is what Supabase called it, for what to offer next. */
export class AuthProblem extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

/** Why an email address can't be one (nothing if it can). */
export function checkEmail(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : t('Enter a valid email address.')
}

/** Why a new password won't do (nothing if it will). */
export function checkPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD) return t('Use at least {n} characters.', { n: MIN_PASSWORD })
  if (!password.trim()) return t("A password can't be just spaces.")
  return null
}

/** An error from Supabase's sign-in, as far as it says what it was. */
export interface AuthErrorLike {
  code?: string
  message?: string
  status?: number
  name?: string
}

/** What went wrong signing in, signing up or changing a password, by Supabase's error codes; else as it says. */
export function authMessage(error: AuthErrorLike): string {
  switch (error.code) {
    case 'invalid_credentials':
      return t("That email and password don't match an account. Check them, or reset your password.")
    case 'email_not_confirmed':
      return t('Confirm your email first: open the link we sent you when you made the account.')
    case 'user_already_exists':
    case 'email_exists':
      return t("There's already an account with this email. Sign in with it instead.")
    case 'weak_password':
      return t('That password is too easy to guess. Make it longer, with a mix of letters, numbers and symbols.')
    case 'same_password':
      return t("That's the password you have now. Choose a different one.")
    case 'over_email_send_rate_limit':
      return t("We've sent too many emails just now. Wait a few minutes, then try again.")
    case 'over_request_rate_limit':
      return t('Too many tries just now. Wait a few minutes, then try again.')
    case 'signup_disabled':
      return t("New accounts can't be made right now.")
    case 'email_provider_disabled':
      return t("Signing in with an email isn't turned on for this copy of the app.")
    case 'email_address_invalid':
      return t('Enter a valid email address.')
    case 'reauthentication_needed':
      return t('To change your password, sign out and sign in again first.')
    case 'session_not_found':
    case 'session_expired':
      return t('You were signed out. Sign in again, then try once more.')
  }
  // No answer from the server at all.
  if (error.name === 'AuthRetryableFetchError' || error.status === 0 || /failed to fetch|networkerror|load failed/i.test(error.message ?? '')) {
    return t("Couldn't reach the server. Check your connection, then try again.")
  }
  return error.message || t('Something went wrong. Try again.')
}

/** The same, ready to throw. */
export const authProblem = (error: AuthErrorLike) => new AuthProblem(authMessage(error), error.code)
