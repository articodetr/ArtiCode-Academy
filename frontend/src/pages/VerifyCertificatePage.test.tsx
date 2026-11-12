import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CertificateVerification } from '../api/certificates'
import { setAccessToken } from '../auth/token-store'
import { formatCertificateDay } from '../certificates/certificates.format'
import { ar } from '../i18n/ar'
import { VERIFICATION_CODE, makeVerification } from '../test/certificates'
import { jsonResponse, mockFetch } from '../test/http'
import { renderWithProviders } from '../test/render'
import { VerifyCertificatePage } from './VerifyCertificatePage'

function mockVerifyApi(answers: Array<CertificateVerification | Response>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  mockFetch((url, init) => {
    const answer = answers[Math.min(calls.length, answers.length - 1)]!
    calls.push({ url, init })
    return answer instanceof Response ? answer.clone() : jsonResponse(200, answer)
  })
  return { calls }
}

function renderAt(code: string) {
  return renderWithProviders(<VerifyCertificatePage />, { route: `/verify/${code}`, path: '/verify/:code' })
}

describe('VerifyCertificatePage (public — API-134)', () => {
  it('verifies the code of the URL without a sign-in and shows a valid certificate from its snapshot', async () => {
    // Even a token held by this tab never travels to the public route.
    setAccessToken('access-1')
    const api = mockVerifyApi([makeVerification()])
    renderAt(VERIFICATION_CODE.toLowerCase())

    expect(await screen.findByText(ar.certificates.verify.valid)).toBeInTheDocument()
    expect(api.calls.map((call) => call.url)).toEqual([`/api/certificates/verify/${VERIFICATION_CODE}`])
    expect(new Headers(api.calls[0]!.init?.headers).has('Authorization')).toBe(false)
    expect(screen.getByText('CERT-2026-00001')).toBeInTheDocument()
    expect(screen.getByText('عمر خالد')).toBeInTheDocument()
    expect(screen.getByText('Omar Khaled')).toBeInTheDocument()
    expect(screen.getByText(/أساسيات بايثون/)).toBeInTheDocument()
    expect(screen.getByText(/جيد جداً \(B\)/)).toBeInTheDocument()
    expect(screen.getByText(formatCertificateDay('2026-12-21T09:30:00.000Z', 'ar'))).toBeInTheDocument()
    expect(screen.getByText('أكاديمية آرتي كود')).toBeInTheDocument()
    setAccessToken(null)
  })

  it('shows a revoked certificate as no longer valid, with the day of the revocation', async () => {
    mockVerifyApi([makeVerification({ status: 'revoked', revokedAt: '2026-12-28T10:00:00.000Z' })])
    renderAt(VERIFICATION_CODE)

    expect(await screen.findByText(ar.certificates.verify.revoked)).toBeInTheDocument()
    expect(screen.getByText(`أُبطلت هذه الشهادة في ${formatCertificateDay('2026-12-28T10:00:00.000Z', 'ar')} ولم تعد صالحة.`)).toBeInTheDocument()
    expect(screen.queryByText(ar.certificates.verify.valid)).not.toBeInTheDocument()
  })

  it('says «not found» for an unknown code (404) without a retry, and for a code that cannot be one without any request', async () => {
    const api = mockVerifyApi([jsonResponse(404, { statusCode: 404, code: 'certificate_not_found', message: 'No certificate matches' })])
    const { unmount } = renderAt(VERIFICATION_CODE)
    expect(await screen.findByText(ar.certificates.verify.notFound)).toBeInTheDocument()
    expect(screen.queryByText(ar.certificates.verify.retry)).not.toBeInTheDocument()
    unmount()

    renderAt('not-a-code-0189')
    expect(await screen.findByText(ar.certificates.verify.notFound)).toBeInTheDocument()
    expect(api.calls).toHaveLength(1)
  })

  it('asks the visitor to wait after 429 and verifies again on retry', async () => {
    const api = mockVerifyApi([jsonResponse(429, { statusCode: 429, code: 'rate_limited', message: 'Too many requests' }), makeVerification()])
    renderAt(VERIFICATION_CODE)

    expect(await screen.findByText(ar.certificates.verify.rateLimited)).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.certificates.verify.retry).closest('button')!)
    expect(await screen.findByText(ar.certificates.verify.valid)).toBeInTheDocument()
    expect(api.calls).toHaveLength(2)
  })

  it('checks a typed code: a malformed one is refused on the field, a good one — as typed — opens its page', async () => {
    const api = mockVerifyApi([makeVerification()])
    renderWithProviders(<VerifyCertificatePage />, { route: '/verify', path: '/verify', routes: { '/verify/:code': <VerifyCertificatePage /> } })

    expect(screen.getByText(ar.certificates.verify.intro)).toBeInTheDocument()
    const field = screen.getByLabelText(ar.certificates.verify.code)
    fireEvent.change(field, { target: { value: 'ABC-123' } })
    fireEvent.click(screen.getByText(ar.certificates.verify.submit).closest('button')!)
    expect(await screen.findByText(ar.certificates.verify.invalidCode)).toBeInTheDocument()
    expect(api.calls).toHaveLength(0)

    fireEvent.change(field, { target: { value: 'k7q2-m4xw-zplr-5tbc-3nhd' } })
    fireEvent.click(screen.getByText(ar.certificates.verify.submit).closest('button')!)
    expect(await screen.findByText(ar.certificates.verify.valid)).toBeInTheDocument()
    await waitFor(() => expect(api.calls.map((call) => call.url)).toEqual([`/api/certificates/verify/${VERIFICATION_CODE}`]))
    // After a check the field offers another one.
    expect(screen.getByLabelText(ar.certificates.verify.checkAnother)).toHaveValue('')
  })
})
