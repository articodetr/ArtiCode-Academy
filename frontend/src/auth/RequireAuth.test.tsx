import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { isAllowed } from './access'
import { RequireAccess, RequireAuth } from './RequireAuth'

const SECRET = 'محتوى محمي'

function redirectState() {
  const probe = screen.getByTestId('location')
  return { pathname: probe.getAttribute('data-pathname'), state: JSON.parse(probe.getAttribute('data-state') ?? 'null') as unknown }
}

function expectForbidden() {
  expect(screen.getByText(ar.errors.forbidden)).toBeInTheDocument()
  expect(screen.getByText(ar.errors.backHome).closest('button')).not.toBeNull()
  expect(screen.queryByText(SECRET)).not.toBeInTheDocument()
}

describe('RequireAuth', () => {
  it('shows a spinner and hides the page while the session is being restored', () => {
    renderWithProviders(
      <RequireAuth>
        <p>{SECRET}</p>
      </RequireAuth>,
      { auth: makeAuth({ status: 'loading' }) },
    )
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument()
    expect(document.querySelector('.ant-spin')).not.toBeNull()
  })

  it('sends an anonymous visitor to /login and remembers where they were going', () => {
    renderWithProviders(
      <RequireAuth>
        <p>{SECRET}</p>
      </RequireAuth>,
      { route: '/users', routes: { '/login': <LocationProbe /> } },
    )
    expect(redirectState()).toEqual({ pathname: '/login', state: { from: '/users' } })
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument()
  })

  it('renders the page for a signed-in user', () => {
    renderWithProviders(
      <RequireAuth>
        <p>{SECRET}</p>
      </RequireAuth>,
      { auth: makeAuth({ user: makeUser() }) },
    )
    expect(screen.getByText(SECRET)).toBeInTheDocument()
  })
})

describe('RequireAccess', () => {
  it('lets a role that owns a role-gated screen through and shows the 403 page to one that does not', () => {
    const { unmount } = renderWithProviders(
      <RequireAccess navKey="settings">
        <p>{SECRET}</p>
      </RequireAccess>,
      { auth: makeAuth({ user: makeUser() }), route: '/settings' },
    )
    expect(screen.getByText(SECRET)).toBeInTheDocument()
    unmount()

    const student = makeUser({ role: 'student', roles: ['student'], permissions: [] })
    renderWithProviders(
      <RequireAccess navKey="settings">
        <p>{SECRET}</p>
      </RequireAccess>,
      { auth: makeAuth({ user: student }), route: '/settings' },
    )
    expectForbidden()
  })

  it('opens a permission-gated screen to a custom role holding its key, whatever the role (AC1/AC2)', () => {
    const custom = makeUser({ role: null, roles: ['auditor'], permissions: ['users.read'] })
    renderWithProviders(
      <RequireAccess navKey="users">
        <p>{SECRET}</p>
      </RequireAccess>,
      { auth: makeAuth({ user: custom }), route: '/users' },
    )
    expect(screen.getByText(SECRET)).toBeInTheDocument()
  })

  it('shows the 403 page on a permission-gated screen to an admin whose role lacks the key', () => {
    renderWithProviders(
      <RequireAccess navKey="audit">
        <p>{SECRET}</p>
      </RequireAccess>,
      { auth: makeAuth({ user: makeUser({ permissions: ['users.read'] }) }), route: '/audit-logs' },
    )
    expectForbidden()
  })

  it('accepts a permission key directly', () => {
    const { unmount } = renderWithProviders(
      <RequireAccess permission="roles.manage">
        <p>{SECRET}</p>
      </RequireAccess>,
      { auth: makeAuth({ user: makeUser({ permissions: ['roles.manage'] }) }) },
    )
    expect(screen.getByText(SECRET)).toBeInTheDocument()
    unmount()

    renderWithProviders(
      <RequireAccess permission="roles.manage">
        <p>{SECRET}</p>
      </RequireAccess>,
      { auth: makeAuth({ user: makeUser({ permissions: ['users.read'] }) }) },
    )
    expectForbidden()
  })

  it('accepts a role, or a list of roles', () => {
    const staff = makeUser({ role: 'staff', roles: ['staff'], permissions: [] })
    const { unmount } = renderWithProviders(
      <RequireAccess role={['admin', 'staff']}>
        <p>{SECRET}</p>
      </RequireAccess>,
      { auth: makeAuth({ user: staff }) },
    )
    expect(screen.getByText(SECRET)).toBeInTheDocument()
    unmount()

    renderWithProviders(
      <RequireAccess role="admin">
        <p>{SECRET}</p>
      </RequireAccess>,
      { auth: makeAuth({ user: staff }) },
    )
    expectForbidden()
  })

  it('shows a user without a known role the landing page, which is open to everyone', () => {
    const noRole = makeUser({ role: null, roles: ['custom_reporting'], permissions: [] })
    renderWithProviders(
      <RequireAccess navKey="dashboard">
        <p>{SECRET}</p>
      </RequireAccess>,
      { auth: makeAuth({ user: noRole }) },
    )
    expect(screen.getByText(SECRET)).toBeInTheDocument()
  })

  it('redirects to /login when there is no user at all', () => {
    renderWithProviders(
      <RequireAccess navKey="dashboard">
        <p>{SECRET}</p>
      </RequireAccess>,
      { routes: { '/login': <LocationProbe /> } },
    )
    expect(redirectState().pathname).toBe('/login')
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument()
  })
})

describe('isAllowed', () => {
  it('requires every given criterion and passes with none', () => {
    const admin = makeUser({ permissions: ['users.read'] })
    expect(isAllowed(admin, {})).toBe(true)
    expect(isAllowed(admin, { navKey: 'users', role: 'admin' })).toBe(true)
    expect(isAllowed(admin, { navKey: 'users', permission: 'roles.manage' })).toBe(false)
    expect(isAllowed(admin, { permission: 'users.read', role: 'staff' })).toBe(false)
    expect(isAllowed({ role: null, permissions: [] }, { role: ['admin', 'staff'] })).toBe(false)
  })
})
