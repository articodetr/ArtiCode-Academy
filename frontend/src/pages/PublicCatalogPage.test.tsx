// MOD-20 (D-R138) — the public catalog list (/explore, API-236): what a visitor sees of the server's answer, the search,
// «المزيد», the closed catalog, the failures, and that a signed-in user goes to the signed-in catalog instead.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { ACADEMY_PUBLIC_PATH } from '../api/academy'
import { PUBLIC_CATALOG_PATH } from '../api/publicCatalog'
import { ar } from '../i18n/ar'
import { formatMoney } from '../payments/payments.format'
import { makePublicAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { CATALOG_NOT_PUBLIC, PUBLIC_COURSE_IDS, makePublicCard, makePublicList } from '../test/publicCatalog'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { PublicCatalogPage } from './PublicCatalogPage'

const pc = ar.publicCatalog

/** Where the page navigated (pathname + query) and with which router state. */
function PathProbe() {
  const location = useLocation()
  return (
    <output data-testid="path" data-state={JSON.stringify(location.state ?? null)}>
      {`${location.pathname}${location.search}`}
    </output>
  )
}

/** Serves API-205 and API-236 (`list` gets the query of each list request) and records the list requests. */
function mockPublicApi(list: (query: URLSearchParams) => Response) {
  const requests: { query: URLSearchParams; headers: Headers }[] = []
  const fetchMock = mockFetch((url, init) => {
    if (url === ACADEMY_PUBLIC_PATH) return jsonResponse(200, makePublicAcademy({ catalogPublic: true, name: { ar: 'أكاديمية النور', en: 'Al-Nour Academy' } }))
    if (url === PUBLIC_CATALOG_PATH || url.startsWith(`${PUBLIC_CATALOG_PATH}?`)) {
      const query = new URL(url, 'http://localhost').searchParams
      requests.push({ query, headers: new Headers(init?.headers) })
      return list(query)
    }
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })
  })
  return { requests, fetchMock }
}

function renderPage(auth = makeAuth()) {
  return renderWithProviders(<PublicCatalogPage />, {
    auth,
    route: '/explore',
    routes: { '/explore/:courseId': <PathProbe />, '/login': <PathProbe />, '/catalog': <PathProbe />, '/': <PathProbe /> },
  })
}

const card = (id: string) => within(screen.getByTestId(`public-card-${id}`))

