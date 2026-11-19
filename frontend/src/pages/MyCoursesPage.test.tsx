// MOD-19 — «my courses»: the student's own requests (API-222) and their cancellation (API-223), and the enrolled
// courses from «my classes» (API-060) grouped by course with the quick links.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MyEnrollmentRequest } from '../api/catalog'
import type { MyClassItem } from '../api/enrollments'
import { ar } from '../i18n/ar'
import { formatMoney } from '../payments/payments.format'
import { REQUEST_IDS, makeMyRequest, makeMyRequestList } from '../test/catalog'
import { ENROLLMENT_IDS, STUDENT_IDS, makeMyClassItem, makeMyClassList } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { MyCoursesPage } from './MyCoursesPage'

interface Api {
  urls: string[]
  posts: string[]
}

function mockMyCoursesApi(requests: MyEnrollmentRequest[], classes: MyClassItem[], cancel?: MyEnrollmentRequest | Response): Api {
  const api: Api = { urls: [], posts: [] }
  mockFetch((url, init) => {
    if (init?.method === 'POST') {
      api.posts.push(url)
      return cancel instanceof Response ? cancel : jsonResponse(200, cancel)
    }
    api.urls.push(new URL(url, 'http://localhost').pathname)
    if (url.startsWith('/api/me/enrollment-requests')) return jsonResponse(200, makeMyRequestList(requests))
    return jsonResponse(200, makeMyClassList(classes))
  })
  return api
}

function renderPage(roles: string[] = ['student']) {
  return renderWithProviders(<MyCoursesPage />, {
    auth: makeAuth({ user: makeUser({ id: STUDENT_IDS[0], role: roles.includes('student') ? 'student' : 'guardian', roles, permissions: ['courses.read'] }) }),
    route: '/my-courses',
    routes: { '/my-lessons': <LocationProbe />, '/catalog': <LocationProbe /> },
  })
}

const requestCard = (id: string = REQUEST_IDS[0]) => screen.getByTestId(`request-${id}`)

