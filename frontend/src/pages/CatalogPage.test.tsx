// MOD-19 — «explore courses» (API-219): the cards the server returns, the filters it receives, the empty and error
// states, and the way to a course page.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import type { CatalogList } from '../api/catalog'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import { formatMoney } from '../payments/payments.format'
import { CATALOG_COURSE_IDS, makeCatalogCard, makeCatalogList } from '../test/catalog'
import { SUBJECT_IDS, makeSubject } from '../test/subjects'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { CatalogPage } from './CatalogPage'

const paid = makeCatalogCard({
  id: CATALOG_COURSE_IDS[1],
  code: 'WEB-201',
  name: { ar: 'تطوير الويب', en: 'Web development' },
  summary: null,
  coverImageUrl: null,
  level: null,
  pricing: 'paid',
  price: { amount: 1200, currency: 'SAR', installments: 2 },
  availableClasses: 1,
  teachers: [],
  mine: { enrolled: false, pending: true },
})

function mockCatalogApi(answer: (query: URLSearchParams, call: number) => CatalogList | Response) {
  const queries: URLSearchParams[] = []
  mockFetch((url) => {
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname === '/api/subjects') return jsonResponse(200, { items: [makeSubject(), makeSubject({ id: SUBJECT_IDS[2], code: 'OLD', name: { ar: 'قديم' }, isActive: false })] })
    queries.push(parsed.searchParams)
    const result = answer(parsed.searchParams, queries.length)
    return result instanceof Response ? result : jsonResponse(200, result)
  })
  return queries
}

function renderPage() {
  return renderWithProviders(<CatalogPage />, {
    auth: makeAuth({ user: makeUser({ id: 'st-1', role: 'student', roles: ['student'], permissions: ['courses.read', 'enrollments.self_enroll'] }) }),
    route: '/catalog',
    routes: { '/catalog/:courseId': <CoursePathProbe /> },
  })
}

/** Where a card led: the path and the query (the enroll intent). */
function CoursePathProbe() {
  const location = useLocation()
  return <output data-testid="course-path">{`${location.pathname}${location.search}`}</output>
}

const card = (id: string) => screen.getByTestId(`catalog-card-${id}`)

