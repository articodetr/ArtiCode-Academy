// Maps a failed public account request (API-016/017/020) to a translation key
// and says whether the link is dead — then the page shows the message instead
// of the form (T12 AC2). Codes: backend/src/users/users.errors.ts (invitation_*,
// reset_*) and backend/src/auth/auth.errors.ts (password_weak, rate_limited, origin_forbidden).
import { ApiError } from '../api/client'
import { PASSWORD_MIN_LENGTH } from './account.links'

export type AccountFlow = 'invitation' | 'reset'

export interface AccountFailure {
  /** Translation key, e.g. `account.errors.invitation_expired`. */
  key: string
  params?: Record<string, string | number>
  /** The token can never work: show the message without the form. */
  terminal: boolean
}

const TERMINAL_CODES: Readonly<Record<AccountFlow, ReadonlySet<string>>> = {
  invitation: new Set(['invitation_invalid', 'invitation_consumed', 'invitation_expired']),
  reset: new Set(['reset_invalid', 'reset_expired']),
}

/** A failure the page reports before any request: the token in the URL is malformed. */
export function malformedLinkFailure(flow: AccountFlow): AccountFailure {
  return { key: `account.errors.${flow === 'invitation' ? 'invitation_invalid' : 'reset_invalid'}`, terminal: true }
}

function problemsOf(body: unknown): string[] {
  if (typeof body !== 'object' || body === null || !('problems' in body)) return []
  const { problems } = body as { problems: unknown }
  return Array.isArray(problems) ? problems.filter((item): item is string => typeof item === 'string') : []
}

export function describeAccountFailure(error: unknown, flow: AccountFlow): AccountFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network', terminal: false }

  if (error.code && TERMINAL_CODES[flow].has(error.code)) {
    return { key: `account.errors.${error.code}`, terminal: true }
  }
  if (error.code === 'password_weak' || (error.status === 400 && !error.code)) {
    // The reset confirm refuses the current password with a dedicated problem line.
    const same = problemsOf(error.body).some((problem) => /different/i.test(problem))
    return same
      ? { key: 'account.errors.password_same', terminal: false }
      : { key: 'account.errors.password_weak', params: { min: PASSWORD_MIN_LENGTH }, terminal: false }
  }
  if (error.code === 'rate_limited') return { key: 'login.errors.rate_limited', terminal: false }
  if (error.code === 'origin_forbidden') return { key: 'users.errors.origin_forbidden', terminal: false }
  if (error.status >= 500) return { key: 'login.errors.server', terminal: false }
  return { key: 'login.errors.generic', terminal: false }
}

// ------------------------------------------------ LR-01-T02 and API-021

/** The verification link in the URL is not even shaped like a token. */
export function malformedVerificationFailure(): AccountFailure {
  return { key: 'emailVerification.errors.verification_invalid', terminal: true }
}

/** A failed API-166 confirmation: an invalid or expired link is dead for good. */
export function describeVerificationConfirmFailure(error: unknown): AccountFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network', terminal: false }
  if (error.code === 'verification_invalid' || error.code === 'verification_expired') {
    return { key: `emailVerification.errors.${error.code}`, terminal: true }
  }
  if (error.code === 'rate_limited' || error.status === 429) return { key: 'login.errors.rate_limited', terminal: false }
  if (error.code === 'origin_forbidden') return { key: 'users.errors.origin_forbidden', terminal: false }
  if (error.status >= 500) return { key: 'login.errors.server', terminal: false }
  return { key: 'login.errors.generic', terminal: false }
}

/** Outcome of a refused API-165 request; `info` = nothing is wrong (already confirmed). */
export interface VerificationRequestFailure {
  key: string
  type: 'info' | 'warning' | 'error'
}

const VERIFICATION_REQUEST_CODES: Readonly<Record<string, VerificationRequestFailure['type']>> = {
  email_already_verified: 'info',
  email_missing: 'warning',
  mail_unavailable: 'warning',
  rate_limited: 'warning',
}

export function describeVerificationRequestFailure(error: unknown): VerificationRequestFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network', type: 'error' }
  const code = error.code ?? (error.status === 429 ? 'rate_limited' : null)
  if (code && code in VERIFICATION_REQUEST_CODES) {
    return { key: `emailVerification.errors.${code}`, type: VERIFICATION_REQUEST_CODES[code] }
  }
  if (error.status >= 500) return { key: 'login.errors.server', type: 'error' }
  return { key: 'login.errors.generic', type: 'error' }
}

/** A refused API-021 request: switched off, too many, or something else. */
export function describeForgotPasswordFailure(error: unknown): { key: string; type: 'warning' | 'error' } {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network', type: 'error' }
  if (error.code === 'reset_disabled') return { key: 'forgotPassword.errors.reset_disabled', type: 'warning' }
  if (error.code === 'rate_limited' || error.status === 429) return { key: 'forgotPassword.errors.rate_limited', type: 'warning' }
  if (error.code === 'origin_forbidden') return { key: 'users.errors.origin_forbidden', type: 'error' }
  if (error.status >= 500) return { key: 'login.errors.server', type: 'error' }
  return { key: 'login.errors.generic', type: 'error' }
}
