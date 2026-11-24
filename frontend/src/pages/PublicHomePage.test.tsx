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
import { HOME_IMAGES } from '../publicHome/homeImages'
import { HOME_IMAGE_PLACEHOLDER } from '../publicHome/homeImages.view'
import { HOME_IMAGE_KEYS } from '../publicHome/homeImageSlots'
import type { HomeImageKey } from '../publicHome/homeImageSlots'
import { makePublicAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { CATALOG_NOT_PUBLIC, PUBLIC_COURSE_IDS, makePublicCard, makePublicList } from '../test/publicCatalog'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { PublicHomePage } from './PublicHomePage'

const ph = ar.publicHome
const pc = ar.publicCatalog
const NAME = { ar: 'أكاديمية النور', en: 'Al-Nour Academy' }
// The academy's own pictures of two places (Settings → Homepage Images); the other two stay the defaults.
const HERO_URL = '/api/academy/media/0123456789abcdef0123456789abcdef.webp'
const WHY_URL = '/api/academy/media/fedcba9876543210fedcba9876543210.jpg'
const OWN_PICTURES = { heroStudent: HERO_URL, aboutLearners: null, promoTraining: null, whyClassroom: WHY_URL }

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

const PROBES = ['/explore', '/explore/:courseId', '/login', '/catalog', '/catalog/:courseId', '/my-classes', '/', '/courses', '/settings', '/verify']

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
/** The source of each of the four pictures of /home right now (null: the place is missing). */
const pictures = () =>
  Object.fromEntries(HOME_IMAGE_KEYS.map((key: HomeImageKey) => [key, document.querySelector(`img[data-home-image="${key}"]`)?.getAttribute('src') ?? null]))
const DEFAULT_PICTURES = { ...HOME_IMAGES }

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

    // One h1: the heading of the welcome band; the academy’s name is in the welcome line above it.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(`${ph.hero.titleStart} ${ph.hero.titleHighlight}`)

    // The header: the name, the main links and the sign-in; never a «register» button. The line that accounts come
    // from the academy is said once, in the welcome band.
    expect(header().getByText('أكاديمية النور')).toBeInTheDocument()
    expect(header().getByText(pc.header.homeLink).closest('a')).toHaveAttribute('href', '/home')
    expect(header().getByText(pc.header.programsLink).closest('a')).toHaveAttribute('href', '/explore')
    expect(header().getByText(pc.header.signIn).closest('button')).toBeInTheDocument()
    expect(hero().getByText(ph.hero.accountsNote)).toBeInTheDocument()
    expect(screen.getAllByText(ph.hero.accountsNote)).toHaveLength(1)
    expect(document.body.textContent).not.toMatch(/إنشاء حساب|أنشئ حساب/)

    // The footer: the same links, the certificate check and the academy’s own name.
    expect(footer().getByText(pc.footer.verifyCertificate).closest('a')).toHaveAttribute('href', '/verify')
    expect(footer().getByText(`© ${new Date().getFullYear()} أكاديمية النور`)).toBeInTheDocument()

    // The tab carries the academy’s name, and so does the page’s description — never the product’s line.
    await waitFor(() => expect(document.title).toBe('أكاديمية النور'))
    expect(document.head.querySelector('meta[name="description"]')).toHaveAttribute('content', `أكاديمية النور — ${ph.meta.description}`)

    expect(api.requests).toHaveLength(1)
    expect(api.requests[0]!.query.get('limit')).toBe('48')
    expect(api.requests[0]!.headers.get('Authorization')).toBeNull()
  })

  it('shows six cards and states only figures summed from the server’s answer, a lower bound with «+» when more exist', async () => {
    const cards = Array.from({ length: 8 }, (_, index) =>
      makePublicCard({ id: `00000000-0000-7000-8000-00000000000${index}`, code: `C-${index}`, name: { ar: `برنامج ${index}` }, lessonCount: 5, durationHours: 2.5, openClasses: 1 }),
    )
    mockHomeApi(() => jsonResponse(200, makePublicList(cards, 'next-page')))
    renderPage()

    await programs().findByText('برنامج 0')
    expect(programs().getByText('برنامج 5')).toBeInTheDocument()
    expect(programs().queryByText('برنامج 6')).not.toBeInTheDocument()
    const stats = within(screen.getByTestId('home-stats'))
    expect(stats.getByText(ph.stats.programs).closest('div')).toHaveTextContent('8+')
    expect(stats.getByText(ph.stats.lessons).closest('div')).toHaveTextContent('40+')
    expect(stats.getByText(ph.stats.hours).closest('div')).toHaveTextContent('20+')
    expect(stats.getByText(ph.stats.openClasses).closest('div')).toHaveTextContent('8+')
  })

  it('keeps a course nobody can join off the page, while the figures still count every course read', async () => {
    const soon = makePublicCard({ id: PUBLIC_COURSE_IDS[0], code: 'SOON-1', name: { ar: 'برنامج قادم' }, openClasses: 0, hasFreeSeat: false, lessonCount: 3 })
    const full = makePublicCard({ id: PUBLIC_COURSE_IDS[1], code: 'FULL-1', name: { ar: 'برنامج ممتلئ' }, openClasses: 2, hasFreeSeat: false, lessonCount: 3 })
    const open = makePublicCard({ id: PUBLIC_COURSE_IDS[2], code: 'OPEN-1', name: { ar: 'برنامج متاح' }, openClasses: 1, hasFreeSeat: true, lessonCount: 3 })
    mockHomeApi(() => jsonResponse(200, makePublicList([soon, full, open])))
    renderPage()

    await programs().findByText('برنامج متاح')
    expect(programs().queryByText('برنامج قادم')).not.toBeInTheDocument()
    expect(programs().queryByText('برنامج ممتلئ')).not.toBeInTheDocument()
    expect(programs().getByText(ph.programs.subtitle)).toBeInTheDocument()
    expect(programs().getByText(ph.programs.all)).toBeInTheDocument()
    const stats = within(screen.getByTestId('home-stats'))
    expect(stats.getByText(ph.stats.programs).closest('div')).toHaveTextContent('3')
    expect(stats.getByText(ph.stats.lessons).closest('div')).toHaveTextContent('9')
    expect(stats.getByText(ph.stats.openClasses).closest('div')).toHaveTextContent('3')
  })

  it('shows the first published courses, marked «قريبًا» and without an invitation to join, when none can be joined', async () => {
    const cards = Array.from({ length: 7 }, (_, index) =>
      makePublicCard({ id: `00000000-0000-7000-8000-00000000001${index}`, code: `S-${index}`, name: { ar: `قادم ${index}` }, openClasses: 0, hasFreeSeat: false }),
    )
    mockHomeApi(() => jsonResponse(200, makePublicList(cards)))
    renderPage()

    await programs().findByText('قادم 0')
    expect(programs().getByText('قادم 5')).toBeInTheDocument()
    expect(programs().queryByText('قادم 6')).not.toBeInTheDocument()
    expect(programs().getAllByText(pc.card.comingSoon)).toHaveLength(6)
    expect(programs().queryByText(pc.card.closed)).not.toBeInTheDocument()
    expect(programs().queryByText(pc.card.subscribeFree)).not.toBeInTheDocument()
    expect(programs().queryByText(pc.card.subscribePaid)).not.toBeInTheDocument()
    // The section says they cannot be joined now, and the way to the full catalog stays.
    expect(programs().getByText(ph.programs.noneJoinable)).toBeInTheDocument()
    expect(programs().queryByText(ph.programs.subtitle)).not.toBeInTheDocument()
    expect(programs().getByText(ph.programs.all)).toBeInTheDocument()
    // The closing strip invites to enroll: with nothing to join it does not show.
    expect(screen.queryByTestId('home-cta')).not.toBeInTheDocument()
  })

  it('words a home card with no class open "Coming soon" in English', async () => {
    await i18n.changeLanguage('en')
    mockHomeApi(() => jsonResponse(200, makePublicList([makePublicCard({ openClasses: 0, hasFreeSeat: false })])))
    renderPage()

    expect(await programs().findByText(en.publicCatalog.card.comingSoon)).toBeInTheDocument()
    expect(programs().getByText(en.publicHome.programs.noneJoinable)).toBeInTheDocument()
  })

  it('invents nothing: no figures without programs, and no testimonials or articles section', async () => {
    mockHomeApi(() => jsonResponse(404, CATALOG_NOT_PUBLIC), { catalogPublic: false })
    renderPage()

    await screen.findByTestId('home-programs-closed')
    expect(screen.queryByTestId('home-stats')).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-testimonials')).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-articles')).not.toBeInTheDocument()
    // The hero's facts fall back to plain words.
    expect(hero().getByText(ph.hero.indicators.media)).toBeInTheDocument()
    expect(hero().queryByText(ph.stats.programs)).not.toBeInTheDocument()
  })

  it('sends a visitor’s search to /explore in the address', async () => {
    mockHomeApi(() => jsonResponse(200, makePublicList([makePublicCard()])))
    renderPage()
    await programs().findByText('أساسيات بايثون')

    fireEvent.change(hero().getByRole('textbox', { name: pc.list.searchLabel }), { target: { value: '  بايثون  ' } })
    fireEvent.click(button(hero(), ph.hero.browse))
    expect(await path()).toBe(`/explore?q=${encodeURIComponent('بايثون')}`)
  })

  it('opens the phone menu with the main links', async () => {
    mockHomeApi(() => jsonResponse(200, makePublicList([makePublicCard()])))
    renderPage()
    await programs().findByText('أساسيات بايثون')

    fireEvent.click(header().getByRole('button', { name: new RegExp(pc.header.openMenu) }))
    const menu = await screen.findByRole('dialog')
    expect(within(menu).getByText(pc.header.programsLink).closest('a')).toHaveAttribute('href', '/explore')
    expect(within(menu).getByText(pc.header.certificatesLink).closest('a')).toHaveAttribute('href', '/verify')
    expect(within(menu).getByText(pc.header.aboutLink).closest('a')).toHaveAttribute('href', '/home#about')
  })

  it('leads a visitor to the public catalog, a course page and the sign-in page — signing in from the header only', async () => {
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
    fireEvent.click(within(screen.getByTestId(`public-card-${PUBLIC_COURSE_IDS[0]}`)).getByText(pc.card.viewCourse).closest('a')!)
    expect(await path()).toBe(`/explore/${PUBLIC_COURSE_IDS[0]}`)
    third.unmount()

    const fourth = renderPage()
    await programs().findByText('أساسيات بايثون')
    // The closing band invites to the programs.
    fireEvent.click(button(within(screen.getByTestId('home-cta')), ph.hero.browse))
    expect(await path()).toBe('/explore')
    fourth.unmount()

    renderPage()
    await programs().findByText('أساسيات بايثون')
    // While the programs are open to visitors, the sign-in is the header’s alone — not repeated in the page.
    expect(screen.getAllByText(pc.header.signIn)).toHaveLength(1)
    expect(hero().queryByText(ph.hero.signIn)).not.toBeInTheDocument()
    fireEvent.click(button(header(), pc.header.signIn))
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
    // Sign-in twice only — the header and the welcome band; the closed panel and the closing band add none.
    expect(within(closed).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-cta')).not.toBeInTheDocument()
    expect(screen.getAllByText(pc.header.signIn)).toHaveLength(2)

    fireEvent.click(button(hero(), ph.hero.signIn))
    expect(await path()).toBe('/login')
  })

  it('reports a failed read of the programs in its section with a retry, and an empty catalog calmly', async () => {
    const api = mockHomeApi((_query, read) => (read === 1 ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : jsonResponse(200, makePublicList([]))))
    renderPage()

    expect(await programs().findByText(ph.programs.loadError)).toBeInTheDocument()
    expect(programs().getByText(pc.errors.server)).toBeInTheDocument()
    // No closing band inviting to programs that could not be shown.
    expect(screen.queryByTestId('home-cta')).not.toBeInTheDocument()
    // The rest of the page stays.
    expect(screen.getByText('مرحبًا بك في أكاديمية النور')).toBeInTheDocument()

    fireEvent.click(button(programs(), ph.programs.retry))
    expect(await programs().findByText(ph.programs.empty)).toBeInTheDocument()
    expect(programs().queryByText(ph.programs.all)).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-cta')).not.toBeInTheDocument()
    expect(api.requests).toHaveLength(2)
  })

  it('shows a generic welcome without the product name when the academy cannot be read', async () => {
    mockFetch((url) => {
      if (url === ACADEMY_PUBLIC_PATH) return jsonResponse(503, { statusCode: 503, code: 'academy_not_configured', message: 'none' })
      return jsonResponse(200, makePublicList([makePublicCard()]))
    })
    renderPage()

    expect(await screen.findByText(ph.hero.welcome)).toBeInTheDocument()
    await programs().findByText('أساسيات بايثون')
    expect(footer().queryByText(/©/)).not.toBeInTheDocument()
    // The header and the tab show a neutral «الأكاديمية» — never the product's name (#208).
    expect(header().getByTestId('public-academy-name')).toHaveTextContent(pc.header.academyFallback)
    await waitFor(() => expect(document.title).toBe(pc.header.academyFallback))
    expect(document.body.textContent).not.toContain(ar.common.appName)
    // The description speaks for no academy in particular — and not for the product either.
    expect(document.head.querySelector('meta[name="description"]')).toHaveAttribute('content', ph.meta.description)
  })

  it('offers a signed-in learner «فصولي» and the signed-in catalog — never the sign-in page', async () => {
    mockHomeApi(() => jsonResponse(200, makePublicList([makePublicCard()])), { catalogPublic: false })
    const auth = makeAuth({ user: makeUser({ role: 'student', roles: ['student'], permissions: [] }) })
    const first = renderPage(auth)

    await programs().findByText('أساسيات بايثون')
    expect(screen.queryByText(pc.header.signIn)).not.toBeInTheDocument()
    expect(header().getByText(pc.header.programsLink).closest('a')).toHaveAttribute('href', '/catalog')
    fireEvent.click(button(header(), pc.header.mySchool))
    expect(await path()).toBe('/my-classes')
    first.unmount()

    const second = renderPage(auth)
    await programs().findByText('أساسيات بايثون')
    fireEvent.click(within(screen.getByTestId(`public-card-${PUBLIC_COURSE_IDS[0]}`)).getByText(pc.card.viewCourse).closest('a')!)
    expect(await path()).toBe(`/catalog/${PUBLIC_COURSE_IDS[0]}`)
    second.unmount()

    renderPage(auth)
    await programs().findByText('أساسيات بايثون')
    // «مدرستي» twice (header, welcome band) — no closing band repeating it.
    expect(screen.queryByTestId('home-cta')).not.toBeInTheDocument()
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

  it('shows neither sign-in nor «فصولي» while the session is still being restored', async () => {
    mockHomeApi(() => jsonResponse(200, makePublicList([makePublicCard()])))
    renderPage(makeAuth({ status: 'loading' }))

    await programs().findByText('أساسيات بايثون')
    expect(screen.queryByText(pc.header.signIn)).not.toBeInTheDocument()
    expect(screen.queryByText(pc.header.mySchool)).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-cta')).not.toBeInTheDocument()
    // Not even «استعرض البرامج» or the header’s «البرامج»: a staff session would withdraw them once restored.
    expect(hero().queryByText(ph.hero.browse)).not.toBeInTheDocument()
    expect(header().queryByText(pc.header.programsLink)).not.toBeInTheDocument()
    expect(footer().queryByText(pc.header.programsLink)).not.toBeInTheDocument()
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
    expect(programs().queryByText(pc.card.viewCourse)).not.toBeInTheDocument()
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

  describe('the academy’s own pictures (Settings → Homepage Images)', () => {
    it('shows the academy’s hero and «why» pictures in their places and the defaults of the other two', async () => {
      mockHomeApi(() => jsonResponse(200, makePublicList([makePublicCard()])), { catalogPublic: true, homepageImages: OWN_PICTURES })
      renderPage()

      await screen.findByText('مرحبًا بك في أكاديمية النور')
      expect(pictures()).toEqual({ ...DEFAULT_PICTURES, heroStudent: HERO_URL, whyClassroom: WHY_URL })
      // Each in its own band, with the attributes it always had.
      const heroPicture = document.querySelector('.public-home__hero-figure img')
      expect(heroPicture).toHaveAttribute('src', HERO_URL)
      expect(heroPicture).toHaveAttribute('alt', '')
      expect(heroPicture).toHaveAttribute('fetchpriority', 'high')
      expect(document.querySelector('.public-home__why-photo img')).toHaveAttribute('src', WHY_URL)
      expect(document.querySelector('.public-home__why-photo img')).toHaveAttribute('loading', 'lazy')
      expect(document.querySelector('#about .public-home__photo-frame img')).toHaveAttribute('src', HOME_IMAGES.aboutLearners)
      expect(document.querySelector('.public-home__photo-frame--promo img')).toHaveAttribute('src', HOME_IMAGES.promoTraining)
    })

    it('shows the four defaults when the academy has none of its own', async () => {
      const none = { heroStudent: null, aboutLearners: null, promoTraining: null, whyClassroom: null }
      mockHomeApi(() => jsonResponse(200, makePublicList([makePublicCard()])), { catalogPublic: true, homepageImages: none })
      renderPage()
      await screen.findByText('مرحبًا بك في أكاديمية النور')
      expect(pictures()).toEqual(DEFAULT_PICTURES)
    })

    it('shows the four defaults when API-205 answers without homepageImages', async () => {
      mockHomeApi(() => jsonResponse(200, makePublicList([makePublicCard()])))
      renderPage()
      await screen.findByText('مرحبًا بك في أكاديمية النور')
      expect(pictures()).toEqual(DEFAULT_PICTURES)
    })

    it('shows no drawn laptop in front of the hero picture (removed at the owner’s request)', async () => {
      mockHomeApi(() => jsonResponse(200, makePublicList([makePublicCard()])), { catalogPublic: true, homepageImages: OWN_PICTURES })
      renderPage()
      await screen.findByText('مرحبًا بك في أكاديمية النور')
      expect(document.querySelector('.public-home__hero-laptop')).toBeNull()
    })

    it('keeps the four frames empty while API-205 loads — no default flashes before the academy’s own picture', async () => {
      let answer!: (response: Response) => void
      const academy = new Promise<Response>((resolve) => {
        answer = resolve
      })
      mockFetch((url) => (url === ACADEMY_PUBLIC_PATH ? academy : jsonResponse(200, makePublicList([makePublicCard()]))))
      renderPage()

      // The programs are already shown; the pictures still wait for API-205, each in its frame.
      await programs().findByText('أساسيات بايثون')
      expect(pictures()).toEqual(Object.fromEntries(HOME_IMAGE_KEYS.map((key) => [key, HOME_IMAGE_PLACEHOLDER])))
      expect(document.querySelector('.public-home__hero-figure img')).toHaveAttribute('width', '760')
      expect(document.querySelector('.public-home__hero-figure img')).toHaveAttribute('height', '981')

      answer(jsonResponse(200, makePublicAcademy({ name: NAME, catalogPublic: true, homepageImages: OWN_PICTURES })))
      await screen.findByText('مرحبًا بك في أكاديمية النور')
      expect(pictures()).toEqual({ ...DEFAULT_PICTURES, heroStudent: HERO_URL, whyClassroom: WHY_URL })
    })

    it('shows the defaults when the academy cannot be read', async () => {
      mockFetch((url) =>
        url === ACADEMY_PUBLIC_PATH
          ? jsonResponse(503, { statusCode: 503, code: 'academy_not_configured', message: 'none' })
          : jsonResponse(200, makePublicList([makePublicCard()])),
      )
      renderPage()

      expect(await screen.findByText(ph.hero.welcome)).toBeInTheDocument()
      expect(pictures()).toEqual(DEFAULT_PICTURES)
    })

    it('shows the same pictures in English', async () => {
      await i18n.changeLanguage('en')
      mockHomeApi(() => jsonResponse(200, makePublicList([makePublicCard()])), { catalogPublic: true, homepageImages: OWN_PICTURES })
      renderPage()

      expect(await screen.findByText('Welcome to Al-Nour Academy')).toBeInTheDocument()
      expect(pictures()).toEqual({ ...DEFAULT_PICTURES, heroStudent: HERO_URL, whyClassroom: WHY_URL })
    })
  })
})
