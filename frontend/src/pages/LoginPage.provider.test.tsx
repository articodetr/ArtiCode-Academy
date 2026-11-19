// The sign-in page inside the REAL AuthProvider (fetch is the only stand-in):
// the two halves that LoginPage.test.tsx and AuthProvider.test.tsx prove apart —
// the page's navigation and the provider's state — meet here for the two-step sign-in.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { getAccessToken, setAccessToken } from '../auth/token-store'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { jsonResponse, mfaChallengeResponse, mockFetch, sessionResponse } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { renderWithProviders } from '../test/render'
import type { SessionUser } from '../api/auth'
import { LoginPage } from './LoginPage'

const UNAUTHENTICATED = { statusCode: 401, code: 'unauthenticated', message: 'Authentication required' }
const challenge = mfaChallengeResponse()

/**
 * Mounts /login under the real provider; `from` is where the visitor was going.
 * `secondStep` replaces the session API-211 answers by default.
 */
function renderSignIn(options: { mfa: boolean; user?: Partial<SessionUser>; secondStep?: () => Response }) {
  const fetchMock = mockFetch((url) => {
    if (url === '/api/auth/login') {
      return jsonResponse(200, options.mfa ? challenge : sessionResponse('access-password', options.user))
    }
    if (url === '/api/auth/login/mfa') {
      return options.secondStep ? options.secondStep() : jsonResponse(200, sessionResponse('access-mfa', options.user))
    }
    return jsonResponse(401, UNAUTHENTICATED)
  })
  renderWithProviders(
    <AuthProvider>
      <LoginPage />
    </AuthProvider>,
    { route: { pathname: '/login', state: { from: '/users' } }, routes: { '*': <LocationProbe /> } },
  )
  return fetchMock
}

/** The requests of the sign-in itself — without the page's own read of API-205 for the catalog link (MOD-20). */
function authCalls(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls.filter(([url]) => String(url) !== '/api/academy/public')
}

async function submitPassword() {
  const user = userEvent.setup()
  // The form shows once the provider knows there is no session to restore.
  await user.type(await screen.findByLabelText(ar.login.identifier), 'admin')
  await user.type(screen.getByLabelText(ar.login.password), 'Secret123!')
  await user.click(screen.getByRole('button', { name: ar.login.submit }))
}

describe('LoginPage with the real AuthProvider', () => {
  beforeEach(() => {
    setAccessToken(null)
  })

  it('signs nobody in on the password alone when the account has two-step verification, then enters with the code', async () => {
    const fetchMock = renderSignIn({ mfa: true })
    await submitPassword()

    const code = await screen.findByLabelText(ar.login.mfa.code)
    // After the right password: no token, no session, still on the sign-in page.
    expect(getAccessToken()).toBeNull()
    expect(screen.queryByTestId('location')).not.toBeInTheDocument()

    await userEvent.type(code, '123456{Enter}')

    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/users')
    expect(getAccessToken()).toBe('access-mfa')
    expect(authCalls(fetchMock).map(([url]) => url)).toEqual(['/api/auth/refresh', '/api/auth/login', '/api/auth/login/mfa'])
    const [, init] = authCalls(fetchMock)[2]!
    expect(JSON.parse(String(init?.body))).toEqual({ challenge: challenge.challenge, code: '123456' })
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    // Neither the password, the challenge nor the code was written anywhere.
    expect(window.sessionStorage.length).toBe(0)
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(challenge.challenge)
  })

  it('sends a user who must change the password to the profile page after the second step', async () => {
    renderSignIn({ mfa: true, user: { mustChangePassword: true } })
    await submitPassword()

    await userEvent.type(await screen.findByLabelText(ar.login.mfa.code), '123456{Enter}')

    await waitFor(() => expect(getAccessToken()).toBe('access-mfa'))
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/profile')
  })

  it('returns to the password form with the lock message when the second step finds the account locked — nobody signed in', async () => {
    const fetchMock = renderSignIn({
      mfa: true,
      secondStep: () => jsonResponse(423, { statusCode: 423, code: 'account_locked', message: 'Locked', retryAfterSeconds: 900 }),
    })
    await submitPassword()

    await userEvent.type(await screen.findByLabelText(ar.login.mfa.code), '123456{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('login.errors.account_locked', { minutes: 15 }))
    expect(screen.queryByLabelText(ar.login.mfa.code)).not.toBeInTheDocument()
    expect(screen.getByLabelText(ar.login.password)).toHaveValue('')
    expect(getAccessToken()).toBeNull()
    expect(screen.queryByTestId('location')).not.toBeInTheDocument()
    expect(authCalls(fetchMock).map(([url]) => url)).toEqual(['/api/auth/refresh', '/api/auth/login', '/api/auth/login/mfa'])
  })

  it('still sends a user who must change the password to the profile page without two-step verification', async () => {
    renderSignIn({ mfa: false, user: { mustChangePassword: true } })
    await submitPassword()

    await waitFor(() => expect(getAccessToken()).toBe('access-password'))
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/profile')
  })
})
