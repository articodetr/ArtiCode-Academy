// MOD-20 (D-R138) — one course of the public catalog (/explore/:courseId, API-237): the course and its outline by level
// (titles only), the price, «اشترك الآن» → the sign-in page with the enroll intent, the closed catalog, a missing
// course, a failure, and that a signed-in user goes to the signed-in course page instead. PORTAL-04: the subject instead
// of the difficulty, no age range and no sessions, the facts order, /login?returnTo=… with the course kept, and — while
// API-205 lets a visitor create an account (by e-mail or through Google) — the note and the dialog of the two ways on,
// «تسجيل الدخول» and «إنشاء حساب جديد», each with the course as returnTo.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { ACADEMY_PUBLIC_PATH } from '../api/academy'
import { PUBLIC_CATALOG_PATH } from '../api/publicCatalog'
import type { PublicCourseDetail } from '../api/publicCatalog'
import { ar } from '../i18n/ar'
import { formatMoney } from '../payments/payments.format'
import { makePublicAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { CATALOG_NOT_PUBLIC, PUBLIC_COURSE_IDS, makePublicDetail } from '../test/publicCatalog'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { KEPT_COURSE_KEY } from '../studentRegistration/keptCourse'
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

function renderPage(auth = makeAuth(), search = '') {
  return renderWithProviders(<PublicCoursePage />, {
    auth,
    route: { pathname: `/explore/${COURSE_ID}`, search },
    path: '/explore/:courseId',
    routes: { '/explore': <PathProbe />, '/login': <PathProbe />, '/catalog/:courseId': <PathProbe /> },
  })
}

/** The band: the page's h1 sits in its header. */
const band = () => within(screen.getByRole('heading', { level: 1 }).closest('header')!)
const SUMMARY = 'مدخل عملي إلى البرمجة'
const DESCRIPTION = 'تتعلم في هذه الدورة المتغيرات والدوال والحلقات.'
const SECTIONS_NAV = { name: pc.course.sectionsNav }
const label = (ar: string) => ({ ar })
/** Where the visitor's buttons lead: the page and the enroll intent as `returnTo`. */
const INTENT = `/catalog/${COURSE_ID}?intent=enroll`
const SIGN_IN = `/login?returnTo=${encodeURIComponent(INTENT)}`
const REGISTER = `/register?returnTo=${encodeURIComponent(INTENT)}`
const keptCourseId = () => {
  const raw = window.localStorage.getItem(KEPT_COURSE_KEY)
  return raw ? (JSON.parse(raw) as { courseId: string }).courseId : null
}

describe('PublicCoursePage', () => {
  beforeEach(() => window.localStorage.clear())

  it('shows the course and its outline by level — titles, kinds and lengths only — read without a token', async () => {
    const { api } = mockCourseApi(serve(makePublicDetail()))
    renderPage()

    expect(await screen.findByText('أساسيات بايثون')).toBeInTheDocument()
    // The band: the badges, the counts, the short text and the availability.
    for (const text of [pc.card.courseType, 'البرمجة', '24 ساعة', '5 دروس · مستويان', SUMMARY, pc.card.available]) expect(band().getByText(text)).toBeInTheDocument()
    // The enrollment card: the subject, the compact facts, the price and the code (PORTAL-04: no difficulty, age or sessions).
    const card = within(screen.getByTestId('public-enroll-card'))
    expect(card.getByText(pc.course.subject)).toBeInTheDocument()
    for (const text of ['PY-101', 'البرمجة', pc.card.free, '24 ساعة', '5 دروس']) expect(card.getByText(text)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('مبتدئ')
    expect(document.body.textContent).not.toContain('جلس')
    expect(document.body.textContent).not.toContain('سنة')
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument()

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
    // The course name is the page's h1, each section an h2, each level a panel, and the lessons a plain ordered list.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('أساسيات بايثون')
    expect(screen.getByRole('heading', { level: 2, name: pc.course.descriptionSection })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: pc.course.outlineSection })).toBeInTheDocument()
    const lists = screen.getByTestId('public-outline').querySelectorAll('ol')
    expect(lists).toHaveLength(2)
    expect(screen.getByTestId('public-outline').querySelectorAll('ol > li')).toHaveLength(4)

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
      expect(screen.queryByTestId(`public-subscribe-${COURSE_ID}`)).not.toBeInTheDocument()
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

  it('keeps the course and sends the visitor to /login?returnTo=<the course with the enroll intent> (PORTAL-04)', async () => {
    mockCourseApi(serve(makePublicDetail()))
    renderPage()
    await screen.findByText('أساسيات بايثون')

    const enroll = within(screen.getByTestId('public-enroll'))
    // Nobody can create an account here: the note invites the sign-in alone.
    expect(enroll.getByTestId('public-enroll-note')).toHaveTextContent(pc.course.signInNote)
    expect(document.body.textContent).not.toContain('إدارة الأكاديمية')
    // A free course says nothing about a request or an invoice.
    expect(enroll.queryByText(pc.course.paidNote)).not.toBeInTheDocument()
    expect(keptCourseId()).toBeNull()
    fireEvent.click(enroll.getByText(pc.course.enroll).closest('button')!)

    const probe = await screen.findByTestId('path')
    expect(probe.textContent).toBe(SIGN_IN)
    // The router state still carries the same way back (the sign-in page of before PORTAL-04 reads it).
    expect(JSON.parse(probe.getAttribute('data-state')!)).toEqual({ from: INTENT })
    expect(keptCourseId()).toBe(COURSE_ID)
  })

  it('offers one way to enroll and nothing that duplicates it, free or paid', async () => {
    for (const overrides of [{}, { pricing: 'paid', price: { amount: 1200, currency: 'SAR' } }] as const) {
      mockCourseApi(serve(makePublicDetail(overrides)))
      const { unmount } = renderPage()
      await screen.findByText('أساسيات بايثون')
      const buttons = screen.getByTestId('public-enroll').querySelector<HTMLElement>('.course-enroll__buttons')!
      expect(within(buttons).getAllByRole('button')).toHaveLength(1)
      expect(within(buttons).queryAllByRole('link')).toHaveLength(0)
      expect(screen.queryByTestId(`public-subscribe-${COURSE_ID}`)).not.toBeInTheDocument()
      expect(screen.queryByText(pc.card.subscribeFree)).not.toBeInTheDocument()
      expect(screen.queryByText(pc.card.subscribePaid)).not.toBeInTheDocument()
      unmount()
    }
  })

  it('reads المادة · المدة · المحتوى in the facts, then the fees, each only with a real value', async () => {
    const card = () => screen.getByTestId('public-enroll-card')
    const labels = () => [...card().querySelectorAll('.course-facts dt')].map((node) => node.textContent)
    mockCourseApi(serve(makePublicDetail({ lessonCount: 12 })))
    const first = renderPage()
    await screen.findByTestId('public-enroll')
    expect(labels()).toEqual([pc.course.subject, pc.card.duration, pc.card.content])
    // The published lessons, with the Arabic plural forms.
    expect(within(card()).getByText('12 درساً')).toBeInTheDocument()
    // The fees come right after the facts, before the buttons.
    const order = [...card().querySelectorAll('.course-facts, .course-enroll__price, .course-enroll__action')].map((node) => node.className)
    expect(order).toEqual(['course-facts', 'course-enroll__price', 'course-enroll__action'])
    first.unmount()

    mockCourseApi(serve(makePublicDetail({ subject: null, durationHours: null, lessonCount: 1 })))
    renderPage()
    await screen.findByTestId('public-enroll')
    expect(labels()).toEqual([pc.card.content])
    expect(within(card()).getByText('درس واحد')).toBeInTheDocument()
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

  it('leads «العودة إلى الدورات» back to the search the course was opened from — kept in its own address (PORTAL-04)', async () => {
    mockCourseApi(serve(makePublicDetail()))
    const opened = renderPage(makeAuth(), `?q=${encodeURIComponent('بايثون')}`)
    await screen.findByTestId('public-outline')
    fireEvent.click(screen.getByText(pc.course.back).closest('button')!)
    expect(decodeURIComponent((await screen.findByTestId('path')).textContent!)).toBe('/explore?q=بايثون')
    opened.unmount()

    // Opened from a direct link (no search): back to all programs.
    renderPage()
    await screen.findByTestId('public-outline')
    fireEvent.click(screen.getByText(pc.course.back).closest('button')!)
    expect((await screen.findByTestId('path')).textContent).toBe('/explore')
  })

  it('never leaves the site from «العودة إلى الدورات», whatever the address carries', async () => {
    mockCourseApi(serve(makePublicDetail()))
    renderPage(makeAuth(), `?q=${encodeURIComponent('https://evil.example')}`)
    await screen.findByTestId('public-outline')
    fireEvent.click(screen.getByText(pc.course.back).closest('button')!)
    const path = (await screen.findByTestId('path')).textContent!
    expect(path.startsWith('/explore?q=')).toBe(true)
    expect(decodeURIComponent(path)).toBe('/explore?q=https://evil.example')
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

  describe('the short text and the description', () => {
    it('shows the summary in the band and the description in its section, each once', async () => {
      mockCourseApi(serve(makePublicDetail()))
      renderPage()
      await screen.findByTestId('public-outline')
      expect(band().getByText(SUMMARY)).toBeInTheDocument()
      expect(band().queryByText(DESCRIPTION)).not.toBeInTheDocument()
      expect(screen.getAllByText(SUMMARY)).toHaveLength(1)
      expect(screen.getAllByText(DESCRIPTION)).toHaveLength(1)
    })

    it('has no «الوصف» section when the description repeats the summary after trimming', async () => {
      mockCourseApi(serve(makePublicDetail({ summary: label(SUMMARY), description: label(`  ${SUMMARY}\n`) })))
      renderPage()
      await screen.findByTestId('public-outline')
      expect(screen.getAllByText(SUMMARY)).toHaveLength(1)
      expect(band().getByText(SUMMARY)).toBeInTheDocument()
      expect(screen.queryByRole('heading', { level: 2, name: pc.course.descriptionSection })).not.toBeInTheDocument()
    })

    it('has no «الوصف» section without a description, and no short text in the band without a summary', async () => {
      mockCourseApi(serve(makePublicDetail({ description: null })))
      const first = renderPage()
      await screen.findByTestId('public-outline')
      expect(band().getByText(SUMMARY)).toBeInTheDocument()
      expect(screen.queryByRole('heading', { level: 2, name: pc.course.descriptionSection })).not.toBeInTheDocument()
      first.unmount()

      mockCourseApi(serve(makePublicDetail({ summary: null })))
      const { container } = renderPage()
      await screen.findByTestId('public-outline')
      expect(container.querySelector('.course-page__summary')).toBeNull()
      expect(screen.getAllByText(DESCRIPTION)).toHaveLength(1)
      expect(band().queryByText(DESCRIPTION)).not.toBeInTheDocument()
    })

    it('keeps the line breaks of a description and never reads it as markup', async () => {
      const text = 'سطر أول\n<b>سطر ثانٍ</b>'
      mockCourseApi(serve(makePublicDetail({ description: label(text) })))
      const { container } = renderPage()
      await screen.findByTestId('public-outline')
      const paragraph = container.querySelector('#course-description .course-page__text')!
      expect(paragraph.textContent).toBe(text)
      expect(paragraph.querySelector('b')).toBeNull()
    })
  })

  describe('the sections', () => {
    it('shows no study plan without a lesson: the band already says «لا دروس بعد»', async () => {
      mockCourseApi(serve(makePublicDetail({ lessonCount: 0, levelCount: 0, outline: [{ number: 1, title: null, lessons: [] }] })))
      renderPage()
      await screen.findByTestId('public-enroll')
      expect(screen.queryByTestId('public-outline')).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { level: 2, name: pc.course.outlineSection })).not.toBeInTheDocument()
      // `levels` only with a curriculum level.
      expect(band().getByText(pc.card.lessons)).toBeInTheDocument()
    })

    it('shows no section at all with neither a text nor a lesson, and never invents outcomes or a teacher', async () => {
      mockCourseApi(serve(makePublicDetail({ summary: null, description: null, lessonCount: 0, levelCount: 0, outline: [] })))
      const { container } = renderPage()
      await screen.findByTestId('public-enroll')
      expect(container.querySelectorAll('.course-page__section')).toHaveLength(0)
      expect(screen.queryByRole('navigation', SECTIONS_NAV)).not.toBeInTheDocument()
    })

    it('words the availability in the band, and shows none for a course whose price is unavailable', async () => {
      mockCourseApi(serve(makePublicDetail({ openClasses: 0, hasFreeSeat: false })))
      const closed = renderPage()
      await screen.findByTestId('public-not-enrollable')
      expect(band().getByText(pc.card.closed)).toBeInTheDocument()
      closed.unmount()

      mockCourseApi(serve(makePublicDetail({ pricing: 'paid', price: null, hasFreeSeat: false })))
      const { container } = renderPage()
      await screen.findByTestId('public-not-enrollable')
      expect(container.querySelector('.course-availability')).toBeNull()
    })
  })

  describe('the bar of section links', () => {
    it('links to both sections, lights the one pressed, moves the focus there and leaves the address alone', async () => {
      mockCourseApi(serve(makePublicDetail()))
      renderPage(makeAuth(), '?q=abc')
      await screen.findByTestId('public-outline')

      const bar = within(screen.getByRole('navigation', SECTIONS_NAV))
      const description = bar.getByRole('link', { name: pc.course.descriptionSection })
      const plan = bar.getByRole('link', { name: pc.course.outlineSection })
      expect(description).toHaveAttribute('href', '#course-description')
      expect(plan).toHaveAttribute('href', '#course-outline')
      expect(description).toHaveAttribute('aria-current', 'true')

      // `fireEvent` answers false when the click was prevented: no hash lands in the address.
      expect(fireEvent.click(plan)).toBe(false)
      expect(plan).toHaveAttribute('aria-current', 'true')
      expect(description).not.toHaveAttribute('aria-current')
      expect(document.activeElement).toBe(document.getElementById('course-outline'))
    })

    it('shows no bar with a single section', async () => {
      mockCourseApi(serve(makePublicDetail({ description: null })))
      renderPage()
      await screen.findByTestId('public-outline')
      expect(screen.queryByRole('navigation', SECTIONS_NAV)).not.toBeInTheDocument()
    })
  })

  describe('the study plan', () => {
    const lesson = (title: string) => ({ title: label(title), kind: 'text' as const, durationSeconds: null })
    const outline = [
      { number: 1, title: label('الأول'), lessons: [lesson('درس أ'), lesson('درس ب')] },
      { number: 2, title: label('فارغ'), lessons: [] },
      { number: 3, title: label('الثالث'), lessons: [lesson('درس ج')] },
    ]

    it('keeps the server order, skips a level without lessons, and keeps every title in the document', async () => {
      mockCourseApi(serve(makePublicDetail({ outline })))
      renderPage()
      const plan = await screen.findByTestId('public-outline')

      const headers = [...plan.querySelectorAll('[role="button"][aria-expanded]')]
      expect(headers.map((header) => header.querySelector('.ant-collapse-title')!.textContent)).toEqual(['المستوى الأول — الأول', 'المستوى الثالث — الثالث'])
      expect(within(plan).queryByText(/فارغ/)).not.toBeInTheDocument()
      expect([...plan.querySelectorAll('ol > li')].map((item) => item.querySelector('.course-outline__title > span:last-child')!.textContent)).toEqual(['درس أ', 'درس ب', 'درس ج'])
      // The header counts its own lessons.
      expect(within(headers[0] as HTMLElement).getByText('درسان')).toBeInTheDocument()
      expect(within(headers[1] as HTMLElement).getByText('درس واحد')).toBeInTheDocument()
    })

    it('opens the first level only, and a level answers the mouse, Enter and Space', async () => {
      mockCourseApi(serve(makePublicDetail({ outline })))
      renderPage()
      const plan = await screen.findByTestId('public-outline')
      const [first, second] = [...plan.querySelectorAll<HTMLElement>('[role="button"][aria-expanded]')]
      expect(first).toHaveAttribute('aria-expanded', 'true')
      expect(second).toHaveAttribute('aria-expanded', 'false')

      fireEvent.click(second!)
      expect(second).toHaveAttribute('aria-expanded', 'true')
      fireEvent.keyDown(second!, { key: 'Enter' })
      expect(second).toHaveAttribute('aria-expanded', 'false')
      // Space presses the header and does not scroll the page.
      expect(fireEvent.keyDown(second!, { key: ' ' })).toBe(false)
      expect(second).toHaveAttribute('aria-expanded', 'true')
    })
  })

  it('keeps the loading, failure and closed states in the page column', async () => {
    mockCourseApi(() => jsonResponse(404, CATALOG_NOT_PUBLIC))
    const closed = renderPage()
    expect((await screen.findByTestId('catalog-closed')).closest('.course-page-state')).not.toBeNull()
    closed.unmount()

    mockCourseApi(() => jsonResponse(404, { statusCode: 404, code: 'course_not_found', message: 'gone' }))
    renderPage()
    expect((await screen.findByText(pc.course.notFound)).closest('.course-page-state')).not.toBeNull()
  })

  describe('creating an account (PORTAL-04, the contract of #207)', () => {
    const entry = ar.studentRegistration.entry
    const academyReads = (fetchMock: ReturnType<typeof mockFetch>) => fetchMock.mock.calls.filter(([url]) => url === ACADEMY_PUBLIC_PATH).length

    /** API-205 with `academy` (or the failure `status`) and API-237 with `detail`. */
    function mockRegistrationApi(academy: unknown, detail: () => Response, status = 200) {
      return mockFetch((url) => {
        if (url === ACADEMY_PUBLIC_PATH) return jsonResponse(status, academy)
        if (url === COURSE_PATH) return detail()
        return jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })
      })
    }

    function renderForRegister() {
      return renderWithProviders(<PublicCoursePage />, {
        auth: makeAuth(),
        route: `/explore/${COURSE_ID}`,
        path: '/explore/:courseId',
        routes: { '/register': <PathProbe />, '/login': <PathProbe /> },
      })
    }

    const open = () => makePublicAcademy({ catalogPublic: true, selfRegistration: true })

    it.each([
      ['the field absent', makePublicAcademy({ catalogPublic: true }), 200],
      ['false', makePublicAcademy({ catalogPublic: true, selfRegistration: false }), 200],
      ['a failed read', { statusCode: 503, code: 'academy_not_configured', message: 'none' }, 503],
    ])('keeps the original note and offers no account with %s, reading API-205 once', async (_case, academy, status) => {
      const fetchMock = mockRegistrationApi(academy, serve(makePublicDetail()), status)
      renderForRegister()
      const enroll = within(await screen.findByTestId('public-enroll'))
      await waitFor(() => expect(academyReads(fetchMock)).toBe(1))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(enroll.getByTestId('public-enroll-note')).toHaveTextContent(pc.course.signInNote)
      expect(enroll.queryByText(pc.course.signInOrRegisterNote)).not.toBeInTheDocument()
      expect(screen.queryByTestId('public-enroll-choice')).not.toBeInTheDocument()
      expect(document.querySelector('a[href^="/register"]')).toBeNull()
      expect(document.body.textContent).not.toContain(entry.courseNote)
      expect(academyReads(fetchMock)).toBe(1)
    })

    /** The note that says an account can be created: API-205 was read and the card knows it. */
    const registrationKnown = () => screen.findByText(pc.course.signInOrRegisterNote)
    const enrollButton = () => within(screen.getByTestId('public-enroll')).getByText(pc.course.enroll).closest('button')!
    /** The dialog of the two ways on, once «اشترك الآن» opened it. */
    const choice = async () => within((await screen.findByTestId('public-enroll-choice')).closest<HTMLElement>('[role="dialog"]')!)

    it('labels the button «اشترك الآن»', () => {
      expect(pc.course.enroll).toBe('اشترك الآن')
    })

    it.each([
      ['by e-mail (selfRegistration)', { selfRegistration: true }],
      ['through Google alone (googleSignUp)', { selfRegistration: false, googleSignUp: true }],
    ])('opens a dialog with «تسجيل الدخول» and «إنشاء حساب جديد», each with the course as returnTo, when an account can be created %s', async (_case, flags) => {
      const fetchMock = mockRegistrationApi({ ...makePublicAcademy({ catalogPublic: true }), ...flags }, serve(makePublicDetail()))
      renderForRegister()
      await registrationKnown()
      const enroll = within(screen.getByTestId('public-enroll'))
      expect(enroll.getByTestId('public-enroll-note')).toHaveTextContent(pc.course.signInOrRegisterNote)
      expect(enroll.queryByText(pc.course.signInNote)).not.toBeInTheDocument()
      // One button, and no second «إنشاء حساب» beside it: the new account is one of the dialog's two choices.
      const buttons = screen.getByTestId('public-enroll').querySelector<HTMLElement>('.course-enroll__buttons')!
      expect(within(buttons).getAllByRole('button')).toHaveLength(1)
      expect(within(buttons).queryAllByRole('link')).toHaveLength(0)
      expect(screen.queryByTestId(`public-subscribe-${COURSE_ID}`)).not.toBeInTheDocument()
      expect(academyReads(fetchMock)).toBe(1)
      expect(screen.queryByTestId('public-enroll-choice')).not.toBeInTheDocument()

      fireEvent.click(enrollButton())

      const dialog = await choice()
      expect(dialog.getByText(pc.course.enrollTitle)).toBeInTheDocument()
      expect(dialog.getByText(pc.course.enrollChoice.text)).toBeInTheDocument()
      const signIn = dialog.getByText(pc.course.enrollChoice.signIn).closest('a')!
      const register = dialog.getByText(pc.course.enrollChoice.register).closest('a')!
      expect(signIn).toHaveAttribute('href', SIGN_IN)
      expect(register).toHaveAttribute('href', REGISTER)
      expect(pc.course.enrollChoice).toMatchObject({ signIn: 'تسجيل الدخول', register: 'إنشاء حساب جديد' })
      // Opening the dialog keeps nothing and goes nowhere.
      expect(keptCourseId()).toBeNull()
      expect(screen.queryByTestId('path')).not.toBeInTheDocument()

      fireEvent.click(register)
      const probe = await screen.findByTestId('path')
      expect(probe.textContent).toBe(REGISTER)
      expect(JSON.parse(probe.getAttribute('data-state')!)).toEqual({ from: INTENT })
      expect(keptCourseId()).toBe(COURSE_ID)
    })

    it('leads «تسجيل الدخول» of the dialog to /login?returnTo=<the course with the enroll intent>', async () => {
      mockRegistrationApi(open(), serve(makePublicDetail()))
      renderForRegister()
      await registrationKnown()
      fireEvent.click(enrollButton())

      fireEvent.click((await choice()).getByText(pc.course.enrollChoice.signIn).closest('a')!)

      const probe = await screen.findByTestId('path')
      expect(probe.textContent).toBe(SIGN_IN)
      expect(JSON.parse(probe.getAttribute('data-state')!)).toEqual({ from: INTENT })
      expect(keptCourseId()).toBe(COURSE_ID)
    })

    it('closes the dialog without going anywhere or keeping anything', async () => {
      mockRegistrationApi(open(), serve(makePublicDetail()))
      renderForRegister()
      await registrationKnown()
      fireEvent.click(enrollButton())
      await choice()

      fireEvent.click(screen.getByTestId('public-enroll-choice').closest('[role="dialog"]')!.querySelector('.ant-modal-close')!)

      // (jsdom never ends antd's closing motion, so the dialog's node may linger; what matters is that nothing happened.)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(screen.queryByTestId('path')).not.toBeInTheDocument()
      expect(keptCourseId()).toBeNull()
    })

    it('goes straight to the sign-in, with no dialog, while no account can be created', async () => {
      mockRegistrationApi(makePublicAcademy({ catalogPublic: true, selfRegistration: false }), serve(makePublicDetail()))
      renderForRegister()
      const enroll = within(await screen.findByTestId('public-enroll'))
      await waitFor(() => expect(enroll.getByTestId('public-enroll-note')).toHaveTextContent(pc.course.signInNote))

      fireEvent.click(enrollButton())

      expect((await screen.findByTestId('path')).textContent).toBe(SIGN_IN)
      expect(screen.queryByTestId('public-enroll-choice')).not.toBeInTheDocument()
    })

    it('keeps the paid note beside the new one', async () => {
      mockRegistrationApi(open(), serve(makePublicDetail({ pricing: 'paid', price: { amount: 1200, currency: 'SAR' } })))
      renderForRegister()
      await registrationKnown()
      expect(within(screen.getByTestId('public-enroll')).getByText(pc.course.paidNote)).toBeInTheDocument()
    })

    it('offers no button and no dialog for a course that takes nobody now', async () => {
      mockRegistrationApi(open(), serve(makePublicDetail({ openClasses: 0, hasFreeSeat: false })))
      renderForRegister()
      await screen.findByTestId('public-not-enrollable')
      await waitFor(() => expect(document.querySelector('.public-catalog__register')).not.toBeNull())
      expect(screen.queryByText(pc.course.enroll)).not.toBeInTheDocument()
      expect(screen.queryByTestId('public-enroll-choice')).not.toBeInTheDocument()
    })

    it('words the closed catalog truthfully, with the way to register, only while registration is open', async () => {
      const opened = mockRegistrationApi(open(), () => jsonResponse(404, CATALOG_NOT_PUBLIC))
      const first = renderForRegister()
      const closed = within(await screen.findByTestId('catalog-closed'))
      expect(await closed.findByText(entry.accountsNote)).toBeInTheDocument()
      expect(closed.queryByText(pc.closed.text)).not.toBeInTheDocument()
      expect(closed.getByRole('link', { name: entry.createAccount })).toHaveAttribute('href', '/register')
      expect(closed.getByText(pc.closed.signIn)).toBeInTheDocument()
      expect(academyReads(opened)).toBe(1)
      first.unmount()

      mockRegistrationApi(makePublicAcademy({ catalogPublic: false }), () => jsonResponse(404, CATALOG_NOT_PUBLIC))
      renderForRegister()
      const shut = within(await screen.findByTestId('catalog-closed'))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(shut.getByText(pc.closed.text)).toBeInTheDocument()
      expect(shut.queryByText(entry.accountsNote)).not.toBeInTheDocument()
      expect(shut.queryByRole('link', { name: entry.createAccount })).not.toBeInTheDocument()
    })

    it('reads nothing for a signed-in user, whatever the academy allows', async () => {
      const fetchMock = mockRegistrationApi(open(), serve(makePublicDetail()))
      renderWithProviders(<PublicCoursePage />, {
        auth: makeAuth({ user: makeUser({ role: 'student', roles: ['student'] }) }),
        route: `/explore/${COURSE_ID}`,
        path: '/explore/:courseId',
        routes: { '/catalog/:courseId': <PathProbe /> },
      })
      await screen.findByTestId('path')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(document.querySelector('a[href^="/register"]')).toBeNull()
    })
  })
})

function renderWithPaid(overrides: Partial<PublicCourseDetail>) {
  mockCourseApi(serve(makePublicDetail(overrides)))
  return renderPage()
}
