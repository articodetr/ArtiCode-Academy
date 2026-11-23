// MOD-19 — a course of the catalog (API-220) and the self-service enrollment (API-221): what the page shows of the
// server's answer, the confirmation before a request, the outcome, the refusals, and the re-read after every attempt.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogCourseDetail, CatalogEnrollResult } from '../api/catalog'
import { ar } from '../i18n/ar'
import { formatMoney } from '../payments/payments.format'
import { CATALOG_CLASS_IDS, CATALOG_COURSE_IDS, makeCatalogClass, makeCatalogDetail, makeEnrollResult, makeMyRequest, makeRequestInvoice } from '../test/catalog'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { CatalogCoursePage } from './CatalogCoursePage'

const COURSE_PATH = `/api/catalog/courses/${CATALOG_COURSE_IDS[0]}`
const ENROLL_PATH = `/api/catalog/classes/${CATALOG_CLASS_IDS[0]}/enroll`

interface Api {
  reads: number
  posts: { url: string; body: unknown }[]
}

function mockCourseApi(detail: CatalogCourseDetail | Response | ((read: number) => CatalogCourseDetail), enroll?: CatalogEnrollResult | Response): Api {
  const api: Api = { reads: 0, posts: [] }
  mockFetch((url, init) => {
    if (init?.method === 'POST') {
      api.posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined })
      if (enroll instanceof Response) return enroll
      return jsonResponse(201, enroll ?? makeEnrollResult())
    }
    if (url === COURSE_PATH) {
      api.reads += 1
      if (detail instanceof Response) return detail
      return jsonResponse(200, typeof detail === 'function' ? detail(api.reads) : detail)
    }
    return jsonResponse(404, { statusCode: 404, message: 'unexpected' })
  })
  return api
}

function renderPage(roles: string[] = ['student']) {
  return renderWithProviders(<CatalogCoursePage />, {
    auth: makeAuth({ user: makeUser({ id: 'st-1', role: 'student', roles, permissions: ['courses.read', 'enrollments.self_enroll'] }) }),
    route: `/catalog/${CATALOG_COURSE_IDS[0]}`,
    path: '/catalog/:courseId',
    routes: { '/my-classes': <LocationProbe />, '/payments': <LocationProbe />, '/catalog': <LocationProbe />, '/my-lessons': <LocationProbe />, '/learn/:courseId': <LocationProbe /> },
  })
}

const classCard = (id: string = CATALOG_CLASS_IDS[0]) => screen.getByTestId(`catalog-class-${id}`)

async function confirmDialog(title: string): Promise<HTMLElement> {
  const [heading] = await screen.findAllByText(title)
  return heading!.closest('[role="dialog"]') as HTMLElement
}

