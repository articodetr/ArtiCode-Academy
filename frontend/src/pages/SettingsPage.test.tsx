import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { THREE_BRANCHES } from '../test/branches'
import { THREE_GRADE_SCHEMES } from '../test/gradeSchemes'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ALL_ROLES, makeCatalog } from '../test/roles'
import { makeRoomList } from '../test/rooms'
import { SettingsPage } from './SettingsPage'

/** Serves the roles tab (API-022/023), the general tab (API-035), the branches tab (API-080), the rooms tab (API-084, API-080) and the grade schemes tab (API-122). */
function mockSettingsApi() {
  return mockFetch((url) => {
    if (url === '/api/roles') return jsonResponse(200, { items: ALL_ROLES })
    if (url === '/api/permissions') return jsonResponse(200, makeCatalog())
    if (url === '/api/academy') return jsonResponse(200, makeAcademy())
    if (url === '/api/branches') return jsonResponse(200, { items: THREE_BRANCHES() })
    if (url === '/api/rooms') return jsonResponse(200, makeRoomList())
    if (url === '/api/grade-schemes') return jsonResponse(200, { items: THREE_GRADE_SCHEMES() })
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })
  })
}

/** The general tab follows the /settings entry: `academy.settings.read` (or `.manage`) since CH-0036. */
const SETTINGS_ADMIN = ['academy.settings.read', 'academy.settings.manage', 'roles.manage']

