// Pure rules of the second step of a sign-in (MFA-UI part A — API-005, API-211,
// API-020): how a typed code is normalised before it is sent, what a refused
// API-211 request tells the visitor, how long the step is shown as alive, when
// its wrong codes are spent, and the notices the password form shows after the
// step ended. No React, no I/O.
//
// The two normalisers mirror backend/src/auth/mfa/totp.ts (`matchTotp`) and
// backend/src/auth/mfa/recovery-codes.ts (`normalizeRecoveryCode`) — keep them
// in sync. They exist so a code that cannot be right (five digits, an `O` in a
// recovery code) is refused here: on the server every wrong code counts against
// the challenge (five, then it is over) AND against the account's lockout.
import { ApiError } from '../api/client'

// ---------------------------------------------------------------- codes

/** Digits of the authenticator's code. */
export const TOTP_CODE_LENGTH = 6
/** Room for the six digits typed in groups ("123 456") or pasted with stray spaces. */
export const TOTP_INPUT_MAX_LENGTH = 16

/** Symbols of a recovery code, shown as XXXXX-XXXXX. */
export const RECOVERY_CODE_LENGTH = 10
/** Digits 2–9 and the upper-case letters without I and O (no look-alikes of 0 and 1). */
export const RECOVERY_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const RECOVERY_CODE_PLACEHOLDER = 'XXXXX-XXXXX'
/** Room for the ten symbols with their dash and a few stray spaces. */
export const RECOVERY_INPUT_MAX_LENGTH = 32

const WHITESPACE = /\s/g
const SIX_DIGITS = /^[0-9]{6}$/
const RECOVERY_SEPARATORS = /[\s-]/g
const ASCII_ALPHANUMERIC = /^[0-9A-Za-z]*$/
const RECOVERY_SYMBOLS = new RegExp(`^[${RECOVERY_CODE_ALPHABET}]{${RECOVERY_CODE_LENGTH}}$`)

/** Arabic-Indic (U+0660..) and Persian (U+06F0..) digits as ASCII: an Arabic keyboard layout types them. */
function toAsciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0)
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660))
  })
}

/**
 * The six ASCII digits of a typed authenticator code, or null when the input
 * cannot be one. Spaces are dropped ("123 456") and Arabic-Indic digits read
 * as their ASCII twins (the server accepts 0–9 only).
 */
export function normalizeTotpCode(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const digits = toAsciiDigits(input.replace(WHITESPACE, ''))
  return SIX_DIGITS.test(digits) ? digits : null
}

/**
 * A typed recovery code as `XXXXX-XXXXX`, or null when it cannot be one: spaces
 * and dashes dropped, upper case, exactly ten symbols of the alphabet — a typed
 * 0, 1, I or O is refused, not guessed (the server does the same).
 */
export function normalizeRecoveryCode(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const compact = input.replace(RECOVERY_SEPARATORS, '')
  // Checked before upper-casing: 'ı' would otherwise become 'I'.
  if (!ASCII_ALPHANUMERIC.test(compact)) return null
  const symbols = compact.toUpperCase()
  if (!RECOVERY_SYMBOLS.test(symbols)) return null
  const half = RECOVERY_CODE_LENGTH / 2
  return `${symbols.slice(0, half)}-${symbols.slice(half)}`
}

// ------------------------------------------------------------- failures

/** Which of the two factors the visitor is typing. */
export type MfaFactorKind = 'code' | 'recoveryCode'

/**
 * What a refused API-211 request means for the screen:
 * - `field`   — the typed code was wrong: the message goes under the field, which is emptied and focused;
 * - `restart` — the challenge is over (expired, used, exhausted): back to the password form with the notice;
 * - `locked`  — the account is locked: the server answers every code with the lock until it ends, and a
 *               lock usually outlives the challenge — back to the password form, which says for how long;
 * - `alert`   — anything else: a worded message above the field, the step stays.
 */
export interface MfaSignInFailure {
  kind: 'field' | 'restart' | 'locked' | 'alert'
  /** Translation key — never a raw backend code. */
  key: string
  /** Minutes until the account's lock ends (`account_locked`), rounded up. */
  minutes?: number
  /**
   * Set when the server counted the answer against the challenge's five wrong
   * codes (`mfa_code_invalid`): the step counts them too — `challengeExhausted`.
   */
  spendsAttempt?: true
  /**
   * Set only when the server was not reached: the typed code was not judged and
   * may be sent again as it is. After every answer of the server the field is
   * emptied — the code was wrong, or it will be stale before a retry makes sense.
   */
  keepsInput?: true
}