describe('CatalogPage', () => {
  afterEach(async () => {
    await i18n.changeLanguage('ar')
  })

  it('shows the published courses from GET /api/catalog/courses as cards with the server’s values', async () => {
    const queries = mockCatalogApi(() => makeCatalogList([makeCatalogCard(), paid]))
    renderPage()

    expect(await screen.findByText('أساسيات بايثون')).toBeInTheDocument()
    expect(Object.fromEntries(queries[0]!)).toEqual({ limit: '24' })
    const free = within(card(CATALOG_COURSE_IDS[0]))
    expect(free.queryByText('PY-101')).not.toBeInTheDocument()
    expect(free.getByText('مدخل عملي إلى البرمجة')).toBeInTheDocument()
    // PORTAL-04: the school subject, never the difficulty level; no sessions.
    expect(free.getByText('البرمجة')).toBeInTheDocument()
    expect(free.queryByText('مبتدئ')).not.toBeInTheDocument()
    expect(card(CATALOG_COURSE_IDS[0]).textContent).not.toContain('جلس')
    expect(free.getByText(ar.catalog.free)).toBeInTheDocument()
    expect(free.getByText(ar.catalog.card.available)).toBeInTheDocument()
    expect(free.getByText('خالد المعلم')).toBeInTheDocument()
    expect(free.getByText(ar.catalog.card.enroll)).toBeInTheDocument()
    expect(card(CATALOG_COURSE_IDS[0]).querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.org/py.jpg')
    expect(card(CATALOG_COURSE_IDS[0]).querySelector('img')?.getAttribute('alt')).toBe('')

    const web = within(card(CATALOG_COURSE_IDS[1]))
    expect(card(CATALOG_COURSE_IDS[1]).textContent).toContain(formatMoney(1200, 'SAR', 'ar'))
    expect(web.getByText(ar.catalog.card.pending)).toBeInTheDocument()
    // A pending request: no second call to action on the card, the details only.
    expect(web.queryByText(ar.catalog.card.request)).not.toBeInTheDocument()
    expect(web.getByText(ar.publicCatalog.card.viewCourse)).toBeInTheDocument()
    expect(card(CATALOG_COURSE_IDS[1]).querySelector('img')).toBeNull()
  })

  it('wears the public card’s look with the subject badge, and keeps the reader’s own state and the seats', async () => {
    const enrolled = makeCatalogCard({ id: 'c-mine', code: 'X-3', name: { ar: 'دورتي' }, mine: { enrolled: true, pending: false } })
    mockCatalogApi(() => makeCatalogList([makeCatalogCard(), enrolled]))
    renderPage()
    await screen.findByText('أساسيات بايثون')

    const node = card(CATALOG_COURSE_IDS[0])
    expect(node).toHaveClass('public-card', 'public-card--app')
    expect(node.querySelector('.course-badge--subject')).toHaveTextContent('البرمجة')
    expect(node.querySelector('.course-badge--level')).toBeNull()
    expect(node.querySelector('.course-badge--duration')).toHaveTextContent('24 ساعة')
    const facts = within(node.querySelector<HTMLElement>('.public-card__facts')!)
    expect(facts.getByText(ar.catalog.card.availableClasses)).toBeInTheDocument()
    expect(facts.getByText('خالد المعلم')).toBeInTheDocument()

    const mine = within(card('c-mine'))
    expect(mine.getByText(ar.catalog.card.enrolled)).toBeInTheDocument()
    expect(mine.queryByText(ar.catalog.card.enroll)).not.toBeInTheDocument()
    // The name is the card's one link to the course; «عرض الدورة» repeats it for the pointer only.
    expect(mine.getByRole('link', { name: 'دورتي' })).toHaveAttribute('href', '/catalog/c-mine')
    expect(mine.getByText(ar.publicCatalog.card.viewCourse).closest('button')).toHaveAttribute('tabindex', '-1')
  })

  it('words a full course, one without an open class, and a paid one whose price is unavailable', async () => {
    mockCatalogApi(() =>
      makeCatalogList([
        makeCatalogCard({ availableClasses: 0 }),
        makeCatalogCard({ id: 'c-closed', code: 'X-1', openClasses: 0, availableClasses: 0 }),
        makeCatalogCard({ id: 'c-price', code: 'X-2', pricing: 'paid', price: null, availableClasses: 0 }),
      ]),
    )
    renderPage()

    expect(await within(await screen.findByTestId(`catalog-card-${CATALOG_COURSE_IDS[0]}`)).findByText(ar.catalog.card.full)).toBeInTheDocument()
    expect(within(card('c-closed')).getByText(ar.catalog.card.closed)).toBeInTheDocument()
    expect(within(card('c-price')).getByText(ar.catalog.card.priceUnavailable)).toBeInTheDocument()
    expect(within(card('c-price')).getByText(ar.catalog.paid)).toBeInTheDocument()
    expect(screen.queryByText(ar.catalog.card.enroll)).not.toBeInTheDocument()
  })

  it('sends the type, «available now», the subject and the search (after a pause) as filters', async () => {
    const queries = mockCatalogApi(() => makeCatalogList([makeCatalogCard()]))
    renderPage()
    await screen.findByText('أساسيات بايثون')

    fireEvent.mouseDown(screen.getByRole('combobox', { name: ar.catalog.pricingLabel }))
    fireEvent.click(await screen.findByText(ar.catalog.paid, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(queries).toHaveLength(2))
    expect(Object.fromEntries(queries[1]!)).toEqual({ limit: '24', pricing: 'paid' })

    fireEvent.click(screen.getByRole('switch', { name: ar.catalog.availableOnly }))
    await waitFor(() => expect(queries).toHaveLength(3))
    expect(Object.fromEntries(queries[2]!)).toEqual({ limit: '24', pricing: 'paid', available: 'true' })

    // PORTAL-04: the subject replaced the difficulty level; inactive subjects are not offered.
    expect(screen.queryByRole('combobox', { name: 'المستوى' })).not.toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: ar.catalog.subjectLabel }))
    expect(await screen.findByText('البرمجة', { selector: '.ant-select-item-option-content' })).toBeInTheDocument()
    expect(screen.queryByText('قديم', { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('البرمجة', { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(queries).toHaveLength(4))
    expect(queries[3]!.get('subjectId')).toBe(makeSubject().id)
    expect(queries[3]!.get('levelId')).toBeNull()

    fireEvent.change(screen.getByLabelText(ar.catalog.searchLabel), { target: { value: ' بايثون ' } })
    await waitFor(() => expect(queries).toHaveLength(5), { timeout: 2000 })
    expect(queries[4]!.get('q')).toBe('بايثون')
  })

  it('tells an empty catalog from no match, and clears the filters', async () => {
    const queries = mockCatalogApi(() => makeCatalogList([]))
    renderPage()
    expect(await screen.findByText(ar.catalog.empty)).toBeInTheDocument()
    expect(screen.queryByText(ar.catalog.clearFilters)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: ar.catalog.availableOnly }))
    expect(await screen.findByText(ar.catalog.emptyFiltered)).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.catalog.clearFilters).closest('button')!)
    await waitFor(() => expect(Object.fromEntries(queries[queries.length - 1]!)).toEqual({ limit: '24' }))
    expect(await screen.findByText(ar.catalog.empty)).toBeInTheDocument()
  })

  it('shows a failure with a retry', async () => {
    mockCatalogApi((_query, call) => (call === 1 ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : makeCatalogList([makeCatalogCard()])))
    renderPage()
    expect(await screen.findByText(ar.catalog.loadError)).toBeInTheDocument()
    expect(screen.getByText(ar.catalog.errors.server)).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.catalog.retry).closest('button')!)
    expect(await screen.findByText('أساسيات بايثون')).toBeInTheDocument()
    expect(screen.queryByText(ar.catalog.loadError)).not.toBeInTheDocument()
  })

  it('opens the course page from a card: the enroll button carries the intent', async () => {
    mockCatalogApi(() => makeCatalogList([makeCatalogCard()]))
    renderPage()
    await screen.findByText('أساسيات بايثون')
    fireEvent.click(within(card(CATALOG_COURSE_IDS[0])).getByText(ar.catalog.card.enroll).closest('button')!)
    expect((await screen.findByTestId('course-path')).textContent).toBe(`/catalog/${CATALOG_COURSE_IDS[0]}?intent=enroll`)
  })

  it('carries the intent on a paid course’s request button too', async () => {
    const open = makeCatalogCard({ pricing: 'paid', price: { amount: 1200, currency: 'SAR', installments: 1 } })
    mockCatalogApi(() => makeCatalogList([open]))
    renderPage()
    await screen.findByText('أساسيات بايثون')
    fireEvent.click(within(card(CATALOG_COURSE_IDS[0])).getByText(ar.catalog.card.request).closest('button')!)
    expect((await screen.findByTestId('course-path')).textContent).toBe(`/catalog/${CATALOG_COURSE_IDS[0]}?intent=enroll`)
  })

  it('opens the course page with no intent from «عرض الدورة»', async () => {
    mockCatalogApi(() => makeCatalogList([makeCatalogCard()]))
    renderPage()
    await screen.findByText('أساسيات بايثون')
    fireEvent.click(within(card(CATALOG_COURSE_IDS[0])).getByText(ar.publicCatalog.card.viewCourse).closest('button')!)
    expect((await screen.findByTestId('course-path')).textContent).toBe(`/catalog/${CATALOG_COURSE_IDS[0]}`)
  })

  it('speaks English with the English names the server stores', async () => {
    await i18n.changeLanguage('en')
    mockCatalogApi(() => makeCatalogList([makeCatalogCard()]))
    renderPage()
    expect(await screen.findByText('Python Basics')).toBeInTheDocument()
    expect(screen.getByText(en.catalog.title)).toBeInTheDocument()
    const free = within(card(CATALOG_COURSE_IDS[0]))
    expect(free.getByText(en.catalog.free)).toBeInTheDocument()
    // PORTAL-04: the subject's English name, never the difficulty level.
    expect(free.getByText('Programming')).toBeInTheDocument()
    expect(free.queryByText('Beginner')).not.toBeInTheDocument()
    expect(free.getByText(en.catalog.card.enroll)).toBeInTheDocument()
  })

  it('pages through the keyset cursor', async () => {
    const queries = mockCatalogApi((query) => (query.get('cursor') ? makeCatalogList([paid]) : makeCatalogList([makeCatalogCard()], 'next-1')))
    renderPage()
    await screen.findByText('أساسيات بايثون')
    fireEvent.click(screen.getByText(ar.catalog.next).closest('button')!)
    expect(await screen.findByText('تطوير الويب')).toBeInTheDocument()
    expect(queries[1]!.get('cursor')).toBe('next-1')
    expect(screen.getByText('الصفحة 2')).toBeInTheDocument()
  })
})
