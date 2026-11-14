// The finance additions of /payments: the tabs by permission, fee plans
// (API-140..143), draft invoices (API-146), the class batch (API-150) and the
// recorded payments list (API-152).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { makeClass } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { FEE_PLAN_ID, FINANCE_MANAGER_PERMISSIONS, makeFeePlan, makeInvoice, makeInvoiceSummary, makePayment } from '../test/payments'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeListItem } from '../test/users'
import { PaymentsPage } from './PaymentsPage'

const STUDENT = makeListItem({ id: '0192f0a0-0000-7000-8000-0000000000aa', fullName: 'ريم ناصر', roles: ['student'] })

interface Call {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
}

function mockApi(overrides: Record<string, (call: Call) => Response | undefined> = {}) {
  const calls: Call[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const call: Call = { method: init?.method ?? 'GET', path: parsed.pathname, query: parsed.searchParams, body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    const custom = overrides[`${call.method} ${call.path}`]?.(call)
    if (custom) return custom
    if (call.path === '/api/academy') return jsonResponse(200, makeAcademy())
    if (call.path === '/api/invoices' && call.method === 'GET') return jsonResponse(200, { items: [makeInvoiceSummary()], nextCursor: null })
    if (call.path === '/api/invoices' && call.method === 'POST') return jsonResponse(201, makeInvoice({ id: 'new-draft', status: 'draft', number: null }))
    if (call.path.startsWith('/api/invoices/')) return jsonResponse(200, makeInvoice({ id: 'new-draft', status: 'draft', number: null }))
    if (call.path === '/api/fee-plans' && call.method === 'GET') return jsonResponse(200, { items: [makeFeePlan(), makeFeePlan({ id: 'plan-off', name: { ar: 'خطة قديمة' }, isActive: false, invoiceCount: 4 })] })
    if (call.path.startsWith('/api/fee-plans')) return jsonResponse(200, makeFeePlan())
    if (call.path === '/api/users') return jsonResponse(200, { items: [STUDENT], nextCursor: null })
    if (call.path === '/api/classes') return jsonResponse(200, { items: [makeClass()], nextCursor: null })
    if (call.path === '/api/payments') return jsonResponse(200, { items: [makePayment()], nextCursor: null })
    if (call.path.startsWith('/api/payments/')) return jsonResponse(200, makePayment())
    return jsonResponse(404, { statusCode: 404, message: 'unexpected' })
  })
  return calls
}

function renderPage(permissions: string[], route = '/payments') {
  return renderWithProviders(<PaymentsPage />, { auth: makeAuth({ user: makeUser({ permissions, roles: ['staff'] }) }), route })
}

const tabNames = () => Array.from(document.querySelectorAll('.ant-tabs-tab')).map((tab) => tab.textContent)
const dialogTitled = async (title: string) => (await screen.findByText(title, { selector: '.ant-modal-title' })).closest('.ant-modal') as HTMLElement
const button = (scope: HTMLElement, label: string) => within(scope).getByText(label).closest('button') as HTMLButtonElement

async function pick(scope: HTMLElement, label: string, option: string) {
  fireEvent.mouseDown(within(scope).getByLabelText(label))
  fireEvent.click(await screen.findByText(option, { selector: '.ant-select-item-option-content' }))
}

describe('PaymentsPage — tabs by permission', () => {
  it('shows invoices and recorded payments to a cashier, fee plans only with a fee-plan read key', async () => {
    mockApi()
    const { unmount } = renderPage(['payments.record'])
    await screen.findByText('INV-2026-00057')
    expect(tabNames()).toEqual([ar.payments.tabs.invoices, ar.payments.tabs.payments])
    unmount()

    renderPage(['invoices.manage'])
    await screen.findByText('INV-2026-00057')
    expect(tabNames()).toEqual([ar.payments.tabs.invoices, ar.payments.tabs.feePlans, ar.payments.tabs.payments])
  })

  it('shows no tab to a learner', async () => {
    mockFetch(() => jsonResponse(200, { items: [] }))
    renderPage(['invoices.read_own'])
    await screen.findByText(ar.payments.mine.empty)
    expect(tabNames()).toEqual([])
  })
})

