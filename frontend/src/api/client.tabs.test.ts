import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, mockFetch, sessionResponse } from '../test/http'

// Two tabs of one browser (KI-047, MOD-01-H08, TEST-060). Each tab gets its
// own copy of the client modules (in-memory access token, in-flight refresh),
// while the cookie jar, the Web Locks and the server are shared, as in a real
// browser. The fake server rotates the refresh cookie like
// AuthService.refresh() and revokes the whole family when a rotated cookie
// comes back.

async function openTab() {
  vi.resetModules()
  const client = await import('./client')
  const store = await import('../auth/token-store')
  return { client, store }
}

function fakeServer() {
  let issued = 0
  // The browser's cookie, shared by every tab, and the only unrotated token of
  // the server-side family (null once the family is revoked).
  let jar = 'cookie-0'
  let current: string | null = 'cookie-0'
  const sentCookies: string[] = []

  const fetchMock = mockFetch(async (url, init) => {
    if (url !== '/api/auth/refresh') {
      const token = new Headers(init?.headers).get('Authorization') ?? ''
      return token.startsWith('Bearer access-')
        ? jsonResponse(200, { items: [] })
        : jsonResponse(401, { statusCode: 401, code: 'token_expired', message: 'Access token expired' })
    }
    const cookie = jar // read when the request leaves, like a browser
    sentCookies.push(cookie)
    await new Promise((resolve) => setTimeout(resolve, 5)) // network round trip
    if (cookie !== current) {
      current = null
      return jsonResponse(401, { statusCode: 401, code: 'refresh_reused', message: 'Refresh token reuse detected' })
    }
    issued += 1
    current = `cookie-${issued}`
    jar = current // Set-Cookie is stored before the response reaches the page
    return jsonResponse(200, sessionResponse(`access-${issued}`))
  })

  return {
    fetchMock,
    sentCookies,
    familyAlive: () => current !== null,
    refreshCalls: () => fetchMock.mock.calls.filter(([url]) => url === '/api/auth/refresh').length,
  }
}

/** Exclusive locks by name, shared by every tab — the part of LockManager the client uses. */
function installWebLocks() {
  const queues = new Map<string, Promise<unknown>>()
  const requested: string[] = []
  const locks = {
    request<T>(name: string, callback: () => Promise<T>): Promise<T> {
      requested.push(name)
      const run = (queues.get(name) ?? Promise.resolve()).then(() => callback())
      queues.set(name, run.catch(() => undefined))
      return run
    },
  }
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true })
  return requested
}

function removeWebLocks() {
  Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
}

describe('refresh across two tabs (KI-047)', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'locks')
  })

  it('without Web Locks two tabs refreshing together trip reuse detection (the KI-047 race)', async () => {
    removeWebLocks()
    const server = fakeServer()
    const a = await openTab()
    const b = await openTab()

    const [first, second] = await Promise.allSettled([a.client.refreshSession(), b.client.refreshSession()])

    expect(first.status).toBe('fulfilled')
    expect(second).toMatchObject({ status: 'rejected', reason: { status: 401, code: 'refresh_reused' } })
    // Both requests left with the same cookie, so the server revoked the session.
    expect(server.sentCookies).toEqual(['cookie-0', 'cookie-0'])
    expect(server.familyAlive()).toBe(false)
  })

  it('with the lock, two tabs whose access tokens expired together both refresh and retry', async () => {
    const requested = installWebLocks()
    const server = fakeServer()
    const a = await openTab()
    const b = await openTab()
    a.store.setAccessToken('stale-a', 'user-1')
    b.store.setAccessToken('stale-b', 'user-1')

    const results = await Promise.all([a.client.apiRequest('/api/users'), b.client.apiRequest('/api/users')])

    expect(results).toEqual([{ items: [] }, { items: [] }])
    // The second tab waited and sent the cookie the first refresh stored.
    expect(server.sentCookies).toEqual(['cookie-0', 'cookie-1'])
    expect(server.familyAlive()).toBe(true)
    expect(requested).toEqual([a.client.REFRESH_LOCK_NAME, a.client.REFRESH_LOCK_NAME])
    expect(a.client.REFRESH_LOCK_NAME).toBe('articode.auth.refresh')
    // Each tab keeps its own access token in memory.
    expect(a.store.getAccessToken()).toBe('access-1')
    expect(b.store.getAccessToken()).toBe('access-2')
  })

  it('still shares one request between the callers of one tab under the lock', async () => {
    const requested = installWebLocks()
    const server = fakeServer()
    const a = await openTab()
    const b = await openTab()

    const [a1, a2, b1] = await Promise.all([
      a.client.refreshSession(),
      a.client.refreshSession(),
      b.client.refreshSession(),
    ])

    expect(a1).toBe(a2)
    expect(a1.accessToken).toBe('access-1')
    expect(b1.accessToken).toBe('access-2')
    expect(server.refreshCalls()).toBe(2)
    expect(requested).toHaveLength(2)
    expect(server.familyAlive()).toBe(true)
  })
})
