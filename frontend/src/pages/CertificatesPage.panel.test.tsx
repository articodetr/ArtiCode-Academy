import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { CERTIFICATE_ADMIN_PERMISSIONS, CERTIFICATE_ID_2, makeCertificate, makeCertificateList, makeRevokedCertificate } from '../test/certificates'
import { makeClass, makeClassList } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { CertificatesPage } from './CertificatesPage'

// Redesign (2026-11-14): on a wide screen a certificate opens in a side panel beside the table, not over it.
const issued = makeCertificate()
const revoked = makeRevokedCertificate({ id: CERTIFICATE_ID_2, serial: 'CERT-2026-00002' })

function mockApi() {
  mockFetch((url) => {
    const path = new URL(url, 'http://localhost').pathname
    if (path === '/api/certificates') return jsonResponse(200, makeCertificateList([issued, revoked]))
    if (path.startsWith('/api/certificates/')) return jsonResponse(200, path.endsWith(CERTIFICATE_ID_2) ? revoked : issued)
    if (path === '/api/classes') return jsonResponse(200, makeClassList([makeClass()]))
    if (path === '/api/courses' || path === '/api/users') return jsonResponse(200, { items: [], nextCursor: null })
    return jsonResponse(404, { statusCode: 404, message: 'unexpected' })
  })
}

/** A window wide enough for the docked panel: only that one media query matches. */
function wideScreen() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1360px)',
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

const drawerTitle = () => document.querySelector('.record-drawer--docked .ant-drawer-title')

describe('CertificatesPage — the side panel on a wide screen (redesign)', () => {
  beforeEach(() => {
    wideScreen()
    mockApi()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens a certificate inside the panel beside the table, without a mask, keeps three columns, and switches on another row', async () => {
    renderWithProviders(<CertificatesPage />, { auth: makeAuth({ user: makeUser({ permissions: CERTIFICATE_ADMIN_PERMISSIONS }) }), route: '/certificates' })

    fireEvent.click(await screen.findByText('CERT-2026-00001'))
    await waitFor(() => expect(drawerTitle()).toHaveTextContent('CERT-2026-00001'))
    const panel = document.querySelector('.list-panel') as HTMLElement
    expect(panel.querySelector('.ant-drawer')).not.toBeNull()
    expect(document.querySelector('.ant-drawer-mask')).toBeNull()
    expect(document.querySelector('.list-with-panel--open')).not.toBeNull()
    const headers = within(screen.getAllByRole('table')[0]!).getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual([ar.certificates.columns.serial, ar.common.student, ar.common.status])

    fireEvent.click(within(screen.getAllByRole('table')[0]!).getByText('CERT-2026-00002'))
    await waitFor(() => expect(drawerTitle()).toHaveTextContent('CERT-2026-00002'))
  })
})
