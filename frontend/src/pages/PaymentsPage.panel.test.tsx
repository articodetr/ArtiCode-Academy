import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { CASHIER_PERMISSIONS, makeInvoice, makeInvoiceSummary } from '../test/payments'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { PaymentsPage } from './PaymentsPage'

const first = makeInvoiceSummary({ id: 'i-a', number: 'INV-2026-00001' })
const second = makeInvoiceSummary({ id: 'i-b', number: 'INV-2026-00002' })

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

describe('PaymentsPage — the side panel on a wide screen', () => {
  beforeEach(() => {
    wideScreen()
    mockFetch((url) => {
      const path = new URL(url, 'http://localhost').pathname
      if (path === '/api/academy') return jsonResponse(200, makeAcademy())
      if (path === '/api/invoices') return jsonResponse(200, { items: [first, second], nextCursor: null })
      if (path === '/api/invoices/i-a') return jsonResponse(200, makeInvoice({ id: 'i-a', number: 'INV-2026-00001' }))
      if (path === '/api/invoices/i-b') return jsonResponse(200, makeInvoice({ id: 'i-b', number: 'INV-2026-00002' }))
      return jsonResponse(404, { statusCode: 404, message: 'unexpected' })
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens an invoice inside the panel without a mask, keeps four columns, and switches invoice on another row', async () => {
    renderWithProviders(<PaymentsPage />, { auth: makeAuth({ user: makeUser({ permissions: CASHIER_PERMISSIONS, roles: ['staff'] }) }), route: '/payments' })

    fireEvent.click(await screen.findByText('INV-2026-00001'))
    await waitFor(() => expect(drawerTitle()).toHaveTextContent('INV-2026-00001'))
    expect(document.querySelector('.list-panel .ant-drawer')).not.toBeNull()
    expect(document.querySelector('.ant-drawer-mask')).toBeNull()
    const headers = within(screen.getAllByRole('table')[0]!).getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual([ar.payments.columns.number, ar.common.student, ar.payments.columns.balance, ar.common.status])

    fireEvent.click(within(screen.getAllByRole('table')[0]!).getByText('INV-2026-00002'))
    await waitFor(() => expect(drawerTitle()).toHaveTextContent('INV-2026-00002'))
  })
})
