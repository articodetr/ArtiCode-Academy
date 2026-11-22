// MOD-20 (D-R138) — one course of the public catalog (/explore/:courseId, API-237): the course and its outline by level
// (titles only), the price, «سجّل في هذه الدورة» → the sign-in page with the enroll intent, the closed catalog, a missing
// course, a failure, and that a signed-in user goes to the signed-in course page instead.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { ACADEMY_PUBLIC_PATH } from '../api/academy'
import { PUBLIC_CATALOG_PATH } from '../api/publicCatalog'
import type { PublicCourseDetail } from '../api/publicCatalog'
import { ar } from '../i18n/ar'
import { formatMoney } from '../payments/payments.format'
import { makePublicAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { CATALOG_NOT_PUBLIC, PUBLIC_COURSE_IDS, makePublicDetail } from '../test/publicCatalog'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { PublicCoursePage } from './PublicCoursePage'

const pc = ar.publicCatalog
const COURSE_ID = PUBLIC_COURSE_IDS[0]
const COURSE_PATH = `${PUBLIC_CATALOG_PATH}/${COURSE_ID}`

/** Where the page navigated (pathname + query) and with which router state. */
function PathProbe() {
  const location = useLocation()
  return (
    <output data-testid="path" data-state={JSON.stringify(location.state ?? null)}>
      {`${location.pathname}${location.search}`}
    </output>
  )
}

/** Serves API-205 and API-237 (`detail` answers each read of the course) and counts the course reads. */
function mockCourseApi(detail: (read: number) => Response) {
  const api = { reads: 0, headers: [] as Headers[] }
  const fetchMock = mockFetch((url, init) => {
    if (url === ACADEMY_PUBLIC_PATH) return jsonResponse(200, makePublicAcademy({ catalogPublic: true }))
    if (url === COURSE_PATH) {
      api.reads += 1
      api.headers.push(new Headers(init?.headers))
      return detail(api.reads)
    }
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })
  })
  return { api, fetchMock }
}

const serve = (detail: PublicCourseDetail) => () => jsonResponse(200, detail)

function renderPage(auth = makeAuth()) {
  return renderWithProviders(<PublicCoursePage />, {
    auth,
    route: `/explore/${COURSE_ID}`,
    path: '/explore/:courseId',
    routes: { '/explore': <PathProbe />, '/login': <PathProbe />, '/catalog/:courseId': <PathProbe /> },
  })
}

