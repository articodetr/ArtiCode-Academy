import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ALL_ROLES, makeCatalog } from '../test/roles'
import { SettingsPage } from './SettingsPage'

function mockRolesApi() {
  return mockFetch((url) => (url === '/api/roles' ? jsonResponse(200, { items: ALL_ROLES }) : jsonResponse(200, makeCatalog())))
}

describe('SettingsPage', () => {
  it('shows the general form with both tabs to an admin holding roles.manage, and the roles tab navigates to /settings/roles', async () => {
    renderWithProviders(<SettingsPage />, {
      auth: makeAuth({ user: makeUser({ permissions: ['roles.manage'] }) }),
      route: '/settings',
      routes: { '/settings/roles': <LocationProbe /> },
    })

    expect(screen.getByRole('heading', { name: ar.settings.title })).toBeInTheDocument()
    expect(screen.getByLabelText(ar.settings.academyNameAr)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: ar.settings.tabs.general })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(screen.getByRole('tab', { name: ar.settings.tabs.roles }))
    expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/settings/roles')
  })

  it('renders the roles manager under /settings/roles for a holder of roles.manage', async () => {
    const fetchMock = mockRolesApi()
    renderWithProviders(<SettingsPage section="roles" />, {
      auth: makeAuth({ user: makeUser({ permissions: ['roles.manage'] }) }),
      route: '/settings/roles',
    })

    expect(screen.getByText(ar.rolesAdmin.subtitle)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: ar.settings.tabs.roles })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('أمين المكتبة')).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.settings.academyNameAr)).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => String(url)).sort()).toEqual(['/api/permissions', '/api/roles'])
  })

  it('opens /settings/roles to a roles.manage holder whose role sees no other settings, without the general tab (D-R06)', async () => {
    mockRolesApi()
    renderWithProviders(<SettingsPage section="roles" />, {
      auth: makeAuth({ user: makeUser({ role: 'staff', roles: ['staff', 'role_manager'], permissions: ['users.read', 'roles.manage'] }) }),
      route: '/settings/roles',
    })

    expect(await screen.findByText('أمين المكتبة')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: ar.settings.tabs.general })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: ar.settings.tabs.roles })).not.toBeInTheDocument()
  })

  it('shows the 403 page under /settings/roles to a user without roles.manage, and hides the roles tab on /settings', () => {
    renderWithProviders(<SettingsPage section="roles" />, { auth: makeAuth({ user: makeUser({ permissions: ['users.read'] }) }), route: '/settings/roles' })
    expect(screen.getByText(ar.errors.forbidden)).toBeInTheDocument()
    expect(screen.queryByText(ar.rolesAdmin.subtitle)).not.toBeInTheDocument()
  })

  it('hides the roles tab on /settings from an admin without roles.manage', () => {
    renderWithProviders(<SettingsPage />, { auth: makeAuth({ user: makeUser({ permissions: ['users.read'] }) }), route: '/settings' })
    expect(screen.getByLabelText(ar.settings.academyNameAr)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: ar.settings.tabs.roles })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: ar.settings.tabs.general })).not.toBeInTheDocument()
  })
})
