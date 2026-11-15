import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import type { AuthContextValue } from '../auth/auth-context'
import { LoginPage } from './LoginPage'

/** Mounts the page at /login; every other path renders the location probe. */
function renderLogin(auth: AuthContextValue = makeAuth(), from?: string) {
  return renderWithProviders(<LoginPage />, {
    auth,
    route: { pathname: '/login', state: from ? { from } : null },
    routes: { '*': <LocationProbe /> },
  })
}

function fields() {
  return {
    identifier: screen.getByLabelText(ar.login.identifier),
    password: screen.getByLabelText(ar.login.password),
    submit: screen.getByRole('button', { name: ar.login.submit }),
  }
}

async function submitCredentials(identifier = 'admin', password = 'Secret123!') {
  const user = userEvent.setup()
  await user.type(fields().identifier, identifier)
  await user.type(fields().password, password)
  await user.click(fields().submit)
}

describe('LoginPage', () => {
  it('renders the sign-in form in Arabic (RTL) by default', () => {
    renderLogin()
    expect(screen.getByText(ar.common.appName)).toBeInTheDocument()
    const { identifier, password, submit } = fields()
    expect(identifier).toHaveAttribute('autocomplete', 'username')
    expect(password).toHaveAttribute('type', 'password')
    expect(submit).toBeEnabled()
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
    expect(document.documentElement).toHaveAttribute('lang', 'ar')
  })

  it('requires both fields before calling login', async () => {
    const auth = makeAuth()
    renderLogin(auth)
    await userEvent.click(fields().submit)
    expect(await screen.findByText(ar.login.identifierRequired)).toBeInTheDocument()
    expect(await screen.findByText(ar.login.passwordRequired)).toBeInTheDocument()
    expect(auth.login).not.toHaveBeenCalled()
  })

  it('signs in with the trimmed identifier and returns to the page the visitor came from', async () => {
    const auth = makeAuth()
    vi.mocked(auth.login).mockResolvedValue(makeUser())
    renderLogin(auth, '/users')
    await submitCredentials('  admin@test.local ', 'Secret123!')
    await waitFor(() => expect(auth.login).toHaveBeenCalledWith('admin@test.local', 'Secret123!'))
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/users')
  })

  it('sends a user who must change the password to the profile page instead', async () => {
    const auth = makeAuth()
    vi.mocked(auth.login).mockResolvedValue(makeUser({ mustChangePassword: true }))
    renderLogin(auth, '/users')
    await submitCredentials()
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/profile')
  })

  it('shows the dedicated message for a known backend code and stays on the page', async () => {
    const auth = makeAuth()
    vi.mocked(auth.login).mockRejectedValue(
      new ApiError(401, 'Invalid credentials', { statusCode: 401, code: 'invalid_credentials' }),
    )
    renderLogin(auth)
    await submitCredentials()
    expect(await screen.findByRole('alert')).toHaveTextContent(ar.login.errors.invalid_credentials)
    expect(screen.queryByTestId('location')).not.toBeInTheDocument()
    expect(fields().submit).toBeEnabled()
  })

  it('tells a locked-out user how many minutes to wait (rounded up)', async () => {
    const auth = makeAuth()
    vi.mocked(auth.login).mockRejectedValue(
      new ApiError(423, 'Locked', { statusCode: 423, code: 'account_locked', retryAfterSeconds: 290 }),
    )
    renderLogin(auth)
    await submitCredentials()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('login.errors.account_locked', { minutes: 5 }),
    )
  })

  it('uses the generic, server and network messages for everything else', async () => {
    const auth = makeAuth()
    const login = vi.mocked(auth.login)
    renderLogin(auth)

    login.mockRejectedValueOnce(new ApiError(400, 'Bad request', { message: ['identifier must be a string'] }))
    await submitCredentials()
    expect(await screen.findByRole('alert')).toHaveTextContent(ar.login.errors.generic)

    login.mockRejectedValueOnce(new ApiError(503, 'Service Unavailable'))
    await userEvent.click(fields().submit)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(ar.login.errors.server))

    login.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await userEvent.click(fields().submit)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(ar.login.errors.network))
  })

  it('redirects an already signed-in user away from the login page', () => {
    renderLogin(makeAuth({ user: makeUser() }), '/users')
    expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/users')
    expect(screen.queryByRole('button', { name: ar.login.submit })).not.toBeInTheDocument()
  })

  it('shows only a spinner while the session is still being restored', () => {
    renderLogin(makeAuth({ status: 'loading' }))
    expect(screen.queryByRole('button', { name: ar.login.submit })).not.toBeInTheDocument()
    expect(document.querySelector('.ant-spin')).not.toBeNull()
  })
})
