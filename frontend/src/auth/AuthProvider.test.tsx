import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import { useLayoutEffect } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isMfaChallenge } from '../api/auth'
import { jsonResponse, mfaChallengeResponse, mockFetch, sessionResponse } from '../test/http'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './auth-context'
import type { AuthContextValue } from './auth-context'
import { RequireAuth } from './RequireAuth'
import { emitSessionLost, emitSessionSwitched, getAccessToken, setAccessToken } from './token-store'

const UNAUTHENTICATED = { statusCode: 401, code: 'unauthenticated', message: 'Authentication required' }

/** What the server answers when POST /api/auth/refresh hits its limit (30 per minute per IP). */
function rateLimited(headers: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({ statusCode: 429, error: 'Too Many Requests', code: 'rate_limited', message: 'Too many requests; try again later' }),
    { status: 429, headers: { 'Content-Type': 'application/json', ...headers } },
  )
}

/**
 * The provider above a router like app/App.tsx: `/` behind the real RequireAuth, `/login` a marker. `events`
 * records every status the provider showed and every time the sign-in page was mounted.
 */
function renderAppShell() {
  const events: string[] = []
  function StatusProbe() {
    const { status } = useAuth()
    useLayoutEffect(() => {
      events.push(status)
    })
    return <output data-testid="auth" data-status={status} />
  }
  function SignInPage() {
    useLayoutEffect(() => {
      events.push('sign-in page')
    }, [])
    return <p>sign-in page</p>
  }
  render(
    <AntdApp>
      <AuthProvider>
        <StatusProbe />
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/login" element={<SignInPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <p>home</p>
                </RequireAuth>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </AntdApp>,
  )
  return {
    events,
    status: () => screen.queryByTestId('auth')?.getAttribute('data-status') ?? null,
  }
}

/** Moves the fake clock and lets the fetch answers and React updates settle (waitFor never resolves under fake timers). */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Mounts the real provider and exposes its context value to the test. */
function renderProvider() {
  const ref: { current: AuthContextValue | null } = { current: null }
  function Capture() {
    const value = useAuth()
    // A layout effect, never a passive one (KI-059): it runs inside the commit that writes
    // `data-status`, so a test that waited for the DOM reads the value of that same commit. Outside
    // act() (the refresh answer lands while waitFor runs) React flushes passive effects in a later
    // Scheduler task, and waitFor can resolve before it — the read then saw the loading value.
    useLayoutEffect(() => {
      ref.current = value
    })
    return (
      <output data-testid="auth" data-status={value.status}>
        {value.user ? `${value.user.role}:${value.user.name}` : ''}
      </output>
    )
  }
  // Inside antd's App like in app/App.tsx: the provider shows notices through App.useApp().
  render(
    <AntdApp>
      <AuthProvider>
        <Capture />
      </AuthProvider>
    </AntdApp>,
  )
  return {
    auth: () => {
      if (!ref.current) throw new Error('AuthProvider did not render')
      return ref.current
    },
    status: () => screen.getByTestId('auth').getAttribute('data-status'),
  }
}

