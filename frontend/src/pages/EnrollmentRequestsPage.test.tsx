// MOD-19 — «طلبات الاشتراك»: the office's list (API-224), the details drawer
// (API-225), approve / reject through API-059 and a payment recorded on the
// request's invoice (API-151). No server: fetch is stubbed per test.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EnrollmentRequest } from '../api/enrollmentRequests'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { OFFICE_PERMISSIONS, REGISTRAR_PERMISSIONS, REQUEST_IDS, REQUEST_INVOICE_ID, makeEnrollmentRequest, makeRequestInvoice, makeRequestList } from '../test/enrollmentRequests'
import { jsonResponse, mockFetch } from '../test/http'
import { makeInvoice } from '../test/payments'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { EnrollmentRequestsPage } from './EnrollmentRequestsPage'

const r = ar.enrollmentRequests

interface Call {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
}

type Handler = (call: Call) => Response | undefined

/** Serves the list and the detail from `state()` (re-read on every GET) and answers the writes with `write`. */
function mockRequestsApi(state: () => EnrollmentRequest, write: Handler = () => undefined, pendingCount = 4) {
  const calls: Call[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const call: Call = { method: init?.method ?? 'GET', path: parsed.pathname, query: parsed.searchParams, body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    const answered = write(call)
    if (answered) return answered
    if (call.path === '/api/academy') return jsonResponse(200, makeAcademy())
    if (call.path === '/api/enrollment-requests') return jsonResponse(200, makeRequestList([state()], pendingCount))
    if (call.path === `/api/enrollment-requests/${REQUEST_IDS[0]}`) return jsonResponse(200, state())
    return jsonResponse(500, { statusCode: 500, message: `unexpected ${call.method} ${call.path}` })
  })
  return { calls, writes: () => calls.filter((call) => call.method !== 'GET') }
}