describe('CatalogCoursePage', () => {
  it('shows the course, its syllabus and its open class with the weekly times and seats', async () => {
    const zoned = makeCatalogClass({ schedule: [{ weekday: 1, startTime: '17:00', endTime: '18:30', timeZone: 'Pacific/Kiritimati', effectiveFrom: '2026-11-01', effectiveTo: '2027-02-28' }] })
    mockCourseApi(makeCatalogDetail({ classes: [zoned] }))
    renderPage()

    expect(await screen.findByText('أساسيات بايثون')).toBeInTheDocument()
    expect(screen.getByText('مبتدئ')).toBeInTheDocument()
    expect(screen.getByText(ar.catalog.free)).toBeInTheDocument()
    expect(screen.getByText('من 12 إلى 18 سنة')).toBeInTheDocument()
    expect(screen.getByText('تتعلم في هذه الدورة المتغيرات والدوال والحلقات.')).toBeInTheDocument()
    expect(screen.getByText('المتغيرات')).toBeInTheDocument()
    expect(screen.getByText('تعريف الدوال واستدعاؤها')).toBeInTheDocument()
    expect(screen.getByText(ar.catalog.detail.lockedNote)).toBeInTheDocument()

    const offer = within(classCard())
    expect(offer.getByText('بايثون — الفصل أ')).toBeInTheDocument()
    expect(offer.getByText('PY-101-A')).toBeInTheDocument()
    expect(offer.getByText(ar.labels.open)).toBeInTheDocument()
    expect(offer.getByText('خالد المعلم')).toBeInTheDocument()
    expect(offer.getByText('15')).toBeInTheDocument()
    expect(offer.getByText(ar.days.mon)).toBeInTheDocument()
    expect(offer.getByText('17:00–18:30')).toBeInTheDocument()
    expect(offer.getByText('بتوقيت Pacific/Kiritimati')).toBeInTheDocument()
    expect(offer.getByText(ar.catalog.class.scheduleNote)).toBeInTheDocument()
    // The only enrollable class is the obvious choice.
    expect(offer.getByText(ar.catalog.class.recommended)).toBeInTheDocument()
    expect(offer.getByText(ar.catalog.class.enroll)).toBeInTheDocument()
  })

  it('enrolls in a free course after a confirmation, says so, and reads the course again', async () => {
    const api = mockCourseApi(makeCatalogDetail(), makeEnrollResult())
    const { unmount } = renderPage()
    await screen.findByText('أساسيات بايثون')

    fireEvent.click(within(classCard()).getByText(ar.catalog.class.enroll).closest('button')!)
    const dialog = await confirmDialog(ar.catalog.confirm.freeTitle)
    expect(within(dialog).getByText('سيُفعَّل التحاقك بفصل «بايثون — الفصل أ» فور تأكيدك، وتظهر الدورة في «فصولي».')).toBeInTheDocument()
    expect(api.posts).toHaveLength(0)
    fireEvent.click(within(dialog).getByText(ar.catalog.confirm.freeOk).closest('button')!)

    const enrolled = await screen.findByTestId('catalog-enrolled')
    expect(enrolled).toHaveTextContent(ar.catalog.result.enrolledTitle)
    expect(screen.getByText('صار تسجيلك في فصل «بايثون — الفصل أ» مفعّلاً.')).toBeInTheDocument()
    expect(api.posts).toEqual([{ url: ENROLL_PATH, body: {} }])
    await waitFor(() => expect(api.reads).toBe(2))
    // PORTAL-04: the way on is to learn, or «My School».
    fireEvent.click(within(enrolled).getByText(ar.catalog.result.startLearning).closest('button')!)
    expect((await screen.findByTestId('location')).getAttribute('data-pathname')).toBe(`/learn/${CATALOG_COURSE_IDS[0]}`)
    unmount()

    mockCourseApi(makeCatalogDetail(), makeEnrollResult())
    renderPage()
    await screen.findByText('أساسيات بايثون')
    fireEvent.click(within(classCard()).getByText(ar.catalog.class.enroll).closest('button')!)
    fireEvent.click(within(await confirmDialog(ar.catalog.confirm.freeTitle)).getByText(ar.catalog.confirm.freeOk).closest('button')!)
    fireEvent.click(within(await screen.findByTestId('catalog-enrolled')).getByText(ar.catalog.result.goToMySchool).closest('button')!)
    expect((await screen.findByTestId('location')).getAttribute('data-pathname')).toBe('/my-classes')
  })

  it('opens one confirmation and sends one request however often the button is pressed (PORTAL-04)', async () => {
    const api = mockCourseApi(makeCatalogDetail(), makeEnrollResult())
    renderPage()
    await screen.findByText('أساسيات بايثون')
    const button = within(classCard()).getByText(ar.catalog.class.enroll).closest('button')!
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)
    const dialog = await confirmDialog(ar.catalog.confirm.freeTitle)
    expect(document.querySelectorAll('.ant-modal-confirm').length).toBe(1)
    const ok = within(dialog).getByText(ar.catalog.confirm.freeOk).closest('button')!
    fireEvent.click(ok)
    fireEvent.click(ok)
    expect(await screen.findByTestId('catalog-enrolled')).toBeInTheDocument()
    expect(api.posts).toHaveLength(1)
  })

  it('never says «enrolled» without an answer: a dropped connection says the outcome is unknown and offers to read the course again (PORTAL-04)', async () => {
    let reads = 0
    const posts: string[] = []
    mockFetch((url, init) => {
      if (init?.method === 'POST') {
        posts.push(url)
        return Promise.reject(new TypeError('Failed to fetch'))
      }
      if (url === COURSE_PATH) {
        reads += 1
        // The third read (the «reload» button) finds the enrollment the lost answer had made.
        const enrolledNow = makeCatalogDetail({
          mine: { enrolled: true, pending: false },
          classes: [makeCatalogClass({ enrollable: false, blocker: 'already_enrolled', myEnrollment: { id: 'e-1', status: 'active', state: 'enrolled' } })],
        })
        return jsonResponse(200, reads < 3 ? makeCatalogDetail() : enrolledNow)
      }
      return jsonResponse(404, { statusCode: 404, message: 'unexpected' })
    })
    renderPage()
    await screen.findByText('أساسيات بايثون')
    fireEvent.click(within(classCard()).getByText(ar.catalog.class.enroll).closest('button')!)
    fireEvent.click(within(await confirmDialog(ar.catalog.confirm.freeTitle)).getByText(ar.catalog.confirm.freeOk).closest('button')!)

    const failure = await screen.findByTestId('catalog-enroll-failure')
    expect(failure).toHaveTextContent(ar.catalog.errors.network)
    expect(failure).toHaveTextContent(ar.catalog.detail.enrollUnknown)
    expect(screen.queryByTestId('catalog-enrolled')).not.toBeInTheDocument()
    expect(posts).toHaveLength(1)
    await waitFor(() => expect(reads).toBe(2))
    // The automatic re-read has to land first: a loading antd button ignores a click.
    const reloadButton = within(failure).getByText(ar.catalog.detail.reloadCourse).closest('button')!
    await waitFor(() => expect(reloadButton).not.toHaveClass('ant-btn-loading'))

    fireEvent.click(reloadButton)
    const standing = await screen.findByTestId('catalog-standing')
    expect(standing).toHaveAttribute('data-standing', 'studying')
    // The server has answered now: the «unknown outcome» alert goes, and nothing was sent again.
    await waitFor(() => expect(screen.queryByTestId('catalog-enroll-failure')).not.toBeInTheDocument())
    expect(posts).toHaveLength(1)
  })

  it('claims no success for an answer that is not an active enrollment', async () => {
    const odd = makeEnrollResult({ enrollment: makeMyRequest({ status: 'pending', state: 'pending_approval' }) })
    const api = mockCourseApi(makeCatalogDetail(), odd)
    renderPage()
    await screen.findByText('أساسيات بايثون')
    fireEvent.click(within(classCard()).getByText(ar.catalog.class.enroll).closest('button')!)
    fireEvent.click(within(await confirmDialog(ar.catalog.confirm.freeTitle)).getByText(ar.catalog.confirm.freeOk).closest('button')!)
    await waitFor(() => expect(api.reads).toBe(2))
    expect(api.posts).toHaveLength(1)
    expect(screen.queryByTestId('catalog-enrolled')).not.toBeInTheDocument()
    expect(screen.queryByText(ar.catalog.result.enrolledTitle)).not.toBeInTheDocument()
  })

  it('requests a paid course: the confirmation names the price and the two conditions, the answer names the invoice', async () => {
    const paid = makeCatalogDetail({ pricing: 'paid', price: { amount: 1200, currency: 'SAR', installments: 2 } })
    const requested = makeEnrollResult({ outcome: 'requested', enrollment: makeMyRequest({ payment: { state: 'unpaid', required: true, total: 1200, paid: 0, balance: 1200, currency: 'SAR', invoices: [makeRequestInvoice()] } }) })
    const api = mockCourseApi(paid, requested)
    renderPage()
    await screen.findByText('أساسيات بايثون')
    const price = formatMoney(1200, 'SAR', 'ar')
    expect(document.body.textContent).toContain(price)
    expect(screen.getByText(ar.catalog.detail.installments)).toBeInTheDocument()

    fireEvent.click(within(classCard()).getByText(ar.catalog.class.request).closest('button')!)
    const dialog = await confirmDialog(ar.catalog.confirm.paidTitle)
    expect(dialog.textContent).toContain(price)
    // PORTAL-04: sending the request does not start the studies — the payment AND the approval come first.
    expect(dialog.textContent).toContain('إرسال الطلب لا يفعّل الدراسة: لا يُفعَّل الالتحاق ولا تُفتح الدروس إلا بعد تأكيد الدفع وموافقة إدارة الأكاديمية معاً.')
    expect(api.posts).toHaveLength(0)
    fireEvent.click(within(dialog).getByText(ar.catalog.confirm.paidOk).closest('button')!)

    const requestedPanel = await screen.findByTestId('catalog-requested')
    expect(requestedPanel).toHaveTextContent(ar.catalog.result.requestedTitle)
    // The server's state of the request, and the invoice it issued.
    expect(requestedPanel).toHaveTextContent(ar.catalog.states.pending_payment)
    expect(requestedPanel.textContent).toContain('صدرت الفاتورة INV-2026-00082')
    // No way into the lessons from a request.
    expect(within(requestedPanel).queryByText(ar.catalog.result.startLearning)).not.toBeInTheDocument()
    expect(screen.queryByTestId('catalog-enrolled')).not.toBeInTheDocument()
    expect(api.posts).toHaveLength(1)
    fireEvent.click(within(requestedPanel).getByText(ar.catalog.result.invoices).closest('button')!)
    expect((await screen.findByTestId('location')).getAttribute('data-pathname')).toBe('/payments')
  })

  it('leads a sent request to «my requests» in My School (PORTAL-04)', async () => {
    const paid = makeCatalogDetail({ pricing: 'paid', price: { amount: 1200, currency: 'SAR', installments: 1 } })
    mockCourseApi(paid, makeEnrollResult({ outcome: 'requested', enrollment: makeMyRequest() }))
    renderPage()
    await screen.findByText('أساسيات بايثون')
    fireEvent.click(within(classCard()).getByText(ar.catalog.class.request).closest('button')!)
    fireEvent.click(within(await confirmDialog(ar.catalog.confirm.paidTitle)).getByText(ar.catalog.confirm.paidOk).closest('button')!)
    fireEvent.click(within(await screen.findByTestId('catalog-requested')).getByText(ar.catalog.result.myRequests).closest('button')!)
    const location = await screen.findByTestId('location')
    expect(location.getAttribute('data-pathname')).toBe('/my-classes')
  })

  it('claims no request for an answer that is not a pending request', async () => {
    const paid = makeCatalogDetail({ pricing: 'paid', price: { amount: 1200, currency: 'SAR', installments: 1 } })
    const api = mockCourseApi(paid, makeEnrollResult({ outcome: 'requested', enrollment: makeMyRequest({ status: 'cancelled', state: 'cancelled' }) }))
    renderPage()
    await screen.findByText('أساسيات بايثون')
    fireEvent.click(within(classCard()).getByText(ar.catalog.class.request).closest('button')!)
    fireEvent.click(within(await confirmDialog(ar.catalog.confirm.paidTitle)).getByText(ar.catalog.confirm.paidOk).closest('button')!)
    await waitFor(() => expect(api.reads).toBe(2))
    expect(api.posts).toHaveLength(1)
    expect(screen.queryByTestId('catalog-requested')).not.toBeInTheDocument()
  })

  it('says why the server refused, and reads the course again', async () => {
    const api = mockCourseApi(
      (read) => (read === 1 ? makeCatalogDetail() : makeCatalogDetail({ classes: [makeCatalogClass({ enrollable: false, blocker: 'class_full', seatsLeft: 0, enrolledCount: 20 })] })),
      jsonResponse(409, { statusCode: 409, code: 'class_full', message: 'full', capacity: 20, enrolledCount: 20 }),
    )
    renderPage()
    await screen.findByText('أساسيات بايثون')
    fireEvent.click(within(classCard()).getByText(ar.catalog.class.enroll).closest('button')!)
    fireEvent.click(within(await confirmDialog(ar.catalog.confirm.freeTitle)).getByText(ar.catalog.confirm.freeOk).closest('button')!)

    expect(await screen.findByText(ar.catalog.errors.class_full)).toBeInTheDocument()
    // A refusal the server explained is no unknown outcome: no «reload» offer.
    expect(screen.queryByText(ar.catalog.detail.enrollUnknown)).not.toBeInTheDocument()
    await waitFor(() => expect(api.reads).toBe(2))
    expect(await within(classCard()).findByText(ar.catalog.blockers.class_full)).toBeInTheDocument()
    expect(within(classCard()).queryByText(ar.catalog.class.enroll)).not.toBeInTheDocument()
    expect(screen.getByText(ar.catalog.detail.unavailable)).toBeInTheDocument()
  })

  it('explains to a reader who may not enroll themself why, and offers no button', async () => {
    mockCourseApi(makeCatalogDetail({ selfService: { allowed: false, reason: 'not_a_student' }, classes: [makeCatalogClass({ enrollable: false, blocker: 'not_allowed' })] }))
    renderPage(['guardian'])
    expect(await screen.findByText(ar.catalog.selfService.not_a_student)).toBeInTheDocument()
    expect(within(classCard()).queryByText(ar.catalog.class.enroll)).not.toBeInTheDocument()
    expect(within(classCard()).queryByText(ar.catalog.blockers.not_allowed)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.catalog.detail.unavailable)).not.toBeInTheDocument()
  })

  it('shows the reader’s own request on its class and no «unavailable» notice', async () => {
    const mine = makeCatalogClass({ enrollable: false, blocker: 'request_pending', myEnrollment: { id: 'e-1', status: 'pending', state: 'pending_payment' } })
    mockCourseApi(makeCatalogDetail({ mine: { enrolled: false, pending: true }, classes: [mine] }))
    renderPage()
    expect(await within(await screen.findByTestId(`catalog-class-${CATALOG_CLASS_IDS[0]}`)).findByText(ar.catalog.states.pending_payment)).toBeInTheDocument()
    expect(screen.getAllByText(ar.catalog.card.pending).length).toBeGreaterThan(0)
    expect(screen.queryByText(ar.catalog.detail.unavailable)).not.toBeInTheDocument()
  })

  it('says «not available right now» when no class is open', async () => {
    mockCourseApi(makeCatalogDetail({ classes: [] }))
    renderPage()
    expect(await screen.findByText(ar.catalog.detail.unavailable)).toBeInTheDocument()
    expect(screen.getByText(ar.catalog.detail.noClasses)).toBeInTheDocument()
  })

  it('shows a page-level notice for a course that is gone, with the way back', async () => {
    mockCourseApi(jsonResponse(404, { statusCode: 404, code: 'course_not_found', message: 'gone', courseId: CATALOG_COURSE_IDS[0] }))
    renderPage()
    expect(await screen.findByText(ar.catalog.detail.notFound)).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.catalog.detail.back).closest('button')!)
    expect((await screen.findByTestId('location')).getAttribute('data-pathname')).toBe('/catalog')
  })
})

