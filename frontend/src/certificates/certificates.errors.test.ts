import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { ar } from '../i18n/ar'
import i18n from '../i18n'
import { describeCertificatesFailure, describeVerificationFailure, failureMessage, isCertificatesFailure, isStaleIssue, isStaleRevocation } from './certificates.errors'

const t = i18n.getFixedT('ar')

function apiError(status: number, body: Record<string, unknown>) {
  return new ApiError(status, String(body.message ?? `${status}`), { statusCode: status, ...body })
}

describe('describeCertificatesFailure', () => {
  it('maps every code of the MOD-10 dictionary and the guards to its own message', () => {
    for (const code of ['class_not_found', 'class_not_completed', 'certificate_request_invalid', 'certificate_not_found', 'certificate_revoked', 'cursor_invalid', 'origin_forbidden', 'rate_limited']) {
      const failure = describeCertificatesFailure(apiError(409, { code, message: 'x' }))
      expect(failure.key).toBe(`certificates.errors.${code}`)
      expect(failureMessage(t, failure)).toBe(ar.certificates.errors[code as keyof typeof ar.certificates.errors].replace(' {{list}}', ''))
    }
  })

  it('lists the missing keys of permission_denied, and reads validation, server and network failures', () => {
    const denied = describeCertificatesFailure(apiError(403, { code: 'permission_denied', missing: ['certificates.read_all', 'certificates.issue'] }))
    expect(failureMessage(t, denied)).toBe('ليست لديك الصلاحية اللازمة لهذا الإجراء (certificates.read_all, certificates.issue)')
    expect(failureMessage(t, describeCertificatesFailure(apiError(400, { message: 'reason must be longer than or equal to 1 characters' })))).toBe(
      'رفض الخادم البيانات: reason must be longer than or equal to 1 characters',
    )
    expect(describeCertificatesFailure(apiError(503, { message: 'down' })).key).toBe('login.errors.server')
    expect(describeCertificatesFailure(new TypeError('Failed to fetch')).key).toBe('login.errors.network')
    expect(describeCertificatesFailure(apiError(418, { message: 'teapot' })).key).toBe('login.errors.generic')
  })

  it('tells the stale refusals of issuing and revoking from the retryable ones', () => {
    const of = (code: string) => describeCertificatesFailure(apiError(409, { code }))
    expect(['class_not_completed', 'certificate_request_invalid', 'class_not_found'].every((code) => isStaleIssue(of(code)))).toBe(true)
    expect(isStaleIssue(of('rate_limited'))).toBe(false)
    expect(isStaleIssue(describeCertificatesFailure(new TypeError('offline')))).toBe(false)
    expect(['certificate_revoked', 'certificate_not_found'].every((code) => isStaleRevocation(of(code)))).toBe(true)
    expect(isStaleRevocation(of('permission_denied'))).toBe(false)
    expect(isCertificatesFailure(of('cursor_invalid'), 'cursor_invalid')).toBe(true)
  })
})

describe('describeVerificationFailure (API-134)', () => {
  it('reads an unknown or malformed code (404) as terminal, and 429, 5xx and the network as worth a retry', () => {
    expect(describeVerificationFailure(apiError(404, { code: 'certificate_not_found' }))).toEqual({ key: 'certificates.verify.notFound', terminal: true })
    expect(describeVerificationFailure(apiError(429, { code: 'rate_limited' }))).toEqual({ key: 'certificates.verify.rateLimited', terminal: false })
    expect(describeVerificationFailure(apiError(500, {}))).toEqual({ key: 'login.errors.server', terminal: false })
    expect(describeVerificationFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network', terminal: false })
    expect(describeVerificationFailure(apiError(400, {}))).toEqual({ key: 'login.errors.generic', terminal: false })
  })
})
