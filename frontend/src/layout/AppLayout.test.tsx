import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigProvider } from 'antd'
import type { ReactElement } from 'react'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { SettingsPage } from '../pages/SettingsPage'
import { SETTINGS_MANAGER_PERMISSIONS, makeAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { AppLayout } from './AppLayout'
import { PHONE_QUERY } from './useIsPhone'

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

  it('adds the roles and audit entries for their permission holders and hides them from a student', () => {
    const { unmount } = renderWithProviders(<AppLayout />, {
      auth: makeAuth({ user: makeUser({ permissions: ['users.read', 'roles.manage', 'audit.read', 'academy.settings.read'] }) }),
      route: '/',
    })
    const admin = menuLabels()
    expect(admin).toContain(ar.nav.roles)
    expect(admin).toContain(ar.nav.audit)
    // Since the grouped menu (2026-11-22) both close the «system» section, after the settings: settings, roles, audit.
    expect(admin.indexOf(ar.nav.roles)).toBe(admin.indexOf(ar.nav.settings) + 1)
    expect(admin.indexOf(ar.nav.audit)).toBe(admin.indexOf(ar.nav.roles) + 1)
    expect(admin.indexOf(ar.nav.users)).toBeLessThan(admin.indexOf(ar.nav.settings))
    unmount()

    const student = makeUser({ role: 'student', roles: ['student'], permissions: ['courses.read'] })
    renderWithProviders(<AppLayout />, { auth: makeAuth({ user: student }), route: '/' })
    const labels = menuLabels()
    // The staff courses page is not a learner's — «my classes» is.
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

  it('shows the homepage images and grade schemes entries right after the settings entry to a holder of academy.settings.manage, and selects grade schemes on /settings/grade-schemes (J-F44)', () => {
    renderWithProviders(<AppLayout />, {
      auth: makeAuth({ user: makeUser({ permissions: ['academy.settings.read', 'academy.settings.manage'] }) }),
      route: '/settings/grade-schemes',
    })
    const labels = menuLabels()
    expect(labels.indexOf(ar.nav.homepageImages)).toBe(labels.indexOf(ar.nav.settings) + 1)
    expect(labels.indexOf(ar.nav.gradeSchemes)).toBe(labels.indexOf(ar.nav.homepageImages) + 1)
    const selected = document.querySelectorAll('.ant-menu-item-selected')
    expect(selected).toHaveLength(1)
    expect(selected[0]).toHaveTextContent(ar.nav.gradeSchemes)
  })

  it('shows a student «my lessons» in place of «lessons» and selects it on /my-lessons (J-F11)', () => {
    const student = makeUser({ role: 'student', roles: ['student'], permissions: ['courses.read', 'schedule.read', 'lessons.read'] })
    renderWithProviders(<AppLayout />, { auth: makeAuth({ user: student }), route: '/my-lessons' })
    const labels = menuLabels()
    expect(labels).not.toContain(ar.nav.lessons)
    expect(labels.indexOf(ar.nav.myLessons)).toBe(labels.indexOf(ar.nav.schedule) + 1)
    expect(labels.indexOf(ar.nav.myClasses)).toBeGreaterThan(-1)
    const selected = document.querySelectorAll('.ant-menu-item-selected')
    expect(selected).toHaveLength(1)
    expect(selected[0]).toHaveTextContent(ar.nav.myLessons)
  })

  it('keeps «assignments» and, since J-F67, «my assignments» out of a learner-only student’s menu; «my lessons» stays (J-F42)', () => {
    const student = makeUser({ role: 'student', roles: ['student'], permissions: ['courses.read', 'assignments.read', 'assignments.submit', 'schedule.read', 'lessons.read'] })
    renderWithProviders(<AppLayout />, { auth: makeAuth({ user: student }), route: '/my-assignments' })
    const labels = menuLabels()
    expect(labels).not.toContain(ar.nav.assignments)
    // LEARNER_MENU_HIDDEN (J-F67): the page stays reachable from its links, the horizontal bar stays short.
    expect(labels).not.toContain(ar.nav.myAssignments)
    expect(labels).toContain(ar.nav.myLessons)
  })

  it('shows a teacher «exams» — no «assignments» since 2026-11-26, even with the key — and selects it on /exams; a student holding exams.read does not see it (J-F45)', () => {
    // A session from before the seed change still carries assignments.read: the teacher gets no assignments entry all the same.
    const teacher = makeUser({ role: 'teacher', roles: ['teacher'], permissions: ['classes.read', 'assignments.read', 'exams.read', 'exams.manage', 'exams.grade', 'questions.manage'] })
    const { unmount } = renderWithProviders(<AppLayout />, { auth: makeAuth({ user: teacher }), route: '/exams' })
    const labels = menuLabels()
    expect(labels).not.toContain(ar.nav.assignments)
    expect(labels).toContain(ar.nav.exams)
    expect(labels.indexOf(ar.nav.questionBanks)).toBe(labels.indexOf(ar.nav.exams) + 1)
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
const siderName = () => document.querySelector('.app-brand__title') as HTMLElement

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

/** AppLayout.css read from disk: vitest empties every `.css` import, `?raw` included. */
async function layoutCss(): Promise<string> {
  const fsModule = 'node:fs'
  const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
  // A variable, not a literal: Vite rewrites `new URL('./AppLayout.css', import.meta.url)` into the asset's served URL.
  const path = './AppLayout.css'
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The declarations of the rule written exactly with `selector` inside the phone block (`@media (max-width: 767.98px)`), as `property → value`. */
async function phoneDeclarations(selector: string): Promise<Map<string, string>> {
  const css = await layoutCss()
  const start = css.indexOf('@media (max-width: 767.98px)')
  expect(start).toBeGreaterThan(-1)
  const block = css.slice(css.indexOf('{', start) + 1)
  const declarations = new Map<string, string>()
  for (const match of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1]!.trim() !== selector) continue
    for (const part of match[2]!.split(';')) {
      const [property, value] = part.split(':').map((side) => side.trim())
      if (property && value) declarations.set(property, value)
    }
  }
  return declarations
}

describe('AppLayout — the header’s user, bell and menus (KI-108)', () => {
  beforeEach(() => {
    mockFetch(() => new Promise<Response>(() => {}))
  })

  it('isolates the signed-in user’s name in its own direction, so a name mixing Arabic and Latin words keeps its order', () => {
    renderWithProviders(<AppLayout />, { auth: makeAuth({ user: makeUser({ name: 'الموظف v5 KM6I3V' }) }), route: '/' })
    const name = within(header().querySelector('.app-user') as HTMLElement).getByText('الموظف v5 KM6I3V')
    expect(name.tagName).toBe('BDI')
    expect(name).toHaveAttribute('dir', 'auto')
  })

  it('lets the header grow with its wrapped rows on a phone, so the bell’s badge stays inside it (390 × 844)', async () => {
    renderWithProviders(<AppLayout />, { auth: makeAuth({ user: makeUser() }), route: '/' })
    // The badge belongs to the bell inside the header's actions.
    const bell = within(header()).getByLabelText(ar.nav.notifications)
    expect(bell.closest('.ant-badge')?.parentElement).toHaveClass('app-header__actions')
    // jsdom has no layout: assert the configuration — the phone rule replaces the fixed 72 px height, and its padding
    // keeps the badge (half above the bell) below the top of the page. The browser check measures it.
    const phone = await phoneDeclarations('.app-header')
    expect(phone.get('height')).toBe('auto')
    expect(phone.get('min-height')).toBe('64px')
    expect(phone.get('padding')).toBe('10px 12px')
    expect((await phoneDeclarations('.app-header__actions')).get('row-gap')).toBe('8px')
  })

  it('reaches the user menu with the keyboard: Tab focuses its button, Enter opens it on its first item, the arrows move, Escape closes it back to the button and ArrowDown opens it again (KI-120)', async () => {
    // The menu focuses its first item that is laid out (@rc-component/util isVisible reads `offsetParent`); jsdom lays
    // nothing out, so every connected element is given a parent here, as a browser's page has one.
    const laidOut = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
      return this.isConnected ? document.body : null
    })
    onTestFinished(() => laidOut.mockRestore())
    const keyboard = userEvent.setup()
    renderWithProviders(<AppLayout />, { auth: makeAuth({ user: makeUser({ name: 'سارة أحمد' }) }), route: '/', routes: { '/profile': <LocationProbe /> } })
    // A real button named by the user's name alone (the avatar is decorative).
    const trigger = within(header()).getByRole('button', { name: 'سارة أحمد' })
    expect(trigger).toHaveClass('app-user')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    // Tab reaches it (a span was never in the tab order — `tabIndex` -1).
    for (let presses = 0; presses < 40 && document.activeElement !== trigger; presses += 1) await keyboard.tab()
    expect(trigger).toHaveFocus()

    // Enter opens the menu and the focus moves onto its first enabled item (the role line is disabled).
    await keyboard.keyboard('{Enter}')
    const profile = (await screen.findByText(ar.common.profile)).closest('li') as HTMLElement
    await waitFor(() => expect(profile).toHaveFocus())
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    // The menu's own keys read `keyCode` (@rc-component/menu, @rc-component/dropdown), which user-event leaves out:
    // they are sent with it. The menu moves the focus in the next frame.
    fireEvent.keyDown(profile, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 })
    const logout = screen.getByText(ar.common.logout).closest('li') as HTMLElement
    await waitFor(() => expect(logout).toHaveFocus())

    fireEvent.keyDown(logout, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 })
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
    expect(trigger).toHaveFocus()

    // ArrowDown on the closed button opens it as well; Enter on «my account» then goes there.
    await keyboard.keyboard('{ArrowDown}')
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'))
    // The focus moves into the menu again (jsdom never ends the closing motion, so the same menu is shown again).
    await waitFor(() => expect((document.activeElement as HTMLElement).closest('.app-user-menu [role="menuitem"]')).not.toBeNull())
    fireEvent.keyDown(screen.getByText(ar.common.profile).closest('li')!, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 })
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/profile')
  })

  it('leaves the focus alone when a press outside closes the user menu, and hands it back to the button without a scroll on Escape (review of KI-120)', async () => {
    // The menu focuses its first laid-out item (see the test above).
    const laidOut = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
      return this.isConnected ? document.body : null
    })
    onTestFinished(() => laidOut.mockRestore())
    renderWithProviders(<AppLayout />, { auth: makeAuth({ user: makeUser({ name: 'سارة أحمد' }) }), route: '/' })
    const trigger = within(header()).getByRole('button', { name: 'سارة أحمد' })
    const focusesTheButton = vi.spyOn(trigger, 'focus')
    const focusInMenu = () =>
      waitFor(() => {
        const focused = document.activeElement as HTMLElement
        expect(focused.closest('.app-user-menu [role="menuitem"]')).not.toBeNull()
        return focused
      })

    fireEvent.click(trigger)
    await focusInMenu()
    // A press outside: @rc-component/trigger closes the menu on that mousedown, the focus still on an item. Moving it to
    // the button would scroll a scrolled page back to the header before the click lands.
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
    expect(focusesTheButton).not.toHaveBeenCalled()
    expect(trigger).not.toHaveFocus()

    // Escape from the open menu still hands the focus back, and scrolls nothing.
    fireEvent.click(trigger)
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'))
    const item = await focusInMenu()
    fireEvent.keyDown(item, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 })
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
    expect(trigger).toHaveFocus()
    expect(focusesTheButton).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('draws the user menu’s button as the plain trigger it replaced, with a ring for the keyboard focus (KI-120)', async () => {
    const css = await layoutCss()
    const rule = (selector: string) => {
      const match = css.match(new RegExp(`(?:^|})\\s*${selector.replace(/[.:-]/g, '\\$&')}\\s*\\{([^}]*)\\}`))
      return match ? match[1]! : ''
    }
    const base = rule('.app-user')
    for (const declaration of ['padding: 0', 'border: 0', 'background: none', 'color: inherit', 'font: inherit', 'cursor: pointer']) expect(base).toContain(declaration)
    expect(rule('.app-user:focus-visible')).toContain('outline: 3px solid')
  })

  it('picks an item of the user menu with Space, as Enter and a click do', async () => {
    renderWithProviders(<AppLayout />, { auth: makeAuth({ user: makeUser() }), route: '/', routes: { '/profile': <LocationProbe /> } })
    fireEvent.click(header().querySelector('.app-user') as HTMLElement)
    const profile = (await screen.findByText(ar.common.profile)).closest('li') as HTMLElement
    expect(profile).toHaveAttribute('role', 'menuitem')
    profile.focus()
    const space = { key: ' ', code: 'Space', keyCode: 32, which: 32 }
    // The keydown is cancelled (no page scroll); the item is picked on the key's release.
    expect(fireEvent.keyDown(profile, space)).toBe(false)
    fireEvent.keyUp(profile, space)
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/profile')
  })
})