/** Where a button led: path and query. */
function PathProbe() {
  const location = useLocation()
  return <output data-testid="path">{`${location.pathname}${location.search}`}</output>
}

/** The query string of the page (the enroll intent leaves it — replace). */
function SearchProbe() {
  const location = useLocation()
  return <output data-testid="search">{location.search}</output>
}

describe('CatalogCoursePage — the enroll intent after the sign-in (MOD-20, D-R138)', () => {
  const scrollIntoView = vi.fn()
  const original = Element.prototype.scrollIntoView

  beforeEach(() => {
    scrollIntoView.mockClear()
    // jsdom lays nothing out and has no scrollIntoView.
    Element.prototype.scrollIntoView = scrollIntoView
  })
  afterEach(() => {
    Element.prototype.scrollIntoView = original
  })

  function renderWithIntent(search: string, roles: string[] = ['student']) {
    return renderWithProviders(
      <>
        <CatalogCoursePage />
        <SearchProbe />
      </>,
      {
        auth: makeAuth({ user: makeUser({ id: 'st-1', role: 'student', roles, permissions: ['courses.read', 'enrollments.self_enroll'] }) }),
        route: `/catalog/${CATALOG_COURSE_IDS[0]}${search}`,
        path: '/catalog/:courseId',
        routes: { '/learn/:courseId': <PathProbe />, '/my-classes': <PathProbe /> },
      },
    )
  }

  const classes = () => screen.getByTestId('catalog-classes')

  it('brings the classes into view with «اختر الفصل…», drops the intent from the URL, and enrolls nobody by itself', async () => {
    const api = mockCourseApi(makeCatalogDetail())
    renderWithIntent('?intent=enroll')

    expect(await within(await screen.findByTestId('catalog-classes')).findByText(ar.catalog.detail.intentNotice)).toBeInTheDocument()
    expect(classes()).toHaveAttribute('data-intent', 'enroll')
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect(scrollIntoView.mock.contexts[0]).toBe(classes().parentElement)
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
    // The notice stays once the parameter has gone; the learner still chooses and confirms.
    expect(within(classes()).getByText(ar.catalog.detail.intentNotice)).toBeInTheDocument()
    expect(api.posts).toEqual([])
    expect(screen.queryByText(ar.catalog.confirm.freeTitle)).not.toBeInTheDocument()

    // Closing the notice takes the highlight with it.
    fireEvent.click(within(classes()).getByLabelText(/close|إغلاق/i))
    await waitFor(() => expect(within(classes()).queryByText(ar.catalog.detail.intentNotice)).not.toBeInTheDocument())
    expect(classes()).not.toHaveAttribute('data-intent')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('keeps any other parameter and shows nothing special without the intent', async () => {
    mockCourseApi(makeCatalogDetail())
    renderWithIntent('?from=home')

    await screen.findByText('أساسيات بايثون')
    expect(within(classes()).queryByText(ar.catalog.detail.intentNotice)).not.toBeInTheDocument()
    expect(classes()).not.toHaveAttribute('data-intent')
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(screen.getByTestId('search').textContent).toBe('?from=home')
  })

  it('still brings the classes into view for a reader who may not enroll themself, without the notice', async () => {
    mockCourseApi(makeCatalogDetail({ selfService: { allowed: false, reason: 'not_a_student' }, classes: [makeCatalogClass({ enrollable: false, blocker: 'not_allowed' })] }))
    renderWithIntent('?intent=enroll', ['guardian'])

    expect(await screen.findByText(ar.catalog.selfService.not_a_student)).toBeInTheDocument()
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect(within(classes()).queryByText(ar.catalog.detail.intentNotice)).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
  })

  // PORTAL-04, the learner journey — stage 2: what the page says to a visitor who comes back from the sign-in.
  it('never says «اختر الفصل…» when no class takes the reader now: the reason shows instead', async () => {
    const api = mockCourseApi(makeCatalogDetail({ classes: [makeCatalogClass({ enrollable: false, blocker: 'class_full', seatsLeft: 0, enrolledCount: 20 })] }))
    renderWithIntent('?intent=enroll')

    expect(await screen.findByText(ar.catalog.detail.unavailable)).toBeInTheDocument()
    expect(within(classCard()).getByText(ar.catalog.blockers.class_full)).toBeInTheDocument()
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('catalog-intent-notice')).not.toBeInTheDocument()
    expect(within(classCard()).queryByText(ar.catalog.class.enroll)).not.toBeInTheDocument()
    expect(api.posts).toEqual([])
  })

  it('offers «واصل التعلم» to a student who already studies the course, instead of a second request', async () => {
    const api = mockCourseApi(
      makeCatalogDetail({
        mine: { enrolled: true, pending: false },
        classes: [makeCatalogClass({ enrollable: false, blocker: 'already_enrolled', myEnrollment: { id: 'e-1', status: 'active', state: 'enrolled' } })],
      }),
    )
    renderWithIntent('?intent=enroll')

    const standing = await screen.findByTestId('catalog-standing')
    expect(standing).toHaveAttribute('data-standing', 'studying')
    expect(standing).toHaveTextContent(ar.catalog.detail.mine.studyingTitle)
    expect(screen.queryByTestId('catalog-intent-notice')).not.toBeInTheDocument()
    expect(screen.queryByText(ar.catalog.detail.unavailable)).not.toBeInTheDocument()
    // «opens after your enrollment is activated» is no news to an enrolled student.
    expect(screen.queryByText(ar.catalog.detail.lockedNote)).not.toBeInTheDocument()
    fireEvent.click(within(standing).getByText(ar.catalog.detail.mine.continue).closest('button')!)
    expect((await screen.findByTestId('path')).textContent).toBe(`/learn/${CATALOG_COURSE_IDS[0]}`)
    expect(api.posts).toEqual([])
  })

  it('offers the review of a completed course, and the way to «my requests» for a pending one', async () => {
    mockCourseApi(makeCatalogDetail({ classes: [makeCatalogClass({ enrollable: false, blocker: 'already_enrolled', myEnrollment: { id: 'e-1', status: 'completed', state: 'completed' } })] }))
    const { unmount } = renderWithIntent('?intent=enroll')
    const completed = await screen.findByTestId('catalog-standing')
    expect(completed).toHaveAttribute('data-standing', 'completed')
    expect(within(completed).getByText(ar.catalog.detail.mine.review)).toBeInTheDocument()
    unmount()

    mockCourseApi(
      makeCatalogDetail({
        mine: { enrolled: false, pending: true },
        classes: [makeCatalogClass({ enrollable: false, blocker: 'request_pending', myEnrollment: { id: 'e-2', status: 'pending', state: 'pending_approval' } })],
      }),
    )
    renderWithIntent('?intent=enroll')
    const pending = await screen.findByTestId('catalog-standing')
    expect(pending).toHaveAttribute('data-standing', 'pending')
    expect(pending).toHaveTextContent(ar.catalog.states.pending_approval)
    // A pending request is no place to study: no way into the learning space from here.
    expect(within(pending).queryByText(ar.catalog.detail.mine.continue)).not.toBeInTheDocument()
    expect(screen.queryByTestId('catalog-intent-notice')).not.toBeInTheDocument()
    // Awaiting the approval: nothing to pay, so no «my invoices» here.
    expect(within(pending).queryByText(ar.catalog.result.invoices)).not.toBeInTheDocument()
    fireEvent.click(within(pending).getByText(ar.catalog.detail.mine.requests).closest('button')!)
    expect((await screen.findByTestId('path')).textContent).toBe('/my-classes?section=requests')
  })
})