describe('SettingsPage', () => {
  it('shows the real general form with both tabs to an admin holding the settings keys and roles.manage, and the roles tab navigates to /settings/roles', async () => {
    const fetchMock = mockSettingsApi()
    renderWithProviders(<SettingsPage />, {
      auth: makeAuth({ user: makeUser({ permissions: SETTINGS_ADMIN }) }),
      route: '/settings',
      routes: { '/settings/roles': <LocationProbe /> },
    })

    expect(screen.getByRole('heading', { name: ar.settings.title })).toBeInTheDocument()
    expect(await screen.findByLabelText(ar.settings.academyNameAr)).toHaveValue('أكاديمية آرتي كود')
    expect(screen.getByRole('tab', { name: ar.settings.tabs.general })).toHaveAttribute('aria-selected', 'true')
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/api/academy'])

    await userEvent.click(screen.getByRole('tab', { name: ar.settings.tabs.roles }))
    expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/settings/roles')
  })

  it('renders the roles manager under /settings/roles for a holder of roles.manage without touching the academy endpoint', async () => {
    const fetchMock = mockSettingsApi()
    renderWithProviders(<SettingsPage section="roles" />, {
      auth: makeAuth({ user: makeUser({ permissions: SETTINGS_ADMIN }) }),
      route: '/settings/roles',
    })

    expect(screen.getByText(ar.rolesAdmin.subtitle)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: ar.settings.tabs.roles })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('أمين المكتبة')).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.settings.academyNameAr)).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => String(url)).sort()).toEqual(['/api/permissions', '/api/roles'])
  })

  it('opens /settings/roles to a roles.manage holder whose role sees no other settings, without the general tab (D-R06)', async () => {
    mockSettingsApi()
    renderWithProviders(<SettingsPage section="roles" />, {
      auth: makeAuth({ user: makeUser({ role: 'staff', roles: ['staff', 'role_manager'], permissions: ['users.read', 'roles.manage'] }) }),
      route: '/settings/roles',
    })

    expect(await screen.findByText('أمين المكتبة')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: ar.settings.tabs.general })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: ar.settings.tabs.roles })).not.toBeInTheDocument()
  })

  it('opens /settings/roles to a custom role (no UI role) holding roles.manage — the gate is the permission, not the role (T15)', async () => {
    mockSettingsApi()
    renderWithProviders(<SettingsPage section="roles" />, {
      auth: makeAuth({ user: makeUser({ role: null, roles: ['role_manager'], permissions: ['roles.manage'] }) }),
      route: '/settings/roles',
    })

    expect(await screen.findByText('أمين المكتبة')).toBeInTheDocument()
    expect(screen.queryByText(ar.errors.forbidden)).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: ar.settings.tabs.general })).not.toBeInTheDocument()
  })

  it('shows the 403 page under /settings/roles to a user without roles.manage, and hides the roles tab on /settings', () => {
    renderWithProviders(<SettingsPage section="roles" />, { auth: makeAuth({ user: makeUser({ permissions: ['users.read'] }) }), route: '/settings/roles' })
    expect(screen.getByText(ar.errors.forbidden)).toBeInTheDocument()
    expect(screen.queryByText(ar.rolesAdmin.subtitle)).not.toBeInTheDocument()
  })

  it('renders the rooms manager under /settings/rooms for a holder of schedule.manage, with the rooms tab between general and roles (J-F06)', async () => {
    const fetchMock = mockSettingsApi()
    renderWithProviders(<SettingsPage section="rooms" />, {
      auth: makeAuth({ user: makeUser({ permissions: [...SETTINGS_ADMIN, 'schedule.manage'] }) }),
      route: '/settings/rooms',
      routes: { '/settings': <LocationProbe /> },
    })

    expect(screen.getByText(ar.rooms.subtitle)).toBeInTheDocument()
    // The grade schemes tab (J-F44) follows academy.settings.manage, which SETTINGS_ADMIN holds.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([ar.settings.tabs.general, ar.settings.tabs.rooms, ar.settings.tabs.gradeSchemes, ar.settings.tabs.roles])
    expect(screen.getByRole('tab', { name: ar.settings.tabs.rooms })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('HALL')).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.settings.academyNameAr)).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => String(url)).sort()).toEqual(['/api/branches', '/api/rooms'])

    await userEvent.click(screen.getByRole('tab', { name: ar.settings.tabs.general }))
    expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/settings')
  })

  it('opens /settings/rooms to a custom role holding schedule.manage alone, without the other tabs, and answers 403 without the key (J-F06)', async () => {
    mockSettingsApi()
    const { unmount } = renderWithProviders(<SettingsPage section="rooms" />, {
      auth: makeAuth({ user: makeUser({ role: null, roles: ['scheduler'], permissions: ['schedule.manage'] }) }),
      route: '/settings/rooms',
    })
    expect(await screen.findByText('HALL')).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByText(ar.rooms.add)).toBeInTheDocument()
    unmount()

    renderWithProviders(<SettingsPage section="rooms" />, { auth: makeAuth({ user: makeUser({ permissions: SETTINGS_ADMIN }) }), route: '/settings/rooms' })
    expect(screen.getByText(ar.errors.forbidden)).toBeInTheDocument()
    expect(screen.queryByText(ar.rooms.subtitle)).not.toBeInTheDocument()
  })

  it('shows the general form alone (no tabs) to a holder of academy.settings.read without roles.manage', async () => {
    mockSettingsApi()
    renderWithProviders(<SettingsPage />, { auth: makeAuth({ user: makeUser({ permissions: ['academy.settings.read'] }) }), route: '/settings' })
    expect(await screen.findByLabelText(ar.settings.academyNameAr)).toBeInTheDocument()
    expect(screen.getByText(ar.settings.readOnlyHint)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: ar.settings.tabs.roles })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: ar.settings.tabs.general })).not.toBeInTheDocument()
  })

  // MOD-02-T06 screen: the branches tab under /settings/branches behind `branches.manage` alone.
  it('shows the branches tab to a holder of branches.manage and navigates to /settings/branches', async () => {
    const fetchMock = mockSettingsApi()
    renderWithProviders(<SettingsPage />, {
      auth: makeAuth({ user: makeUser({ permissions: [...SETTINGS_ADMIN, 'branches.manage'] }) }),
      route: '/settings',
      routes: { '/settings/branches': <LocationProbe /> },
    })

    expect(await screen.findByLabelText(ar.settings.academyNameAr)).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([ar.settings.tabs.general, ar.settings.tabs.branches, ar.settings.tabs.gradeSchemes, ar.settings.tabs.roles])
    await userEvent.click(screen.getByRole('tab', { name: ar.settings.tabs.branches }))
    expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/settings/branches')
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/api/academy'])
  })

  it('renders the branches manager under /settings/branches for a holder of branches.manage without touching the academy endpoint', async () => {
    const fetchMock = mockSettingsApi()
    renderWithProviders(<SettingsPage section="branches" />, {
      auth: makeAuth({ user: makeUser({ permissions: [...SETTINGS_ADMIN, 'branches.manage'] }) }),
      route: '/settings/branches',
    })

    expect(screen.getByText(ar.branches.subtitle)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: ar.settings.tabs.branches })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('NORTH')).toBeInTheDocument()
    expect(screen.getByText(ar.branches.add)).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.settings.academyNameAr)).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/api/branches'])
  })

  it('shows the 403 page under /settings/branches to a user without branches.manage, and hides the branches tab on /settings', async () => {
    mockSettingsApi()
    renderWithProviders(<SettingsPage section="branches" />, { auth: makeAuth({ user: makeUser({ permissions: SETTINGS_ADMIN }) }), route: '/settings/branches' })
    expect(screen.getByText(ar.errors.forbidden)).toBeInTheDocument()
    expect(screen.queryByText(ar.branches.subtitle)).not.toBeInTheDocument()
    cleanup()

    mockSettingsApi()
    renderWithProviders(<SettingsPage />, { auth: makeAuth({ user: makeUser({ permissions: SETTINGS_ADMIN }) }), route: '/settings' })
    expect(await screen.findByLabelText(ar.settings.academyNameAr)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: ar.settings.tabs.branches })).not.toBeInTheDocument()
  })

  // J-F44 (MOD-09-T08 part a): the grade schemes tab under /settings/grade-schemes behind `academy.settings.manage` alone.
  it('renders the grade schemes manager under /settings/grade-schemes for a holder of academy.settings.manage, its tab after rooms and before roles (J-F44)', async () => {
    const fetchMock = mockSettingsApi()
    renderWithProviders(<SettingsPage section="gradeSchemes" />, {
      auth: makeAuth({ user: makeUser({ permissions: [...SETTINGS_ADMIN, 'branches.manage', 'schedule.manage'] }) }),
      route: '/settings/grade-schemes',
      routes: { '/settings/rooms': <LocationProbe /> },
    })

    expect(screen.getByText(ar.gradeSchemes.subtitle)).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      ar.settings.tabs.general,
      ar.settings.tabs.branches,
      ar.settings.tabs.rooms,
      ar.settings.tabs.gradeSchemes,
      ar.settings.tabs.roles,
    ])
    expect(screen.getByRole('tab', { name: ar.settings.tabs.gradeSchemes })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('ناجح أو راسب')).toBeInTheDocument()
    expect(screen.getByText(ar.gradeSchemes.add)).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.settings.academyNameAr)).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/api/grade-schemes'])

    await userEvent.click(screen.getByRole('tab', { name: ar.settings.tabs.rooms }))
    expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/settings/rooms')
  })

  it('opens /settings/grade-schemes to a custom role holding academy.settings.manage alone, and answers 403 to a holder of academy.settings.read alone (J-F44)', async () => {
    mockSettingsApi()
    const { unmount } = renderWithProviders(<SettingsPage section="gradeSchemes" />, {
      auth: makeAuth({ user: makeUser({ role: null, roles: ['registrar'], permissions: ['academy.settings.manage'] }) }),
      route: '/settings/grade-schemes',
    })
    expect(await screen.findByText('ناجح أو راسب')).toBeInTheDocument()
    // The general tab follows the settings entry (read or manage), so this holder sees two tabs.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([ar.settings.tabs.general, ar.settings.tabs.gradeSchemes])
    unmount()

    const fetchMock = mockSettingsApi()
    renderWithProviders(<SettingsPage section="gradeSchemes" />, { auth: makeAuth({ user: makeUser({ permissions: ['academy.settings.read'] }) }), route: '/settings/grade-schemes' })
    expect(screen.getByText(ar.errors.forbidden)).toBeInTheDocument()
    expect(screen.queryByText(ar.gradeSchemes.subtitle)).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
