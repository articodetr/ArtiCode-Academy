import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { CLASS_ID } from '../test/classes'
import { STUDENT_IDS } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeChildInvoice, makeMyInvoice, makeMyInvoiceList } from '../test/myInvoices'
import { listMyInvoices, myInvoicesPath } from './myInvoices'

describe('«my invoices» API (API-155)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the path with the given filters only, in a fixed order', () => {
    expect(myInvoicesPath()).toBe('/api/me/invoices')
    expect(myInvoicesPath({ status: 'cancelled', classId: CLASS_ID, studentId: STUDENT_IDS[1] })).toBe(`/api/me/invoices?studentId=${STUDENT_IDS[1]}&classId=${CLASS_ID}&status=cancelled`)
  })

  it('reads the owner projection: no note, issuer or plan, completed receipts only, the relation', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, makeMyInvoiceList([makeMyInvoice(), makeChildInvoice()])))
    const controller = new AbortController()
    const list = await listMyInvoices({}, controller.signal)
    const [own, child] = list.items
    expect(own).not.toHaveProperty('notes')
    expect(own).not.toHaveProperty('issuedBy')
    expect(own).not.toHaveProperty('feePlan')
    expect(own?.payments.map((payment) => payment.number)).toEqual(['RCPT-2026-00031'])
    expect(Object.keys(own?.payments[0] ?? {}).sort()).toEqual(['amount', 'id', 'method', 'number', 'paidAt', 'payerName', 'reference'])
    expect(own?.relation).toBe('self')
    expect(child?.relation).toBe('child')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/me/invoices')
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
  })

  it('surfaces the 403 of a caller holding neither key, with both keys named', async () => {
    mockFetch(() => jsonResponse(403, { statusCode: 403, error: 'Forbidden', code: 'permission_denied', message: 'no', missing: ['invoices.read_own', 'invoices.read_linked'] }))
    await expect(listMyInvoices()).rejects.toMatchObject({ status: 403, code: 'permission_denied', body: { missing: ['invoices.read_own', 'invoices.read_linked'] } })
  })
})
