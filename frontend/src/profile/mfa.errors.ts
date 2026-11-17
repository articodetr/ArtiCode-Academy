// Messages of the two-step verification card's requests (API-206..API-210 — the codes of
// backend/src/auth/auth.errors.ts, in the order backend/src/auth/mfa/mfa.controller.ts documents). Pure: returns
// an i18n key, the form field the refusal names and what the screen does about it — never a string and never the
// raw code.
import { ApiError } from '../api/client'
import { requestFailure } from './profile.errors'

/** The second factor a request carried: a code of the authenticator app, or a recovery code (API-209 takes either). */
export type MfaFactor = 'code' | 'recoveryCode'

export type MfaField = 'password' | MfaFactor

export interface MfaFailure {
  /** Translation key, e.g. `profile.mfa.errors.password_invalid`. */
  key: string
  /** The form field the message belongs to; absent = shown above the form. */
  field?: MfaField
  /**
   * What the screen does besides saying it:
   * - `status_changed` — the account's state is not what the card shows (already on, already off, or the server
   *   lost its key): the dialog closes with the message and the card re-reads API-206;
   * - `setup_expired` — the setup was never confirmed in its 10 minutes: back to the password step;
   * - `codes_unseen` — the code that turns it on (API-208) was answered «already on». The usual way there is a
   *   first answer that never arrived (the network dropped it) followed by a retry: it IS on, and the ten recovery
   *   codes of that lost answer were shown to nobody. The dialog closes, the card says so plainly and offers new
   *   recovery codes in one click (API-210).
   */
  effect?: 'status_changed' | 'setup_expired' | 'codes_unseen'
}

/** «It is on, but its recovery codes were not shown here» — what the card keeps saying until new codes are made. */
export const CODES_UNSEEN_KEY = 'profile.mfa.errors.codes_unseen'

/**
 * A refused or failed MFA request. `factor` is the second factor the request carried (a code unless said);
 * `enabling` says that the request was the code that turns two-step verification on (API-208) — the one request
 * whose «already on» means more than an out-of-date card.
 */
export function describeMfaFailure(error: unknown, factor: MfaFactor = 'code', enabling = false): MfaFailure {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'password_invalid':
        return { key: 'profile.mfa.errors.password_invalid', field: 'password' }
      case 'mfa_code_invalid':
        return factor === 'recoveryCode'
          ? { key: 'profile.mfa.errors.recovery_code_invalid', field: 'recoveryCode' }
          : { key: 'profile.mfa.errors.mfa_code_invalid', field: 'code' }
      case 'mfa_factor_required':
        return { key: 'profile.mfa.errors.mfa_factor_required', field: factor }
      case 'mfa_already_enabled':
        if (enabling) return { key: CODES_UNSEEN_KEY, effect: 'codes_unseen' }
        return { key: 'profile.mfa.errors.mfa_already_enabled', effect: 'status_changed' }
      case 'mfa_not_enabled':
      case 'mfa_unavailable':
        return { key: `profile.mfa.errors.${error.code}`, effect: 'status_changed' }
      case 'mfa_setup_required':
        return { key: 'profile.mfa.errors.mfa_setup_required', effect: 'setup_expired' }
      default:
        // Each of the four POSTs has its own limit: 10 per 15 minutes per (IP, user) — the throttler keys a
        // route by its handler, so the four do not share one budget (measured in a real browser, CH-0294).
        if (error.code === 'rate_limited' || error.status === 429) return { key: 'profile.mfa.errors.rate_limited' }
    }
  }
  // No answer, a server failure, or anything else — in the words the rest of the profile page uses.
  return { key: requestFailure(error).key }
}

/**
 * Whether a failed request ended without an answer of the application: the connection dropped, or a gateway gave
 * up (5xx). The server may have done what was asked all the same — for the code that turns two-step verification
 * on (API-208) that means «on, with recovery codes nobody saw», so the card re-reads the truth when the dialog
 * goes. A refusal the server worded (4xx, or the coded `503 mfa_unavailable`) is an answer: nothing was done.
 */
export function isUnanswered(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true
  return error.status >= 500 && error.code !== 'mfa_unavailable'
}
