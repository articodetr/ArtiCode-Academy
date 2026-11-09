import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { PASSWORD_MIN_LENGTH, passwordChangeFailure, requestFailure } from './profile.errors'

/** An error as apiRequest() throws it for a backend answer `{ statusCode, code?, message }`. */
function apiError(status: number, code?: string) {
  const body = code
    ? { statusCode: status, code, message: 'refused' }
    : { statusCode: status, message: ['newPassword must be longer than or equal to 10 characters'] }
  return new ApiError(status, 'refused', body)
}

describe('profile request failures (J-F36)', () => {
  it('maps the codes of POST /api/auth/password to the profile messages', () => {
    expect(passwordChangeFailure(apiError(400, 'password_invalid'))).toEqual({ key: 'profile.errors.password_invalid' })
    expect(passwordChangeFailure(apiError(400, 'password_weak'))).toEqual({
      key: 'profile.errors.password_weak',
      values: { min: PASSWORD_MIN_LENGTH },
    })
    // The DTO's length check answers 400 without a code.
    expect(passwordChangeFailure(apiError(400))).toEqual({ key: 'profile.errors.password_weak', values: { min: 10 } })
  })

  it('falls back to the sign-in vocabulary for throttling, server failures, refusals and no answer', () => {
    expect(passwordChangeFailure(apiError(429, 'rate_limited'))).toEqual({ key: 'login.errors.rate_limited' })
    expect(passwordChangeFailure(apiError(503))).toEqual({ key: 'login.errors.server' })
    expect(passwordChangeFailure(apiError(403, 'origin_forbidden'))).toEqual({ key: 'login.errors.generic' })
    expect(passwordChangeFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network' })
  })

  it('describes a failed sign-out without the password messages', () => {
    expect(requestFailure(apiError(400))).toEqual({ key: 'login.errors.generic' })
    expect(requestFailure(apiError(500))).toEqual({ key: 'login.errors.server' })
    expect(requestFailure(apiError(429, 'rate_limited'))).toEqual({ key: 'login.errors.rate_limited' })
    expect(requestFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network' })
  })
})
