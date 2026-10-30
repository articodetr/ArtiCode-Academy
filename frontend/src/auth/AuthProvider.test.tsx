import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { jsonResponse, mockFetch, sessionResponse } from '../test/http'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './auth-context'
import type { AuthContextValue } from './auth-context'
import { emitSessionLost, getAccessToken, setAccessToken } from './token-store'

const UNAUTHENTICATED = { statusCode: 401, code: 'unauthenticated', message: 'Authentication required' }

/** Mounts the real provider and exposes its context value to the test. */
function renderProvider() {
  const ref: { current: AuthContextValue | null } = { current: null }
  function Capture() {
    const value = useAuth()
    useEffect(() => {
      ref.current = value
    })
    return (
      <output data-testid="auth" data-status={value.status}>
        {value.user ? `${value.user.role}:${value.user.name}` : ''}
      </output>
    )
  }
  render(
    <AuthProvider>
      <Capture />
    </AuthProvider>,
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
