import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    expect(admin.indexOf(ar.nav.roles)).toBe(admin.indexOf(ar.nav.users) + 1)
    expect(admin.indexOf(ar.nav.audit)).toBe(admin.indexOf(ar.nav.settings) - 1)
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

  it('shows the grade schemes entry right after the settings entry to a holder of academy.settings.manage, and selects it on /settings/grade-schemes (J-F44)', () => {
    renderWithProviders(<AppLayout />, {
      auth: makeAuth({ user: makeUser({ permissions: ['academy.settings.read', 'academy.settings.manage'] }) }),
      route: '/settings/grade-schemes',
    })
    const labels = menuLabels()
    expect(labels.indexOf(ar.nav.gradeSchemes)).toBe(labels.indexOf(ar.nav.settings) + 1)
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

/** AppLayout.css read from disk: vitest empties every `.css` import, `?raw` included. */
async function layoutCss(): Promise<string> {
  const fsModule = 'node:fs'
  const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
  // A variable, not a literal: Vite rewrites `new URL('./AppLayout.css', import.meta.url)` into the asset's served URL.
  const path = './AppLayout.css'
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The declarations of the rule written exactly with `selector` inside `@media (max-width: 768px)`, as `property → value`. */
async function phoneDeclarations(selector: string): Promise<Map<string, string>> {
  const css = await layoutCss()
  const start = css.indexOf('@media (max-width: 768px)')
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
    // jsdom has no layout: assert the configuration — the phone rule replaces the fixed 64 px height, and its padding
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
