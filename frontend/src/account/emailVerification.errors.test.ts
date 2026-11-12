import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { describeVerificationConfirmFailure, describeVerificationRequestFailure, malformedVerificationLink } from './emailVerification.errors'

function refusal(status: number, body: Record<string, unknown> = {}) {
  return new ApiError(status, `${status}`, { statusCode: status, ...body })
}

describe('describeVerificationConfirmFailure (API-166)', () => {
  it('ends the link for an invalid or expired token, and for a malformed one without asking', () => {
    expect(describeVerificationConfirmFailure(refusal(404, { code: 'verification_invalid' }))).toEqual({ key: 'verifyEmail.errors.verification_invalid', terminal: true })
    expect(describeVerificationConfirmFailure(refusal(410, { code: 'verification_expired', expiredAt: '2026-11-10T10:00:00.000Z' }))).toEqual({
      key: 'verifyEmail.errors.verification_expired',
      terminal: true,
    })
    expect(malformedVerificationLink()).toEqual({ key: 'verifyEmail.errors.verification_invalid', terminal: true })
  })

  it('keeps the button for a throttled, refused-origin, failed or unanswered request', () => {
    expect(describeVerificationConfirmFailure(refusal(429, { code: 'rate_limited' }))).toEqual({ key: 'login.errors.rate_limited', terminal: false })
    expect(describeVerificationConfirmFailure(refusal(403, { code: 'origin_forbidden' }))).toEqual({ key: 'users.errors.origin_forbidden', terminal: false })
    expect(describeVerificationConfirmFailure(refusal(502))).toEqual({ key: 'login.errors.server', terminal: false })
    expect(describeVerificationConfirmFailure(refusal(400))).toEqual({ key: 'login.errors.generic', terminal: false })
    expect(describeVerificationConfirmFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network', terminal: false })
  })
})

describe('describeVerificationRequestFailure (API-165)', () => {
  it('words every refusal of the request', () => {
    expect(describeVerificationRequestFailure(refusal(422, { code: 'email_missing' }))).toEqual({ key: 'profile.emailVerification.errors.email_missing' })
    expect(describeVerificationRequestFailure(refusal(503, { code: 'mail_unavailable' }))).toEqual({ key: 'profile.emailVerification.errors.mail_unavailable' })
    expect(describeVerificationRequestFailure(refusal(429, { code: 'rate_limited' }))).toEqual({ key: 'profile.emailVerification.errors.rate_limited' })
    expect(describeVerificationRequestFailure(refusal(403, { code: 'origin_forbidden' }))).toEqual({ key: 'users.errors.origin_forbidden' })
    expect(describeVerificationRequestFailure(refusal(500))).toEqual({ key: 'login.errors.server' })
    expect(describeVerificationRequestFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network' })
  })

  it('reports when the address was confirmed already', () => {
    expect(describeVerificationRequestFailure(refusal(409, { code: 'email_already_verified', emailVerifiedAt: '2026-11-11T08:00:00.000Z' }))).toEqual({
      key: 'profile.emailVerification.errors.email_already_verified',
      alreadyVerifiedAt: '2026-11-11T08:00:00.000Z',
    })
  })
})
