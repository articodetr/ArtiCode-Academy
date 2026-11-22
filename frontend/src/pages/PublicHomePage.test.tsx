// PORTAL-04 (#208) — the academy's public home page (/home): what a visitor, a learner and staff see of API-205 and
// API-236, where each action leads, and that every failing section fails alone (closed catalog, error, empty).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { ACADEMY_PUBLIC_PATH } from '../api/academy'
import type { PublicAcademy } from '../api/academy'
import { PUBLIC_CATALOG_PATH } from '../api/publicCatalog'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import { makePublicAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { CATALOG_NOT_PUBLIC, PUBLIC_COURSE_IDS, makePublicCard, makePublicList } from '../test/publicCatalog'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { PublicHomePage } from './PublicHomePage'

const ph = ar.publicHome
const pc = ar.publicCatalog
const NAME = { ar: 'أكاديمية النور', en: 'Al-Nour Academy' }

function PathProbe() {
  const location = useLocation()
  return <output data-testid="path">{`${location.pathname}${location.search}`}</output>
}

/** Serves API-205 (`academy`) and API-236 (`list`, with the query of each request) and records the list requests. */
function mockHomeApi(list: (query: URLSearchParams, read: number) => Response, academy: Partial<PublicAcademy> = { catalogPublic: true }) {
  const requests: { query: URLSearchParams; headers: Headers }[] = []
  const fetchMock = mockFetch((url, init) => {
    if (url === ACADEMY_PUBLIC_PATH) return jsonResponse(200, makePublicAcademy({ name: NAME, ...academy }))
    if (url === PUBLIC_CATALOG_PATH || url.startsWith(`${PUBLIC_CATALOG_PATH}?`)) {
      const query = new URL(url, 'http://localhost').searchParams
      requests.push({ query, headers: new Headers(init?.headers) })
      return list(query, requests.length)
    }
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })
  })
  return { requests, fetchMock }
}

const PROBES = ['/explore', '/explore/:courseId', '/login', '/catalog', '/catalog/:courseId', '/my-school', '/', '/courses', '/settings', '/verify']

function renderPage(auth = makeAuth()) {
  return renderWithProviders(<PublicHomePage />, {
    auth,
    route: '/home',
    routes: Object.fromEntries(PROBES.map((path) => [path, <PathProbe key={path} />])),
  })
}

const hero = () => within(document.querySelector<HTMLElement>('.public-home__hero')!)
const programs = () => within(screen.getByTestId('home-programs'))
const header = () => within(document.querySelector<HTMLElement>('.public-catalog__header')!)
const footer = () => within(screen.getByTestId('public-footer'))
const button = (scope: ReturnType<typeof within>, text: string) => scope.getByText(text).closest('button')!
const path = async () => (await screen.findByTestId('path')).textContent

