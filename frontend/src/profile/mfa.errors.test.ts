import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import { describeMfaFailure } from './mfa.errors'

const refusal = (status: number, code?: string) => new ApiError(status, 'refused', code ? { statusCode: status, code, message: 'refused' } : { statusCode: status })

/** The text behind a dotted i18n key, or undefined when the key does not exist. */
function textOf(translation: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined), translation)
}

describe('describeMfaFailure', () => {
  it('puts a wrong password on the password field', () => {
    expect(describeMfaFailure(refusal(400, 'password_invalid'))).toEqual({ key: 'profile.mfa.errors.password_invalid', field: 'password' })
  })

  it('puts a refused second factor on the field that carried it', () => {
    expect(describeMfaFailure(refusal(400, 'mfa_code_invalid'))).toEqual({ key: 'profile.mfa.errors.mfa_code_invalid', field: 'code' })
    expect(describeMfaFailure(refusal(400, 'mfa_code_invalid'), 'recoveryCode')).toEqual({ key: 'profile.mfa.errors.recovery_code_invalid', field: 'recoveryCode' })
    expect(describeMfaFailure(refusal(400, 'mfa_factor_required'))).toEqual({ key: 'profile.mfa.errors.mfa_factor_required', field: 'code' })
    expect(describeMfaFailure(refusal(400, 'mfa_factor_required'), 'recoveryCode')).toEqual({ key: 'profile.mfa.errors.mfa_factor_required', field: 'recoveryCode' })
  })

  it('marks a state the card no longer shows: already on, already off, no server key', () => {
    expect(describeMfaFailure(refusal(409, 'mfa_already_enabled'))).toEqual({ key: 'profile.mfa.errors.mfa_already_enabled', effect: 'status_changed' })
    expect(describeMfaFailure(refusal(409, 'mfa_not_enabled'))).toEqual({ key: 'profile.mfa.errors.mfa_not_enabled', effect: 'status_changed' })
    expect(describeMfaFailure(refusal(503, 'mfa_unavailable'))).toEqual({ key: 'profile.mfa.errors.mfa_unavailable', effect: 'status_changed' })
  })

  it('marks an expired setup', () => {
    expect(describeMfaFailure(refusal(409, 'mfa_setup_required'))).toEqual({ key: 'profile.mfa.errors.mfa_setup_required', effect: 'setup_expired' })
  })

  it('names the shared limit of the four writes, by code or by status alone', () => {
    expect(describeMfaFailure(refusal(429, 'rate_limited'))).toEqual({ key: 'profile.mfa.errors.rate_limited' })
    expect(describeMfaFailure(refusal(429))).toEqual({ key: 'profile.mfa.errors.rate_limited' })
  })

  it('falls back to the words of the profile page for a server failure, no answer, or anything else', () => {
    expect(describeMfaFailure(refusal(500))).toEqual({ key: 'login.errors.server' })
    expect(describeMfaFailure(refusal(503))).toEqual({ key: 'login.errors.server' })
    expect(describeMfaFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network' })
    expect(describeMfaFailure(refusal(400))).toEqual({ key: 'login.errors.generic' })
    expect(describeMfaFailure(refusal(403, 'origin_forbidden'))).toEqual({ key: 'login.errors.generic' })
    expect(describeMfaFailure(refusal(418, 'something_new'))).toEqual({ key: 'login.errors.generic' })
  })

  it('never answers a key without a text in both languages, and no text shows a raw code', () => {
    const failures = [
      refusal(400, 'password_invalid'),
      refusal(400, 'mfa_code_invalid'),
      refusal(400, 'mfa_factor_required'),
      refusal(409, 'mfa_already_enabled'),
      refusal(409, 'mfa_not_enabled'),
      refusal(409, 'mfa_setup_required'),
      refusal(503, 'mfa_unavailable'),
      refusal(429, 'rate_limited'),
      refusal(500),
      refusal(400),
      new Error('offline'),
    ]
    const keys = new Set(failures.flatMap((failure) => [describeMfaFailure(failure).key, describeMfaFailure(failure, 'recoveryCode').key]))
    for (const key of keys) {
      for (const translation of [ar, en]) {
        const text = textOf(translation, key)
        expect(typeof text, key).toBe('string')
        expect(text as string, key).not.toMatch(/[a-z]+_[a-z_]+/)
      }
    }
  })
})
