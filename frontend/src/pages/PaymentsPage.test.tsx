import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Academy } from '../api/academy'
import { formatMoney } from '../dashboard/dashboard.data'
import { ar } from '../i18n/ar'
import { formatLessonDateTime } from '../lessons/lessons.format'
import { makeAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { CASHIER_PERMISSIONS, INVOICE_ID, makeInvoice, makeInvoiceSummary, makeMyInvoice, makePayment } from '../test/payments'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { PaymentsPage } from './PaymentsPage'

/** Text as Testing Library compares it: runs of white space (Intl's no-break spaces included) as one space. */
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
const sar = (amount: number) => formatMoney(amount, 'SAR', 'ar')
/** The «record a payment» dialog as it is on screen now (a remount would replace the element). */
const recordDialog = () => screen.getByText(/تسجيل دفعة على/).closest('.ant-modal') as HTMLElement

const overdue = makeInvoiceSummary({
  id: 'inv-2',
  number: 'INV-2026-00058',
  student: { id: 's-2', fullName: 'خالد علي', displayName: null },
  overdue: true,
  balance: 900,
  paid: 300,
  total: 1200,
  paymentState: 'partial',
})

interface Api {
  queries: URLSearchParams[]
  posts: { url: string; body: unknown }[]
  detailReads: number
}

function mockApi({ record, detail = [makeInvoice()], academy = makeAcademy() }: { record?: Response; detail?: ReturnType<typeof makeInvoice>[]; academy?: Academy } = {}): Api {
  const api: Api = { queries: [], posts: [], detailReads: 0 }
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (parsed.pathname === '/api/academy') return jsonResponse(200, academy)
    if (parsed.pathname === '/api/invoices' && method === 'GET') {
      api.queries.push(parsed.searchParams)
      return jsonResponse(200, { items: [makeInvoiceSummary(), overdue], nextCursor: null })
    }
    if (parsed.pathname === `/api/invoices/${INVOICE_ID}` && method === 'GET') {
      const answer = detail[Math.min(api.detailReads, detail.length - 1)]
      api.detailReads += 1
      return jsonResponse(200, answer)
    }
    if (parsed.pathname === `/api/invoices/${INVOICE_ID}/payments` && method === 'POST') {
      api.posts.push({ url: parsed.pathname, body: JSON.parse(String(init?.body)) })
      return record ?? jsonResponse(201, makePayment())
    }
    if (parsed.pathname === '/api/me/invoices') {
      api.queries.push(parsed.searchParams)
      return jsonResponse(200, {
        items: [makeMyInvoice(), makeMyInvoice({ id: 'inv-9', number: 'INV-2026-00090', relation: 'child', student: { id: 's-9', fullName: 'ليلى سالم', displayName: null }, overdue: true })],
      })
    }
    return jsonResponse(404, { statusCode: 404, message: 'unexpected' })
  })
  return api
}

function renderPage(permissions: string[], roles = ['staff']) {
  return renderWithProviders(<PaymentsPage />, { auth: makeAuth({ user: makeUser({ permissions, roles }) }), route: '/payments' })
}

async function openRecordModal() {
  fireEvent.click(await screen.findByText('INV-2026-00057'))
  const record = await screen.findByText(ar.payments.record.action)
  fireEvent.click(record.closest('button')!)
  const title = await screen.findByText(/تسجيل دفعة على/)
  return title.closest('.ant-modal') as HTMLElement
}