describe('PublicHomePage', () => {
  afterEach(async () => {
    await i18n.changeLanguage('ar')
  })

  it('welcomes a visitor in the academy’s name with its first programs, read without a token', async () => {
    const paid = makePublicCard({ id: PUBLIC_COURSE_IDS[1], code: 'WEB-201', name: { ar: 'تطوير الويب' }, pricing: 'paid', price: { amount: 1200, currency: 'SAR' } })
    const api = mockHomeApi(() => jsonResponse(200, makePublicList([makePublicCard(), paid], 'next-page')))
    renderPage()

    expect(await screen.findByText('مرحبًا بك في أكاديمية النور')).toBeInTheDocument()
    expect(await programs().findByText('أساسيات بايثون')).toBeInTheDocument()
    expect(programs().getByText('تطوير الويب')).toBeInTheDocument()
    // The same card as the public catalog: level, price and open classes from the server only.
    expect(within(screen.getByTestId(`public-card-${PUBLIC_COURSE_IDS[0]}`)).getByText(pc.card.free)).toBeInTheDocument()

    // The header: the name, the main links, sign-in with the accounts line; never a «register» button.
    expect(header().getByText('أكاديمية النور')).toBeInTheDocument()
    expect(header().getByText(pc.header.homeLink).closest('a')).toHaveAttribute('href', '/home')
    expect(header().getByText(pc.header.programsLink).closest('a')).toHaveAttribute('href', '/explore')
    expect(header().getByText(pc.header.accountsNote)).toBeInTheDocument()
    expect(hero().getByText(ph.hero.accountsNote)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/إنشاء حساب|أنشئ حساب/)

    // The footer: the same links, the certificate check and the academy’s own name.
    expect(footer().getByText(pc.footer.verifyCertificate).closest('a')).toHaveAttribute('href', '/verify')
    expect(footer().getByText(`© ${new Date().getFullYear()} أكاديمية النور`)).toBeInTheDocument()

    // The tab carries the academy’s name.
    await waitFor(() => expect(document.title).toBe('أكاديمية النور'))

    expect(api.requests).toHaveLength(1)
    expect(api.requests[0]!.query.get('limit')).toBe('6')
    expect(api.requests[0]!.headers.get('Authorization')).toBeNull()
  })

  it('leads a visitor to the public catalog, a course page and the sign-in page', async () => {
    mockHomeApi(() => jsonResponse(200, makePublicList([makePublicCard()])))
    const first = renderPage()
    await programs().findByText('أساسيات بايثون')
    fireEvent.click(button(hero(), ph.hero.browse))
    expect(await path()).toBe('/explore')
    first.unmount()

    const second = renderPage()
    await programs().findByText('أساسيات بايثون')
    fireEvent.click(button(programs(), ph.programs.all))
    expect(await path()).toBe('/explore')
    second.unmount()

    const third = renderPage()
    await programs().findByText('أساسيات بايثون')
    fireEvent.click(within(screen.getByTestId(`public-card-${PUBLIC_COURSE_IDS[0]}`)).getByText(pc.list.details).closest('a')!)
    expect(await path()).toBe(`/explore/${PUBLIC_COURSE_IDS[0]}`)
    third.unmount()

    renderPage()
    await programs().findByText('أساسيات بايثون')
    fireEvent.click(button(hero(), ph.hero.signIn))
    expect(await path()).toBe('/login')
  })

  it('keeps the page when the academy keeps its catalog closed: no programs, no browse links, the way to sign in', async () => {
    mockHomeApi(() => jsonResponse(404, CATALOG_NOT_PUBLIC), { catalogPublic: false })
    renderPage()

    const closed = await screen.findByTestId('home-programs-closed')
    expect(within(closed).getByText(ph.programs.closedVisitor.title)).toBeInTheDocument()
    expect(screen.getByText('مرحبًا بك في أكاديمية النور')).toBeInTheDocument()
    expect(screen.getByText(ph.steps.title)).toBeInTheDocument()
    expect(hero().queryByText(ph.hero.browse)).not.toBeInTheDocument()
    expect(header().queryByText(pc.header.programsLink)).not.toBeInTheDocument()
    expect(footer().queryByText(pc.header.programsLink)).not.toBeInTheDocument()
    expect(programs().queryByText(ph.programs.all)).not.toBeInTheDocument()
    expect(programs().queryByText(ph.programs.subtitle)).not.toBeInTheDocument()
    // The closing call offers the sign-in instead of the programs.
    expect(within(screen.getByTestId('home-cta')).queryByText(ph.hero.browse)).not.toBeInTheDocument()

    fireEvent.click(within(closed).getByText(ph.programs.closedVisitor.action).closest('button')!)
    expect(await path()).toBe('/login')
  })

  it('reports a failed read of the programs in its section with a retry, and an empty catalog calmly', async () => {
    const api = mockHomeApi((_query, read) => (read === 1 ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : jsonResponse(200, makePublicList([]))))
    renderPage()

    expect(await programs().findByText(ph.programs.loadError)).toBeInTheDocument()
    expect(programs().getByText(pc.errors.server)).toBeInTheDocument()
    // The rest of the page stays.
    expect(screen.getByText('مرحبًا بك في أكاديمية النور')).toBeInTheDocument()

    fireEvent.click(button(programs(), ph.programs.retry))
    expect(await programs().findByText(ph.programs.empty)).toBeInTheDocument()
    expect(programs().queryByText(ph.programs.all)).not.toBeInTheDocument()
    expect(api.requests).toHaveLength(2)
  })

  it('shows a generic welcome without the product name when the academy cannot be read', async () => {
    mockFetch((url) => {
      if (url === ACADEMY_PUBLIC_PATH) return jsonResponse(503, { statusCode: 503, code: 'academy_not_configured', message: 'none' })
      return jsonResponse(200, makePublicList([makePublicCard()]))
    })
    renderPage()

    expect(await screen.findByText(ph.hero.title)).toBeInTheDocument()
    await programs().findByText('أساسيات بايثون')
    expect(footer().queryByText(/©/)).not.toBeInTheDocument()
  })

  it('offers a signed-in learner «مدرستي» and the signed-in catalog — never the sign-in page', async () => {
    mockHomeApi(() => jsonResponse(200, makePublicList([makePublicCard()])), { catalogPublic: false })
    const auth = makeAuth({ user: makeUser({ role: 'student', roles: ['student'], permissions: [] }) })
    const first = renderPage(auth)

    await programs().findByText('أساسيات بايثون')
    expect(screen.queryByText(pc.header.signIn)).not.toBeInTheDocument()
    expect(header().getByText(pc.header.programsLink).closest('a')).toHaveAttribute('href', '/catalog')
    fireEvent.click(button(header(), pc.header.mySchool))
    expect(await path()).toBe('/my-school')
    first.unmount()

    const second = renderPage(auth)
    await programs().findByText('أساسيات بايثون')
    fireEvent.click(within(screen.getByTestId(`public-card-${PUBLIC_COURSE_IDS[0]}`)).getByText(pc.list.details).closest('a')!)
    expect(await path()).toBe(`/catalog/${PUBLIC_COURSE_IDS[0]}`)
    second.unmount()

    renderPage(auth)
    await programs().findByText('أساسيات بايثون')
    fireEvent.click(button(hero(), ph.hero.browse))
    expect(await path()).toBe('/catalog')
  })

  it('tells a learner where the courses are while visitors cannot see them', async () => {
    mockHomeApi(() => jsonResponse(404, CATALOG_NOT_PUBLIC), { catalogPublic: false })
    renderPage(makeAuth({ user: makeUser({ role: 'student', roles: ['student'], permissions: [] }) }))

    const closed = await screen.findByTestId('home-programs-closed')
    fireEvent.click(within(closed).getByText(ph.programs.closedLearner.action).closest('button')!)
    expect(await path()).toBe('/catalog')
  })

  it('offers staff the dashboard, and the settings when public browsing is off and they may change it', async () => {
    mockHomeApi(() => jsonResponse(404, CATALOG_NOT_PUBLIC), { catalogPublic: false })
    const admin = makeAuth({ user: makeUser({ permissions: ['academy.settings.manage'] }) })
    const first = renderPage(admin)

    const closed = await screen.findByTestId('home-programs-closed')
    expect(within(closed).getByText(ph.programs.closedStaff.title)).toBeInTheDocument()
    expect(screen.queryByText(pc.header.signIn)).not.toBeInTheDocument()
    expect(header().queryByText(pc.header.programsLink)).not.toBeInTheDocument()
    // Staff get no closing call.
    expect(screen.queryByTestId('home-cta')).not.toBeInTheDocument()
    fireEvent.click(within(closed).getByText(ph.programs.closedStaff.action).closest('button')!)
    expect(await path()).toBe('/settings')
    first.unmount()

    renderPage(makeAuth({ user: makeUser({ role: 'teacher', roles: ['teacher'], permissions: [] }) }))
    const teacherView = await screen.findByTestId('home-programs-closed')
    expect(within(teacherView).queryByText(ph.programs.closedStaff.action)).not.toBeInTheDocument()
    fireEvent.click(button(header(), pc.header.dashboard))
    expect(await path()).toBe('/')
  })

  it('shows neither sign-in nor «مدرستي» while the session is still being restored', async () => {
    mockHomeApi(() => jsonResponse(200, makePublicList([makePublicCard()])))
    renderPage(makeAuth({ status: 'loading' }))

    await programs().findByText('أساسيات بايثون')
    expect(screen.queryByText(pc.header.signIn)).not.toBeInTheDocument()
    expect(screen.queryByText(pc.header.mySchool)).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-cta')).not.toBeInTheDocument()
    // Not even «استعرض البرامج»: a staff session would withdraw it once restored.
    expect(hero().queryByText(ph.hero.browse)).not.toBeInTheDocument()
  })

  it('leads staff to the courses page only with courses.read — otherwise the cards are a plain preview, never a 403', async () => {
    mockHomeApi(() => jsonResponse(200, makePublicList([makePublicCard()])))
    const reader = makeAuth({ user: makeUser({ role: 'teacher', roles: ['teacher'], permissions: ['courses.read'] }) })
    const first = renderPage(reader)
    await programs().findByText('أساسيات بايثون')
    expect(screen.getByText('أساسيات بايثون').closest('a')).toHaveAttribute('href', '/courses')
    fireEvent.click(button(programs(), ph.programs.all))
    expect(await path()).toBe('/courses')
    first.unmount()

    renderPage(makeAuth({ user: makeUser({ role: null, roles: ['accountant'], permissions: ['invoices.read_all'] }) }))
    await programs().findByText('أساسيات بايثون')
    expect(screen.getByText('أساسيات بايثون').closest('a')).toBeNull()
    expect(programs().queryByText(pc.list.details)).not.toBeInTheDocument()
    expect(programs().queryByText(ph.programs.all)).not.toBeInTheDocument()
  })

  it('speaks English with the academy’s English name', async () => {
    await i18n.changeLanguage('en')
    mockHomeApi(() => jsonResponse(200, makePublicList([makePublicCard()])))
    renderPage()

    expect(await screen.findByText('Welcome to Al-Nour Academy')).toBeInTheDocument()
    expect(await programs().findByText('Python Basics')).toBeInTheDocument()
    expect(screen.getByText(en.publicHome.steps.title)).toBeInTheDocument()
    expect(header().getByText(en.publicCatalog.header.programsLink)).toBeInTheDocument()
  })
})
