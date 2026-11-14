import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Certificate } from '../api/certificates'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { CERTIFICATE_ID, CERTIFICATE_ID_2, makeCertificate, makeRevokedCertificate } from '../test/certificates'
import { jsonResponse, mockFetch } from '../test/http'
import { makeMyCertificate, makeMyCertificateList, toMyCertificate } from '../test/myCertificates'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { CertificatePrintPage } from './CertificatePrintPage'

/** Issued on 31 December 2026 at 10:30 UTC — already 1 January 2027 in the academy's zone (UTC+14, so no device zone matches it by chance), as its serial says. */
const newYear = makeCertificate({
  serial: 'CERT-2027-00001',
  issuedAt: '2026-12-31T10:30:00.000Z',
  snapshot: { ...makeCertificate().snapshot, completedAt: '2026-12-30T12:00:00.000Z', issuedAt: '2026-12-31T10:30:00.000Z' },
})

const ACADEMY_ZONE = 'Pacific/Kiritimati'

function mockPrintApi({ certificate, my }: { certificate?: Certificate | Response; my?: ReturnType<typeof makeMyCertificateList> }) {
  const paths: string[] = []
  mockFetch((url) => {
    paths.push(url)
    if (url === '/api/academy') return jsonResponse(200, makeAcademy({ timezone: ACADEMY_ZONE }))
    if (url === '/api/me/certificates') return jsonResponse(200, my ?? makeMyCertificateList([]))
    if (url.startsWith('/api/certificates/')) return certificate instanceof Response ? certificate : jsonResponse(200, certificate ?? newYear)
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })
  })
  return { paths }
}

function renderPrint(source: 'academy' | 'own', id = CERTIFICATE_ID) {
  const base = source === 'academy' ? '/certificates' : '/my-certificates'
  return renderWithProviders(<CertificatePrintPage source={source} />, {
    auth: makeAuth({ user: makeUser({ permissions: source === 'academy' ? ['certificates.issue'] : ['certificates.read_own'] }) }),
    route: `${base}/${id}/print`,
    path: `${base}/:id/print`,
  })
}

describe('CertificatePrintPage', () => {
  it('builds the certificate from the snapshot of API-131 — names, course, class, grade, days in the academy’s zone, serial and verification — and prints it', async () => {
    const api = mockPrintApi({})
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    renderPrint('academy')

    const sheet = await screen.findByTestId('certificate-sheet')
    expect(api.paths).toContain(`/api/certificates/${CERTIFICATE_ID}`)
    expect(sheet).toHaveAttribute('dir', 'rtl')
    expect(within(sheet).getByText(ar.certificates.sheet.title)).toBeInTheDocument()
    expect(within(sheet).getByText('تمنح أكاديمية آرتي كود هذه الشهادة إلى')).toBeInTheDocument()
    expect(within(sheet).getByText('عمر خالد')).toBeInTheDocument()
    expect(within(sheet).getByText(/أساسيات بايثون/)).toBeInTheDocument()
    expect(within(sheet).getByText(/ضمن الفصل بايثون — الفصل أ/)).toBeInTheDocument()
    expect(within(sheet).getByText(/بتقدير جيد جداً \(B\)/)).toBeInTheDocument()
    expect(within(sheet).getByText('86.4%')).toBeInTheDocument()
    // The academy's days (UTC+14), not this device's nor UTC's: the issue day matches the year of the serial.
    expect(within(sheet).getByText('1 يناير 2027')).toBeInTheDocument()
    expect(within(sheet).getByText('31 ديسمبر 2026')).toBeInTheDocument()
    expect(within(sheet).getByText('CERT-2027-00001')).toBeInTheDocument()
    // The verification page is a QR code now (redesign); the link itself is not printed, the code is.
    const qr = within(sheet).getByTestId('certificate-qr')
    expect(qr.tagName.toLowerCase()).toBe('svg')
    expect(within(qr).getByText(ar.certificates.sheet.qrLabel)).toBeInTheDocument()
    expect(within(sheet).queryByText(/\/verify\//)).not.toBeInTheDocument()
    expect(within(sheet).getByText('K7Q2-M4XW-ZPLR-5TBC-3NHD')).toBeInTheDocument()
    expect(screen.queryByTestId('certificate-revoked-mark')).not.toBeInTheDocument()
    expect(screen.getByText(ar.certificates.print.back).closest('a')).toHaveAttribute('href', '/certificates')

    fireEvent.click(screen.getByText(ar.certificates.print.print).closest('button')!)
    expect(print).toHaveBeenCalledTimes(1)
  })

  it('prints in the language chosen for the certificate, whatever the language of the app', async () => {
    mockPrintApi({})
    renderPrint('academy')
    await screen.findByTestId('certificate-sheet')

    fireEvent.click(screen.getByText('English'))
    const sheet = await screen.findByText('Certificate of Completion')
    const article = sheet.closest('article') as HTMLElement
    expect(article).toHaveAttribute('dir', 'ltr')
    expect(article).toHaveAttribute('lang', 'en')
    expect(within(article).getByText('ArtiCode Academy awards this certificate to')).toBeInTheDocument()
    expect(within(article).getByText('Omar Khaled')).toBeInTheDocument()
    expect(within(article).getByText(/Python Basics/)).toBeInTheDocument()
    expect(within(article).getByText('1 January 2027')).toBeInTheDocument()
    // The page around it stays in the app's language.
    expect(screen.getByText(ar.certificates.print.print)).toBeInTheDocument()
  })

  it('marks a revoked certificate and names the day of the revocation above it — never the reason', async () => {
    mockPrintApi({ certificate: makeRevokedCertificate() })
    renderPrint('academy')

    expect(await screen.findByTestId('certificate-revoked-mark')).toHaveTextContent(ar.certificates.sheet.revokedMark)
    // Revoked on 28 December 10:00 UTC: already the 29th in the academy's zone.
    expect(screen.getByText('أُبطلت هذه الشهادة في 29 ديسمبر 2026 ولم تعد صالحة؛ تُطبع عليها علامة الإبطال.')).toBeInTheDocument()
    expect(screen.queryByText('خطأ في رصد الدرجة')).not.toBeInTheDocument()
  })

  it('prints one’s own certificate from API-135, and says so when the id is not among one’s certificates', async () => {
    const api = mockPrintApi({ my: makeMyCertificateList([toMyCertificate(newYear)]) })
    const { unmount } = renderPrint('own')

    expect(await screen.findByText('CERT-2027-00001')).toBeInTheDocument()
    expect(api.paths).toContain('/api/me/certificates')
    expect(api.paths.some((path) => path.startsWith('/api/certificates/'))).toBe(false)
    expect(screen.getByText(ar.certificates.print.backOwn).closest('a')).toHaveAttribute('href', '/my-certificates')
    unmount()

    mockPrintApi({ my: makeMyCertificateList([makeMyCertificate()]) })
    renderPrint('own', CERTIFICATE_ID_2)
    expect(await screen.findByText(ar.certificates.print.notFound)).toBeInTheDocument()
    expect(screen.getByText(ar.certificates.print.print).closest('button')).toBeDisabled()
  })

  it('says why the certificate could not be read (API-131 404)', async () => {
    mockPrintApi({ certificate: jsonResponse(404, { statusCode: 404, code: 'certificate_not_found', message: 'none' }) })
    renderPrint('academy')
    expect(await screen.findByText(ar.certificates.errors.certificate_not_found)).toBeInTheDocument()
    expect(screen.queryByTestId('certificate-sheet')).not.toBeInTheDocument()
  })
})
