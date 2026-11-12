// Maps a failed e-mail verification request (LR-01-T02 — J-F54) to a
// translation key. API-165 (the profile's «send the confirmation e-mail»):
// email_missing 422, email_already_verified 409 { emailVerifiedAt },
// mail_unavailable 503 (MAIL_TRANSPORT=none) of backend/src/users/users.errors.ts,
// and rate_limited 429 / origin_forbidden 403 of backend/src/auth/auth.errors.ts.
// API-166 (the public /verify-email/:token page): verification_invalid 404 and
// verification_expired 410 { expiredAt } end the link — the page then shows the
// reason without its button, as the token pages do (MOD-03-T12). Pure: keys and
// values, never strings. Unit-tested in emailVerification.errors.test.ts.
import { ApiError } from '../api/client'

export interface VerificationFailure {
  /** Translation key, e.g. `verifyEmail.errors.verification_expired`. */
  key: string
  params?: Record<string, string>
  /** The link can never work: the page shows the message without its button. */
  terminal: boolean
}

export interface VerificationRequestFailure {
  key: string
  params?: Record<string, string>
  /** 409 `email_already_verified`: the address is confirmed already (since `emailVerifiedAt`) — the card reads its state again. */
  alreadyVerifiedAt?: string
}

function stringField(body: unknown, name: string): string | undefined {
  if (typeof body !== 'object' || body === null || !(name in body)) return undefined
  const value = (body as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : undefined
}

/** A link whose token does not have the shape of one (43 base64url characters): dead without asking the server. */
export function malformedVerificationLink(): VerificationFailure {
  return { key: 'verifyEmail.errors.verification_invalid', terminal: true }
}

/** API-166 refused or failed. */
export function describeVerificationConfirmFailure(error: unknown): VerificationFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network', terminal: false }
  if (error.code === 'verification_invalid') return { key: 'verifyEmail.errors.verification_invalid', terminal: true }
  if (error.code === 'verification_expired') return { key: 'verifyEmail.errors.verification_expired', terminal: true }
  if (error.code === 'rate_limited') return { key: 'login.errors.rate_limited', terminal: false }
  if (error.code === 'origin_forbidden') return { key: 'users.errors.origin_forbidden', terminal: false }
  if (error.status >= 500) return { key: 'login.errors.server', terminal: false }
  return { key: 'login.errors.generic', terminal: false }
}

/** API-165 refused or failed. */
export function describeVerificationRequestFailure(error: unknown): VerificationRequestFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  switch (error.code) {
    case 'email_missing':
      return { key: 'profile.emailVerification.errors.email_missing' }
    case 'email_already_verified': {
      const at = stringField(error.body, 'emailVerifiedAt')
      return { key: 'profile.emailVerification.errors.email_already_verified', ...(at ? { alreadyVerifiedAt: at } : {}) }
    }
    case 'mail_unavailable':
      return { key: 'profile.emailVerification.errors.mail_unavailable' }
    case 'rate_limited':
      return { key: 'profile.emailVerification.errors.rate_limited' }
    case 'origin_forbidden':
      return { key: 'users.errors.origin_forbidden' }
    default:
      return { key: error.status >= 500 ? 'login.errors.server' : 'login.errors.generic' }
  }
}