describe('PaymentsPage — fee plans', () => {
  it('shows the problems before sending, then creates a plan with the right body', async () => {
    const calls = mockApi()
    renderPage(FINANCE_MANAGER_PERMISSIONS, '/payments?tab=feePlans')
    expect(await screen.findByText('رسوم الفصل الدراسي')).toBeInTheDocument()
    expect(screen.getByText(ar.payments.feePlans.inactive)).toBeInTheDocument()

    fireEvent.click(button(document.body, ar.payments.feePlans.create))
    const dialog = await dialogTitled(ar.payments.feePlans.createTitle)
    fireEvent.change(within(dialog).getByLabelText(ar.payments.feePlans.nameAr), { target: { value: 'خطة الربيع' } })
    fireEvent.change(within(dialog).getByLabelText(`${ar.payments.form.descriptionAr} 1`), { target: { value: 'رسوم الدورة' } })
    const amount = within(dialog).getByLabelText(`المبلغ (SAR) 1`)
    fireEvent.change(amount, { target: { value: '900' } })
    fireEvent.blur(amount)
    const percent = within(dialog).getByLabelText(`${ar.payments.feePlans.percent} 1`)
    fireEvent.change(percent, { target: { value: '60' } })
    fireEvent.blur(percent)

    fireEvent.click(button(dialog, ar.payments.feePlans.create))
    expect(await within(dialog).findByText('مجموع النسب 60٪ ولا يساوي 100٪.')).toBeInTheDocument()
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0)

    fireEvent.click(button(dialog, ar.payments.feePlans.evenShares))
    fireEvent.click(button(dialog, ar.payments.feePlans.create))
    await waitFor(() => expect(calls.filter((call) => call.method === 'POST' && call.path === '/api/fee-plans')).toHaveLength(1))
    expect(calls.find((call) => call.method === 'POST')!.body).toEqual({
      name: { ar: 'خطة الربيع' },
      lines: [{ description: { ar: 'رسوم الدورة' }, amount: 900 }],
      installments: [{ percent: 100, dueOffsetDays: 0 }],
    })
  })

  it('offers to deactivate a plan the server refuses to delete with fee_plan_in_use', async () => {
    const calls = mockApi({
      [`DELETE /api/fee-plans/${FEE_PLAN_ID}`]: () => jsonResponse(409, { statusCode: 409, error: 'Conflict', code: 'fee_plan_in_use', message: 'in use', invoiceCount: 7 }),
    })
    renderPage(FINANCE_MANAGER_PERMISSIONS, '/payments?tab=feePlans')
    const row = (await screen.findByText('رسوم الفصل الدراسي')).closest('tr') as HTMLElement
    fireEvent.click(button(row, ar.payments.deleteAction))
    fireEvent.click(button(await dialogTitled('حذف الخطة «رسوم الفصل الدراسي»؟'), ar.payments.feePlans.delete.ok))
    const offer = await screen.findByText(/أُنشئت منها 7 فاتورة/)
    fireEvent.click(button(offer.closest('.ant-modal') as HTMLElement, ar.payments.feePlans.deactivate))
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    expect(calls.find((call) => call.method === 'PATCH')).toMatchObject({ path: `/api/fee-plans/${FEE_PLAN_ID}`, body: { isActive: false } })
  })
})

describe('PaymentsPage — draft invoices', () => {
  async function openNewInvoice() {
    fireEvent.click(button(document.body, ar.payments.draft.action))
    const dialog = await dialogTitled(ar.payments.draft.createTitle)
    await pick(dialog, ar.common.student, 'ريم ناصر')
    return dialog
  }

  it('creates a draft by hand with the typed lines and installments', async () => {
    const calls = mockApi()
    renderPage(FINANCE_MANAGER_PERMISSIONS)
    await screen.findByText('INV-2026-00057')
    const dialog = await openNewInvoice()
    fireEvent.change(within(dialog).getByLabelText(`${ar.payments.form.descriptionAr} 1`), { target: { value: 'رسوم' } })
    const amount = within(dialog).getByLabelText('المبلغ (SAR) 1')
    fireEvent.change(amount, { target: { value: '500' } })
    fireEvent.blur(amount)
    fireEvent.click(button(dialog, ar.payments.form.spread))
    fireEvent.change(within(dialog).getByLabelText(`${ar.payments.drawer.dueOn} 1`), { target: { value: '2026-12-01' } })
    fireEvent.click(button(dialog, ar.payments.draft.create))

    await waitFor(() => expect(calls.filter((call) => call.method === 'POST' && call.path === '/api/invoices')).toHaveLength(1))
    expect(calls.find((call) => call.method === 'POST')!.body).toEqual({
      studentId: STUDENT.id,
      lines: [{ description: { ar: 'رسوم' }, amount: 500 }],
      installments: [{ amount: 500, dueOn: '2026-12-01' }],
    })
  })

  it('creates a draft from an active plan', async () => {
    const calls = mockApi()
    renderPage(FINANCE_MANAGER_PERMISSIONS)
    await screen.findByText('INV-2026-00057')
    const dialog = await openNewInvoice()
    fireEvent.click(within(dialog).getByText(ar.payments.draft.sources.plan))
    await pick(dialog, ar.payments.drawer.feePlan, 'رسوم الفصل الدراسي')
    expect(screen.queryByText('خطة قديمة', { selector: '.ant-select-item-option-content' })).toBeNull()
    fireEvent.click(button(dialog, ar.payments.draft.create))
    await waitFor(() => expect(calls.filter((call) => call.method === 'POST' && call.path === '/api/invoices')).toHaveLength(1))
    expect(calls.find((call) => call.method === 'POST')!.body).toEqual({ studentId: STUDENT.id, feePlanId: FEE_PLAN_ID })
  })

  it('shows the problems of an invoice_invalid refusal on their fields', async () => {
    mockApi({
      'POST /api/invoices': () => jsonResponse(400, { statusCode: 400, error: 'Bad Request', code: 'invoice_invalid', message: 'rules', problems: ['due_dates_not_ascending', 'discount_exceeds_subtotal'] }),
    })
    renderPage(FINANCE_MANAGER_PERMISSIONS)
    await screen.findByText('INV-2026-00057')
    const dialog = await openNewInvoice()
    fireEvent.click(within(dialog).getByText(ar.payments.draft.sources.plan))
    await pick(dialog, ar.payments.drawer.feePlan, 'رسوم الفصل الدراسي')
    fireEvent.click(button(dialog, ar.payments.draft.create))
    expect(await within(dialog).findByText(ar.payments.problems.discount_exceeds_subtotal)).toBeInTheDocument()
  })
})

