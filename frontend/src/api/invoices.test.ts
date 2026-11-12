import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { CLASS_ID } from '../test/classes'
import { ENROLLMENT_IDS, STUDENT_IDS } from '../test/enrollments'
import { FEE_PLAN_IDS } from '../test/feePlans'
import { jsonResponse, mockFetch } from '../test/http'
import { INVOICE_IDS, makeClassInvoicesResult, makeInvoice, makeInvoiceList } from '../test/invoices'
import { changeInvoiceStatus, createInvoice, deleteInvoice, getInvoice, invoicesPath, issueClassInvoices, listInvoices, updateInvoice } from './invoices'

describe('invoices API (API-144..API-150)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the list path in a fixed order, the overdue flag as the literal text the server reads and the number search trimmed', () => {
    expect(invoicesPath()).toBe('/api/invoices')
    expect(
      invoicesPath({ q: '  INV-2026 ', status: 'issued', balance: 'partial', overdue: true, classId: CLASS_ID, studentId: STUDENT_IDS[0], feePlanId: FEE_PLAN_IDS[0], limit: 20, cursor: 'c1' }),
    ).toBe(`/api/invoices?studentId=${STUDENT_IDS[0]}&classId=${CLASS_ID}&feePlanId=${FEE_PLAN_IDS[0]}&status=issued&balance=partial&overdue=true&q=INV-2026&limit=20&cursor=c1`)
    expect(invoicesPath({ overdue: false })).toBe('/api/invoices?overdue=false')
    expect(invoicesPath({ q: '   ' })).toBe('/api/invoices')
  })

  it('reads the list and the detail with the token and the signal; the computed numbers come as the server sent them', async () => {
    const invoice = makeInvoice()
    const fetchMock = mockFetch((url) => (url === '/api/invoices' ? jsonResponse(200, makeInvoiceList([invoice], 'next-1')) : jsonResponse(200, invoice)))
    const controller = new AbortController()
    const list = await listInvoices({}, controller.signal)
    expect(list.nextCursor).toBe('next-1')
    expect(list.items[0]).not.toHaveProperty('installments')
    expect(list.items[0]?.balance).toBe(600)
    const detail = await getInvoice(INVOICE_IDS[0], controller.signal)
    expect(detail.installments.map((part) => [part.status, part.remaining])).toEqual([
      ['paid', 0],
      ['unpaid', 600],
    ])
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/invoices', `/api/invoices/${INVOICE_IDS[0]}`])
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBe(controller.signal)
  })

  it('writes with the documented methods, paths and bodies: create, PATCH, DELETE (204), status, the class batch', async () => {
    const fetchMock = mockFetch((url, init) => {
      if (init?.method === 'DELETE') return jsonResponse(204)
      if (url.endsWith('/invoices') && url.startsWith('/api/classes/')) return jsonResponse(200, makeClassInvoicesResult())
      return jsonResponse(init?.method === 'POST' && url === '/api/invoices' ? 201 : 200, makeInvoice())
    })
    await createInvoice({ studentId: STUDENT_IDS[0], enrollmentId: ENROLLMENT_IDS[0], feePlanId: FEE_PLAN_IDS[0], discountAmount: 50, discountReason: 'منحة' })
    await updateInvoice(INVOICE_IDS[1], { enrollmentId: null, notes: null })
    await expect(deleteInvoice(INVOICE_IDS[1])).resolves.toBeUndefined()
    await changeInvoiceStatus(INVOICE_IDS[0], { action: 'cancel', reason: 'خطأ في الإصدار' })
    await issueClassInvoices(CLASS_ID, { feePlanId: FEE_PLAN_IDS[0], issue: true })
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ['/api/invoices', 'POST', JSON.stringify({ studentId: STUDENT_IDS[0], enrollmentId: ENROLLMENT_IDS[0], feePlanId: FEE_PLAN_IDS[0], discountAmount: 50, discountReason: 'منحة' })],
      [`/api/invoices/${INVOICE_IDS[1]}`, 'PATCH', JSON.stringify({ enrollmentId: null, notes: null })],
      [`/api/invoices/${INVOICE_IDS[1]}`, 'DELETE', undefined],
      [`/api/invoices/${INVOICE_IDS[0]}/status`, 'POST', JSON.stringify({ action: 'cancel', reason: 'خطأ في الإصدار' })],
      [`/api/classes/${CLASS_ID}/invoices`, 'POST', JSON.stringify({ feePlanId: FEE_PLAN_IDS[0], issue: true })],
    ])
  })

  it('surfaces the problems of a refused draft', async () => {
    mockFetch(() => jsonResponse(400, { statusCode: 400, error: 'Bad Request', code: 'invoice_invalid', message: 'rules', problems: ['installments_sum'] }))
    await expect(changeInvoiceStatus(INVOICE_IDS[1], { action: 'issue' })).rejects.toMatchObject({ status: 400, code: 'invoice_invalid', body: { problems: ['installments_sum'] } })
  })
})
