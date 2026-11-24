// MOD-20 (D-R138) — the public catalog list (/explore, API-236): what a visitor sees of the server's answer, the search,
// «المزيد», the closed catalog, the failures, and that a signed-in user goes to the signed-in catalog instead.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { ACADEMY_PUBLIC_PATH } from '../api/academy'
import { PUBLIC_CATALOG_PATH } from '../api/publicCatalog'
import i18n from '../i18n'
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
function mockPublicApi(list: (query: URLSearchParams) => Response, academy: Parameters<typeof makePublicAcademy>[0] = {}) {
  const requests: { query: URLSearchParams; headers: Headers }[] = []
  const fetchMock = mockFetch((url, init) => {
    if (url === ACADEMY_PUBLIC_PATH) return jsonResponse(200, makePublicAcademy({ catalogPublic: true, name: { ar: 'أكاديمية النور', en: 'Al-Nour Academy' }, ...academy }))
    if (url === PUBLIC_CATALOG_PATH || url.startsWith(`${PUBLIC_CATALOG_PATH}?`)) {
      const query = new URL(url, 'http://localhost').searchParams
      requests.push({ query, headers: new Headers(init?.headers) })
      return list(query)
    }
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })
  })
  return { requests, fetchMock }
}

/** The address of the page itself (PORTAL-04 PR-2: the search lives in `?q=`). */
function AddressProbe() {
  const location = useLocation()
  return <output data-testid="address">{decodeURIComponent(location.search)}</output>
}

function renderPage(auth = makeAuth(), search = '') {
  return renderWithProviders(
    <>
      <PublicCatalogPage />
      <AddressProbe />
    </>,
    {
    auth,
    route: { pathname: '/explore', search },
    routes: { '/explore/:courseId': <PathProbe />, '/login': <PathProbe />, '/catalog': <PathProbe />, '/': <PathProbe /> },
    },
  )
}

const card = (id: string) => within(screen.getByTestId(`public-card-${id}`))

