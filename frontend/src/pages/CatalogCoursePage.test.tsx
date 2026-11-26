// MOD-19 — a course of the catalog (API-220) and the self-service enrollment (API-221): what the page shows of the
// server's answer, the confirmation before a request, the outcome, the refusals, and the re-read after every attempt.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogCourseDetail, CatalogEnrollResult } from '../api/catalog'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import { formatMoney } from '../payments/payments.format'
import { CATALOG_CLASS_IDS, CATALOG_COURSE_IDS, makeCatalogClass, makeCatalogDetail, makeEnrollResult, makeMyRequest, makeRequestInvoice } from '../test/catalog'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { CatalogCoursePage } from './CatalogCoursePage'

// The real hook, with its `reload` in reach: a re-read that no button of the page offers while the intent is alive.
const courseHook = vi.hoisted(() => ({ reload: () => {} }))
vi.mock('../catalog/useCatalogCourse', async (importOriginal) => {
  const real = await importOriginal<typeof import('../catalog/useCatalogCourse')>()
  return {
    useCatalogCourse: (courseId: string) => {
      const value = real.useCatalogCourse(courseId)
      courseHook.reload = value.reload
      return value
    },
  }
})

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
  it('still says what opens after enrolling, and that there are no lessons yet, for a course without a syllabus', async () => {
    mockCourseApi(makeCatalogDetail({ syllabus: [] }))
    renderPage()

    expect(await screen.findByText('أساسيات بايثون')).toBeInTheDocument()
    expect(screen.getByText(ar.catalog.detail.lockedNote)).toBeInTheDocument()
    expect(within(document.querySelector<HTMLElement>('.course-page__hero')!).getByText(ar.publicCatalog.card.lessons)).toBeInTheDocument()
    expect(document.getElementById('course-outline')).toBeNull()
  })

  it('shows the course, its syllabus and its open class with the weekly times and seats', async () => {
    const zoned = makeCatalogClass({ schedule: [{ weekday: 1, startTime: '17:00', endTime: '18:30', timeZone: 'Pacific/Kiritimati', effectiveFrom: '2026-11-01', effectiveTo: '2027-02-28' }] })
    mockCourseApi(makeCatalogDetail({ classes: [zoned] }))
    renderPage()

    expect(await screen.findByText('أساسيات بايثون')).toBeInTheDocument()
    // PORTAL-04: the school subject is both a badge of the band and a fact of the enrollment card — never the difficulty.
    expect(within(document.querySelector<HTMLElement>('.course-page__hero')!).getByText('البرمجة')).toBeInTheDocument()
    expect(within(screen.getByTestId('catalog-enroll-card')).getByText('البرمجة')).toBeInTheDocument()
    expect(screen.queryByText('مبتدئ')).not.toBeInTheDocument()
    expect(screen.getByText(ar.catalog.free)).toBeInTheDocument()
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
    expect(within(dialog).getByText('سيُفعَّل التحاقك بفصل «بايثون — الفصل أ» فور تأكيدك، وتظهر الدورة في «دوراتي».')).toBeInTheDocument()
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
        routes: { '/catalog': <PathProbe />, '/learn/:courseId': <PathProbe />, '/my-classes': <PathProbe /> },
      },
    )
  }

  const classes = () => screen.getByTestId('catalog-classes')

  const twoClasses = () => makeCatalogDetail({ classes: [makeCatalogClass(), makeCatalogClass({ id: CATALOG_CLASS_IDS[1], code: 'PY-101-B', name: { ar: 'بايثون — الفصل ب', en: 'Python — class B' } })] })

  /** The confirmations still open: antd keeps a closed one in the DOM, hidden. */
  const openConfirms = () =>
    [...document.querySelectorAll<HTMLElement>('.ant-modal-confirm')].filter((node) => {
      const wrap = node.closest<HTMLElement>('.ant-modal-wrap')
      return wrap?.style.display !== 'none' && !node.className.includes('-leave') && !wrap?.className.includes('-leave')
    })

  async function cancelConfirm(title: string) {
    fireEvent.click(within(await confirmDialog(title)).getByText(ar.catalog.confirm.cancel).closest('button')!)
    await waitFor(() => expect(openConfirms()).toHaveLength(0))
  }

  it('asks the one class’s confirmation by itself, and sends nothing until the learner confirms', async () => {
    const api = mockCourseApi(makeCatalogDetail(), makeEnrollResult())
    renderWithIntent('?intent=enroll')

    const dialog = await confirmDialog(ar.catalog.confirm.freeTitle)
    expect(within(dialog).getByText('سيُفعَّل التحاقك بفصل «بايثون — الفصل أ» فور تأكيدك، وتظهر الدورة في «دوراتي».')).toBeInTheDocument()
    expect(openConfirms()).toHaveLength(1)
    // The notice behind it has nothing to choose from.
    const notice = within(classes()).getByTestId('catalog-intent-notice')
    expect(notice).toHaveTextContent(ar.catalog.detail.intentNoticeOne)
    expect(notice).not.toHaveTextContent(ar.catalog.detail.intentNotice)
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
    expect(api.posts).toEqual([])

    fireEvent.click(within(dialog).getByText(ar.catalog.confirm.freeOk).closest('button')!)
    expect(await screen.findByTestId('catalog-enrolled')).toBeInTheDocument()
    expect(api.posts).toEqual([{ url: ENROLL_PATH, body: {} }])
  })

  it('keeps the invoice and the two conditions in the question of a paid course', async () => {
    const api = mockCourseApi(makeCatalogDetail({ pricing: 'paid', price: { amount: 1200, currency: 'SAR', installments: 1 } }))
    renderWithIntent('?intent=enroll')

    const dialog = await confirmDialog(ar.catalog.confirm.paidTitle)
    expect(dialog.textContent).toContain(formatMoney(1200, 'SAR', 'ar'))
    expect(dialog.textContent).toContain('إرسال الطلب لا يفعّل الدراسة: لا يُفعَّل الالتحاق ولا تُفتح الدروس إلا بعد تأكيد الدفع وموافقة إدارة الأكاديمية معاً.')
    expect(api.posts).toEqual([])
  })

  it('focuses «تراجع» in the question that opened by itself: Enter sends nothing and issues no invoice', async () => {
    const user = userEvent.setup()
    const api = mockCourseApi(makeCatalogDetail({ pricing: 'paid', price: { amount: 1200, currency: 'SAR', installments: 1 } }))
    renderWithIntent('?intent=enroll')

    const dialog = await confirmDialog(ar.catalog.confirm.paidTitle)
    const cancel = within(dialog).getByText(ar.catalog.confirm.cancel).closest('button')!
    await waitFor(() => expect(document.activeElement).toBe(cancel))

    await user.keyboard('{Enter}')
    await waitFor(() => expect(openConfirms()).toHaveLength(0))
    expect(api.posts).toEqual([])
  })

  it('keeps the focus on the confirm button when the learner opened the question from the class', async () => {
    mockCourseApi(makeCatalogDetail())
    renderWithIntent('')
    await screen.findByText('أساسيات بايثون')

    fireEvent.click(within(classCard()).getByText(ar.catalog.class.enroll).closest('button')!)
    const dialog = await confirmDialog(ar.catalog.confirm.freeTitle)
    const ok = within(dialog).getByText(ar.catalog.confirm.freeOk).closest('button')!
    await waitFor(() => expect(document.activeElement).toBe(ok))
  })

  it('leaves the class and its button after a cancel, and does not ask again after a re-read', async () => {
    const api = mockCourseApi(makeCatalogDetail())
    renderWithIntent('?intent=enroll')

    await cancelConfirm(ar.catalog.confirm.freeTitle)
    expect(api.posts).toEqual([])
    const button = within(classCard()).getByText(ar.catalog.class.enroll).closest('button')!
    expect(button).toBeEnabled()

    // The course is read again while the intent is still alive: the question stays answered.
    act(() => courseHook.reload())
    await waitFor(() => expect(api.reads).toBe(2))
    await waitFor(() => expect(screen.getByTestId('catalog-classes')).toHaveAttribute('aria-busy', 'false'))
    expect(within(classes()).getByTestId('catalog-intent-notice')).toBeInTheDocument()
    expect(openConfirms()).toHaveLength(0)

    // The learner's own press still asks, and only their confirmation would send anything.
    fireEvent.click(within(classCard()).getByText(ar.catalog.class.enroll).closest('button')!)
    await waitFor(() => expect(openConfirms()).toHaveLength(1))
    expect(api.posts).toEqual([])
  })

  it('closes the question when the learner leaves the page, and sends nothing', async () => {
    const api = mockCourseApi(makeCatalogDetail())
    renderWithIntent('?intent=enroll')
    await confirmDialog(ar.catalog.confirm.freeTitle)
    expect(openConfirms()).toHaveLength(1)

    fireEvent.click(screen.getByText(ar.catalog.detail.back).closest('button')!)
    expect((await screen.findByTestId('path')).textContent).toBe('/catalog')
    await waitFor(() => expect(openConfirms()).toHaveLength(0))
    expect(api.posts).toEqual([])
  })

  it('does not ask again after a language change', async () => {
    const api = mockCourseApi(makeCatalogDetail())
    renderWithIntent('?intent=enroll')
    await cancelConfirm(ar.catalog.confirm.freeTitle)

    await act(async () => {
      await i18n.changeLanguage('en')
    })
    try {
      expect(await screen.findByText(en.catalog.detail.classes)).toBeInTheDocument()
      expect(openConfirms()).toHaveLength(0)
      expect(api.posts).toEqual([])
    } finally {
      await act(async () => {
        await i18n.changeLanguage('ar')
      })
    }
  })

  it('asks once under StrictMode', async () => {
    const api = mockCourseApi(makeCatalogDetail())
    renderWithProviders(
      <StrictMode>
        <CatalogCoursePage />
      </StrictMode>,
      {
        auth: makeAuth({ user: makeUser({ id: 'st-1', role: 'student', roles: ['student'], permissions: ['courses.read', 'enrollments.self_enroll'] }) }),
        route: `/catalog/${CATALOG_COURSE_IDS[0]}?intent=enroll`,
        path: '/catalog/:courseId',
      },
    )
    await confirmDialog(ar.catalog.confirm.freeTitle)
    expect(document.querySelectorAll('.ant-modal-confirm')).toHaveLength(1)
    expect(api.posts).toEqual([])
  })

  it('does not ask on a later visit of the page: the intent has left the URL', async () => {
    const api = mockCourseApi(makeCatalogDetail())
    const { unmount } = renderWithIntent('?intent=enroll')
    await cancelConfirm(ar.catalog.confirm.freeTitle)
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
    unmount()

    renderWithIntent('')
    await screen.findByText('أساسيات بايثون')
    await waitFor(() => expect(screen.getByTestId('catalog-classes')).toHaveAttribute('aria-busy', 'false'))
    expect(openConfirms()).toHaveLength(0)
    expect(api.posts).toEqual([])
  })

  it('asks nothing without the intent', async () => {
    const api = mockCourseApi(makeCatalogDetail())
    renderWithIntent('')
    await screen.findByText('أساسيات بايثون')
    await waitFor(() => expect(screen.getByTestId('catalog-classes')).toHaveAttribute('aria-busy', 'false'))
    expect(document.querySelectorAll('.ant-modal-confirm')).toHaveLength(0)
    expect(api.posts).toEqual([])
  })

  it('asks nothing of a learner already enrolled, or with a pending request', async () => {
    const enrolled = makeCatalogDetail({
      mine: { enrolled: true, pending: false },
      classes: [
        makeCatalogClass({ enrollable: false, blocker: 'already_enrolled', myEnrollment: { id: 'e-1', status: 'active', state: 'enrolled' } }),
        makeCatalogClass({ id: CATALOG_CLASS_IDS[1], code: 'PY-101-B' }),
      ],
    })
    const first = mockCourseApi(enrolled)
    const { unmount } = renderWithIntent('?intent=enroll')
    expect(await screen.findByTestId('catalog-standing')).toHaveAttribute('data-standing', 'studying')
    expect(document.querySelectorAll('.ant-modal-confirm')).toHaveLength(0)
    expect(first.posts).toEqual([])
    unmount()

    const pending = makeCatalogDetail({
      mine: { enrolled: false, pending: true },
      classes: [
        makeCatalogClass({ enrollable: false, blocker: 'request_pending', myEnrollment: { id: 'e-2', status: 'pending', state: 'pending_payment' } }),
        makeCatalogClass({ id: CATALOG_CLASS_IDS[1], code: 'PY-101-B' }),
      ],
    })
    const second = mockCourseApi(pending)
    renderWithIntent('?intent=enroll')
    expect(await screen.findByTestId('catalog-standing')).toHaveAttribute('data-standing', 'pending')
    expect(document.querySelectorAll('.ant-modal-confirm')).toHaveLength(0)
    expect(second.posts).toEqual([])
  })

  it('brings the classes into view with «اختر الفصل…», drops the intent from the URL, and enrolls nobody by itself', async () => {
    const api = mockCourseApi(twoClasses())
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

  it('offers «انتقل إلى الدورة» to a student who already studies the course, instead of a second request', async () => {
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
    // No enroll button anywhere: the server would refuse a second enrollment anyway.
    expect(within(classCard()).queryByText(ar.catalog.class.enroll)).not.toBeInTheDocument()
    fireEvent.click(within(standing).getByText(ar.catalog.detail.mine.goToCourse).closest('button')!)
    expect((await screen.findByTestId('path')).textContent).toBe(`/learn/${CATALOG_COURSE_IDS[0]}`)
    expect(api.posts).toEqual([])
  })

  it('leads a completed course to the course too, and a pending one to «my requests» with its state', async () => {
    mockCourseApi(makeCatalogDetail({ classes: [makeCatalogClass({ enrollable: false, blocker: 'already_enrolled', myEnrollment: { id: 'e-1', status: 'completed', state: 'completed' } })] }))
    const { unmount } = renderWithIntent('?intent=enroll')
    const completed = await screen.findByTestId('catalog-standing')
    expect(completed).toHaveAttribute('data-standing', 'completed')
    expect(within(completed).getByText(ar.catalog.detail.mine.goToCourse)).toBeInTheDocument()
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
    expect(within(pending).queryByText(ar.catalog.detail.mine.goToCourse)).not.toBeInTheDocument()
    expect(within(classCard()).queryByText(ar.catalog.class.enroll)).not.toBeInTheDocument()
    expect(within(classCard()).queryByText(ar.catalog.class.request)).not.toBeInTheDocument()
    expect(screen.queryByTestId('catalog-intent-notice')).not.toBeInTheDocument()
    // Awaiting the approval: nothing to pay, so no «my invoices» here.
    expect(within(pending).queryByText(ar.catalog.result.invoices)).not.toBeInTheDocument()
    fireEvent.click(within(pending).getByText(ar.catalog.detail.mine.requests).closest('button')!)
    expect((await screen.findByTestId('path')).textContent).toBe('/my-classes?section=requests')
  })
})

