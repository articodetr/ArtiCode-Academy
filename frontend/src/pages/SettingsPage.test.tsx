import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ALL_ROLES, makeCatalog } from '../test/roles'
import { SettingsPage } from './SettingsPage'

/** Serves the roles tab (API-022/023) and the general tab (API-035). */
function mockSettingsApi() {
  return mockFetch((url) => {
    if (url === '/api/roles') return jsonResponse(200, { items: ALL_ROLES })
    if (url === '/api/permissions') return jsonResponse(200, makeCatalog())
    if (url === '/api/academy') return jsonResponse(200, makeAcademy())
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

  it('shows the general form alone (no tabs) to a holder of academy.settings.read without roles.manage', async () => {
    mockSettingsApi()
    renderWithProviders(<SettingsPage />, { auth: makeAuth({ user: makeUser({ permissions: ['academy.settings.read'] }) }), route: '/settings' })
    expect(await screen.findByLabelText(ar.settings.academyNameAr)).toBeInTheDocument()
    expect(screen.getByText(ar.settings.readOnlyHint)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: ar.settings.tabs.roles })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: ar.settings.tabs.general })).not.toBeInTheDocument()
  })
})
