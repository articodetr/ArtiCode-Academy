import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { SettingsPage } from '../pages/SettingsPage'
import { SETTINGS_MANAGER_PERMISSIONS, makeAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { AppLayout } from './AppLayout'

function menuLabels(): string[] {
  return within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent?.trim() ?? '')
}

describe('AppLayout navigation', () => {
  // The header reads GET /api/academy (J-F13); these tests are about the menu, so that read never answers.
  beforeEach(() => {
    mockFetch(() => new Promise<Response>(() => {}))
  })

  it('shows a custom role holding users.read only the dashboard and the users page (AC1)', () => {
    const custom = makeUser({ role: null, roles: ['auditor'], permissions: ['users.read'] })
    renderWithProviders(<AppLayout />, { auth: makeAuth({ user: custom }), route: '/users' })
    expect(menuLabels()).toEqual([ar.nav.dashboard, ar.nav.users])
  })

  it('groups the entries under section headings in the order of NAV_GROUPS, leaving out empty sections (redesign)', () => {
    const user = makeUser({ role: null, roles: ['coordinator'], permissions: ['users.read', 'courses.read', 'roles.manage'] })
    renderWithProviders(<AppLayout />, { auth: makeAuth({ user }), route: '/' })
    const menu = screen.getByRole('menu')
    const headings = [...menu.querySelectorAll('.ant-menu-item-group-title')].map((node) => node.textContent?.trim())
    expect(headings).toEqual([ar.nav.groups.home, ar.nav.groups.teaching, ar.nav.groups.people, ar.nav.groups.academy])
    expect(headings).not.toContain(ar.nav.groups.finance)
  })

  it('adds the roles and audit entries for their permission holders and hides them from a student', () => {
    const { unmount } = renderWithProviders(<AppLayout />, {
      auth: makeAuth({ user: makeUser({ permissions: ['users.read', 'roles.manage', 'audit.read', 'academy.settings.read'] }) }),
      route: '/',
    })
    const admin = menuLabels()
    // Redesign (2026-11-14): the roles tab is one of the settings tabs, so the menu shows the one settings entry;
    // the audit log follows it, last.
    expect(admin).not.toContain(ar.nav.roles)
    expect(admin).toContain(ar.nav.settings)
    expect(admin.indexOf(ar.nav.audit)).toBe(admin.length - 1)
    expect(admin.indexOf(ar.nav.audit)).toBe(admin.indexOf(ar.nav.settings) + 1)
    unmount()

    const student = makeUser({ role: 'student', roles: ['student'], permissions: ['courses.read'] })
    renderWithProviders(<AppLayout />, { auth: makeAuth({ user: student }), route: '/' })
    const labels = menuLabels()
    // Redesign (2026-11-14): the staff courses page is not a learner's — «my classes» is.
    expect(labels).not.toContain(ar.nav.courses)
    expect(labels).toContain(ar.nav.myClasses)
    expect(labels).not.toContain(ar.nav.users)
    expect(labels).not.toContain(ar.nav.roles)
    expect(labels).not.toContain(ar.nav.audit)
  })

  it('selects the roles entry on /settings/roles rather than the settings entry', () => {
    renderWithProviders(<AppLayout />, {
      auth: makeAuth({ user: makeUser({ permissions: ['roles.manage'] }) }),
      route: '/settings/roles',
    })
    const selected = document.querySelectorAll('.ant-menu-item-selected')
    expect(selected).toHaveLength(1)
    expect(selected[0]).toHaveTextContent(ar.nav.roles)
  })

  it('folds the settings tabs into one settings entry, selected on /settings/grade-schemes (J-F44; redesign)', () => {
    renderWithProviders(<AppLayout />, {
      auth: makeAuth({ user: makeUser({ permissions: ['academy.settings.read', 'academy.settings.manage'] }) }),
      route: '/settings/grade-schemes',
    })
    const labels = menuLabels()
    expect(labels).not.toContain(ar.nav.gradeSchemes)
    const selected = document.querySelectorAll('.ant-menu-item-selected')
    expect(selected).toHaveLength(1)
    expect(selected[0]).toHaveTextContent(ar.nav.settings)
  })

  it('shows a student «my lessons» in place of «lessons» and selects it on /my-lessons (J-F11; redesign)', () => {
    const student = makeUser({ role: 'student', roles: ['student'], permissions: ['courses.read', 'schedule.read', 'lessons.read'] })
    renderWithProviders(<AppLayout />, { auth: makeAuth({ user: student }), route: '/my-lessons' })
    const labels = menuLabels()
    expect(labels).not.toContain(ar.nav.lessons)
    expect(labels.indexOf(ar.nav.myLessons)).toBe(labels.indexOf(ar.nav.schedule) + 1)
    expect(labels.indexOf(ar.nav.myClasses)).toBeGreaterThan(-1)
    // The section is headed «my studies» for a learner, not «teaching».
    expect(screen.getByText(ar.nav.groups.study)).toBeInTheDocument()
    const selected = document.querySelectorAll('.ant-menu-item-selected')
    expect(selected).toHaveLength(1)
    expect(selected[0]).toHaveTextContent(ar.nav.myLessons)
  })

  it('shows a student «my assignments» in place of «assignments», right after «my lessons», and selects it on /my-assignments (J-F42)', () => {
    const student = makeUser({ role: 'student', roles: ['student'], permissions: ['courses.read', 'assignments.read', 'assignments.submit', 'schedule.read', 'lessons.read'] })
    renderWithProviders(<AppLayout />, { auth: makeAuth({ user: student }), route: '/my-assignments' })
    const labels = menuLabels()
    expect(labels).not.toContain(ar.nav.assignments)
    expect(labels.indexOf(ar.nav.myAssignments)).toBe(labels.indexOf(ar.nav.myLessons) + 1)
    const selected = document.querySelectorAll('.ant-menu-item-selected')
    expect(selected).toHaveLength(1)
    expect(selected[0]).toHaveTextContent(ar.nav.myAssignments)
  })

  it('shows a teacher «exams» right after «assignments» and selects it on /exams; a student holding exams.read does not see it (J-F45)', () => {
    const teacher = makeUser({ role: 'teacher', roles: ['teacher'], permissions: ['classes.read', 'assignments.read', 'exams.read', 'exams.manage', 'exams.grade'] })
    const { unmount } = renderWithProviders(<AppLayout />, { auth: makeAuth({ user: teacher }), route: '/exams' })
    const labels = menuLabels()
    expect(labels.indexOf(ar.nav.exams)).toBe(labels.indexOf(ar.nav.assignments) + 1)
    const selected = document.querySelectorAll('.ant-menu-item-selected')
    expect(selected).toHaveLength(1)
    expect(selected[0]).toHaveTextContent(ar.nav.exams)
    unmount()

    const student = makeUser({ role: 'student', roles: ['student'], permissions: ['courses.read', 'assignments.read', 'exams.read', 'exams.take'] })
    renderWithProviders(<AppLayout />, { auth: makeAuth({ user: student }), route: '/' })
    expect(menuLabels()).not.toContain(ar.nav.exams)
  })
})