describe('PublicCoursePage', () => {
  it('shows the course and its outline by level — titles, kinds and lengths only — read without a token', async () => {
    const { api } = mockCourseApi(serve(makePublicDetail()))
    renderPage()

    expect(await screen.findByText('أساسيات بايثون')).toBeInTheDocument()
    expect(screen.getByText('PY-101')).toBeInTheDocument()
    expect(screen.getByText('مبتدئ')).toBeInTheDocument()
    expect(screen.getByText(pc.card.free)).toBeInTheDocument()
    expect(screen.getByText('24 ساعة')).toBeInTheDocument()
    expect(screen.getByText('12 جلسة')).toBeInTheDocument()
    expect(screen.getByText('5 دروس · مستويان')).toBeInTheDocument()
    expect(screen.getByText('من 12 إلى 18 سنة')).toBeInTheDocument()
    expect(screen.getByText('تتعلم في هذه الدورة المتغيرات والدوال والحلقات.')).toBeInTheDocument()

    const outline = within(screen.getByTestId('public-outline'))
    expect(outline.getByText(pc.course.outlineNote)).toBeInTheDocument()
    // D-R130: «المستوى الأول — title», and the ordinal alone for a level without a title.
    expect(outline.getByText('المستوى الأول — البداية')).toBeInTheDocument()
    expect(outline.getByText('المستوى الثاني')).toBeInTheDocument()
    for (const title of ['ما هي البرمجة؟', 'تثبيت بايثون', 'المتغيرات', 'حصة أسئلة مباشرة']) expect(outline.getByText(title)).toBeInTheDocument()
    expect(outline.getByText(pc.kinds.video)).toBeInTheDocument()
    expect(outline.getByText(pc.kinds.live)).toBeInTheDocument()
    expect(outline.getByText('10 دقائق')).toBeInTheDocument()
    expect(outline.getByText('60 دقيقة')).toBeInTheDocument()
    // The course name is the page's h1, each level an h2, and the lessons a plain ordered list (antd List is deprecated).
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('أساسيات بايثون')
    expect(outline.getByRole('heading', { level: 2, name: 'المستوى الأول — البداية' })).toBeInTheDocument()
    expect(outline.getAllByRole('list')).toHaveLength(2)
    expect(outline.getAllByRole('listitem')).toHaveLength(4)

    expect(api.reads).toBe(1)
    expect(api.headers[0]!.get('Authorization')).toBeNull()
    // PORTAL-04: the tab reads «course — academy».
    await waitFor(() => expect(document.title).toBe('أساسيات بايثون — أكاديمية آرتي كود'))
  })

  it('replaces the enroll button with the reason when no class takes a learner now, keeping the details (PORTAL-04)', async () => {
    const cases: [Partial<PublicCourseDetail>, string][] = [
      [{ openClasses: 0, hasFreeSeat: false }, pc.course.notEnrollable.not_open],
      [{ hasFreeSeat: false }, pc.course.notEnrollable.class_full],
      // The server's real shape: a paid course whose plan cannot price is sent with hasFreeSeat false (courseOfferOf()).
      [{ pricing: 'paid', price: null, hasFreeSeat: false }, pc.course.notEnrollable.price_unavailable],
    ]
    for (const [overrides, reason] of cases) {
      mockCourseApi(serve(makePublicDetail(overrides)))
      const { unmount } = renderPage()
      const notice = within(await screen.findByTestId('public-not-enrollable'))
      expect(notice.getByText(pc.course.notEnrollableTitle)).toBeInTheDocument()
      expect(notice.getByText(reason)).toBeInTheDocument()
      expect(screen.queryByTestId('public-enroll')).not.toBeInTheDocument()
      expect(screen.queryByText(pc.course.enroll)).not.toBeInTheDocument()
      // The details stay readable, and an unusable price is never called «full».
      expect(screen.getByTestId('public-outline')).toBeInTheDocument()
      if (reason === pc.course.notEnrollable.price_unavailable) expect(screen.queryByText(pc.card.full)).not.toBeInTheDocument()
      unmount()
    }
  })

  it('tells a visitor that a paid course becomes a request with an invoice, activated after payment and approval (PORTAL-04)', async () => {
    mockCourseApi(serve(makePublicDetail({ pricing: 'paid', price: { amount: 1200, currency: 'SAR' } })))
    renderPage()
    const enroll = within(await screen.findByTestId('public-enroll'))
    expect(enroll.getByText(pc.course.enroll)).toBeInTheDocument()
    expect(enroll.getByText(pc.course.paidNote)).toBeInTheDocument()
  })

  it('shows the amount of a paid course, and «السعر غير متاح حالياً» — never «مجانية» — when its plan cannot price now', async () => {
    const { unmount } = renderWithPaid({ pricing: 'paid', price: { amount: 1200, currency: 'SAR' } })
    await screen.findByText('أساسيات بايثون')
    expect(document.body.textContent).toContain(formatMoney(1200, 'SAR', 'ar'))
    expect(screen.queryByText(pc.card.free)).not.toBeInTheDocument()
    unmount()

    renderWithPaid({ pricing: 'paid', price: null })
    expect(await screen.findByText(pc.card.priceUnavailable)).toBeInTheDocument()
    expect(screen.queryByText(pc.card.free)).not.toBeInTheDocument()
  })

  it('sends the visitor to the sign-in page with the course and the enroll intent as the way back, and creates no account', async () => {
    mockCourseApi(serve(makePublicDetail()))
    renderPage()
    await screen.findByText('أساسيات بايثون')

    const enroll = within(screen.getByTestId('public-enroll'))
    expect(enroll.getByText(pc.course.enrollNote)).toBeInTheDocument()
    // A free course says nothing about a request or an invoice.
    expect(enroll.queryByText(pc.course.paidNote)).not.toBeInTheDocument()
    fireEvent.click(enroll.getByText(pc.course.enroll).closest('button')!)

    const probe = await screen.findByTestId('path')
    expect(probe.textContent).toBe('/login')
    expect(JSON.parse(probe.getAttribute('data-state')!)).toEqual({ from: `/catalog/${COURSE_ID}?intent=enroll` })
  })

  it('shows the calm «closed» page when the academy does not open its catalog (404 catalog_not_public)', async () => {
    mockCourseApi(() => jsonResponse(404, CATALOG_NOT_PUBLIC))
    renderPage()

    const closed = await screen.findByTestId('catalog-closed')
    expect(within(closed).getByText(pc.closed.title)).toBeInTheDocument()
    expect(screen.queryByText(pc.course.notFound)).not.toBeInTheDocument()
    fireEvent.click(within(closed).getByText(pc.closed.signIn).closest('button')!)
    expect((await screen.findByTestId('path')).textContent).toBe('/login')
  })

  it('says that an unknown or unpublished course does not exist, with the way back to the courses', async () => {
    mockCourseApi(() => jsonResponse(404, { statusCode: 404, code: 'course_not_found', message: 'gone' }))
    renderPage()

    expect(await screen.findByText(pc.course.notFound)).toBeInTheDocument()
    fireEvent.click(screen.getByText(pc.course.back).closest('button')!)
    expect((await screen.findByTestId('path')).textContent).toBe('/explore')
  })

  it('reports another failure with a retry that reads the course again', async () => {
    const { api } = mockCourseApi((read) => (read === 1 ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : jsonResponse(200, makePublicDetail())))
    renderPage()

    expect(await screen.findByText(pc.course.loadError)).toBeInTheDocument()
    expect(screen.getByText(pc.errors.server)).toBeInTheDocument()
    fireEvent.click(screen.getByText(pc.list.retry).closest('button')!)
    expect(await screen.findByText('أساسيات بايثون')).toBeInTheDocument()
    expect(api.reads).toBe(2)
  })

  it('sends a signed-in user (replace) to the course in the signed-in catalog without reading the public one', async () => {
    const { fetchMock } = mockCourseApi(serve(makePublicDetail()))
    renderPage(makeAuth({ user: makeUser({ role: 'student', roles: ['student'] }) }))

    expect((await screen.findByTestId('path')).textContent).toBe(`/catalog/${COURSE_ID}`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows only a spinner while the session check runs', () => {
    const { fetchMock } = mockCourseApi(serve(makePublicDetail()))
    renderPage(makeAuth({ status: 'loading' }))
    expect(screen.getByTestId('public-session-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('public-outline')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

function renderWithPaid(overrides: Partial<PublicCourseDetail>) {
  mockCourseApi(serve(makePublicDetail(overrides)))
  return renderPage()
}
