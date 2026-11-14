import { describe, expect, it } from 'vitest'
import { paymentsListPath } from '../api/payments'
import { paymentsQuery } from './usePaymentsList'

describe('recorded payments query (API-152)', () => {
  it('turns the filters into the query, days as instants in the academy zone with an exclusive end', () => {
    const query = paymentsQuery({ q: 'RCPT-1', method: 'cash', status: 'reversed', fromDay: '2026-11-01', toDay: '2026-11-30', timeZone: 'Asia/Riyadh', limit: 20 })
    expect(query).toEqual({ limit: 20, q: 'RCPT-1', method: 'cash', status: 'reversed', from: '2026-10-31T21:00:00.000Z', to: '2026-11-30T21:00:00.000Z' })
    expect(paymentsListPath(query)).toBe('/api/payments?method=cash&status=reversed&from=2026-10-31T21%3A00%3A00.000Z&to=2026-11-30T21%3A00%3A00.000Z&q=RCPT-1&limit=20')
  })

  it('drops a malformed day', () => {
    expect(paymentsQuery({ fromDay: '2026-13-40', timeZone: 'UTC', limit: 50 })).toEqual({ limit: 50 })
  })
})
