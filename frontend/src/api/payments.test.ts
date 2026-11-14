import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { INVOICE_ID, PAYMENT_ID, makePayment } from '../test/payments'
import { invoicePaymentsPath, recordPayment, reversePayment, reversePaymentPath } from './payments'

describe('payments API (API-151/154)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the paths', () => {
    expect(invoicePaymentsPath('a/b')).toBe('/api/invoices/a%2Fb/payments')
    expect(reversePaymentPath(PAYMENT_ID)).toBe(`/api/payments/${PAYMENT_ID}/reverse`)
  })

  it('records and reverses with the documented bodies', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, makePayment()))
    await recordPayment(INVOICE_ID, { amount: 250, method: 'cash' })
    await reversePayment(PAYMENT_ID, 'خطأ في المبلغ')
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      [`/api/invoices/${INVOICE_ID}/payments`, 'POST', JSON.stringify({ amount: 250, method: 'cash' })],
      [`/api/payments/${PAYMENT_ID}/reverse`, 'POST', JSON.stringify({ reason: 'خطأ في المبلغ' })],
    ])
  })
})