describe('AuthProvider', () => {
  beforeEach(() => {
    setAccessToken(null)
  })

  it('starts loading, asks the server for a session and becomes anonymous when the cookie is rejected', async () => {
    const fetchMock = mockFetch(() => jsonResponse(401, UNAUTHENTICATED))
    const { status } = renderProvider()
    expect(status()).toBe('loading')
    await waitFor(() => expect(status()).toBe('anonymous'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/refresh')
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    expect(getAccessToken()).toBeNull()
  })

  it('restores the session from the refresh cookie and maps the server roles to the UI role', async () => {
    mockFetch(() => jsonResponse(200, sessionResponse('access-1')))
    const { auth, status } = renderProvider()
    await waitFor(() => expect(status()).toBe('authenticated'))

    expect(screen.getByTestId('auth')).toHaveTextContent('admin:مدير الأكاديمية')
    expect(auth().user).toMatchObject({ id: 'user-1', role: 'admin', roles: ['academy_admin'] })
    expect(auth().hasPermission('users.read')).toBe(true)
    expect(auth().hasPermission('roles.manage')).toBe(false)
    expect(getAccessToken()).toBe('access-1')
  })

  it('signs in through POST /api/auth/login and keeps the access token in memory only', async () => {
    const fetchMock = mockFetch((url) =>
      url === '/api/auth/login'
        ? jsonResponse(200, sessionResponse('access-2', { displayName: 'أ. نورة', roles: ['teacher'], permissions: [] }))
        : jsonResponse(401, UNAUTHENTICATED),
    )
    const { auth, status } = renderProvider()
    await waitFor(() => expect(status()).toBe('anonymous'))

    await act(async () => {
      await auth().login('noura', 'Secret123!')
    })

    expect(status()).toBe('authenticated')
    expect(screen.getByTestId('auth')).toHaveTextContent('teacher:أ. نورة')
    const [, init] = fetchMock.mock.calls[1]
    expect(init?.body).toBe(JSON.stringify({ identifier: 'noura', password: 'Secret123!' }))
    expect(getAccessToken()).toBe('access-2')
    // The token is never persisted: a reload starts from the httpOnly cookie.
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('stays signed out when the password step answers the challenge of two-step verification', async () => {
    const challenge = mfaChallengeResponse()
    const fetchMock = mockFetch((url) =>
      url === '/api/auth/login' ? jsonResponse(200, challenge) : jsonResponse(401, UNAUTHENTICATED),
    )
    const { auth, status } = renderProvider()
    await waitFor(() => expect(status()).toBe('anonymous'))

    let result: unknown
    await act(async () => {
      result = await auth().login('noura', 'Secret123!')
    })

    // The caller gets the challenge to finish the sign-in with; the provider knows no user yet.
    expect(result).toEqual(challenge)
    expect(isMfaChallenge(result)).toBe(true)
    expect(status()).toBe('anonymous')
    expect(auth().user).toBeNull()
    expect(getAccessToken()).toBeNull()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/auth/refresh', '/api/auth/login'])
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('completeMfaLogin finishes the sign-in through POST /api/auth/login/mfa and authenticates', async () => {
    const challenge = mfaChallengeResponse()
    const fetchMock = mockFetch((url) => {
      if (url === '/api/auth/login') return jsonResponse(200, challenge)
      if (url === '/api/auth/login/mfa') {
        return jsonResponse(200, sessionResponse('access-mfa', { displayName: 'أ. نورة', roles: ['teacher'], permissions: [] }))
      }
      return jsonResponse(401, UNAUTHENTICATED)
    })
    const { auth, status } = renderProvider()
    await waitFor(() => expect(status()).toBe('anonymous'))
    await act(async () => {
      await auth().login('noura', 'Secret123!')
    })
    expect(status()).toBe('anonymous')

    let user: unknown
    await act(async () => {
      user = await auth().completeMfaLogin(challenge.challenge, { code: '123456' })
    })

    expect(status()).toBe('authenticated')
    expect(screen.getByTestId('auth')).toHaveTextContent('teacher:أ. نورة')
    expect(user).toMatchObject({ id: 'user-1', role: 'teacher', name: 'أ. نورة' })
    const [url, init] = fetchMock.mock.calls[2]
    expect(url).toBe('/api/auth/login/mfa')
    expect(init?.body).toBe(JSON.stringify({ challenge: challenge.challenge, code: '123456' }))
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    expect(getAccessToken()).toBe('access-mfa')
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('a refused second step leaves the visitor signed out', async () => {
    mockFetch((url) =>
      url === '/api/auth/login/mfa'
        ? jsonResponse(401, { statusCode: 401, code: 'mfa_code_invalid' })
        : jsonResponse(401, UNAUTHENTICATED),
    )
    const { auth, status } = renderProvider()
    await waitFor(() => expect(status()).toBe('anonymous'))

    let failure: unknown
    await act(async () => {
      failure = await auth()
        .completeMfaLogin(mfaChallengeResponse().challenge, { code: '000000' })
        .catch((error: unknown) => error)
    })

    expect(failure).toMatchObject({ status: 401, code: 'mfa_code_invalid' })
    expect(status()).toBe('anonymous')
    expect(getAccessToken()).toBeNull()
  })

  it('drops to anonymous when the API client reports a lost session', async () => {
    mockFetch(() => jsonResponse(200, sessionResponse()))
    const { status } = renderProvider()
    await waitFor(() => expect(status()).toBe('authenticated'))

    act(() => {
      emitSessionLost()
    })

    expect(status()).toBe('anonymous')
    expect(getAccessToken()).toBeNull()
  })

  it('shows the user the cookie now belongs to, with a notice, when another tab switched accounts (KI-046)', async () => {
    mockFetch(() => jsonResponse(200, sessionResponse()))
    const { auth, status } = renderProvider()
    await waitFor(() => expect(status()).toBe('authenticated'))
    expect(screen.getByTestId('auth')).toHaveTextContent('admin:مدير الأكاديمية')

    act(() => {
      emitSessionSwitched(
        sessionResponse('student-token', { id: 'user-2', fullName: 'طالب تجريبي', roles: ['student'], permissions: [] }),
      )
    })

    expect(status()).toBe('authenticated')
    expect(screen.getByTestId('auth')).toHaveTextContent('student:طالب تجريبي')
    expect(auth().hasPermission('users.read')).toBe(false)
    expect(await screen.findByText(/فصار هذا التبويب يعمل بحساب طالب تجريبي/)).toBeInTheDocument()
  })

  it('logout revokes the cookie session and forgets the token', async () => {
    const fetchMock = mockFetch((url) =>
      url === '/api/auth/logout' ? jsonResponse(204) : jsonResponse(200, sessionResponse()),
    )
    const { auth, status } = renderProvider()
    await waitFor(() => expect(status()).toBe('authenticated'))

    await act(async () => {
      await auth().logout()
    })

    expect(status()).toBe('anonymous')
    expect(getAccessToken()).toBeNull()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/auth/refresh', '/api/auth/logout'])
  })
})

// CH-0296: a page load whose refresh was rate-limited (429 — the limit counts per IP), unreachable or a 5xx
// signed the visitor out although the refresh cookie was still valid. Only a 401 means "no session".
describe('AuthProvider start-up check when the server cannot tell', () => {
  beforeEach(() => {
    setAccessToken(null)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a 429 then a success: the user is signed in and the sign-in page was never shown', async () => {
    let refreshes = 0
    const fetchMock = mockFetch(() => (++refreshes === 1 ? rateLimited() : jsonResponse(200, sessionResponse('access-after-429'))))
    const shell = renderAppShell()

    await advance(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(shell.status()).toBe('loading')
    expect(screen.queryByText('home')).not.toBeInTheDocument()

    // No Retry-After: a one-second back-off before the second request.
    await advance(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/auth/refresh', '/api/auth/refresh'])

    expect(shell.status()).toBe('authenticated')
    expect(screen.getByText('home')).toBeInTheDocument()
    expect(getAccessToken()).toBe('access-after-429')
    expect(shell.events).not.toContain('anonymous')
    expect(shell.events).not.toContain('sign-in page')
  })

  it('honours the wait the server names (Retry-After-login of @nestjs/throttler)', async () => {
    let refreshes = 0
    const fetchMock = mockFetch(() =>
      ++refreshes === 1 ? rateLimited({ 'Retry-After-login': '7' }) : jsonResponse(200, sessionResponse()),
    )
    const shell = renderAppShell()

    await advance(0)
    await advance(6_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(shell.status()).toBe('loading')

    await advance(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(shell.status()).toBe('authenticated')
    expect(shell.events).not.toContain('sign-in page')
  })

  it('a 401 refresh_invalid makes the visitor anonymous at once, without a retry', async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse(401, { statusCode: 401, code: 'refresh_invalid', message: 'Refresh token is not valid' }),
    )
    const shell = renderAppShell()

    await advance(0)
    expect(shell.status()).toBe('anonymous')
    expect(screen.getByText('sign-in page')).toBeInTheDocument()

    await advance(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('repeated 429s end in the retry message, not the sign-in form; «إعادة المحاولة» asks again and signs in', async () => {
    let limited = true
    const fetchMock = mockFetch(() => (limited ? rateLimited() : jsonResponse(200, sessionResponse())))
    const shell = renderAppShell()

    // One request and three retries after 1 s, 2 s and 4 s — then the provider stops asking.
    await advance(0)
    await advance(1_000)
    await advance(2_000)
    await advance(4_000)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(screen.getByText('تعذّر التحقق من جلستك')).toBeInTheDocument()
    expect(screen.getByText(/الخادم يتلقى طلبات كثيرة من شبكتك/)).toBeInTheDocument()
    expect(screen.queryByText('sign-in page')).not.toBeInTheDocument()
    expect(shell.events).not.toContain('anonymous')
    expect(shell.events).not.toContain('sign-in page')

    await advance(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(4)

    limited = false
    act(() => {
      fireEvent.click(screen.getByText('إعادة المحاولة').closest('button')!)
    })
    await advance(0)
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(shell.status()).toBe('authenticated')
    expect(screen.getByText('home')).toBeInTheDocument()
    expect(screen.queryByText('تعذّر التحقق من جلستك')).not.toBeInTheDocument()
    expect(shell.events).not.toContain('sign-in page')
  })

  it('a network error and a 5xx are retried too; when the server stays unreachable the sign-in stays one click away', async () => {
    let refreshes = 0
    const fetchMock = vi.fn(async () => {
      refreshes += 1
      if (refreshes === 2) return jsonResponse(503, { statusCode: 503, message: 'Service Unavailable' })
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetchMock)
    const shell = renderAppShell()

    await advance(0)
    await advance(1_000)
    await advance(2_000)
    await advance(4_000)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(screen.getByText(/تعذّر الوصول إلى الخادم/)).toBeInTheDocument()
    expect(shell.events).not.toContain('sign-in page')

    act(() => {
      fireEvent.click(screen.getByText('المتابعة إلى تسجيل الدخول').closest('button')!)
    })
    expect(shell.status()).toBe('anonymous')
    expect(screen.getByText('sign-in page')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
