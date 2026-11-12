import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { CERTIFICATE_ID, VERIFICATION_CODE, makeCertificate, makeCertificateList, makeClassCertificates, makeVerification } from '../test/certificates'
import { CLASS_ID } from '../test/classes'
import { ENROLLMENT_IDS } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import {
  certificatesListPath,
  classCertificatesPath,
  getCertificate,
  issueClassCertificates,
  listCertificates,
  previewClassCertificates,
  revokeCertificate,
  verifyCertificate,
  verifyCertificatePath,
} from './certificates'

describe('certificates API (API-130..API-134, API-136)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the list path with the non-empty parameters only, in a fixed order, the serial query trimmed', () => {
    expect(certificatesListPath()).toBe('/api/certificates')
    expect(certificatesListPath({ q: '   ', classId: '', status: undefined })).toBe('/api/certificates')
    expect(certificatesListPath({ q: ' cert-2026 ', classId: 'c-1', courseId: 'k-1', studentId: 's-1', status: 'revoked', limit: 20, cursor: 'a%b' })).toBe(
      '/api/certificates?classId=c-1&courseId=k-1&studentId=s-1&status=revoked&q=cert-2026&limit=20&cursor=a%25b',
    )
    expect(classCertificatesPath('a/b')).toBe('/api/classes/a%2Fb/certificates')
    expect(verifyCertificatePath('K7Q2 M4XW')).toBe('/api/certificates/verify/K7Q2%20M4XW')
  })

  it('reads the list, a certificate and a class preview with the Bearer token and the abort signal', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.startsWith('/api/classes/')) return jsonResponse(200, makeClassCertificates())
      return jsonResponse(200, url.includes('?') ? makeCertificateList([makeCertificate()]) : makeCertificate())
    })
    const controller = new AbortController()
    await expect(listCertificates({ status: 'issued' }, controller.signal)).resolves.toEqual(makeCertificateList([makeCertificate()]))
    await expect(getCertificate(CERTIFICATE_ID, controller.signal)).resolves.toEqual(makeCertificate())
    await expect(previewClassCertificates(CLASS_ID, controller.signal)).resolves.toEqual(makeClassCertificates())
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/certificates?status=issued', `/api/certificates/${CERTIFICATE_ID}`, `/api/classes/${CLASS_ID}/certificates`])
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
      expect(init?.signal).toBe(controller.signal)
    }
  })

  it('issues with POST and the documented body (empty = every eligible enrollment) and revokes with the reason', async () => {
    const fetchMock = mockFetch((url) => jsonResponse(200, url.endsWith('/revoke') ? makeCertificate({ status: 'revoked' }) : { issued: [makeCertificate()], skipped: [] }))
    await issueClassCertificates(CLASS_ID, {})
    await issueClassCertificates(CLASS_ID, { enrollmentIds: [ENROLLMENT_IDS[0]] })
    await revokeCertificate(CERTIFICATE_ID, { reason: 'خطأ في الدرجة' })
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      [`/api/classes/${CLASS_ID}/certificates`, 'POST', '{}'],
      [`/api/classes/${CLASS_ID}/certificates`, 'POST', JSON.stringify({ enrollmentIds: [ENROLLMENT_IDS[0]] })],
      [`/api/certificates/${CERTIFICATE_ID}/revoke`, 'POST', JSON.stringify({ reason: 'خطأ في الدرجة' })],
    ])
  })

  it('verifies on the public route without a bearer token even when one is held, and never refreshes on a refusal', async () => {
    const fetchMock = mockFetch((url) =>
      url.endsWith(VERIFICATION_CODE) ? jsonResponse(200, makeVerification()) : jsonResponse(401, { statusCode: 401, code: 'token_expired', message: 'expired' }),
    )
    const controller = new AbortController()
    await expect(verifyCertificate(VERIFICATION_CODE, controller.signal)).resolves.toEqual(makeVerification())
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`/api/certificates/verify/${VERIFICATION_CODE}`)
    expect(init?.method).toBe('GET')
    expect(init?.signal).toBe(controller.signal)
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)

    await expect(verifyCertificate('OTHERCODEOTHERCODE22')).rejects.toMatchObject({ status: 401, code: 'token_expired' })
    // No POST /api/auth/refresh after the 401: a public page never touches the session.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
