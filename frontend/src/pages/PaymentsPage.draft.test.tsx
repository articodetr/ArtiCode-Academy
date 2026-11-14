// A draft in the invoice drawer: «edit» (API-147, the smallest PATCH) holds
// unsaved work, so switching to another row on a wide screen asks first;
// «delete» (API-148) asks, then drops the row.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { FINANCE_MANAGER_PERMISSIONS, makeInvoice, makeInvoiceSummary } from '../test/payments'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { PaymentsPage } from './PaymentsPage'

const draftFields = { status: 'draft' as const, number: null, paid: 0, balance: 1200, payments: [], notes: null }
const draft = makeInvoiceSummary({ id: 'd-1', ...draftFields, student: { id: 's-1', fullName: 'مسودة سارة', displayName: null } })
const other = makeInvoiceSummary({ id: 'i-2', number: 'INV-2026-00002' })

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

describe('PaymentsPage — a draft in the invoice drawer', () => {
  let writes: { method: string; path: string; body: unknown }[]
  beforeEach(() => {
    wideScreen()
    writes = []
    mockFetch((url, init) => {
      const path = new URL(url, 'http://localhost').pathname
      const method = init?.method ?? 'GET'
      if (method !== 'GET') writes.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (path === '/api/academy') return jsonResponse(200, makeAcademy())
      if (path === '/api/invoices') return jsonResponse(200, { items: [draft, other], nextCursor: null })
      if (path === '/api/invoices/d-1' && method === 'DELETE') return new Response(null, { status: 204 })
      if (path === '/api/invoices/d-1') return jsonResponse(200, makeInvoice({ id: 'd-1', ...draftFields, installments: [{ seq: 1, amount: 1200, dueOn: '2026-12-01', paid: 0, remaining: 1200, status: 'unpaid', overdue: false }] }))
      if (path === '/api/invoices/i-2') return jsonResponse(200, makeInvoice({ id: 'i-2', number: 'INV-2026-00002' }))
      return jsonResponse(404, { statusCode: 404, message: 'unexpected' })
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderPage() {
    renderWithProviders(<PaymentsPage />, { auth: makeAuth({ user: makeUser({ permissions: FINANCE_MANAGER_PERMISSIONS, roles: ['staff'] }) }), route: '/payments' })
  }

  it('asks before switching rows while the edit form holds a change, and sends only that change', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('مسودة سارة'))
    const drawer = () => document.querySelector('.record-drawer--docked') as HTMLElement
    fireEvent.click((await within(document.body).findByText(ar.common.edit)).closest('button')!)
    const notes = await within(drawer()).findByLabelText(ar.payments.record.notes)
    fireEvent.change(notes, { target: { value: 'ملاحظة جديدة' } })

    fireEvent.click(within(screen.getAllByRole('table')[0]!).getByText('INV-2026-00002'))
    expect((await screen.findAllByText(ar.common.unsaved.title)).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText(ar.common.unsaved.cancel).closest('button')!)

    fireEvent.click(within(drawer()).getByText(ar.common.save).closest('button')!)
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toEqual({ method: 'PATCH', path: '/api/invoices/d-1', body: { notes: 'ملاحظة جديدة' } })
  })

  it('deletes a draft after a confirmation and drops its row', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('مسودة سارة'))
    fireEvent.click((await screen.findByLabelText(ar.payments.draft.delete.action)).closest('button')!)
    const confirm = (await screen.findAllByText(ar.payments.draft.delete.title))[0]!.closest('.ant-modal') as HTMLElement
    fireEvent.click(within(confirm).getByText(ar.payments.draft.delete.ok).closest('button')!)
    await waitFor(() => expect(writes).toEqual([{ method: 'DELETE', path: '/api/invoices/d-1', body: undefined }]))
    await waitFor(() => expect(screen.queryByText('مسودة سارة')).toBeNull())
  })
})