const NAME = { ar: 'أكاديمية النور', en: 'Al-Noor Academy' }
const BRANDED = makeAcademy({ name: NAME })

/** Serves GET /api/academy (one answer per request, the last one repeats) and echoes PATCH /api/academy; records both. */
function mockAcademyApi(...reads: Array<() => Response | Promise<Response>>) {
  const writes: Record<string, unknown>[] = []
  let gets = 0
  mockFetch((url, init) => {
    if (url !== '/api/academy') return jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })
    if ((init?.method ?? 'GET') === 'GET') {
      const answer = reads[Math.min(gets, reads.length - 1)]
      gets += 1
      return answer()
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    writes.push(body)
    return jsonResponse(200, { ...BRANDED, ...body, updatedAt: '2026-11-09T09:00:00.000Z' })
  })
  return { writes, gets: () => gets }
}

const notConfigured = () => jsonResponse(503, { statusCode: 503, error: 'Service Unavailable', code: 'academy_not_configured', message: 'seed' })

const header = () => document.querySelector('.app-header') as HTMLElement
const headerTitle = () => header().querySelector('.app-header__title') as HTMLElement
const headerLogo = () => header().querySelector('img')
const siderName = () => document.querySelector('.app-brand__sub') as HTMLElement

function renderLayout() {
  return renderWithProviders(<AppLayout />, { auth: makeAuth({ user: makeUser() }), route: '/' })
}

