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
    routes: { '/my-school': <LocationProbe />, '/payments': <LocationProbe />, '/catalog': <LocationProbe />, '/my-lessons': <LocationProbe /> },
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
    expect(offer.getByText(ar.catalog.card.enroll)).toBeInTheDocument()
  })

  it('enrolls in a free course after a confirmation, says so, and reads the course again', async () => {
    const api = mockCourseApi(makeCatalogDetail(), makeEnrollResult())
    renderPage()
    await screen.findByText('أساسيات بايثون')

    fireEvent.click(within(classCard()).getByText(ar.catalog.card.enroll).closest('button')!)
    const dialog = await confirmDialog(ar.catalog.confirm.freeTitle)
    expect(within(dialog).getByText('سيُفعَّل تسجيلك في فصل «بايثون — الفصل أ» فوراً، وتظهر دروسه في صفحاتك.')).toBeInTheDocument()
    expect(api.posts).toHaveLength(0)
    fireEvent.click(within(dialog).getByText(ar.catalog.confirm.ok).closest('button')!)

    expect(await screen.findByText(ar.catalog.result.enrolledTitle)).toBeInTheDocument()
    expect(screen.getByText('صار تسجيلك في فصل «بايثون — الفصل أ» مفعّلاً.')).toBeInTheDocument()
    expect(api.posts).toEqual([{ url: ENROLL_PATH, body: {} }])
    await waitFor(() => expect(api.reads).toBe(2))
    fireEvent.click(screen.getByText(ar.catalog.result.myCourses).closest('button')!)
    expect((await screen.findByTestId('location')).getAttribute('data-pathname')).toBe('/my-school')
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

    fireEvent.click(within(classCard()).getByText(ar.catalog.card.request).closest('button')!)
    const dialog = await confirmDialog(ar.catalog.confirm.paidTitle)
    expect(dialog.textContent).toContain(price)
    expect(dialog.textContent).toContain('لا يُفعَّل الاشتراك إلا بعد تأكيد الدفع وموافقة إدارة الأكاديمية معاً.')
    fireEvent.click(within(dialog).getByText(ar.catalog.confirm.ok).closest('button')!)

    expect(await screen.findByText(ar.catalog.result.requestedTitle)).toBeInTheDocument()
    expect(document.body.textContent).toContain('صدرت الفاتورة INV-2026-00082')
    expect(api.posts).toHaveLength(1)
    fireEvent.click(screen.getByText(ar.catalog.result.invoices).closest('button')!)
    expect((await screen.findByTestId('location')).getAttribute('data-pathname')).toBe('/payments')
  })

  it('says why the server refused, and reads the course again', async () => {
    const api = mockCourseApi(
      (read) => (read === 1 ? makeCatalogDetail() : makeCatalogDetail({ classes: [makeCatalogClass({ enrollable: false, blocker: 'class_full', seatsLeft: 0, enrolledCount: 20 })] })),
      jsonResponse(409, { statusCode: 409, code: 'class_full', message: 'full', capacity: 20, enrolledCount: 20 }),
    )
    renderPage()
    await screen.findByText('أساسيات بايثون')
    fireEvent.click(within(classCard()).getByText(ar.catalog.card.enroll).closest('button')!)
    fireEvent.click(within(await confirmDialog(ar.catalog.confirm.freeTitle)).getByText(ar.catalog.confirm.ok).closest('button')!)

    expect(await screen.findByText(ar.catalog.errors.class_full)).toBeInTheDocument()
    await waitFor(() => expect(api.reads).toBe(2))
    expect(await within(classCard()).findByText(ar.catalog.blockers.class_full)).toBeInTheDocument()
    expect(within(classCard()).queryByText(ar.catalog.card.enroll)).not.toBeInTheDocument()
    expect(screen.getByText(ar.catalog.detail.unavailable)).toBeInTheDocument()
  })

  it('explains to a reader who may not enroll themself why, and offers no button', async () => {
    mockCourseApi(makeCatalogDetail({ selfService: { allowed: false, reason: 'not_a_student' }, classes: [makeCatalogClass({ enrollable: false, blocker: 'not_allowed' })] }))
    renderPage(['guardian'])
    expect(await screen.findByText(ar.catalog.selfService.not_a_student)).toBeInTheDocument()
    expect(within(classCard()).queryByText(ar.catalog.card.enroll)).not.toBeInTheDocument()
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
})
