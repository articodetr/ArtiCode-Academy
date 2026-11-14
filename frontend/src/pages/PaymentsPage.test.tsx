import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { CASHIER_PERMISSIONS, INVOICE_ID, makeInvoice, makeInvoiceSummary, makeMyInvoice, makePayment } from '../test/payments'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { PaymentsPage } from './PaymentsPage'

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

function mockApi({ record, detail = [makeInvoice()] }: { record?: Response; detail?: ReturnType<typeof makeInvoice>[] } = {}): Api {
  const api: Api = { queries: [], posts: [], detailReads: 0 }
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (parsed.pathname === '/api/academy') return jsonResponse(200, makeAcademy())
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
    expect(await screen.findByText(/سُجّل الإيصال RCPT-2026-00032/)).toBeInTheDocument()
    await waitFor(() => expect(api.detailReads).toBe(2))
    const drawer = document.querySelector('.ant-drawer') as HTMLElement
    await waitFor(() => expect(drawer.querySelector('.finance-totals')).toHaveTextContent('350'))
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

  it('shows the server refusal payment_exceeds_balance on the amount and re-reads the invoice', async () => {
    const api = mockApi({
      record: jsonResponse(409, { statusCode: 409, error: 'Conflict', code: 'payment_exceeds_balance', message: 'above', amount: 600, balance: 400 }),
    })
    renderPage(CASHIER_PERMISSIONS)
    const dialog = await openRecordModal()
    fireEvent.click(within(dialog).getByText(ar.payments.record.submit).closest('button')!)
    expect(await within(dialog).findByText('المبلغ 600 أكبر من المتبقي 400.')).toBeInTheDocument()
    await waitFor(() => expect(api.detailReads).toBe(2))
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

  it('says so when there is no invoice', async () => {
    mockFetch(() => jsonResponse(200, { items: [] }))
    renderPage(['invoices.read_own'], ['student'])
    expect(await screen.findByText(ar.payments.mine.empty)).toBeInTheDocument()
  })
})