/** The layout with the real settings page in its outlet, as the router mounts them (/settings). */
function renderSettingsInLayout() {
  return renderWithProviders(
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>,
    { auth: makeAuth({ user: makeUser({ permissions: SETTINGS_MANAGER_PERMISSIONS }) }), route: '/settings', path: '/*' },
  )
}

describe('AppLayout — the academy brand in the header (J-F13)', () => {
  it('shows the name from GET /api/academy in the header and the side menu with one request, in the UI language', async () => {
    const api = mockAcademyApi(() => jsonResponse(200, BRANDED))
    renderLayout()

    await waitFor(() => expect(headerTitle()).toHaveTextContent(NAME.ar))
    expect(siderName()).toHaveTextContent(NAME.ar)
    // An isolated, self-directed run with the full name on hover when it is cut.
    expect(headerTitle().tagName).toBe('BDI')
    expect(headerTitle()).toHaveAttribute('dir', 'auto')
    expect(headerTitle()).toHaveAttribute('title', NAME.ar)
    expect(headerLogo()).toBeNull()
    expect(api.gets()).toBe(1)

    try {
      await act(() => i18n.changeLanguage('en'))
      expect(headerTitle()).toHaveTextContent(NAME.en)
      expect(siderName()).toHaveTextContent(NAME.en)
      expect(api.gets()).toBe(1)
    } finally {
      await act(() => i18n.changeLanguage('ar'))
    }
  })

  it('shows no name while the academy is loading — never a flash of the static one — and the real name when it arrives (J-F24)', async () => {
    let answer: (response: Response) => void = () => {}
    mockAcademyApi(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    )
    renderLayout()

    // The title and the side-menu line stay in place, empty, without a tooltip.
    expect(headerTitle()).toBeInTheDocument()
    expect(headerTitle()).toBeEmptyDOMElement()
    expect(headerTitle()).not.toHaveAttribute('title')
    expect(siderName()).toBeEmptyDOMElement()
    expect(siderName()).not.toHaveAttribute('title')
    expect(screen.queryByText(ar.common.academyName)).not.toBeInTheDocument()
    expect(headerLogo()).toBeNull()

    answer(jsonResponse(200, BRANDED))
    await waitFor(() => expect(headerTitle()).toHaveTextContent(NAME.ar))
    expect(siderName()).toHaveTextContent(NAME.ar)
    expect(screen.queryByText(ar.common.academyName)).not.toBeInTheDocument()
  })

  it('shows the static name once the academy arrives without a usable name', async () => {
    mockAcademyApi(() => jsonResponse(200, makeAcademy({ name: { ar: '   ' } })))
    renderLayout()

    await waitFor(() => expect(headerTitle()).toHaveTextContent(ar.common.academyName))
    expect(siderName()).toHaveTextContent(ar.common.academyName)
  })

  it('keeps the static name with no banner of its own when the read fails (503), and follows the retry of the settings tab', async () => {
    const api = mockAcademyApi(notConfigured, () => jsonResponse(200, BRANDED))
    renderSettingsInLayout()

    // The settings tab reports the failure (its job); the header stays as it was.
    expect(await screen.findByText(ar.settings.errors.academy_not_configured)).toBeInTheDocument()
    expect(headerTitle()).toHaveTextContent(ar.common.academyName)
    expect(within(header()).queryByRole('alert')).not.toBeInTheDocument()
    expect(header().querySelector('.ant-alert')).toBeNull()
    expect(api.gets()).toBe(1)

    fireEvent.click(screen.getByText(ar.settings.retry).closest('button') as HTMLElement)
    await waitFor(() => expect(headerTitle()).toHaveTextContent(NAME.ar))
    expect(await screen.findByLabelText(ar.settings.academyNameAr)).toHaveValue(NAME.ar)
    expect(api.gets()).toBe(2)
  })

  it.each([
    ['an https: URL', 'https://cdn.example.test/brand/logo.png', 'https://cdn.example.test/brand/logo.png'],
    ['a root-relative path', '/media/logo.png', `${window.location.origin}/media/logo.png`],
    // jsdom serves the tests over http:, so an http: logo is no mixed content here (J-F24); academy.brand.test.ts covers https: pages.
    ['an http: URL on an http: page', 'http://cdn.example.test/brand/logo.png', 'http://cdn.example.test/brand/logo.png'],
  ])('shows the logo from %s, decorative beside the name and sent without a referrer', async (_, logoUrl, src) => {
    expect(window.location.protocol).toBe('http:')
    mockAcademyApi(() => jsonResponse(200, makeAcademy({ name: NAME, logoUrl })))
    renderLayout()

    await waitFor(() => expect(headerLogo()).not.toBeNull())
    const logo = headerLogo()!
    expect(logo).toHaveAttribute('src', src)
    expect(logo).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(headerTitle()).toHaveTextContent(NAME.ar)
  })

  it('names the brand once: an empty alt on the logo, the name in the title beside it (J-F24)', async () => {
    mockAcademyApi(() => jsonResponse(200, makeAcademy({ name: NAME, logoUrl: 'https://cdn.example.test/brand/logo.png' })))
    renderLayout()

    await waitFor(() => expect(headerLogo()).not.toBeNull())
    expect(headerLogo()).toHaveAttribute('alt', '')
    // An empty alt makes the image presentational: no img role and no second copy of the name for a screen reader.
    const brand = header().querySelector('.app-header__brand') as HTMLElement
    expect(within(brand).queryByRole('img', { hidden: true })).not.toBeInTheDocument()
    expect(within(header()).queryAllByAltText(NAME.ar)).toHaveLength(0)
    expect(within(header()).getAllByText(NAME.ar)).toEqual([headerTitle()])
    expect(brand.textContent).toBe(NAME.ar)
  })

  it.each(['//cdn.example.test/logo.png', 'javascript:alert(1)'])('shows no logo for %s', async (logoUrl) => {
    mockAcademyApi(() => jsonResponse(200, makeAcademy({ name: NAME, logoUrl })))
    renderLayout()

    await waitFor(() => expect(headerTitle()).toHaveTextContent(NAME.ar))
    expect(headerLogo()).toBeNull()
  })

  it('hides a logo that fails to load and keeps the name', async () => {
    mockAcademyApi(() => jsonResponse(200, makeAcademy({ name: NAME, logoUrl: 'https://cdn.example.test/missing.png' })))
    renderLayout()

    await waitFor(() => expect(headerLogo()).not.toBeNull())
    fireEvent.error(headerLogo()!)
    expect(headerLogo()).toBeNull()
    expect(headerTitle()).toHaveTextContent(NAME.ar)
  })

  it('shows a saved name and logo at once — the header and the open settings page share one GET /api/academy', async () => {
    const api = mockAcademyApi(() => jsonResponse(200, BRANDED))
    renderSettingsInLayout()

    const nameAr = await screen.findByLabelText(ar.settings.academyNameAr)
    expect(headerTitle()).toHaveTextContent(NAME.ar)
    expect(api.gets()).toBe(1)

    fireEvent.change(nameAr, { target: { value: 'أكاديمية الفجر' } })
    fireEvent.change(screen.getByLabelText(ar.settings.logoUrl), { target: { value: 'https://cdn.example.test/fajr.png' } })
    fireEvent.click(screen.getByText(ar.common.save).closest('button') as HTMLElement)

    await waitFor(() => expect(api.writes).toHaveLength(1))
    expect(api.writes[0]).toEqual({ name: { ar: 'أكاديمية الفجر', en: NAME.en }, logoUrl: 'https://cdn.example.test/fajr.png' })
    await waitFor(() => expect(headerTitle()).toHaveTextContent('أكاديمية الفجر'))
    expect(headerLogo()).toHaveAttribute('src', 'https://cdn.example.test/fajr.png')
    expect(siderName()).toHaveTextContent('أكاديمية الفجر')
    // The remounted form shows the server's answer too; nothing was read again.
    expect(screen.getByLabelText(ar.settings.academyNameAr)).toHaveValue('أكاديمية الفجر')
    expect(api.gets()).toBe(1)
  })
})