describe('PublicCatalogPage', () => {
  it('shows the published courses as cards — price, subject, counts and open classes — read without a token', async () => {
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
    // The code is not shown on a card; a search by code still reaches the server (below).
    expect(free.queryByText('PY-101')).not.toBeInTheDocument()
    expect(free.getByText('مدخل عملي إلى البرمجة')).toBeInTheDocument()
    // PORTAL-04: the school subject, never the difficulty level; no sessions and no age range.
    expect(free.getByText('البرمجة')).toBeInTheDocument()
    expect(free.queryByText('مبتدئ')).not.toBeInTheDocument()
    expect(free.getByText(pc.card.free)).toBeInTheDocument()
    expect(free.getByText(pc.card.available)).toBeInTheDocument()
    expect(free.getByText('24 ساعة')).toBeInTheDocument()
    expect(screen.getByTestId(`public-card-${PUBLIC_COURSE_IDS[0]}`).textContent).not.toContain('جلس')
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
    // No class open: «قريبًا» on the card, with no subscribe button.
    expect(ai.getByText(pc.card.comingSoon)).toBeInTheDocument()
    expect(ai.queryByText(pc.card.closed)).not.toBeInTheDocument()
    expect(screen.queryByTestId(`public-subscribe-${PUBLIC_COURSE_IDS[2]}`)).not.toBeInTheDocument()
    // No teacher, no class code, no schedule is ever shown — the server sends none.
    expect(document.body.textContent).not.toContain('PY-101-A')

    // The header: the academy's name from API-205 and the sign-in button (the shared public header — PORTAL-04 PR-1
    // redesign — no longer carries the accounts line; the list subtitle says how to enroll). The footer names it too.
    const header = within(document.querySelector<HTMLElement>('.public-catalog__header')!)
    expect(await header.findByText('أكاديمية النور')).toBeInTheDocument()
    expect(header.getByText(pc.header.signIn).closest('button')).toBeInTheDocument()

    expect(api.requests).toHaveLength(1)
    expect(api.requests[0]!.query.get('limit')).toBe('24')
    expect(api.requests[0]!.query.has('q')).toBe(false)
    expect(api.requests[0]!.headers.get('Authorization')).toBeNull()
    // One h1 for the page; each card's name is an h2 under it (PORTAL-04 review).
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(pc.list.title)
    expect(card(PUBLIC_COURSE_IDS[0]).getByRole('heading', { level: 2 })).toHaveTextContent('أساسيات بايثون')
  })

  it('opens a course page from its card', async () => {
    mockPublicApi(() => jsonResponse(200, makePublicList()))
    renderPage()
    await screen.findByText('أساسيات بايثون')
    fireEvent.click(card(PUBLIC_COURSE_IDS[0]).getByText(pc.card.viewCourse).closest('a')!)
    expect((await screen.findByTestId('path')).textContent).toBe(`/explore/${PUBLIC_COURSE_IDS[0]}`)
  })

  it('still finds a course by its code, which the card no longer shows', async () => {
    const api = mockPublicApi(() => jsonResponse(200, makePublicList()))
    renderPage()
    await screen.findByText('أساسيات بايثون')

    fireEvent.change(screen.getByLabelText(pc.list.searchLabel), { target: { value: 'PY-101' } })
    await waitFor(() => expect(api.requests.at(-1)!.query.get('q')).toBe('PY-101'))
    expect(await screen.findByText('أساسيات بايثون')).toBeInTheDocument()
    expect(screen.queryByText('PY-101')).not.toBeInTheDocument()
  })

  it('makes the whole card a real link to its course page, and names the tab after the page and the academy (PORTAL-04)', async () => {
    mockPublicApi(() => jsonResponse(200, makePublicList()))
    renderPage()
    const link = (await screen.findByText('أساسيات بايثون')).closest('a')!
    expect(link).toHaveAttribute('href', `/explore/${PUBLIC_COURSE_IDS[0]}`)
    // The link is stretched over the card (publicCatalog.css), so a click anywhere on it opens the course.
    expect(link).toHaveClass('public-card__link')
    await waitFor(() => expect(document.title).toBe(`${pc.list.tabTitle} — أكاديمية النور`))
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

  describe('the order of the cards', () => {
    const open = (id: string) => makePublicCard({ id, code: id, name: { ar: `برنامج ${id}` } })
    const full = (id: string) => makePublicCard({ id, code: id, name: { ar: `برنامج ${id}` }, hasFreeSeat: false })
    const soon = (id: string) => makePublicCard({ id, code: id, name: { ar: `برنامج ${id}` }, openClasses: 0, hasFreeSeat: false })
    const shownIds = () => Array.from(document.querySelectorAll('[data-testid^="public-card-"]')).map((node) => node.getAttribute('data-testid')!.slice('public-card-'.length))

    it('orders each page as it arrives and only appends the next one: no card jumps, is lost or repeats, and the cursor still works', async () => {
      const api = mockPublicApi((query) =>
        query.get('cursor') === 'next-1'
          ? // `s1` again: a course the server moved between the two reads is not shown twice.
            jsonResponse(200, makePublicList([soon('s2'), soon('s1'), open('o2')], null))
          : jsonResponse(200, makePublicList([soon('s1'), full('f1'), open('o1')], 'next-1')),
      )
      renderPage()

      await screen.findByText('برنامج o1')
      expect(shownIds()).toEqual(['o1', 'f1', 's1'])

      fireEvent.click(screen.getByText(pc.list.more).closest('button')!)
      await screen.findByText('برنامج o2')
      expect(shownIds()).toEqual(['o1', 'f1', 's1', 'o2', 's2'])
      expect(api.requests.map((request) => request.query.get('cursor'))).toEqual([null, 'next-1'])

      // The whole list is on screen: the count is every distinct course.
      await waitFor(() => expect(screen.queryByText(pc.list.more)).not.toBeInTheDocument())
      expect(screen.getByText(i18n.getFixedT('ar')('publicCatalog.list.count', { count: 5 }))).toBeInTheDocument()
    })

    it('orders the results of a search the same way', async () => {
      mockPublicApi(() => jsonResponse(200, makePublicList([soon('s1'), open('o1')])))
      renderPage(makeAuth(), '?q=برنامج')

      await screen.findByText('برنامج o1')
      expect(shownIds()).toEqual(['o1', 's1'])
    })
  })

  it('searches once the typing pauses, from the first page, and offers to clear a search that finds nothing', async () => {
    const api = mockPublicApi((query) => (query.get('q') ? jsonResponse(200, makePublicList([], null)) : jsonResponse(200, makePublicList())))
    renderPage()
    await screen.findByText('أساسيات بايثون')

    fireEvent.change(screen.getByLabelText(pc.list.searchLabel), { target: { value: '  جافا ' } })
    expect(await screen.findByText(pc.list.emptyFiltered)).toBeInTheDocument()
    expect(api.requests.at(-1)!.query.get('q')).toBe('جافا')
    expect(api.requests.at(-1)!.query.has('cursor')).toBe(false)

    // «مسح البحث» sits in the results bar and in the «no results» panel; the panel's button is used here.
    const noResults = screen.getByText(pc.list.emptyFilteredTitle).closest<HTMLElement>('.public-home__notice')!
    fireEvent.click(within(noResults).getByText(pc.list.clearSearch).closest('button')!)
    expect(await screen.findByText('أساسيات بايثون')).toBeInTheDocument()
    expect(api.requests.at(-1)!.query.has('q')).toBe(false)
  })

  it('keeps the search in the address: starts from ?q=, writes a new search there, and drops it when cleared', async () => {
    const api = mockPublicApi((query) => jsonResponse(200, makePublicList(query.get('q') === 'جافا' ? [] : [makePublicCard()])))
    renderPage(makeAuth(), '?q=بايثون')

    expect(await screen.findByText('أساسيات بايثون')).toBeInTheDocument()
    expect(api.requests[0]!.query.get('q')).toBe('بايثون')
    expect(screen.getByLabelText(pc.list.searchLabel)).toHaveValue('بايثون')
    expect(screen.getByText('نتائج البحث عن «بايثون»')).toBeInTheDocument()
    // Each card carries the search to its course page, whose «العودة إلى الدورات» comes back to these results.
    expect(decodeURIComponent(screen.getByText('أساسيات بايثون').closest('a')!.getAttribute('href')!)).toBe(`/explore/${PUBLIC_COURSE_IDS[0]}?q=بايثون`)

    fireEvent.change(screen.getByLabelText(pc.list.searchLabel), { target: { value: 'جافا' } })
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent('?q=جافا'))
    expect(api.requests.at(-1)!.query.get('q')).toBe('جافا')

    const bar = within(document.querySelector<HTMLElement>('.public-explore__toolbar')!)
    fireEvent.click(bar.getByText(pc.list.clearSearch).closest('button')!)
    await waitFor(() => expect(screen.getByTestId('address')).toBeEmptyDOMElement())
    expect(await screen.findByText(pc.list.allResults)).toBeInTheDocument()
  })

  it('starts from the first page again when a search is cleared after «عرض المزيد» — never resumes a stale page', async () => {
    const pageTwo = makePublicCard({ id: PUBLIC_COURSE_IDS[1], code: 'WEB-201', name: { ar: 'تطوير الويب' } })
    const found = makePublicCard({ id: PUBLIC_COURSE_IDS[2], code: 'JV-101', name: { ar: 'جافا' } })
    const api = mockPublicApi((query) => {
      if (query.get('q')) return jsonResponse(200, makePublicList([found], null))
      return query.get('cursor') === 'c1' ? jsonResponse(200, makePublicList([pageTwo], null)) : jsonResponse(200, makePublicList([makePublicCard()], 'c1'))
    })
    renderPage()
    await screen.findByText('أساسيات بايثون')
    fireEvent.click(screen.getByText(pc.list.more).closest('button')!)
    expect(await screen.findByText('تطوير الويب')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(pc.list.searchLabel), { target: { value: 'جافا' } })
    expect(await screen.findByText('جافا')).toBeInTheDocument()

    const bar = within(document.querySelector<HTMLElement>('.public-explore__toolbar')!)
    fireEvent.click(bar.getByText(pc.list.clearSearch).closest('button')!)
    expect(await screen.findByText('أساسيات بايثون')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('جافا')).not.toBeInTheDocument())
    expect(screen.queryByText('تطوير الويب')).not.toBeInTheDocument()
    expect(screen.getByText(pc.list.more).closest('button')).toBeInTheDocument()
    expect(api.requests.at(-1)!.query.has('cursor')).toBe(false)
    expect(api.requests.at(-1)!.query.has('q')).toBe(false)
  })

  it('says how many programs once the whole list is on screen — never while more pages remain', async () => {
    const second = makePublicCard({ id: PUBLIC_COURSE_IDS[1], code: 'WEB-201', name: { ar: 'تطوير الويب' } })
    let complete = true
    mockPublicApi(() => jsonResponse(200, makePublicList([makePublicCard(), second], complete ? null : 'next')))
    const first = renderPage()
    expect(await screen.findByText('تطوير الويب')).toBeInTheDocument()
    expect(screen.getByText(pc.list.allResults)).toBeInTheDocument()
    expect(screen.getByText('برنامجان')).toBeInTheDocument()
    first.unmount()

    complete = false
    renderPage()
    expect(await screen.findByText('تطوير الويب')).toBeInTheDocument()
    expect(screen.queryByText('برنامجان')).not.toBeInTheDocument()
    expect(screen.getByText(pc.list.more).closest('button')).toBeInTheDocument()
  })

  it('says calmly that the academy does not show its courses to visitors (404 catalog_not_public), with the way to sign in', async () => {
    mockPublicApi(() => jsonResponse(404, CATALOG_NOT_PUBLIC))
    renderPage()

    const closed = await screen.findByTestId('catalog-closed')
    expect(within(closed).getByText(pc.closed.title)).toBeInTheDocument()
    expect(within(closed).getByText(pc.closed.text)).toBeInTheDocument()
    expect(screen.queryByText(pc.list.loadError)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(pc.list.searchLabel)).not.toBeInTheDocument()
    // The page keeps its heading; the line inviting to browse would contradict the closed catalog.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(pc.list.title)
    expect(screen.queryByText(pc.list.subtitle)).not.toBeInTheDocument()

    fireEvent.click(within(closed).getByText(pc.closed.signIn).closest('button')!)
    expect((await screen.findByTestId('path')).textContent).toBe('/login')
    expect(screen.queryByText(ar.studentRegistration.entry.createAccount)).not.toBeInTheDocument()
  })

  it('offers a new account on the closed panel only while the academy opens registration, reading API-205 once', async () => {
    const { fetchMock } = mockPublicApi(() => jsonResponse(404, CATALOG_NOT_PUBLIC), { selfRegistration: true })
    renderPage()

    const closed = await screen.findByTestId('catalog-closed')
    await waitFor(() => expect(within(closed).getByText(ar.studentRegistration.entry.accountsNote)).toBeInTheDocument())
    expect(within(closed).queryByText(pc.closed.text)).not.toBeInTheDocument()
    expect(within(closed).getByRole('link', { name: ar.studentRegistration.entry.createAccount })).toHaveAttribute('href', '/register')
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith(ACADEMY_PUBLIC_PATH))).toHaveLength(1)
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
