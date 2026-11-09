// Messages of the profile page's requests (J-F36): the password change
// (POST /api/auth/password — codes of backend/src/auth/auth.errors.ts) and
// signing out. Pure: returns i18n keys and their values, never strings.
import { ApiError } from '../api/client'

/** Shortest new password (PASSWORD_MIN_LENGTH in backend/src/auth/password.service.ts). */
export const PASSWORD_MIN_LENGTH = 10

export interface FailureMessage {
  key: string
  values?: Record<string, unknown>
}

/** Any failed request, in the words of the sign-in page: throttled, server failure, no answer, or anything else. */
export function requestFailure(error: unknown): FailureMessage {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  if (error.code === 'rate_limited') return { key: 'login.errors.rate_limited' }
  return { key: error.status >= 500 ? 'login.errors.server' : 'login.errors.generic' }
}

/** A refused password change: wrong current password, a new one the policy rejects, else requestFailure(). */
export function passwordChangeFailure(error: unknown): FailureMessage {
  if (error instanceof ApiError) {
    if (error.code === 'password_invalid') return { key: 'profile.errors.password_invalid' }
    // A 400 without a code comes from the length check of ChangePasswordDto.
    if (error.code === 'password_weak' || error.status === 400) {
      return { key: 'profile.errors.password_weak', values: { min: PASSWORD_MIN_LENGTH } }
    }
  }
  return requestFailure(error)
}
