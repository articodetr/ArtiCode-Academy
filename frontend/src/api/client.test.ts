import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken, onSessionLost, setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch, sessionResponse } from '../test/http'
import { ApiError, apiRequest, apiUrl, refreshSession } from './client'

const EXPIRED = { statusCode: 401, code: 'token_expired', message: 'Access token expired' }

describe('apiUrl', () => {
  it('normalises the leading slash (same-origin base URL in tests)', () => {
    expect(apiUrl('/api/health')).toBe('/api/health')
    expect(apiUrl('api/health')).toBe('/api/health')
  })
})

describe('apiRequest', () => {
  beforeEach(() => {
    setAccessToken(null)
  })

  it('sends JSON with the bearer token and the cookie jar', async () => {
    setAccessToken('access-1')
    const fetchMock = mockFetch(() => jsonResponse(200, { ok: true }))

    await expect(apiRequest('/api/users', { method: 'POST', body: { kind: 'student' } })).resolves.toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/users')
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    expect(init?.body).toBe('{"kind":"student"}')
    const headers = new Headers(init?.headers)
    expect(headers.get('Authorization')).toBe('Bearer access-1')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('Accept')).toBe('application/json')
  })

  it('omits the token and the content type for public GET requests', async () => {
    setAccessToken('access-1')
    const fetchMock = mockFetch(() => jsonResponse(200, { status: 'ok' }))

    await apiRequest('/api/health', { auth: false })

    const [, init] = fetchMock.mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(headers.has('Authorization')).toBe(false)
    expect(headers.has('Content-Type')).toBe(false)
    expect(init?.body).toBeUndefined()
  })

  it('resolves with undefined for 204 No Content', async () => {
    mockFetch(() => jsonResponse(204))
    await expect(apiRequest('/api/auth/logout', { method: 'POST', auth: false })).resolves.toBeUndefined()
  })

  it('throws an ApiError carrying the backend status, code and message', async () => {
    mockFetch(() => jsonResponse(403, { statusCode: 403, code: 'permission_denied', message: 'Missing permission' }))

    const error: unknown = await apiRequest('/api/users').catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ name: 'ApiError', status: 403, code: 'permission_denied', message: 'Missing permission' })
  })

  it('joins validation message arrays and leaves the code null', async () => {
    mockFetch(() => jsonResponse(400, { statusCode: 400, message: ['identifier must be a string', 'password should not be empty'] }))

    await expect(apiRequest('/api/auth/login', { method: 'POST', body: {}, auth: false })).rejects.toMatchObject({
      status: 400,
      code: null,
      message: 'identifier must be a string, password should not be empty',
    })
  })

  it('refreshes once and retries a request whose access token expired', async () => {
    setAccessToken('stale')
    const fetchMock = mockFetch((url, init) => {
      if (url === '/api/auth/refresh') return jsonResponse(200, sessionResponse('fresh'))
      const token = new Headers(init?.headers).get('Authorization')
      return token === 'Bearer fresh' ? jsonResponse(200, { items: [] }) : jsonResponse(401, EXPIRED)
    })

    await expect(apiRequest('/api/users')).resolves.toEqual({ items: [] })

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/users', '/api/auth/refresh', '/api/users'])
    expect(getAccessToken()).toBe('fresh')
  })

  it('gives up after one failed refresh and announces the lost session', async () => {
    setAccessToken('stale')
    const lost = vi.fn()
    const unsubscribe = onSessionLost(lost)
    const fetchMock = mockFetch((url) =>
      url === '/api/auth/refresh'
        ? jsonResponse(401, { statusCode: 401, code: 'unauthenticated', message: 'No session' })
        : jsonResponse(401, EXPIRED),
    )

    try {
      await expect(apiRequest('/api/users')).rejects.toMatchObject({ status: 401, code: 'token_expired' })
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/users', '/api/auth/refresh'])
      expect(lost).toHaveBeenCalledTimes(1)
      expect(getAccessToken()).toBeNull()
    } finally {
      unsubscribe()
    }
  })

  it('does not refresh for a 401 that is not about the access token', async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse(401, { statusCode: 401, code: 'invalid_credentials', message: 'Invalid credentials' }),
    )

    await expect(
      apiRequest('/api/auth/login', { method: 'POST', body: { identifier: 'x', password: 'y' }, auth: false }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('refreshSession', () => {
  beforeEach(() => {
    setAccessToken(null)
  })

  it('shares one in-flight request between concurrent callers and stores the new token', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, sessionResponse('one')))

    const [first, second] = await Promise.all([refreshSession(), refreshSession()])

    expect(first).toBe(second)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBe('one')
  })

  it('starts a new request once the previous one has settled', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, sessionResponse('again')))

    await refreshSession()
    await refreshSession()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
