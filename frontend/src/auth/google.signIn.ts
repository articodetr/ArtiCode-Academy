// Pure rules of the Google sign-in screens (PORTAL-04 — the shared contract B): what a refused start means, what the
// server's verdict in `/login?google=<code>` says, and how the second step of an account with two-step verification is
// read from `/login#google-mfa=<challenge>&expiresAt=<ISO>&returnTo=<path>`. The fragment never reaches a server or a
// log; the page reads it once and clears it. No React, no I/O.
import type { MfaChallenge } from '../api/auth'
import { ApiError } from '../api/client'
import { GOOGLE_URL_INVALID } from '../api/google'
import { MFA_CHALLENGE_TTL_MS } from './mfa.signIn'
import { safeReturnPath } from './returnPath'

// --------------------------------------------------------------- start

/** A refused `POST /api/auth/google/start`, as a translation key of this app — never a server message. */
export function describeGoogleStartFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'google_unavailable') return 'login.google.errors.unavailable'
    if (error.code === 'rate_limited' || error.status === 429) return 'login.errors.rate_limited'
    if (error.code === 'origin_forbidden') return 'users.errors.origin_forbidden'
    if (error.status >= 500) return 'login.errors.server'
    return 'login.google.errors.failed'
  }
  if (error instanceof Error && error.message === GOOGLE_URL_INVALID) return 'login.google.errors.failed'
  return 'login.errors.network'
}

// ------------------------------------------------------------ verdicts

/**
 * The codes of `/login?google=<code>` (the callback's failures). Since the review: `link_conflict` (the academy account
 * with this e-mail is linked to ANOTHER Google account), `mfa_unavailable` (the account has two-step verification but
 * the server's MFA key is missing) and `email_not_authoritative` (Google does not vouch for this address, so it can
 * neither create an account nor link one; an existing account in that case answers `link_required`).
 */
export const GOOGLE_RESULT_CODES = [
  'cancelled',
  'failed',
  'unavailable',
  'registration_closed',
  'link_required',
  'link_conflict',
  'email_not_authoritative',
  'account_unavailable',
  'mfa_unavailable',
] as const
export type GoogleResultCode = (typeof GOOGLE_RESULT_CODES)[number]

export const GOOGLE_RESULT_PARAM = 'google'

const RESULT_TYPES: Readonly<Record<GoogleResultCode, 'info' | 'warning' | 'error'>> = {
  cancelled: 'info',
  failed: 'error',
  unavailable: 'warning',
  registration_closed: 'warning',
  link_required: 'warning',
  link_conflict: 'warning',
  email_not_authoritative: 'warning',
  account_unavailable: 'error',
  mfa_unavailable: 'error',
}

export interface GoogleResultMessage {
  code: GoogleResultCode
  /** Translation key of this app: `login.google.results.<code>`. */
  key: string
  type: 'info' | 'warning' | 'error'
}

/**
 * The server's verdict in `?google=`, worded by this app; a code this build does not know reads as `failed` (never the
 * raw value). Null without the parameter.
 */
export function googleResultOf(search: string): GoogleResultMessage | null {
  const value = new URLSearchParams(search).get(GOOGLE_RESULT_PARAM)
  if (value === null) return null
  const code: GoogleResultCode = (GOOGLE_RESULT_CODES as readonly string[]).includes(value) ? (value as GoogleResultCode) : 'failed'
  return { code, key: `login.google.results.${code}`, type: RESULT_TYPES[code] }
}

/** The query string without `?google=` (the other parameters — `returnTo` — stay), ready for a `replace`. */
export function withoutGoogleResult(search: string): string {
  const params = new URLSearchParams(search)
  params.delete(GOOGLE_RESULT_PARAM)
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}

// --------------------------------------------------------- MFA fragment

export const GOOGLE_MFA_KEY = 'google-mfa'

/** The server's challenge: 43 base64url characters today; a little room either way, never anything else. */
const CHALLENGE_SHAPE = /^[A-Za-z0-9_-]{16,256}$/

export interface GoogleMfaHandoff {
  /** The challenge of API-211, held in memory only. */
  challenge: MfaChallenge
  /** Where to go once the second step succeeds, checked by the server's rule; null without one. */
  returnTo: string | null
}

/** True when the address fragment is the server's hand-over of a second step (whatever its values). */
export function isGoogleMfaFragment(hash: string): boolean {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).has(GOOGLE_MFA_KEY)
}

/**
 * The second step the server handed over in the fragment, or null when there is none or its challenge cannot be one.
 * `expiresAt` is passed through when it is a date (MfaChallengeStep keeps its own five-minute clock and never reads it),
 * else five minutes from `now`.
 */
export function googleMfaHandoffOf(hash: string, now: number = Date.now()): GoogleMfaHandoff | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const challenge = params.get(GOOGLE_MFA_KEY)
  if (challenge === null || !CHALLENGE_SHAPE.test(challenge)) return null
  const expiresAt = params.get('expiresAt')
  return {
    challenge: {
      mfaRequired: true,
      challenge,
      expiresAt: expiresAt !== null && Number.isFinite(Date.parse(expiresAt)) ? expiresAt : new Date(now + MFA_CHALLENGE_TTL_MS).toISOString(),
    },
    returnTo: safeReturnPath(params.get('returnTo')),
  }
}
