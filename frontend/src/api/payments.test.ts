import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { STUDENT_IDS } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { INVOICE_IDS, INVOICE_PAYMENT_IDS } from '../test/invoices'
import { makePayment, makePaymentList, makeReversedPayment } from '../test/payments'
import { getPayment, listPayments, paymentsPath, recordPayment, reversePayment } from './payments'

describe('payments API (API-151..API-154)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the list path in a fixed order with the receipt search trimmed', () => {
    expect(paymentsPath()).toBe('/api/payments')
    expect(
      paymentsPath({
        q: ' RCPT ',
        method: 'cash',
        status: 'completed',
        studentId: STUDENT_IDS[0],
        invoiceId: INVOICE_IDS[0],
        from: '2026-10-31T21:00:00.000Z',
        to: '2026-11-30T21:00:00.000Z',
        limit: 50,
        cursor: 'c2',
      }),
    ).toBe(
      `/api/payments?invoiceId=${INVOICE_IDS[0]}&studentId=${STUDENT_IDS[0]}&method=cash&status=completed&from=2026-10-31T21%3A00%3A00.000Z&to=2026-11-30T21%3A00%3A00.000Z&q=RCPT&limit=50&cursor=c2`,
    )
  })

  it('records a payment on its invoice and reverses one with the documented bodies; reads the list and a receipt', async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === '/api/payments') return jsonResponse(200, makePaymentList([makePayment()]))
      if (url.endsWith('/reverse')) return jsonResponse(200, makeReversedPayment())
      return jsonResponse(init?.method === 'POST' ? 201 : 200, makePayment())
    })
    const recorded = await recordPayment(INVOICE_IDS[0], { amount: 600, method: 'cash', paidAt: '2026-11-11T05:00:00.000Z', payerName: 'خالد عمر' })
    expect(recorded.number).toBe('RCPT-2026-00031')
    expect(recorded.invoice.balance).toBe(600)
    await reversePayment(INVOICE_PAYMENT_IDS[1], { reason: 'تحويل مكرر' })
    await listPayments()
    await getPayment(INVOICE_PAYMENT_IDS[0])
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      [`/api/invoices/${INVOICE_IDS[0]}/payments`, 'POST', JSON.stringify({ amount: 600, method: 'cash', paidAt: '2026-11-11T05:00:00.000Z', payerName: 'خالد عمر' })],
      [`/api/payments/${INVOICE_PAYMENT_IDS[1]}/reverse`, 'POST', JSON.stringify({ reason: 'تحويل مكرر' })],
      ['/api/payments', 'GET', undefined],
      [`/api/payments/${INVOICE_PAYMENT_IDS[0]}`, 'GET', undefined],
    ])
  })

  it('surfaces the balance the server names when a payment exceeds it', async () => {
    mockFetch(() => jsonResponse(409, { statusCode: 409, error: 'Conflict', code: 'payment_exceeds_balance', message: 'above', amount: 200.01, balance: 200 }))
    await expect(recordPayment(INVOICE_IDS[0], { amount: 200.01, method: 'cash' })).rejects.toMatchObject({ status: 409, code: 'payment_exceeds_balance', body: { amount: 200.01, balance: 200 } })
  })
})
