import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { RequireAuth, RequireRole } from './RequireAuth'

const SECRET = 'محتوى محمي'

function redirectState() {
  const probe = screen.getByTestId('location')
  return { pathname: probe.getAttribute('data-pathname'), state: JSON.parse(probe.getAttribute('data-state') ?? 'null') as unknown }
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

describe('RequireRole', () => {
  it('lets a role that owns the screen through', () => {
    renderWithProviders(
      <RequireRole navKey="users">
        <p>{SECRET}</p>
      </RequireRole>,
      { auth: makeAuth({ user: makeUser() }), route: '/users' },
    )
    expect(screen.getByText(SECRET)).toBeInTheDocument()
  })

  it('shows the 403 page to a role that does not see the screen', () => {
    const student = makeUser({ role: 'student', roles: ['student'], permissions: [] })
    renderWithProviders(
      <RequireRole navKey="users">
        <p>{SECRET}</p>
      </RequireRole>,
      { auth: makeAuth({ user: student }), route: '/users' },
    )
    expect(screen.getByText(ar.errors.forbidden)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: ar.errors.backHome })).toBeInTheDocument()
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument()
  })

  it('shows a user without a known role only the screens open to everyone', () => {
    const noRole = makeUser({ role: null, roles: ['custom_reporting'], permissions: [] })
    renderWithProviders(
      <RequireRole navKey="dashboard">
        <p>{SECRET}</p>
      </RequireRole>,
      { auth: makeAuth({ user: noRole }) },
    )
    expect(screen.getByText(SECRET)).toBeInTheDocument()
  })

  it('redirects to /login when there is no user at all', () => {
    renderWithProviders(
      <RequireRole navKey="dashboard">
        <p>{SECRET}</p>
      </RequireRole>,
      { routes: { '/login': <LocationProbe /> } },
    )
    expect(redirectState().pathname).toBe('/login')
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument()
  })
})
