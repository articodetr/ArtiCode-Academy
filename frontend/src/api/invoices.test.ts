import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { INVOICE_ID, makeInvoice } from '../test/payments'
import { changeInvoiceStatus, getInvoice, invoicesListPath, listMyInvoices, myInvoicesPath } from './invoices'

describe('invoices API (API-144/145/149/155)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the list path with the non-empty parameters only, in a fixed order', () => {
    expect(invoicesListPath()).toBe('/api/invoices')
    expect(invoicesListPath({ q: '  ', status: undefined, studentId: '' })).toBe('/api/invoices')
    expect(invoicesListPath({ studentId: 's-1', classId: 'c-1', status: 'issued', balance: 'partial', overdue: true, q: ' INV-26 ', limit: 20, cursor: 'a%b' })).toBe(
      '/api/invoices?studentId=s-1&classId=c-1&status=issued&balance=partial&overdue=true&q=INV-26&limit=20&cursor=a%25b',
    )
  })

  it('builds the «my invoices» path', () => {
    expect(myInvoicesPath()).toBe('/api/me/invoices')
    expect(myInvoicesPath({ studentId: 's-1', status: 'issued' })).toBe('/api/me/invoices?studentId=s-1&status=issued')
  })

  it('reads with the Bearer token and posts the status action', async () => {
    const fetchMock = mockFetch((url) => jsonResponse(200, url.includes('/me/') ? { items: [] } : makeInvoice()))
    await getInvoice(INVOICE_ID)
    await listMyInvoices()
    await changeInvoiceStatus(INVOICE_ID, { action: 'cancel', reason: 'خطأ' })
    const calls = fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET', init?.body])
    expect(calls).toEqual([
      [`/api/invoices/${INVOICE_ID}`, 'GET', undefined],
      ['/api/me/invoices', 'GET', undefined],
      [`/api/invoices/${INVOICE_ID}/status`, 'POST', JSON.stringify({ action: 'cancel', reason: 'خطأ' })],
    ])
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('Authorization')).toBe('Bearer access-1')
  })
})
