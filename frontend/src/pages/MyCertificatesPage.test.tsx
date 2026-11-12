import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MyCertificateList } from '../api/myCertificates'
import { ar } from '../i18n/ar'
import { CERTIFICATE_ID, CERTIFICATE_ID_2, makeRevokedCertificate } from '../test/certificates'
import { jsonResponse, mockFetch } from '../test/http'
import { CHILD_STUDENT, makeMyCertificate, makeMyCertificateList, toMyCertificate } from '../test/myCertificates'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { formatDateTime } from '../users/users.format'
import { MyCertificatesPage } from './MyCertificatesPage'

const own = makeMyCertificate()
const childRevoked = toMyCertificate(makeRevokedCertificate({ id: CERTIFICATE_ID_2, serial: 'CERT-2026-00002', student: { ...CHILD_STUDENT } }), 'child')

function mockMyCertificatesApi(answers: Array<MyCertificateList | Response>) {
  const urls: string[] = []
  mockFetch((url) => {
    const answer = answers[Math.min(urls.length, answers.length - 1)]!
    urls.push(url)
    return answer instanceof Response ? answer.clone() : jsonResponse(200, answer)
  })
  return { urls }
}

function renderPage(roles: string[], permissions: string[]) {
  return renderWithProviders(<MyCertificatesPage />, {
    auth: makeAuth({ user: makeUser({ role: roles.includes('guardian') ? 'guardian' : 'student', roles, permissions }) }),
    route: '/my-certificates',
  })
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

describe('MyCertificatesPage', () => {
  it('shows a student their certificates from GET /api/me/certificates: serial, status, course, class, grade, the issue date and a print link', async () => {
    const api = mockMyCertificatesApi([makeMyCertificateList([own])])
    renderPage(['student'], ['certificates.read_own'])

    expect(await screen.findByText('CERT-2026-00001')).toBeInTheDocument()
    expect(api.urls).toEqual(['/api/me/certificates'])
    const [row] = bodyRows()
    expect(within(row!).getByText(ar.certificates.status.issued)).toBeInTheDocument()
    expect(within(row!).getByText('أساسيات بايثون')).toBeInTheDocument()
    expect(within(row!).getByText('PY-101-A')).toBeInTheDocument()
    expect(within(row!).getByText('86.4%')).toBeInTheDocument()
    expect(within(row!).getByText(formatDateTime(own.issuedAt, 'ar'))).toBeInTheDocument()
    const print = within(row!).getByText(ar.certificates.drawer.print).closest('a') as HTMLElement
    expect(print).toHaveAttribute('href', `/my-certificates/${CERTIFICATE_ID}/print`)
    expect(print).toHaveAttribute('target', '_blank')
    // A student alone sees no student column and no student filter.
    expect(screen.queryByText(ar.myClasses.relation.self)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(ar.common.student)).not.toBeInTheDocument()
  })

  it('shows a guardian each certificate with its student and relation, a revoked one with its day only — never a reason — and filters by student', async () => {
    mockMyCertificatesApi([makeMyCertificateList([childRevoked, own])])
    renderPage(['guardian', 'student'], ['certificates.read_own', 'certificates.read_linked'])

    expect(await screen.findByText('CERT-2026-00002')).toBeInTheDocument()
    const rows = bodyRows()
    expect(within(rows[0]!).getByText('ليلى')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.myClasses.relation.child)).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.certificates.status.revoked)).toBeInTheDocument()
    expect(within(rows[0]!).getByText(`أُبطلت في ${formatDateTime(childRevoked.revokedAt, 'ar')}`)).toBeInTheDocument()
    expect(screen.queryByText('خطأ في رصد الدرجة')).not.toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.myClasses.relation.self)).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByLabelText(ar.common.student))
    fireEvent.click([...document.querySelectorAll('.ant-select-item-option-content')].find((node) => node.textContent?.startsWith('ليلى'))!)
    await waitFor(() => expect(bodyRows()).toHaveLength(1))
    expect(screen.getByText('CERT-2026-00002')).toBeInTheDocument()
    expect(screen.queryByText('CERT-2026-00001')).not.toBeInTheDocument()
  })

  it('says there is no certificate yet, and shows the server’s 403 to a learner holding neither key, with a retry', async () => {
    const api = mockMyCertificatesApi([
      jsonResponse(403, { statusCode: 403, code: 'permission_denied', missing: ['certificates.read_own', 'certificates.read_linked'], message: 'no' }),
      makeMyCertificateList([]),
    ])
    renderPage(['student'], [])

    expect(await screen.findByText('ليست لديك الصلاحية اللازمة لهذا الإجراء (certificates.read_own, certificates.read_linked)')).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.certificates.refresh, { selector: 'button span' }).closest('button')!)
    expect(await screen.findByText(ar.certificates.my.empty)).toBeInTheDocument()
    expect(api.urls).toHaveLength(2)
  })
})
