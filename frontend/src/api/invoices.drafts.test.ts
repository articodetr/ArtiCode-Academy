import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { INVOICE_ID, PAYMENT_ID, makeInvoice, makePayment } from '../test/payments'
import { classInvoicesPath, createInvoice, deleteInvoice, issueClassInvoices, updateInvoice } from './invoices'
import { getPayment, listPayments } from './payments'

describe('draft invoices, the class batch and the payments list (API-146..153)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('sends the documented methods and paths', async () => {
    const fetchMock = mockFetch((url, init) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      if (url.includes('/classes/')) return jsonResponse(200, { created: [], skipped: [] })
      if (url.startsWith('/api/payments')) return jsonResponse(200, url.includes('?') ? { items: [makePayment()], nextCursor: null } : makePayment())
      return jsonResponse(200, makeInvoice())
    })
    await createInvoice({ studentId: 's', feePlanId: 'p' })
    await updateInvoice(INVOICE_ID, { notes: null })
    await deleteInvoice(INVOICE_ID)
    await issueClassInvoices('k-1', { feePlanId: 'p', issue: true })
    await listPayments({ status: 'completed', limit: 20 })
    await getPayment(PAYMENT_ID)
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET', init?.body ?? null])).toEqual([
      ['/api/invoices', 'POST', JSON.stringify({ studentId: 's', feePlanId: 'p' })],
      [`/api/invoices/${INVOICE_ID}`, 'PATCH', JSON.stringify({ notes: null })],
      [`/api/invoices/${INVOICE_ID}`, 'DELETE', null],
      [classInvoicesPath('k-1'), 'POST', JSON.stringify({ feePlanId: 'p', issue: true })],
      ['/api/payments?status=completed&limit=20', 'GET', null],
      [`/api/payments/${PAYMENT_ID}`, 'GET', null],
    ])
  })
})