/** Account verdicts that already have a sign-in message (login.errors.*). */
const ACCOUNT_CODES = new Set(['account_suspended', 'account_pending', 'account_not_activated'])

function retryAfterMinutes(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { retryAfterSeconds } = body as { retryAfterSeconds?: unknown }
  if (typeof retryAfterSeconds !== 'number' || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) return undefined
  return Math.max(1, Math.ceil(retryAfterSeconds / 60))
}

/** Codes: backend/src/auth/auth.errors.ts, as API-211 (`POST /api/auth/login/mfa`) answers them. */
export function describeMfaSignInFailure(error: unknown, factor: MfaFactorKind): MfaSignInFailure {
  if (!(error instanceof ApiError)) return { kind: 'alert', key: 'login.errors.network', keepsInput: true }
  const { code } = error

  if (code === 'mfa_code_invalid') {
    return {
      kind: 'field',
      key: factor === 'code' ? 'login.mfa.errors.code_invalid' : 'login.mfa.errors.recovery_code_invalid',
      spendsAttempt: true,
    }
  }
  // Unreachable through the form (an empty field is refused before any request); worded all the same.
  if (code === 'mfa_factor_required') {
    return { kind: 'field', key: factor === 'code' ? 'login.mfa.codeRequired' : 'login.mfa.recoveryCodeRequired' }
  }
  if (code === 'mfa_challenge_invalid') return { kind: 'restart', key: 'login.mfa.errors.challenge_invalid' }
  if (code === 'account_locked') {
    return { kind: 'locked', key: 'login.errors.account_locked', minutes: retryAfterMinutes(error.body) }
  }
  if (code === 'mfa_unavailable') return { kind: 'alert', key: 'login.errors.mfa_unavailable' }
  if (code === 'rate_limited' || error.status === 429) return { kind: 'alert', key: 'login.errors.rate_limited' }
  if (code && ACCOUNT_CODES.has(code)) return { kind: 'alert', key: `login.errors.${code}` }
  if (code === 'origin_forbidden') return { kind: 'alert', key: 'users.errors.origin_forbidden' }
  if (error.status >= 500) return { kind: 'alert', key: 'login.errors.server' }
  return { kind: 'alert', key: 'login.errors.generic' }
}

// --------------------------------------------------------------- expiry

/** The server's lifetime of a challenge (MFA_CHALLENGE_TTL_MS, D-R109): five minutes. */
export const MFA_CHALLENGE_TTL_MS = 5 * 60_000

/**
 * How long the step is still shown as alive: the server's five minutes counted
 * from the moment the step appeared (`startedAtMs`) to `nowMs`, both read from
 * this device's clock — used as a stopwatch only. The challenge's `expiresAt`
 * is deliberately not part of it: an instant of the server's clock compared
 * with this device's made a device a few minutes fast call a fresh challenge
 * expired within seconds (4 min 40 s fast = 20 s to type the code, at every
 * sign-in). The step appears the moment the challenge arrives, so its age is
 * the challenge's age whatever either clock says.
 *
 * Never more than the five minutes (a clock set back while the step is open),
 * never less than 0. A courtesy to the visitor — the server stays the judge:
 * a challenge it refuses ends the step through `mfa_challenge_invalid`.
 */
export function stepTimeLeftMs(startedAtMs: number, nowMs: number): number {
  const elapsed = nowMs - startedAtMs
  if (!Number.isFinite(elapsed) || elapsed <= 0) return MFA_CHALLENGE_TTL_MS
  return Math.max(0, MFA_CHALLENGE_TTL_MS - elapsed)
}

/** Whole minutes left, rounded up; 0 once the time is up. */
export function minutesLeftOf(leftMs: number): number {
  return leftMs > 0 ? Math.ceil(leftMs / 60_000) : 0
}

/** The calm line under the form for the minutes left (`minutesLeftOf`); null once the step is over. */
export function expiryLine(minutesLeft: number): { key: string; minutes?: number } | null {
  if (minutesLeft <= 0) return null
  if (minutesLeft === 1) return { key: 'login.mfa.expiresSoon' }
  if (minutesLeft === 2) return { key: 'login.mfa.expiresInTwoMinutes' }
  return { key: 'login.mfa.expiresInMinutes', minutes: minutesLeft }
}

// ------------------------------------------------------------- attempts

/** Wrong codes a challenge takes before the server consumes it (MFA_CHALLENGE_MAX_ATTEMPTS): five. */
export const MFA_CHALLENGE_MAX_ATTEMPTS = 5