describe('PaymentsPage — bill a whole class', () => {
  it('sends the class batch and shows what was created and skipped', async () => {
    const calls = mockApi({
      [`POST /api/classes/${makeClass().id}/invoices`]: () =>
        jsonResponse(200, {
          created: [makeInvoiceSummary({ id: 'b-1', number: 'INV-2026-00100' })],
          skipped: [{ enrollmentId: 'e-2', studentId: 's-2', reason: 'already_invoiced' }],
        }),
    })
    renderPage(FINANCE_MANAGER_PERMISSIONS)
    await screen.findByText('INV-2026-00057')
    const before = calls.filter((call) => call.path === '/api/invoices' && call.method === 'GET').length
    fireEvent.click(button(document.body, ar.payments.batch.action))
    const dialog = await dialogTitled(ar.payments.batch.title)
    await pick(dialog, ar.payments.draft.class, 'PY-101-A — بايثون — الفصل أ')
    await pick(dialog, ar.payments.drawer.feePlan, 'رسوم الفصل الدراسي')
    fireEvent.click(within(dialog).getByText(ar.payments.batch.issue))
    fireEvent.click(button(dialog, ar.payments.batch.submit))

    expect(await within(dialog).findByText('أُنشئت 1 فاتورة، وتُخطّي 1 تسجيل.')).toBeInTheDocument()
    expect(calls.find((call) => call.path.endsWith('/invoices') && call.path.startsWith('/api/classes/'))!.body).toEqual({ feePlanId: FEE_PLAN_ID, issue: true })
    expect(within(dialog).getByText('INV-2026-00100')).toBeInTheDocument()
    expect(within(dialog).getByText(ar.payments.batch.reasons.already_invoiced)).toBeInTheDocument()
    await waitFor(() => expect(calls.filter((call) => call.path === '/api/invoices' && call.method === 'GET').length).toBeGreaterThan(before))
  })
})

describe('PaymentsPage — recorded payments', () => {
  it('lists the receipts and forms the query from the filters', async () => {
    const calls = mockApi()
    renderPage(['payments.record'], '/payments?tab=payments')
    expect(await screen.findByText('RCPT-2026-00032')).toBeInTheDocument()
    const reads = () => calls.filter((call) => call.path === '/api/payments')
    expect(reads()[0]!.query.get('limit')).toBe('20')

    await pick(document.body, ar.payments.record.method, ar.payments.methods.cheque)
    await waitFor(() => expect(reads().at(-1)!.query.get('method')).toBe('cheque'))
    fireEvent.change(screen.getByLabelText(ar.payments.recorded.from), { target: { value: '2026-11-01' } })
    await waitFor(() => expect(reads().at(-1)!.query.get('from')).toBe('2026-10-31T21:00:00.000Z'))

    fireEvent.click(screen.getByText('RCPT-2026-00032'))
    fireEvent.click((await screen.findByText(ar.payments.recorded.openInvoice)).closest('button')!)
    expect(calls.some((call) => call.path === `/api/payments/${makePayment().id}`)).toBe(true)
    await waitFor(() => expect(calls.some((call) => call.path === `/api/invoices/${makePayment().invoice.id}`)).toBe(true))
  })
})