/** The keys of an academy admin that open one entry of every staff section (the system section without branches and rooms). */
const STAFF_SECTIONS_PERMISSIONS = [
  'users.read',
  'enrollments.manage',
  'courses.read',
  'classes.read',
  'schedule.read',
  'lessons.read',
  'assignments.read',
  'exams.read',
  'certificates.read_all',
  'invoices.read_all',
  'reports.attendance.view',
  'academy.settings.read',
  'academy.settings.manage',
  'roles.manage',
  'audit.read',
]

const sider = () => document.querySelector('.app-sider') as HTMLElement
const siderMenu = () => within(sider()).getByRole('menu')
const headings = (menu: HTMLElement) => Array.from(menu.querySelectorAll('.ant-menu-item-group-title')).map((title) => title.textContent?.trim() ?? '')
const labelsIn = (root: Element) => Array.from(root.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent?.trim() ?? '')

/** Each titled section of a menu: its heading and the entries under it. */
function sections(menu: HTMLElement): Array<[string, string[]]> {
  return Array.from(menu.querySelectorAll('.ant-menu-item-group')).map((group) => [group.querySelector('.ant-menu-item-group-title')?.textContent?.trim() ?? '', labelsIn(group)])
}

/** A phone-sized viewport for useIsPhone(): its query matches, every other one (antd's breakpoints) does not. */
function onPhone() {
  const original = window.matchMedia
  window.matchMedia = ((query: string) => ({ ...original(query), matches: query === PHONE_QUERY })) as typeof window.matchMedia
  onTestFinished(() => {
    window.matchMedia = original
  })
}