function renderPage(permissions: string[]) {
  renderWithProviders(<EnrollmentRequestsPage />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/enrollment-requests' })
}

async function openRequest() {
  fireEvent.click(await screen.findByLabelText(`${r.view}: ليلى حسن`))
  return (await screen.findByText(r.drawer.invoices)).closest('.ant-drawer') as HTMLElement
}

function dialogTitled(title: string): HTMLElement {
  return screen.getAllByText(title).map((node) => node.closest('[role="dialog"]')).find((node): node is HTMLElement => node !== null)!
}

describe('EnrollmentRequestsPage', () => {
  it('lists the pending requests with the server’s payment and request states, the count, and filters by state and search', async () => {
    const { calls } = mockRequestsApi(() => makeEnrollmentRequest())
    renderPage(REGISTRAR_PERMISSIONS)
    const row = (await screen.findByText('ليلى حسن')).closest('tr') as HTMLElement
    expect(within(row).getByText('أساسيات بايثون')).toBeInTheDocument()
    expect(within(row).getByText('PY-101-A')).toBeInTheDocument()
    expect(within(row).getByText(r.paymentStates.unpaid)).toBeInTheDocument()
    expect(within(row).getByText(r.states.pending_payment)).toBeInTheDocument()
    expect(screen.getByTestId('pending-count')).toHaveTextContent('4')
    const lists = () => calls.filter((call) => call.path === '/api/enrollment-requests')
    expect(lists()[0]!.query.get('state')).toBe('pending')

    fireEvent.mouseDown(screen.getByRole('combobox', { name: r.stateLabel }))
    fireEvent.click(await screen.findByText(r.filters.pending_approval, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(lists().at(-1)!.query.get('state')).toBe('pending_approval'))

    fireEvent.change(screen.getByLabelText(r.searchLabel), { target: { value: '  ليلى ' } })
    await waitFor(() => expect(lists().at(-1)!.query.get('q')).toBe('ليلى'))
    expect(lists().at(-1)!.query.get('state')).toBe('pending_approval')
  })

  it('shows why approval is refused and the invoice without its payment lines for a registrar; a rejection needs its reason', async () => {
    let current = makeEnrollmentRequest()
    const { writes, calls } = mockRequestsApi(
      () => current,
      (call) => {
        if (call.method !== 'POST') return undefined
        current = makeEnrollmentRequest({
          status: 'cancelled',
          state: 'rejected',
          rejectionReason: 'المستوى غير مناسب',
          allowedActions: [],
          approveBlocker: null,
          payment: { state: 'missing', required: true, total: 0, paid: 0, balance: 0, currency: 'SAR', invoices: [makeRequestInvoice({ status: 'cancelled' })] },
        })
        return jsonResponse(200, {})
      },
    )
    renderPage(REGISTRAR_PERMISSIONS)
    const drawer = await openRequest()
    expect(within(drawer).getByTestId('approve-blocker')).toHaveTextContent('لا تُقبل الموافقة')
    expect(within(drawer).getByText(r.actions.approve).closest('button')).toBeDisabled()
    expect(within(drawer).getByText('INV-2026-00082')).toBeInTheDocument()
    expect(within(drawer).getByText(r.drawer.paymentsHidden)).toBeInTheDocument()
    // No payments.record: no way to record money here.
    expect(within(drawer).queryByText(r.drawer.recordPayment)).toBeNull()

    fireEvent.click(within(drawer).getByText(r.actions.reject).closest('button')!)
    const dialog = dialogTitled(r.reject.title.replace('{{name}}', 'ليلى حسن'))
    fireEvent.click(within(dialog).getByText(r.reject.ok).closest('button')!)
    expect(await within(dialog).findByText(r.reject.reasonMissing)).toBeInTheDocument()
    expect(writes()).toHaveLength(0)

    fireEvent.change(within(dialog).getByLabelText(r.reject.reason), { target: { value: '  المستوى غير مناسب ' } })
    fireEvent.click(within(dialog).getByText(r.reject.ok).closest('button')!)
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ method: 'POST', path: `/api/enrollments/${REQUEST_IDS[0]}/status`, body: { action: 'reject', reason: 'المستوى غير مناسب' } })
    // The drawer and the list re-read the server's state.
    expect(await within(drawer).findByText(r.states.rejected)).toBeInTheDocument()
    expect(within(drawer).getByText('المستوى غير مناسب')).toBeInTheDocument()
    expect(calls.filter((call) => call.path === '/api/enrollment-requests').length).toBeGreaterThanOrEqual(2)
  })

  it('approves a settled request, and shows the server’s payment_required refusal with the balance still due', async () => {
    let refuse = true
    const settled = makeEnrollmentRequest({
      state: 'pending_approval',
      approveBlocker: null,
      payment: { state: 'paid', required: true, total: 1000, paid: 1000, balance: 0, currency: 'SAR', invoices: [makeRequestInvoice({ paid: 1000, balance: 0 })] },
    })
    const { writes } = mockRequestsApi(
      () => settled,
      (call) => {
        if (call.method !== 'POST') return undefined
        if (refuse) {
          refuse = false
          return jsonResponse(409, { statusCode: 409, code: 'payment_required', message: 'unpaid', paymentState: 'partial', invoices: [{ id: REQUEST_INVOICE_ID, number: 'INV-2026-00082', balance: 250 }] })
        }
        return jsonResponse(200, {})
      },
    )
    renderPage(REGISTRAR_PERMISSIONS)
    const drawer = await openRequest()
    expect(within(drawer).queryByTestId('approve-blocker')).toBeNull()
    fireEvent.click(within(drawer).getByText(r.actions.approve).closest('button')!)
    const dialog = dialogTitled(r.approve.title.replace('{{name}}', 'ليلى حسن'))
    fireEvent.click(within(dialog).getByText(r.approve.ok).closest('button')!)
    expect(await within(dialog).findByText(/INV-2026-00082: 250\.00/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByText(r.approve.ok).closest('button')!)
    await waitFor(() => expect(writes()).toHaveLength(2))
    expect(writes().map((call) => call.body)).toEqual([{ action: 'approve' }, { action: 'approve' }])
  })

  it('records a payment on the request’s invoice for a holder of payments.record, then re-reads the request', async () => {
    let current = makeEnrollmentRequest()
    const { writes, calls } = mockRequestsApi(
      () => current,
      (call) => {
        if (call.method === 'GET' && call.path === `/api/invoices/${REQUEST_INVOICE_ID}`) {
          return jsonResponse(200, makeInvoice({ id: REQUEST_INVOICE_ID, number: 'INV-2026-00082', total: 1000, paid: 0, balance: 1000, paymentState: 'unpaid', nextDue: { seq: 1, dueOn: '2026-11-19', remaining: 1000 } }))
        }
        if (call.method === 'POST' && call.path === `/api/invoices/${REQUEST_INVOICE_ID}/payments`) {
          current = makeEnrollmentRequest({
            state: 'pending_approval',
            approveBlocker: null,
            payment: { state: 'paid', required: true, total: 1000, paid: 1000, balance: 0, currency: 'SAR', invoices: [makeRequestInvoice({ paid: 1000, balance: 0, payments: [] })] },
          })
          return jsonResponse(201, {})
        }
        return undefined
      },
    )
    renderPage(OFFICE_PERMISSIONS)
    const drawer = await openRequest()
    fireEvent.click(within(drawer).getByText(r.drawer.recordPayment).closest('button')!)
    const dialog = await waitFor(() => dialogTitled(ar.payments.record.title.replace('{{number}}', 'INV-2026-00082')))
    fireEvent.click(within(dialog).getByText(ar.payments.record.submit).closest('button')!)
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ path: `/api/invoices/${REQUEST_INVOICE_ID}/payments`, body: { amount: 1000, method: 'cash' } })
    expect(await within(drawer).findByText(r.states.pending_approval)).toBeInTheDocument()
    expect(within(drawer).getByText(r.actions.approve).closest('button')).toBeEnabled()
    expect(within(drawer).queryByText(r.drawer.recordPayment)).toBeNull()
    expect(calls.filter((call) => call.path === `/api/enrollment-requests/${REQUEST_IDS[0]}`).length).toBeGreaterThanOrEqual(2)
  })
})
