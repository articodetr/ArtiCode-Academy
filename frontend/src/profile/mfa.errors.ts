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
   * - `setup_expired` — the setup was never confirmed in its 10 minutes: back to the password step.
   */
  effect?: 'status_changed' | 'setup_expired'
}

/** A refused or failed MFA request; `factor` is the second factor the request carried (a code unless said). */
export function describeMfaFailure(error: unknown, factor: MfaFactor = 'code'): MfaFailure {
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
      case 'mfa_not_enabled':
      case 'mfa_unavailable':
        return { key: `profile.mfa.errors.${error.code}`, effect: 'status_changed' }
      case 'mfa_setup_required':
        return { key: 'profile.mfa.errors.mfa_setup_required', effect: 'setup_expired' }
      default:
        // The four POSTs share one limit: 10 per 15 minutes.
        if (error.code === 'rate_limited' || error.status === 429) return { key: 'profile.mfa.errors.rate_limited' }
    }
  }
  // No answer, a server failure, or anything else — in the words the rest of the profile page uses.
  return { key: requestFailure(error).key }
}