describe('PaymentsPage — office view', () => {
  it('lists the invoices with the server amounts, marks the overdue balance and filters overdue only', async () => {
    const api = mockApi()
    renderPage(CASHIER_PERMISSIONS)

    expect(await screen.findByText('INV-2026-00057')).toBeInTheDocument()
    expect(screen.getByText('خالد علي')).toBeInTheDocument()
    const overdueRow = screen.getByText('INV-2026-00058').closest('tr') as HTMLElement
    expect(overdueRow.querySelector('.finance-overdue')).not.toBeNull()
    expect(within(overdueRow).getByText(ar.payments.status.overdue)).toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.payments.filters.overdueOnly))
    await waitFor(() => expect(api.queries.at(-1)?.get('overdue')).toBe('true'))
    expect(api.queries[0]?.get('limit')).toBe('20')
  })

  it('records a payment with the typed values and shows the invoice the server reads back', async () => {
    const after = makeInvoice({ paid: 850, balance: 350, updatedAt: '2026-11-14T10:00:00.000Z' })
    const api = mockApi({ detail: [makeInvoice(), after] })
    renderPage(CASHIER_PERMISSIONS)

    const dialog = await openRecordModal()
    const amount = within(dialog).getByRole('spinbutton')
    fireEvent.change(amount, { target: { value: '250' } })
    fireEvent.blur(amount)
    fireEvent.change(within(dialog).getByLabelText(ar.payments.record.reference), { target: { value: '  TRX-9 ' } })
    fireEvent.click(within(dialog).getByText(ar.payments.record.submit).closest('button')!)

    await waitFor(() => expect(api.posts).toHaveLength(1))
    expect(api.posts[0]!.body).toEqual({ amount: 250, method: 'cash', reference: 'TRX-9' })
    const toast = await screen.findByText(/سُجّل الإيصال RCPT-2026-00032/)
    // The balance is money ending in «ر.س.»: the sentence adds no period of its own (QA V4: «المتبقي الآن 215 ر.س..»).
    expect(toast.textContent).toContain(sar(350))
    expect(toast.textContent).not.toMatch(/\.[\u200E\u200F]*\./)
    await waitFor(() => expect(api.detailReads).toBe(2))
    const drawer = document.querySelector('.ant-drawer') as HTMLElement
    await waitFor(() => expect(drawer.querySelector('.finance-totals')).toHaveTextContent('350'))
  })

  it('keeps the invoice number on one line and lets the header actions wrap under it (QA V4 P6 at 390 px)', async () => {
    mockApi()
    renderPage(CASHIER_PERMISSIONS)
    fireEvent.click(await screen.findByText('INV-2026-00057'))
    await screen.findByText(ar.payments.record.action)
    // jsdom has no layout: assert the configuration — the number's `white-space: nowrap` class and the header's wrap
    // class (both rules are checked in payments/payments.css.test.ts).
    const header = document.querySelector('.ant-drawer-header') as HTMLElement
    expect(header).toHaveClass('finance-drawer__header')
    expect(within(header).getByText('INV-2026-00057')).toHaveClass('finance-number')
  })

  it('refuses an amount above the balance before any request', async () => {
    const api = mockApi()
    renderPage(CASHIER_PERMISSIONS)
    const dialog = await openRecordModal()
    const amount = within(dialog).getByRole('spinbutton')
    fireEvent.change(amount, { target: { value: '700' } })
    fireEvent.blur(amount)
    fireEvent.click(within(dialog).getByText(ar.payments.record.submit).closest('button')!)
    expect(await within(dialog).findByText(/المبلغ أكبر من المتبقي/)).toBeInTheDocument()
    expect(api.posts).toHaveLength(0)
  })

  it('keeps the refusal payment_exceeds_balance and the typed values after re-reading the changed invoice (QA V4 P3)', async () => {
    // Somebody else recorded 99.75 while the dialog was open: the re-read invoice has a new balance and a new updatedAt.
    const changed = makeInvoice({ paid: 699.75, balance: 500.25, paymentState: 'partial', nextDue: { seq: 2, dueOn: '2026-12-01', remaining: 500.25 }, updatedAt: '2026-11-14T11:00:00.000Z' })
    const api = mockApi({
      record: jsonResponse(409, { statusCode: 409, error: 'Conflict', code: 'payment_exceeds_balance', message: 'above', amount: 550.25, balance: 500.25 }),
      detail: [makeInvoice(), changed],
    })
    renderPage(CASHIER_PERMISSIONS)
    const dialog = await openRecordModal()
    const amount = within(dialog).getByRole('spinbutton')
    fireEvent.change(amount, { target: { value: '550.25' } })
    fireEvent.blur(amount)
    fireEvent.change(within(dialog).getByLabelText(ar.payments.record.reference), { target: { value: 'TRX-1' } })
    fireEvent.click(within(dialog).getByText(ar.payments.record.submit).closest('button')!)

    await waitFor(() => expect(api.posts).toHaveLength(1))
    await waitFor(() => expect(api.detailReads).toBe(2))
    // The dialog now shows and checks the new balance…
    await waitFor(() => expect(recordDialog()).toHaveTextContent(normalize(ar.payments.record.balance.replace('{{balance}}', sar(500.25)))))
    // …and is still the user's session: the refusal in money on the amount, the typed amount and reference.
    const refusal = ar.payments.errors.payment_exceeds_balance.replace('{{amount}}', sar(550.25)).replace('{{balance}}', sar(500.25))
    expect(recordDialog().querySelector('.ant-form-item-explain-error')).toHaveTextContent(normalize(refusal))
    expect(within(recordDialog()).getByRole('spinbutton')).toHaveValue('550.25')
    expect(within(recordDialog()).getByLabelText(ar.payments.record.reference)).toHaveValue('TRX-1')

    // A second press is refused before any request against the new balance — never a silent other amount.
    fireEvent.click(within(recordDialog()).getByText(ar.payments.record.submit).closest('button')!)
    expect(await within(recordDialog()).findByText(normalize(ar.payments.record.amountAboveBalance.replace('{{balance}}', sar(500.25))))).toBeInTheDocument()
    expect(api.posts).toHaveLength(1)
  })

  it('keeps the refusal invoice_not_issued and the typed values after re-reading the cancelled invoice', async () => {
    const cancelled = makeInvoice({ status: 'cancelled', cancelledAt: '2026-11-14T11:00:00.000Z', cancelReason: 'خطأ', updatedAt: '2026-11-14T11:00:00.000Z' })
    const api = mockApi({
      record: jsonResponse(409, { statusCode: 409, error: 'Conflict', code: 'invoice_not_issued', message: 'not issued', status: 'cancelled' }),
      detail: [makeInvoice(), cancelled],
    })
    renderPage(CASHIER_PERMISSIONS)
    const dialog = await openRecordModal()
    fireEvent.change(within(dialog).getByLabelText(ar.payments.record.reference), { target: { value: 'TRX-2' } })
    fireEvent.click(within(dialog).getByText(ar.payments.record.submit).closest('button')!)

    await waitFor(() => expect(api.detailReads).toBe(2))
    // The drawer shows the cancelled invoice (its «record» action is gone) while the dialog keeps the session.
    await waitFor(() => expect(screen.queryByText(ar.payments.record.action)).toBeNull())
    expect(within(recordDialog()).getByText(ar.payments.errors.invoice_not_issued)).toBeInTheDocument()
    expect(within(recordDialog()).getByLabelText(ar.payments.record.reference)).toHaveValue('TRX-2')
    expect(api.posts).toHaveLength(1)
  })

  it('reads the typed «received at» in the academy zone and names it when it is not this device’s (QA V4 P6)', async () => {
    // Asia/Tokyo is neither the machine's zone (Europe/Istanbul) nor CI's (UTC).
    const api = mockApi({ academy: makeAcademy({ timezone: 'Asia/Tokyo' }) })
    renderPage(CASHIER_PERMISSIONS)
    const dialog = await openRecordModal()
    const zoneNote = within(dialog).getByTestId('paid-at-zone')
    expect(zoneNote).toHaveTextContent(ar.payments.record.paidAtZone)
    expect(zoneNote).toHaveTextContent('Asia/Tokyo')
    fireEvent.change(within(dialog).getByLabelText(ar.payments.record.paidAt), { target: { value: '2026-11-01T10:00' } })
    fireEvent.click(within(dialog).getByText(ar.payments.record.submit).closest('button')!)

    await waitFor(() => expect(api.posts).toHaveLength(1))
    expect(api.posts[0]!.body).toEqual({ amount: 600, method: 'cash', paidAt: '2026-11-01T01:00:00.000Z' })
  })
})