describe('CatalogCoursePage — the facts (PORTAL-04)', () => {
  /** The labels of the enrollment card's facts, in order. */
  const factLabels = () => [...screen.getByTestId('catalog-enroll-card').querySelectorAll('.ant-descriptions-item-label')].map((node) => node.textContent)

  it('reads المادة · المدة · المحتوى · الرسوم, with no difficulty, sessions or age range', async () => {
    mockCourseApi(makeCatalogDetail({ minAge: 12, maxAge: 18, sessionsCount: 12 }))
    renderPage()
    await screen.findByText('أساسيات بايثون')

    expect(factLabels()).toEqual([ar.catalog.card.subject, ar.catalog.card.duration, ar.catalog.card.content, ar.catalog.card.price])
    const card = within(screen.getByTestId('catalog-enroll-card'))
    expect(card.getByText('البرمجة')).toBeInTheDocument()
    expect(card.getByText('درسان')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('مستوى الصعوبة')
    expect(document.body.textContent).not.toContain('الفئة العمرية')
    expect(document.body.textContent).not.toContain('سنة')
    expect(document.body.textContent).not.toContain('جلس')
  })

  it('omits the subject and the duration when the server has none, and keeps the installments after the fees', async () => {
    mockCourseApi(makeCatalogDetail({ subject: null, durationHours: null, pricing: 'paid', price: { amount: 1200, currency: 'SAR', installments: 3 } }))
    renderPage()
    await screen.findByText('أساسيات بايثون')

    expect(factLabels()).toEqual([ar.catalog.card.content, ar.catalog.card.price, ar.catalog.detail.installments])
    expect(screen.getByTestId('catalog-enroll-card').textContent).toContain(formatMoney(1200, 'SAR', 'ar'))
  })
})

describe('CatalogCoursePage — the polished page (PORTAL-04)', () => {
  it('shows the description as paragraphs, a subheading and a list, never the typed ** or - marks', async () => {
    mockCourseApi(makeCatalogDetail({ description: { ar: 'مقدمة الدورة.\n**ماذا ستتعلم؟**\n- المتغيرات\n- الدوال' } }))
    renderPage()
    await screen.findByText('أساسيات بايثون')

    const section = document.getElementById('course-description')!
    expect(within(section).getByRole('heading', { level: 3, name: 'ماذا ستتعلم؟' })).toBeInTheDocument()
    expect(within(section).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['المتغيرات', 'الدوال'])
    expect(within(section).getByText('مقدمة الدورة.')).toBeInTheDocument()
    expect(section.textContent).not.toContain('**')
  })

  it('names the course code at the foot of the card and says the reader’s standing as a pill on the band', async () => {
    mockCourseApi(makeCatalogDetail({ mine: { enrolled: true, pending: false } }))
    renderPage()
    await screen.findByText('أساسيات بايثون')

    const code = screen.getByTestId('catalog-enroll-card').querySelector('.course-enroll__code')!
    expect(code).toHaveTextContent(ar.catalog.detail.code)
    expect(code).toHaveTextContent('PY-101')
    const hero = document.querySelector<HTMLElement>('.course-page__hero')!
    expect(within(hero).getByText(ar.catalog.card.enrolled)).toHaveClass('course-availability--available')
  })
})