/**
 * True once the server has answered `mfa_code_invalid` that many times for one
 * challenge: its fifth wrong code consumed it, whatever the account's lockout
 * threshold, so the next code could only be refused as `mfa_challenge_invalid`
 * — the step ends now instead of asking for it.
 */
export function challengeExhausted(wrongCodes: number): boolean {
  return wrongCodes >= MFA_CHALLENGE_MAX_ATTEMPTS
}

// -------------------------------------------------------------- notices

/**
 * Why the step hands the visitor back to the password form:
 * - `back`   — they asked for it (the link, or the button of the expired step);
 * - `ended`  — the challenge is over: the server refused it as expired or used, or its five wrong
 *              codes are spent — the password form then says why;
 * - `locked` — the account is locked (`MfaRestartLock` says for how long, when the server did).
 */
export type MfaRestartReason = 'back' | 'ended' | 'locked'

/** What comes with the `locked` reason. */
export interface MfaRestartLock {
  /** Minutes until the lock ends, rounded up; absent when the server named none. */
  minutes?: number
}

/** A notice the sign-in page shows above the password form; its id travels as `location.state.notice`. */
export type SignInNotice =
  | 'mfa_step_ended'
  | 'password_changed'
  | 'password_changed_step_ended'
  | 'password_changed_account_locked'
  | 'registration_completed'

type SignInNoticeType = 'success' | 'warning'

interface SignInNoticeSpec {
  key: string
  type: SignInNoticeType
  /**
   * The wording that names the minutes of a lock (`{{minutes}}`), used instead of `key` when the
   * notice came with usable minutes. A notice without it never reads `location.state.minutes`.
   */
  timedKey?: string
}

export const SIGN_IN_NOTICES: Readonly<Record<SignInNotice, SignInNoticeSpec>> = {
  /** The second step was refused as expired or used: the password is asked again. */
  mfa_step_ended: { key: 'login.mfa.errors.challenge_invalid', type: 'warning' },
  /** After a password reset whose second step the visitor left: the new password works. */
  password_changed: { key: 'login.mfa.notices.passwordChanged', type: 'success' },
  /** After a password reset whose second step ran out. */
  password_changed_step_ended: { key: 'login.mfa.notices.passwordChangedStepEnded', type: 'warning' },
  /** After a password reset whose second step locked the account: the new password works once the lock ends. */
  password_changed_account_locked: {
    key: 'login.mfa.notices.passwordChangedLocked',
    timedKey: 'login.mfa.notices.passwordChangedLockedFor',
    type: 'warning',
  },
  /** A student finished their own registration (PORTAL-04): the link opens no session, so they sign in now. */
  registration_completed: { key: 'studentRegistration.notices.accountCreated', type: 'success' },
}

/** The longest lock the server can name: AUTH_LOCKOUT_MINUTES goes up to 1440 (backend env.schema.ts). */
export const LOCK_MINUTES_MAX = 24 * 60

function isLockMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= LOCK_MINUTES_MAX
}

/** What a page puts into the router state of `/login` to have a notice shown there. */
export interface SignInNoticeState {
  notice: SignInNotice
  /** Whole minutes of a lock, for a notice that names them. */
  minutes?: number
}

/** The router state for a notice; `minutes` travels only when it is a usable number of minutes. */
export function signInNoticeState(notice: SignInNotice, minutes?: number): SignInNoticeState {
  return isLockMinutes(minutes) ? { notice, minutes } : { notice }
}

/** A notice ready for the screen: a translation key of this module's own list, never text from outside. */
export interface ShownSignInNotice {
  id: SignInNotice
  key: string
  type: SignInNoticeType
  /** The `{{minutes}}` of `key`, present exactly when the key is a `timedKey`. */
  minutes?: number
}

/** The notice with that id; the timed wording only for a notice that has one and whole minutes in 1..1440. */
export function signInNotice(id: SignInNotice, minutes?: unknown): ShownSignInNotice {
  const { key, type, timedKey } = SIGN_IN_NOTICES[id]
  return timedKey !== undefined && isLockMinutes(minutes) ? { id, key: timedKey, type, minutes } : { id, key, type }
}

/**
 * The notice carried by a router location state, or null. Only a known id is
 * ever shown, worded by this module; the one other value read from the state is
 * a whole number of minutes — anything else there is ignored, never rendered.
 */
export function signInNoticeOf(state: unknown): ShownSignInNotice | null {
  if (typeof state !== 'object' || state === null) return null
  const { notice, minutes } = state as { notice?: unknown; minutes?: unknown }
  if (typeof notice !== 'string' || !Object.hasOwn(SIGN_IN_NOTICES, notice)) return null
  return signInNotice(notice as SignInNotice, minutes)
}
