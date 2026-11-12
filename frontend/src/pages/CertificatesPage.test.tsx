import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CertificateList } from '../api/certificates'
import { ar } from '../i18n/ar'
import { CERTIFICATE_ADMIN_PERMISSIONS, CERTIFICATE_ID, CERTIFICATE_ID_2, CERTIFICATE_READER_PERMISSIONS, makeCertificate, makeCertificateList, makeRevokedCertificate } from '../test/certificates'
import { makeClass, makeClassList } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { formatDateTime } from '../users/users.format'
import { CertificatesPage } from './CertificatesPage'

const issued = makeCertificate()
const revoked = makeRevokedCertificate({
  id: CERTIFICATE_ID_2,
  serial: 'CERT-2026-00002',
  student: { id: 'student-2', fullName: 'سارة علي', fullNameLatin: null, displayName: 'سارة' },
})

/** Serves the list (recording its queries), the pickers and the detail. */
function mockCertificatesApi(lists: Array<CertificateList | Response>) {
  const queries: URLSearchParams[] = []
  const paths: string[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    paths.push(`${method} ${parsed.pathname}`)
    if (parsed.pathname === '/api/certificates' && method === 'GET') {
      const answer = lists[Math.min(queries.length, lists.length - 1)]!
      queries.push(parsed.searchParams)
      return answer instanceof Response ? answer.clone() : jsonResponse(200, answer)
    }
    if (parsed.pathname.startsWith('/api/certificates/')) return jsonResponse(200, parsed.pathname.endsWith(CERTIFICATE_ID_2) ? revoked : issued)
    if (parsed.pathname === '/api/classes') return jsonResponse(200, makeClassList([makeClass()]))
    if (parsed.pathname === '/api/courses') return jsonResponse(200, { items: [], nextCursor: null })
    if (parsed.pathname === '/api/users') return jsonResponse(200, { items: [], nextCursor: null })
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${method} ${parsed.pathname}` })
  })
  return { queries, paths }
}

function renderPage(permissions: string[]) {
  return renderWithProviders(<CertificatesPage />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/certificates' })
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

describe('CertificatesPage', () => {
  it('lists GET /api/certificates newest first: serial, student, course, class, grade, status (with the day of a revocation) and the issue date', async () => {
    const api = mockCertificatesApi([makeCertificateList([issued, revoked])])
    renderPage(CERTIFICATE_ADMIN_PERMISSIONS)

    expect(await screen.findByText('CERT-2026-00001')).toBeInTheDocument()
    expect(Object.fromEntries(api.queries[0]!)).toEqual({ limit: '20' })
    const rows = bodyRows()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('عمر خالد')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Omar Khaled')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('أساسيات بايثون')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('PY-101-A')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('86.4%')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('جيد جداً (B)')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.certificates.status.issued)).toBeInTheDocument()
    expect(within(rows[0]!).getByText(formatDateTime(issued.issuedAt, 'ar'))).toBeInTheDocument()
    expect(within(rows[1]!).getByText('سارة')).toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.certificates.status.revoked)).toBeInTheDocument()
    expect(within(rows[1]!).getByText(formatDateTime(revoked.revokedAt, 'ar'))).toBeInTheDocument()
    // Each row prints in a new tab; certificates are issued from a class, never here.
    expect(within(rows[0]!).getByRole('link', { name: /CERT-2026-00001/ })).toHaveAttribute('href', `/certificates/${CERTIFICATE_ID}/print`)
    expect(screen.getByText(ar.certificates.issueHint)).toBeInTheDocument()
  })

  it('re-queries from the first page on the serial search (trimmed) and the status filter', async () => {
    const api = mockCertificatesApi([makeCertificateList([issued])])
    renderPage(CERTIFICATE_ADMIN_PERMISSIONS)
    await screen.findByText('CERT-2026-00001')

    const search = screen.getByLabelText(ar.certificates.filters.search)
    fireEvent.change(search, { target: { value: '  2026-0000 ' } })
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter', keyCode: 13 })
    await waitFor(() => expect(api.queries).toHaveLength(2))
    expect(Object.fromEntries(api.queries[1]!)).toEqual({ q: '2026-0000', limit: '20' })

    fireEvent.mouseDown(screen.getByLabelText(ar.common.status))
    fireEvent.click([...document.querySelectorAll('.ant-select-item-option-content')].find((node) => node.textContent === ar.certificates.status.revoked)!)
    await waitFor(() => expect(api.queries).toHaveLength(3))
    expect(Object.fromEntries(api.queries[2]!)).toEqual({ q: '2026-0000', status: 'revoked', limit: '20' })
  })

  it('follows the server’s cursor to the next page and back', async () => {
    const api = mockCertificatesApi([makeCertificateList([issued], 'cursor-2'), makeCertificateList([revoked]), makeCertificateList([issued], 'cursor-2')])
    renderPage(CERTIFICATE_ADMIN_PERMISSIONS)
    await screen.findByText('CERT-2026-00001')

    fireEvent.click(screen.getByText(ar.certificates.pagination.next).closest('button')!)
    expect(await screen.findByText('CERT-2026-00002')).toBeInTheDocument()
    expect(api.queries[1]!.get('cursor')).toBe('cursor-2')
    expect(screen.getByText('الصفحة 2')).toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.certificates.pagination.previous).closest('button')!)
    expect(await screen.findByText('CERT-2026-00001')).toBeInTheDocument()
    expect(api.queries[2]!.has('cursor')).toBe(false)
  })

  it('offers each picker only with the key its list needs, and says the list is empty — filtered or not', async () => {
    mockCertificatesApi([makeCertificateList([])])
    renderPage(CERTIFICATE_READER_PERMISSIONS)

    expect(await screen.findByText(ar.certificates.empty)).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.certificates.columns.class)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(ar.common.course)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(ar.common.student)).not.toBeInTheDocument()

    fireEvent.mouseDown(screen.getByLabelText(ar.common.status))
    fireEvent.click([...document.querySelectorAll('.ant-select-item-option-content')].find((node) => node.textContent === ar.certificates.status.issued)!)
    expect(await screen.findByText(ar.certificates.emptyFiltered)).toBeInTheDocument()
  })

  it('opens the drawer of a row (API-131)', async () => {
    const api = mockCertificatesApi([makeCertificateList([issued, revoked])])
    renderPage(CERTIFICATE_ADMIN_PERMISSIONS)
    await screen.findByText('CERT-2026-00002')

    fireEvent.click(within(bodyRows()[1]!).getByText('سارة'))
    expect(await screen.findByText('خطأ في رصد الدرجة')).toBeInTheDocument()
    expect(api.paths).toContain(`GET /api/certificates/${CERTIFICATE_ID_2}`)
  })

  it('shows a refused list by its code, and restarts from the first page after cursor_invalid', async () => {
    const api = mockCertificatesApi([
      jsonResponse(400, { statusCode: 400, code: 'cursor_invalid', message: 'bad cursor' }),
      makeCertificateList([issued]),
    ])
    renderPage(CERTIFICATE_ADMIN_PERMISSIONS)

    expect(await screen.findByText(ar.certificates.errors.cursor_invalid)).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.certificates.refresh, { selector: 'button span' }).closest('button')!)
    expect(await screen.findByText('CERT-2026-00001')).toBeInTheDocument()
    expect(api.queries[1]!.has('cursor')).toBe(false)
  })
})
