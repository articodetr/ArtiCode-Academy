import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Certificate } from '../api/certificates'
import { ar } from '../i18n/ar'
import { CERTIFICATE_ADMIN_PERMISSIONS, CERTIFICATE_ID, CERTIFICATE_STAFF_PERMISSIONS, makeCertificate, makeRevokedCertificate } from '../test/certificates'
import { waitForDrawersToSettle } from '../test/drawer'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { formatDateTime } from '../users/users.format'
import { CertificateDrawer } from './CertificateDrawer'

interface Options {
  details?: Array<Certificate | Response>
  revoke?: Response
}

/** Serves API-131 (one answer per read, the last one repeated) and records the revocations. */
function mockCertificateApi({ details = [makeCertificate()], revoke }: Options = {}) {
  const revocations: unknown[] = []
  let reads = 0
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    if (url === `/api/certificates/${CERTIFICATE_ID}` && method === 'GET') {
      const answer = details[Math.min(reads, details.length - 1)]!
      reads += 1
      return answer instanceof Response ? answer.clone() : jsonResponse(200, answer)
    }
    if (url === `/api/certificates/${CERTIFICATE_ID}/revoke` && method === 'POST') {
      revocations.push(JSON.parse(String(init?.body)))
      return revoke ?? jsonResponse(200, makeRevokedCertificate({ revokeReason: 'خطأ في رصد الدرجة' }))
    }
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${method} ${url}` })
  })
  return { revocations, reads: () => reads }
}

function renderDrawer(permissions: string[]) {
  const onUpdated = vi.fn()
  const onClose = vi.fn()
  renderWithProviders(<CertificateDrawer certificateId={CERTIFICATE_ID} onClose={onClose} onUpdated={onUpdated} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
    route: '/certificates',
  })
  return { onUpdated, onClose }
}

function revokeDialog(): HTMLElement {
  return screen.getByText(ar.certificates.revoke.intro).closest('[role="dialog"]') as HTMLElement
}

describe('CertificateDrawer', () => {
  it('shows what the certificate says — the snapshot — with its serial, verification link, issuance and print link', async () => {
    mockCertificateApi({
      details: [
        makeCertificate({
          // The course was renamed after the issuance: the printed name stays, the current one shows beneath it.
          course: { id: 'course-1', code: 'PY-101', name: { ar: 'بايثون للمبتدئين' } },
        }),
      ],
    })
    renderDrawer(CERTIFICATE_STAFF_PERMISSIONS)

    expect((await screen.findAllByText('CERT-2026-00001')).length).toBeGreaterThan(0)
    expect(screen.getByText(ar.certificates.status.issued)).toBeInTheDocument()
    expect(screen.getByText('عمر خالد')).toBeInTheDocument()
    expect(screen.getByText('Omar Khaled')).toBeInTheDocument()
    expect(screen.getByText('أساسيات بايثون')).toBeInTheDocument()
    expect(screen.getByText('الاسم الحالي: بايثون للمبتدئين')).toBeInTheDocument()
    expect(screen.getByText('86.4% — جيد جداً (B)')).toBeInTheDocument()
    expect(screen.getByText('أكاديمية آرتي كود')).toBeInTheDocument()
    expect(screen.getByText('بواسطة هند الموظفة')).toBeInTheDocument()
    expect(screen.getByText('K7Q2-M4XW-ZPLR-5TBC-3NHD')).toBeInTheDocument()
    expect(screen.getByText(`${window.location.origin}/verify/K7Q2M4XWZPLR5TBC3NHD`)).toBeInTheDocument()
    const print = screen.getByText(ar.certificates.drawer.print).closest('a') as HTMLElement
    expect(print).toHaveAttribute('href', `/certificates/${CERTIFICATE_ID}/print`)
    expect(print).toHaveAttribute('target', '_blank')
    // Staff issue but never revoke (certificates.revoke is the admin's).
    expect(screen.queryByText(ar.certificates.drawer.revoke)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.certificates.drawer.revokeReason)).not.toBeInTheDocument()
  })

  it('shows a revoked certificate with when, by whom and why it was revoked, and offers no revocation', async () => {
    const revoked = makeRevokedCertificate()
    mockCertificateApi({ details: [revoked] })
    renderDrawer(CERTIFICATE_ADMIN_PERMISSIONS)

    expect(await screen.findByText(ar.certificates.status.revoked)).toBeInTheDocument()
    expect(screen.getByText(`أُبطلت هذه الشهادة في ${formatDateTime(revoked.revokedAt, 'ar')} ولم تعد صالحة.`)).toBeInTheDocument()
    expect(screen.getByText('بواسطة مدير الأكاديمية')).toBeInTheDocument()
    expect(screen.getByText('خطأ في رصد الدرجة')).toBeInTheDocument()
    expect(screen.queryByText(ar.certificates.drawer.revoke)).not.toBeInTheDocument()
  })

  it('revokes with a required, trimmed reason and shows the server’s answer in the drawer and the list row', async () => {
    const api = mockCertificateApi()
    const { onUpdated } = renderDrawer(CERTIFICATE_ADMIN_PERMISSIONS)
    await screen.findByText('عمر خالد')
    await waitForDrawersToSettle()

    fireEvent.click(screen.getByText(ar.certificates.drawer.revoke).closest('button')!)
    const dialog = revokeDialog()
    fireEvent.click(within(dialog).getByText(ar.certificates.revoke.submit).closest('button')!)
    expect(await within(dialog).findByText(ar.certificates.revoke.reasonRequired)).toBeInTheDocument()
    expect(api.revocations).toEqual([])

    fireEvent.change(within(dialog).getByLabelText(ar.certificates.revoke.reason), { target: { value: '  خطأ في رصد الدرجة  ' } })
    fireEvent.click(within(dialog).getByText(ar.certificates.revoke.submit).closest('button')!)

    await waitFor(() => expect(api.revocations).toEqual([{ reason: 'خطأ في رصد الدرجة' }]))
    expect(await screen.findByText('أُبطلت الشهادة CERT-2026-00001')).toBeInTheDocument()
    expect(await screen.findByText(ar.certificates.status.revoked)).toBeInTheDocument()
    expect(screen.getByText('خطأ في رصد الدرجة')).toBeInTheDocument()
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: CERTIFICATE_ID, status: 'revoked' }))
    expect(screen.queryByText(ar.certificates.revoke.intro)).not.toBeInTheDocument()
  })

  // One question per test: jsdom never ends the closing animation of an answered confirm, so it stays in the DOM.
  it('asks before dropping a typed reason, and keeps the dialog and the reason on «keep writing»', async () => {
    const api = mockCertificateApi()
    renderDrawer(CERTIFICATE_ADMIN_PERMISSIONS)
    await screen.findByText('عمر خالد')
    await waitForDrawersToSettle()

    fireEvent.click(screen.getByText(ar.certificates.drawer.revoke).closest('button')!)
    fireEvent.change(within(revokeDialog()).getByLabelText(ar.certificates.revoke.reason), { target: { value: 'سبب' } })
    fireEvent.click(within(revokeDialog()).getByText(ar.common.cancel).closest('button')!)

    const question = (await screen.findByText(ar.certificates.revoke.discard.content)).closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(question).getByText(ar.certificates.revoke.discard.cancel).closest('button')!)
    expect(within(revokeDialog()).getByLabelText(ar.certificates.revoke.reason)).toHaveValue('سبب')
    expect(api.revocations).toEqual([])
  })

  it('drops the typed reason on «discard and close» without revoking; a dialog without a reason closes at once', async () => {
    const api = mockCertificateApi()
    renderDrawer(CERTIFICATE_ADMIN_PERMISSIONS)
    await screen.findByText('عمر خالد')
    await waitForDrawersToSettle()

    fireEvent.click(screen.getByText(ar.certificates.drawer.revoke).closest('button')!)
    fireEvent.click(within(revokeDialog()).getByText(ar.common.cancel).closest('button')!)
    await waitFor(() => expect(screen.queryByText(ar.certificates.revoke.intro)).not.toBeInTheDocument())
    expect(screen.queryByText(ar.certificates.revoke.discard.content)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.certificates.drawer.revoke).closest('button')!)
    fireEvent.change(within(revokeDialog()).getByLabelText(ar.certificates.revoke.reason), { target: { value: 'سبب' } })
    fireEvent.click(within(revokeDialog()).getByText(ar.common.cancel).closest('button')!)
    const question = (await screen.findByText(ar.certificates.revoke.discard.content)).closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(question).getByText(ar.certificates.revoke.discard.ok).closest('button')!)
    await waitFor(() => expect(screen.queryByText(ar.certificates.revoke.intro)).not.toBeInTheDocument())
    expect(api.revocations).toEqual([])
  })

  it('reads the certificate again when it was revoked meanwhile (409 certificate_revoked), and hands the re-read to the list', async () => {
    const api = mockCertificateApi({
      details: [makeCertificate(), makeRevokedCertificate({ revokeReason: 'سبب آخر' })],
      revoke: jsonResponse(409, { statusCode: 409, code: 'certificate_revoked', certificateId: CERTIFICATE_ID, revokedAt: '2026-12-28T10:00:00.000Z', message: 'revoked' }),
    })
    const { onUpdated } = renderDrawer(CERTIFICATE_ADMIN_PERMISSIONS)
    await screen.findByText('عمر خالد')
    await waitForDrawersToSettle()

    fireEvent.click(screen.getByText(ar.certificates.drawer.revoke).closest('button')!)
    fireEvent.change(within(revokeDialog()).getByLabelText(ar.certificates.revoke.reason), { target: { value: 'خطأ' } })
    fireEvent.click(within(revokeDialog()).getByText(ar.certificates.revoke.submit).closest('button')!)

    expect(await screen.findByText(ar.certificates.errors.certificate_revoked)).toBeInTheDocument()
    expect(await screen.findByText('سبب آخر')).toBeInTheDocument()
    expect(api.reads()).toBe(2)
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'revoked', revokeReason: 'سبب آخر' }))
  })

  it('keeps the dialog and the reason when the revocation fails for a retryable reason', async () => {
    mockCertificateApi({ revoke: jsonResponse(503, { statusCode: 503, message: 'down' }) })
    renderDrawer(CERTIFICATE_ADMIN_PERMISSIONS)
    await screen.findByText('عمر خالد')
    await waitForDrawersToSettle()

    fireEvent.click(screen.getByText(ar.certificates.drawer.revoke).closest('button')!)
    fireEvent.change(within(revokeDialog()).getByLabelText(ar.certificates.revoke.reason), { target: { value: 'خطأ' } })
    fireEvent.click(within(revokeDialog()).getByText(ar.certificates.revoke.submit).closest('button')!)

    expect(await within(revokeDialog()).findByText(ar.login.errors.server)).toBeInTheDocument()
    expect(within(revokeDialog()).getByLabelText(ar.certificates.revoke.reason)).toHaveValue('خطأ')
  })

  it('says the certificate does not exist when the server answers 404', async () => {
    mockCertificateApi({ details: [jsonResponse(404, { statusCode: 404, code: 'certificate_not_found', message: 'none' })] })
    renderDrawer(CERTIFICATE_ADMIN_PERMISSIONS)
    expect(await screen.findByText(ar.certificates.errors.certificate_not_found)).toBeInTheDocument()
  })
})
