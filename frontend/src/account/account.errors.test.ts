import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { describeAccountFailure, malformedLinkFailure } from './account.errors'

function apiError(status: number, body: Record<string, unknown> = {}) {
  return new ApiError(status, 'failed', { statusCode: status, ...body })
}

describe('describeAccountFailure', () => {
  it('marks the invitation codes terminal on the invitation flow only', () => {
    for (const code of ['invitation_invalid', 'invitation_consumed', 'invitation_expired']) {
      expect(describeAccountFailure(apiError(404, { code }), 'invitation')).toEqual({ key: `account.errors.${code}`, terminal: true })
      expect(describeAccountFailure(apiError(404, { code }), 'reset')).toEqual({ key: 'login.errors.generic', terminal: false })
    }
  })

  it('marks the reset codes terminal on the reset flow only', () => {
    for (const code of ['reset_invalid', 'reset_expired']) {
      expect(describeAccountFailure(apiError(410, { code }), 'reset')).toEqual({ key: `account.errors.${code}`, terminal: true })
      expect(describeAccountFailure(apiError(410, { code }), 'invitation')).toEqual({ key: 'login.errors.generic', terminal: false })
    }
  })

  it('keeps the form on password_weak, telling the minimum, and on the dedicated "same password" problem', () => {
    expect(describeAccountFailure(apiError(400, { code: 'password_weak', problems: ['at least 10 characters'] }), 'invitation')).toEqual({
      key: 'account.errors.password_weak',
      params: { min: 10 },
      terminal: false,
    })
    expect(
      describeAccountFailure(apiError(400, { code: 'password_weak', problems: ['different from the current password'] }), 'reset'),
    ).toEqual({ key: 'account.errors.password_same', terminal: false })
    // DTO validation (length bounds) carries no code: still a password problem.
    expect(describeAccountFailure(apiError(400, { message: ['password must be longer'] }), 'reset')).toMatchObject({
      key: 'account.errors.password_weak',
      terminal: false,
    })
  })

  it('maps throttling, origin refusal, server errors and network failures to the shared messages', () => {
    expect(describeAccountFailure(apiError(429, { code: 'rate_limited' }), 'invitation')).toEqual({ key: 'login.errors.rate_limited', terminal: false })
    expect(describeAccountFailure(apiError(403, { code: 'origin_forbidden' }), 'reset')).toEqual({ key: 'users.errors.origin_forbidden', terminal: false })
    expect(describeAccountFailure(apiError(503), 'invitation')).toEqual({ key: 'login.errors.server', terminal: false })
    expect(describeAccountFailure(new TypeError('Failed to fetch'), 'reset')).toEqual({ key: 'login.errors.network', terminal: false })
  })

  it('describes a malformed link as the invalid-link failure of its flow', () => {
    expect(malformedLinkFailure('invitation')).toEqual({ key: 'account.errors.invitation_invalid', terminal: true })
    expect(malformedLinkFailure('reset')).toEqual({ key: 'account.errors.reset_invalid', terminal: true })
  })
})