/** The layout around a probe of the current location (an entry's navigation keeps the layout mounted). */
function renderShell(user = makeUser({ permissions: STAFF_SECTIONS_PERMISSIONS }), options: { route?: string; wrap?: (ui: ReactElement) => ReactElement } = {}) {
  const { route = '/', wrap = (ui) => ui } = options
  return renderWithProviders(
    wrap(
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="*" element={<LocationProbe />} />
        </Route>
      </Routes>,
    ),
    { auth: makeAuth({ user }), route, path: '/*' },
  )
}

describe('AppLayout — the grouped side menu (Admin Dashboard Modern Redesign, 2026-11-22)', () => {
  beforeEach(() => {
    mockFetch(() => new Promise<Response>(() => {}))
  })

  it('heads a staff viewer’s menu with the landing page, then titled sections in the spec’s order; a section with nothing visible is left out', () => {
    renderShell()
    const menu = siderMenu()
    // The landing page heads the menu on its own, outside any section.
    expect(menu.firstElementChild).toHaveAttribute('role', 'menuitem')
    expect(menu.firstElementChild).toHaveTextContent(ar.nav.dashboard)
    expect(sections(menu)).toEqual([
      [ar.nav.groups.academy, [ar.nav.users, ar.nav.enrollmentRequests]],
      // No «classes» entry although the viewer holds classes.read: classes are an internal mechanism (2026-11-26).
      [ar.nav.groups.academics, [ar.nav.courses, ar.nav.lessons, ar.nav.schedule]],
      [ar.nav.groups.assessment, [ar.nav.assignments, ar.nav.exams, ar.nav.certificates]],
      [ar.nav.groups.finance, [ar.nav.payments]],
      [ar.nav.groups.followUp, [ar.nav.reports, ar.nav.notifications]],
      [ar.nav.groups.system, [ar.nav.settings, ar.nav.homepageImages, ar.nav.gradeSchemes, ar.nav.roles, ar.nav.audit]],
    ])
    expect(labelsIn(menu)).not.toContain(ar.nav.classes)
    // «My pages» has nothing for an admin who is no learner: no empty heading.
    expect(headings(menu)).not.toContain(ar.nav.groups.mine)
    expect(menu.querySelector('.ant-menu-item-divider')).toBeNull()
  })

  it('shows a teacher who is also a guardian their own pages under «my pages», before the teaching sections, and no users page (J-F70)', () => {
    renderShell(makeUser({ role: 'teacher', roles: ['teacher', 'guardian'], permissions: ['users.read', 'classes.read', 'lessons.read', 'schedule.read'] }))
    const menu = siderMenu()
    expect(headings(menu)).toEqual([ar.nav.groups.mine, ar.nav.groups.academics, ar.nav.groups.followUp])
    expect(labelsIn(menu)).not.toContain(ar.nav.users)
    // J-F72: «الفصول والمجموعات» reads «الدورات» for a teacher.
    const academics = sections(menu).find(([heading]) => heading === ar.nav.groups.academics)!
    expect(academics[1]).toEqual([ar.nav.classesForTeacher, ar.nav.myStudents, ar.nav.lessons, ar.nav.schedule])
    const mine = sections(menu).find(([heading]) => heading === ar.nav.groups.mine)!
    expect(mine[1]).toEqual([ar.nav.myClasses, ar.nav.catalog, ar.nav.myLessons, ar.nav.myAssignments, ar.nav.myExams, ar.nav.myGrades, ar.nav.myCertificates])
  })

  it('leaves «assignments» out of a teacher’s «evaluation» section — exams and question banks follow each other — and keeps it for a teacher who is also an admin (2026-11-26)', () => {
    const teacherKeys = ['users.read', 'courses.read', 'classes.read', 'lessons.read', 'schedule.read', 'exams.read', 'exams.manage', 'questions.manage', 'grades.read_all']
    const { unmount } = renderShell(makeUser({ role: 'teacher', roles: ['teacher'], permissions: teacherKeys }))
    const menu = siderMenu()
    expect(labelsIn(menu)).not.toContain(ar.nav.assignments)
    expect(sections(menu)).toEqual([
      [ar.nav.groups.academics, [ar.nav.classesForTeacher, ar.nav.lessons, ar.nav.schedule]],
      [ar.nav.groups.assessment, [ar.nav.exams, ar.nav.questionBanks]],
      [ar.nav.groups.followUp, [ar.nav.notifications]],
    ])
    unmount()

    renderShell(makeUser({ role: 'admin', roles: ['academy_admin', 'teacher'], permissions: [...teacherKeys, 'assignments.read'] }))
    const assessment = sections(siderMenu()).find(([heading]) => heading === ar.nav.groups.assessment)!
    expect(assessment[1]).toEqual([ar.nav.assignments, ar.nav.exams, ar.nav.questionBanks])
  })

  it('gives a learner-only viewer a horizontal TabseetCourse pill bar instead of the vertical Sider on desktop, without Explore Courses and with no headings, and navigates from it (J-F66)', async () => {
    const student = makeUser({ role: 'student', roles: ['student'], permissions: ['courses.read', 'schedule.read', 'lessons.read', 'assignments.read', 'exams.read'] })
    renderShell(student, { route: '/schedule' })
    // J-F67: «واجباتي», «اختباراتي» and «درجاتي» are off the learner's menu (their pages stay).
    const flat = [ar.nav.dashboard, ar.nav.myClasses, ar.nav.schedule, ar.nav.myLessons, ar.nav.myCertificates, ar.nav.notifications]

    expect(document.querySelector('.app-sider')).toBeNull()
    expect(document.querySelector('.ant-layout-sider')).toBeNull()
    expect(document.querySelector('.app-shell')).toHaveClass('app-shell--learner')

    const nav = screen.getByRole('navigation', { name: ar.nav.mainMenu })
    expect(nav).toHaveClass('app-learner-nav')
    const top = document.querySelector('.app-top') as HTMLElement
    expect(top).not.toBeNull()
    expect(top).toContainElement(header())
    expect(top).toContainElement(nav)
    expect(top.nextElementSibling).toHaveClass('app-content')
    const menu = within(nav).getByRole('menu')
    expect(menu).toHaveClass('ant-menu-horizontal')
    expect(labelsIn(menu)).toEqual(flat)
    expect(labelsIn(menu)).not.toContain(ar.nav.catalog)
    expect(menu.querySelector('.ant-menu-item-group')).toBeNull()
    expect(menu.querySelector('.ant-menu-item-divider')).toBeNull()

    const selected = menu.querySelectorAll('.ant-menu-item-selected')
    expect(selected).toHaveLength(1)
    expect(selected[0]).toHaveTextContent(ar.nav.schedule)

    fireEvent.click(within(menu).getByText(ar.nav.myLessons))
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/my-lessons')
  })

  it('uses the phone drawer (not the desktop horizontal bar) for a learner-only viewer on a phone, without Explore Courses (J-F66)', async () => {
    onPhone()
    const student = makeUser({ role: 'student', roles: ['student'], permissions: ['courses.read', 'schedule.read', 'lessons.read'] })
    renderShell(student)

    expect(document.querySelector('.app-sider')).toBeNull()
    expect(document.querySelector('.app-learner-nav')).toBeNull()
    const button = within(header()).getByRole('button', { name: ar.nav.openMenu })
    fireEvent.click(button)
    const dialog = await screen.findByRole('dialog')
    const menu = within(dialog).getByRole('menu')
    expect(labelsIn(menu)).toContain(ar.nav.myLessons)
    expect(labelsIn(menu)).not.toContain(ar.nav.catalog)
    expect(menu.querySelector('.ant-menu-item-group')).toBeNull()
  })

  it('styles the learner horizontal navigation bar with self-hosted Cairo 14px/700, 18px icons, TabseetCourse 1140px centered container, navy/gold active states, and print suppression (J-F66)', async () => {
    const css = (await layoutCss()).replace(/\r\n/g, '\n')
    expect(css).toContain('.app-learner-nav')
    expect(css).toContain('--ac-learner-max: 1140px')
    expect(css).toContain("'Public Cairo'")
    expect(css).toContain('font-size: 14px')
    expect(css).toContain('font-size: 18px')
    expect(css).toContain('font-weight: 700')
    expect(css).toContain('background: #113464')
    expect(css).toContain('color: #c5a052')
    expect(css).toMatch(/@media\s+print\s*\{[\s\S]*\.app-learner-nav[\s\S]*display:\s*none\s*!important/)
  })

  it('keeps the entire top header region (.app-top: .app-header and, on desktop learner pages, .app-learner-nav) sticky at top: 0 while scrolling and static on paper (J-F66)', async () => {
    const { unmount } = renderShell()
    const staffTop = document.querySelector('.app-top') as HTMLElement
    expect(staffTop).not.toBeNull()
    expect(staffTop).toContainElement(header())
    expect(staffTop.nextElementSibling).toHaveClass('app-content')
    unmount()

    onPhone()
    renderShell()
    const phoneTop = document.querySelector('.app-top') as HTMLElement
    expect(phoneTop).toContainElement(header())

    const css = (await layoutCss()).replace(/\r\n/g, '\n')
    const topRule = css.match(/\.app-top\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(topRule).toContain('position: sticky')
    expect(topRule).toContain('top: 0')
    expect(topRule).toContain('z-index: 100')
    expect(css).toContain('--ac-sticky-offset: 88px')
    expect(css).toContain('--ac-sticky-offset: 140px')
    expect(css).toMatch(/@media\s+print\s*\{[\s\S]*\.app-top\s*\{[^}]*position:\s*static/)
  })

  it('folds the sections into dividers on the icon rail — headings do not fit 80 px — and the trigger is a button that says what it does', async () => {
    renderShell()
    const expanded = labelsIn(siderMenu())
    const trigger = within(sider()).getByRole('button', { name: ar.nav.collapseMenu })
    expect(trigger).toHaveClass('app-sider__trigger')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(trigger)
    await waitFor(() => expect(sider()).toHaveClass('ant-layout-sider-collapsed'))
    const menu = siderMenu()
    expect(menu.querySelector('.ant-menu-item-group-title')).toBeNull()
    // The same entries in the same order, a divider between two sections (seven sections, six dividers).
    expect(labelsIn(menu)).toEqual(expanded)
    expect(menu.querySelectorAll('.ant-menu-item-divider')).toHaveLength(6)
    expect(menu.firstElementChild).toHaveTextContent(ar.nav.dashboard)
    expect(menu.children[1]).toHaveClass('ant-menu-item-divider')
    const rail = within(sider()).getByRole('button', { name: ar.nav.expandMenu })
    expect(rail).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(rail)
    await waitFor(() => expect(sider()).not.toHaveClass('ant-layout-sider-collapsed'))
    expect(headings(siderMenu())).toContain(ar.nav.groups.system)
  })

  it('selects the entry of the current page inside its section and navigates from the grouped menu', async () => {
    renderShell(undefined, { route: '/settings/roles' })
    const selected = siderMenu().querySelectorAll('.ant-menu-item-selected')
    expect(selected).toHaveLength(1)
    expect(selected[0]).toHaveTextContent(ar.nav.roles)
    expect(selected[0]!.closest('.ant-menu-item-group')?.querySelector('.ant-menu-item-group-title')).toHaveTextContent(ar.nav.groups.system)

    fireEvent.click(within(siderMenu()).getByText(ar.nav.exams))
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/exams')
  })

  it('names the side menu as a landmark', () => {
    renderShell()
    expect(within(sider()).getByRole('navigation', { name: ar.nav.mainMenu })).toContainElement(siderMenu())
  })
})

describe('AppLayout — the academy at the top of the side menu', () => {
  it('shows the academy’s name, not the product’s, and on the rail its initial', async () => {
    mockAcademyApi(() => jsonResponse(200, BRANDED))
    renderShell()

    await waitFor(() => expect(siderName()).toHaveTextContent(NAME.ar))
    expect(sider().contains(siderName())).toBe(true)
    expect(siderName().tagName).toBe('BDI')
    expect(siderName()).toHaveAttribute('dir', 'auto')
    expect(siderName()).toHaveAttribute('title', NAME.ar)
    expect(within(sider()).queryByText(ar.common.appName)).not.toBeInTheDocument()
    expect(within(sider()).queryByText('AC')).not.toBeInTheDocument()

    fireEvent.click(within(sider()).getByRole('button', { name: ar.nav.collapseMenu }))
    await waitFor(() => expect(sider().querySelector('.app-brand__mark')).not.toBeNull())
    const mark = sider().querySelector('.app-brand__mark') as HTMLElement
    expect(mark).toHaveTextContent('أ')
    // Decorative: the name is in the header; the full name shows on hover.
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(mark.parentElement).toHaveAttribute('title', NAME.ar)
    expect(sider().querySelector('.app-brand__title')).toBeNull()
  })

  it('shows the academy’s logo on the rail when it has one, decorative, and the initial once the logo fails to load', async () => {
    mockAcademyApi(() => jsonResponse(200, makeAcademy({ name: { ar: 'nour academy' }, logoUrl: 'https://cdn.example.test/brand/logo.png' })))
    renderShell()
    await waitFor(() => expect(siderName()).toHaveTextContent('nour academy'))

    fireEvent.click(within(sider()).getByRole('button', { name: ar.nav.collapseMenu }))
    await waitFor(() => expect(sider().querySelector('img')).not.toBeNull())
    const logo = sider().querySelector('img') as HTMLImageElement
    expect(logo).toHaveAttribute('src', 'https://cdn.example.test/brand/logo.png')
    expect(logo).toHaveAttribute('alt', '')
    expect(logo).toHaveAttribute('referrerpolicy', 'no-referrer')

    fireEvent.error(logo)
    expect(sider().querySelector('img')).toBeNull()
    expect(sider().querySelector('.app-brand__mark')).toHaveTextContent('N')
  })

  it('shows nothing at the top of the side menu while the academy is loading, expanded or on the rail', async () => {
    mockFetch(() => new Promise<Response>(() => {}))
    renderShell()
    expect(siderName()).toBeEmptyDOMElement()
    expect(siderName()).not.toHaveAttribute('title')
    fireEvent.click(within(sider()).getByRole('button', { name: ar.nav.collapseMenu }))
    await waitFor(() => expect(sider()).toHaveClass('ant-layout-sider-collapsed'))
    const brand = sider().querySelector('.app-brand') as HTMLElement
    expect(brand).toBeEmptyDOMElement()
    expect(brand).not.toHaveAttribute('title')
  })
})

describe('AppLayout — the side menu as a drawer on a phone', () => {
  beforeEach(() => {
    mockFetch(() => new Promise<Response>(() => {}))
  })

  it('has no Sider; the menu button at the start of the header opens a drawer from the right in Arabic, an entry navigates and closes it', async () => {
    onPhone()
    mockAcademyApi(() => jsonResponse(200, BRANDED))
    renderShell(makeUser({ permissions: ['users.read', 'audit.read'] }))

    expect(document.querySelector('.ant-layout-sider')).toBeNull()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    const start = header().querySelector('.app-header__start') as HTMLElement
    const button = within(start).getByRole('button', { name: ar.nav.openMenu })
    expect(start.firstElementChild).toBe(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(button)
    const dialog = await screen.findByRole('dialog')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveAttribute('aria-controls', dialog.id)
    const drawer = dialog.closest('.app-nav-drawer') as HTMLElement
    expect(drawer).toHaveClass('ant-drawer-open')
    // The inline start of the Arabic UI is the right.
    expect(drawer).toHaveClass('ant-drawer-right')
    // Headed by the academy's name, with a close button that says what it does.
    await waitFor(() => expect(dialog.querySelector('.app-nav-drawer__title')).toHaveTextContent(NAME.ar))
    expect(within(dialog).getByRole('button', { name: ar.nav.closeMenu })).toBeInTheDocument()
    const menu = within(dialog).getByRole('menu')
    expect(labelsIn(menu)).toEqual([ar.nav.dashboard, ar.nav.users, ar.nav.notifications, ar.nav.audit])
    expect(headings(menu)).toEqual([ar.nav.groups.academy, ar.nav.groups.followUp, ar.nav.groups.system])

    fireEvent.click(within(menu).getByText(ar.nav.users))
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/users')
    await waitFor(() => expect(button).toHaveAttribute('aria-expanded', 'false'))
    expect(drawer).not.toHaveClass('ant-drawer-open')
  })

  it('closes the drawer with its close button, on the same page', async () => {
    onPhone()
    renderShell(makeUser({ permissions: ['users.read'] }))
    const button = within(header()).getByRole('button', { name: ar.nav.openMenu })
    fireEvent.click(button)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: ar.nav.closeMenu }))
    await waitFor(() => expect(button).toHaveAttribute('aria-expanded', 'false'))
    expect(dialog.closest('.app-nav-drawer')).not.toHaveClass('ant-drawer-open')
    expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/')
  })

  it('opens the drawer from the left in a left-to-right UI', async () => {
    onPhone()
    renderShell(makeUser({ permissions: ['users.read'] }), { wrap: (ui) => <ConfigProvider direction="ltr">{ui}</ConfigProvider> })
    fireEvent.click(within(header()).getByRole('button', { name: ar.nav.openMenu }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.closest('.app-nav-drawer')).toHaveClass('ant-drawer-left')
  })

  it('keeps every function of the header on a phone: the search, the bell, the language and the user’s menu', () => {
    onPhone()
    renderShell(makeUser({ name: 'سارة أحمد', permissions: ['users.read'] }))
    const bar = header()
    expect(within(bar).getByRole('button', { name: ar.search.open })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: ar.nav.notifications })).toBeInTheDocument()
    expect(bar.querySelector('.ant-segmented')).not.toBeNull()
    expect(within(bar).getByRole('button', { name: 'سارة أحمد' })).toHaveAttribute('aria-haspopup', 'menu')
  })

  it('shows no menu button on a desktop, where the Sider holds the menu', () => {
    renderShell()
    expect(within(header()).queryByRole('button', { name: ar.nav.openMenu })).not.toBeInTheDocument()
    expect(sider()).toHaveClass('ant-layout-sider')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
