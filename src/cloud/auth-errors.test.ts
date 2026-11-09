import { describe, expect, it } from 'vitest'
import { authMessage, authProblem, checkEmail, checkPassword } from './auth-errors'

describe('signing in with an email and password', () => {
  it('takes an email that could be one', () => {
    expect(checkEmail('sam@example.com')).toBeNull()
    expect(checkEmail('  sam@example.com ')).toBeNull()
    for (const bad of ['', 'sam', 'sam@example', 'sam @example.com', '@example.com']) expect(checkEmail(bad)).toBe('Enter a valid email address.')
  })

  it('takes a new password of 8 characters or more, not just spaces', () => {
    expect(checkPassword('1234567')).toBe('Use at least 8 characters.')
    expect(checkPassword('12345678')).toBeNull()
    expect(checkPassword('         ')).toBe("A password can't be just spaces.")
  })

  it('says plainly what went wrong, by what the server calls it', () => {
    expect(authMessage({ code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 })).toBe(
      "That email and password don't match an account. Check them, or reset your password.",
    )
    expect(authMessage({ code: 'email_not_confirmed', message: 'Email not confirmed' })).toMatch(/^Confirm your email first/)
    expect(authMessage({ code: 'over_email_send_rate_limit', message: 'email rate limit exceeded', status: 429 })).toMatch(/too many emails/)
  })

  it('says when the server can’t be reached', () => {
    expect(authMessage({ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 })).toBe("Couldn't reach the server. Check your connection, then try again.")
  })

  it('passes on anything else as the server says it', () => {
    expect(authMessage({ code: 'something_new', message: 'Something new went wrong' })).toBe('Something new went wrong')
    expect(authMessage({})).toBe('Something went wrong. Try again.')
  })

  it('keeps what the server called it, for what to offer next', () => {
    const p = authProblem({ code: 'email_not_confirmed', message: 'Email not confirmed' })
    expect(p).toBeInstanceOf(Error)
    expect(p.code).toBe('email_not_confirmed')
  })
})