describe('MyCoursesPage', () => {
  it('shows a student their requests with the payment due and their enrolled courses with quick links', async () => {
    const api = mockMyCoursesApi([makeMyRequest()], [makeMyClassItem()])
    renderPage()

    const card = within(await screen.findByTestId(`request-${REQUEST_IDS[0]}`))
    expect(card.getByText('تطوير الويب')).toBeInTheDocument()
    expect(card.getByText(ar.catalog.states.pending_payment)).toBeInTheDocument()
    expect(card.getByText('تطوير الويب — أ')).toBeInTheDocument()
    expect(card.getByText('WEB-201-A')).toBeInTheDocument()
    expect(card.getByText(ar.myCourses.paymentStates.unpaid)).toBeInTheDocument()
    expect(card.getByText('INV-2026-00082')).toBeInTheDocument()
    expect(card.getByText(ar.myCourses.requests.payHint)).toBeInTheDocument()
    expect(requestCard().textContent).toContain(formatMoney(1200, 'SAR', 'ar'))
    expect(card.getByText(ar.myCourses.requests.cancel)).toBeInTheDocument()

    const group = within(await screen.findByTestId('my-courses'))
    expect(await group.findByText('أساسيات بايثون')).toBeInTheDocument()
    expect(group.getByText('بايثون — الفصل أ')).toBeInTheDocument()
    expect(group.getByText('خالد المعلم')).toBeInTheDocument()
    expect(group.queryByText(ar.myCourses.courses.student)).not.toBeInTheDocument()
    expect([...api.urls].sort()).toEqual(['/api/me/classes', '/api/me/enrollment-requests'])

    fireEvent.click(group.getByText(ar.myCourses.links.lessons).closest('button')!)
    expect((await screen.findByTestId('location')).getAttribute('data-pathname')).toBe('/my-lessons')
  })

  it('cancels a pending request after a confirmation and shows the server’s answer', async () => {
    const cancelled = makeMyRequest({ status: 'cancelled', state: 'cancelled', decidedAt: '2026-11-19T10:00:00.000Z', payment: { state: 'missing', required: true, total: 0, paid: 0, balance: 0, currency: null, invoices: [] } })
    const api = mockMyCoursesApi([makeMyRequest()], [], cancelled)
    renderPage()

    fireEvent.click(within(await screen.findByTestId(`request-${REQUEST_IDS[0]}`)).getByText(ar.myCourses.requests.cancel).closest('button')!)
    expect(await screen.findByText(ar.myCourses.requests.cancelConfirm)).toBeInTheDocument()
    expect(api.posts).toHaveLength(0)
    fireEvent.click((await screen.findByText(ar.myCourses.requests.cancelOk)).closest('button')!)

    expect(await screen.findByText(ar.myCourses.requests.cancelled)).toBeInTheDocument()
    expect(api.posts).toEqual([`/api/me/enrollment-requests/${REQUEST_IDS[0]}/cancel`])
    await waitFor(() => expect(within(requestCard()).getByText(ar.catalog.states.cancelled)).toBeInTheDocument())
    expect(within(requestCard()).queryByText(ar.myCourses.requests.cancel)).not.toBeInTheDocument()
  })

  it('says why a cancellation was refused and reads the requests again', async () => {
    const api = mockMyCoursesApi([makeMyRequest()], [], jsonResponse(409, { statusCode: 409, code: 'request_has_payments', message: 'paid', paymentCount: 1 }))
    renderPage()
    fireEvent.click(within(await screen.findByTestId(`request-${REQUEST_IDS[0]}`)).getByText(ar.myCourses.requests.cancel).closest('button')!)
    fireEvent.click((await screen.findByText(ar.myCourses.requests.cancelOk)).closest('button')!)
    expect(await screen.findByText(ar.catalog.errors.request_has_payments)).toBeInTheDocument()
    await waitFor(() => expect(api.urls.filter((url) => url === '/api/me/enrollment-requests')).toHaveLength(2))
  })

  it('shows the rejection reason and the waiting-for-approval hint', async () => {
    mockMyCoursesApi(
      [
        makeMyRequest({ id: REQUEST_IDS[1], status: 'cancelled', state: 'rejected', rejectionReason: 'يلزم اختبار تحديد المستوى أولاً', decidedAt: '2026-11-19T11:00:00.000Z' }),
        makeMyRequest({ id: REQUEST_IDS[2], state: 'pending_approval', payment: { state: 'paid', required: true, total: 1200, paid: 1200, balance: 0, currency: 'SAR', invoices: [] } }),
      ],
      [],
    )
    renderPage()
    const rejected = within(await screen.findByTestId(`request-${REQUEST_IDS[1]}`))
    expect(rejected.getByText(ar.catalog.states.rejected)).toBeInTheDocument()
    expect(rejected.getByText(ar.myCourses.requests.rejectionReason)).toBeInTheDocument()
    expect(rejected.getByText('يلزم اختبار تحديد المستوى أولاً')).toBeInTheDocument()
    expect(rejected.queryByText(ar.myCourses.requests.cancel)).not.toBeInTheDocument()
    const approval = within(requestCard(REQUEST_IDS[2]))
    expect(approval.getByText(ar.myCourses.requests.approvalHint)).toBeInTheDocument()
    expect(approval.getByText(ar.myCourses.paymentStates.paid)).toBeInTheDocument()
  })

  it('shows a guardian the children’s courses and no request section', async () => {
    const child = makeMyClassItem({ enrollmentId: ENROLLMENT_IDS[1], relation: 'child', student: { id: STUDENT_IDS[1], fullName: 'ليلى سعيد', displayName: null } })
    const api = mockMyCoursesApi([], [child])
    renderPage(['guardian'])
    expect(await screen.findByText('ليلى سعيد')).toBeInTheDocument()
    expect(screen.getByText(ar.myClasses.relation.child)).toBeInTheDocument()
    expect(screen.queryByTestId('my-requests')).not.toBeInTheDocument()
    expect(api.urls).toEqual(['/api/me/classes'])
  })

  it('offers the catalog when nothing is enrolled yet', async () => {
    mockMyCoursesApi([], [])
    renderPage()
    expect(await screen.findByText(ar.myCourses.requests.empty)).toBeInTheDocument()
    const courses = within(screen.getByTestId('my-courses'))
    expect(await courses.findByText(ar.myCourses.courses.empty)).toBeInTheDocument()
    fireEvent.click(courses.getByText(ar.myCourses.explore).closest('button')!)
    expect((await screen.findByTestId('location')).getAttribute('data-pathname')).toBe('/catalog')
  })
})