describe('PaymentsPage — learner view', () => {
  it('shows «my invoices» with the relation for a guardian and never reads the office list', async () => {
    const api = mockApi()
    renderPage(['invoices.read_own', 'invoices.read_linked'], ['student', 'guardian'])

    expect(await screen.findByText('INV-2026-00090')).toBeInTheDocument()
    expect(screen.getByText(ar.payments.mine.title)).toBeInTheDocument()
    expect(screen.getByText(ar.payments.mine.relation.child)).toBeInTheDocument()
    expect(screen.getByText(ar.payments.mine.relation.self)).toBeInTheDocument()
    expect(screen.getAllByText(/ليلى سالم/).length).toBeGreaterThan(0)
    expect(api.queries).toHaveLength(1)
    expect(document.querySelector('.my-invoice .finance-totals__bad')).not.toBeNull()
  })

  it('shows a receipt’s time in the academy zone, as the office view does (QA V4 P4 — a London browser)', async () => {
    mockApi({ academy: makeAcademy({ timezone: 'Asia/Tokyo' }) })
    renderPage(['invoices.read_own'], ['student'])
    fireEvent.click((await screen.findAllByText(ar.payments.mine.details))[0]!)
    const paidAt = makeMyInvoice().payments[0]!.paidAt
    await waitFor(() => expect(document.querySelector('.my-invoice__lists small')).not.toBeNull())
    expect(document.querySelector('.my-invoice__lists small')).toHaveTextContent(normalize(formatLessonDateTime(paidAt, 'ar', 'Asia/Tokyo')))
  })

  it('says so when there is no invoice', async () => {
    mockFetch(() => jsonResponse(200, { items: [] }))
    renderPage(['invoices.read_own'], ['student'])
    expect(await screen.findByText(ar.payments.mine.empty)).toBeInTheDocument()
  })
})