describe('PublicCatalogPage', () => {
  it('shows the published courses as cards — price, level, counts and open classes — read without a token', async () => {
    const paid = makePublicCard({
      id: PUBLIC_COURSE_IDS[1],
      code: 'WEB-201',
      name: { ar: 'تطوير الويب', en: 'Web development' },
      level: null,
      pricing: 'paid',
      price: { amount: 1200, currency: 'SAR' },
      openClasses: 1,
      hasFreeSeat: false,
      lessonCount: 1,
      levelCount: 1,
      durationHours: null,
      sessionsCount: null,
    })
    // A paid course whose plan cannot price a request now: never «مجانية».
    const unpriced = makePublicCard({ id: PUBLIC_COURSE_IDS[2], code: 'AI-301', name: { ar: 'الذكاء الاصطناعي' }, pricing: 'paid', price: null, openClasses: 0, hasFreeSeat: false })
    const api = mockPublicApi(() => jsonResponse(200, makePublicList([makePublicCard(), paid, unpriced])))
    renderPage()

    expect(await screen.findByText('أساسيات بايثون')).toBeInTheDocument()
    const free = card(PUBLIC_COURSE_IDS[0])
    expect(free.getByText('PY-101')).toBeInTheDocument()
    expect(free.getByText('مدخل عملي إلى البرمجة')).toBeInTheDocument()
    expect(free.getByText('مبتدئ')).toBeInTheDocument()
    expect(free.getByText(pc.card.free)).toBeInTheDocument()
    expect(free.getByText(pc.card.available)).toBeInTheDocument()
    expect(free.getByText('24 ساعة')).toBeInTheDocument()
    expect(free.getByText('12 جلسة')).toBeInTheDocument()
    expect(free.getByText('5 دروس')).toBeInTheDocument()
    expect(free.getByText('مستويان')).toBeInTheDocument()
    expect(free.getByTestId('course-cover')).toHaveAttribute('src', 'https://cdn.example.org/py.jpg')

    const web = card(PUBLIC_COURSE_IDS[1])
    // The amount as formatMoney words it (a non-breaking space the text matcher would fold).
    expect(screen.getByTestId(`public-card-${PUBLIC_COURSE_IDS[1]}`).textContent).toContain(formatMoney(1200, 'SAR', 'ar'))
    expect(web.queryByText(pc.card.free)).not.toBeInTheDocument()
    expect(web.getByText(pc.card.full)).toBeInTheDocument()
    expect(web.getByText('درس واحد')).toBeInTheDocument()
    expect(web.getByText('مستوى واحد')).toBeInTheDocument()

    const ai = card(PUBLIC_COURSE_IDS[2])
    expect(ai.getByText(pc.card.priceUnavailable)).toBeInTheDocument()
    expect(ai.queryByText(pc.card.free)).not.toBeInTheDocument()
    expect(ai.getByText(pc.card.closed)).toBeInTheDocument()
    // No teacher, no class code, no schedule is ever shown — the server sends none.
    expect(document.body.textContent).not.toContain('PY-101-A')

    // The header: the academy's name from API-205, the sign-in button and the line that replaces a «register» button.
    expect(await screen.findByText('أكاديمية النور')).toBeInTheDocument()
    expect(screen.getByText(pc.header.accountsNote)).toBeInTheDocument()

    expect(api.requests).toHaveLength(1)
    expect(api.requests[0]!.query.get('limit')).toBe('24')
    expect(api.requests[0]!.query.has('q')).toBe(false)
    expect(api.requests[0]!.headers.get('Authorization')).toBeNull()
  })

  it('opens a course page from its card', async () => {
    mockPublicApi(() => jsonResponse(200, makePublicList()))
    renderPage()
    await screen.findByText('أساسيات بايثون')
    fireEvent.click(card(PUBLIC_COURSE_IDS[0]).getByText(pc.list.details).closest('a')!)
    expect((await screen.findByTestId('path')).textContent).toBe(`/explore/${PUBLIC_COURSE_IDS[0]}`)
  })

  it('makes the whole card a real link to its course page, and names the tab after the page and the academy (PORTAL-04)', async () => {
    mockPublicApi(() => jsonResponse(200, makePublicList()))
    renderPage()
    const link = (await screen.findByText('أساسيات بايثون')).closest('a')!
    expect(link).toHaveAttribute('href', `/explore/${PUBLIC_COURSE_IDS[0]}`)
    // The link is stretched over the card (publicCatalog.css), so a click anywhere on it opens the course.
    expect(link).toHaveClass('public-card__link')
    await waitFor(() => expect(document.title).toBe(`${pc.list.title} — أكاديمية النور`))
    fireEvent.click(link)
    expect((await screen.findByTestId('path')).textContent).toBe(`/explore/${PUBLIC_COURSE_IDS[0]}`)
  })

  it('appends the next page under the cards with «المزيد», then hides it at the end', async () => {
    const second = makePublicCard({ id: PUBLIC_COURSE_IDS[1], code: 'WEB-201', name: { ar: 'تطوير الويب' } })
    const api = mockPublicApi((query) =>
      query.get('cursor') === 'next-1' ? jsonResponse(200, makePublicList([second], null)) : jsonResponse(200, makePublicList([makePublicCard()], 'next-1')),
    )
    renderPage()

    await screen.findByText('أساسيات بايثون')
    fireEvent.click(screen.getByText(pc.list.more).closest('button')!)

    expect(await screen.findByText('تطوير الويب')).toBeInTheDocument()
    expect(screen.getByText('أساسيات بايثون')).toBeInTheDocument()
    expect(api.requests.map((request) => request.query.get('cursor'))).toEqual([null, 'next-1'])
    await waitFor(() => expect(screen.queryByText(pc.list.more)).not.toBeInTheDocument())
  })

  it('searches once the typing pauses, from the first page, and offers to clear a search that finds nothing', async () => {
    const api = mockPublicApi((query) => (query.get('q') ? jsonResponse(200, makePublicList([], null)) : jsonResponse(200, makePublicList())))
    renderPage()
    await screen.findByText('أساسيات بايثون')

    fireEvent.change(screen.getByLabelText(pc.list.searchLabel), { target: { value: '  جافا ' } })
    expect(await screen.findByText(pc.list.emptyFiltered)).toBeInTheDocument()
    expect(api.requests.at(-1)!.query.get('q')).toBe('جافا')
    expect(api.requests.at(-1)!.query.has('cursor')).toBe(false)

    fireEvent.click(screen.getByText(pc.list.clearSearch).closest('button')!)
    expect(await screen.findByText('أساسيات بايثون')).toBeInTheDocument()
    expect(api.requests.at(-1)!.query.has('q')).toBe(false)
  })

  it('says calmly that the academy does not show its courses to visitors (404 catalog_not_public), with the way to sign in', async () => {
    mockPublicApi(() => jsonResponse(404, CATALOG_NOT_PUBLIC))
    renderPage()

    const closed = await screen.findByTestId('catalog-closed')
    expect(within(closed).getByText(pc.closed.title)).toBeInTheDocument()
    expect(within(closed).getByText(pc.closed.text)).toBeInTheDocument()
    expect(screen.queryByText(pc.list.loadError)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(pc.list.searchLabel)).not.toBeInTheDocument()

    fireEvent.click(within(closed).getByText(pc.closed.signIn).closest('button')!)
    expect((await screen.findByTestId('path')).textContent).toBe('/login')
  })

  it('reports another failure with a retry that asks again', async () => {
    let attempt = 0
    mockPublicApi(() => {
      attempt += 1
      return attempt === 1 ? jsonResponse(429, { statusCode: 429, code: 'rate_limited', message: 'slow' }) : jsonResponse(200, makePublicList())
    })
    renderPage()

    expect(await screen.findByText(pc.list.loadError)).toBeInTheDocument()
    expect(screen.getByText(pc.errors.rate_limited)).toBeInTheDocument()
    fireEvent.click(screen.getByText(pc.list.retry).closest('button')!)
    expect(await screen.findByText('أساسيات بايثون')).toBeInTheDocument()
    expect(screen.queryByText(pc.list.loadError)).not.toBeInTheDocument()
  })

  it('leads to the sign-in page from the header', async () => {
    mockPublicApi(() => jsonResponse(200, makePublicList()))
    renderPage()
    await screen.findByText('أساسيات بايثون')
    fireEvent.click(screen.getByText(pc.header.signIn).closest('button')!)
    expect((await screen.findByTestId('path')).textContent).toBe('/login')
  })

  it('sends a signed-in user to the signed-in catalog without reading the public one, and waits for the session check', async () => {
    const { fetchMock } = mockPublicApi(() => jsonResponse(200, makePublicList()))
    const { unmount } = renderPage(makeAuth({ status: 'loading' }))
    expect(screen.getByTestId('public-session-loading')).toBeInTheDocument()
    expect(screen.queryByText(pc.list.title)).not.toBeInTheDocument()
    unmount()

    renderPage(makeAuth({ user: makeUser({ role: 'student', roles: ['student'] }) }))
    expect((await screen.findByTestId('path')).textContent).toBe('/catalog')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends a signed-in member of staff home, not to the learners’ catalog (which would answer 403)', async () => {
    const { fetchMock } = mockPublicApi(() => jsonResponse(200, makePublicList()))
    renderPage(makeAuth({ user: makeUser({ role: 'teacher', roles: ['teacher'] }) }))
    expect((await screen.findByTestId('path')).textContent).toBe('/')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
