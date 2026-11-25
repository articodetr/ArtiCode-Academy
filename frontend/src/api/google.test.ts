import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { GOOGLE_PATHS, GOOGLE_URL_INVALID, isGoogleAuthorizationUrl, startGoogleSignIn } from './google'

const GOOGLE_URL = 'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=s&nonce=n&code_challenge=c'

describe('Google sign-in API', () => {
  beforeEach(() => {
    // A stored token must never travel to the public route.
    setAccessToken('access-1')
  })

  it('POSTs the return path to the public start route with cookies and without a bearer token, and hands back the URL', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, { url: GOOGLE_URL }))

    await expect(startGoogleSignIn('/catalog/c-1?intent=enroll')).resolves.toBe(GOOGLE_URL)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(GOOGLE_PATHS.start)
    expect(init?.method).toBe('POST')
    // The `aca_google` cookie of the answer must be stored: the request carries the browser's cookies.
    expect(init?.credentials).toBe('include')
    expect(new Headers(init?.headers).get('Authorization')).toBeNull()
    expect(JSON.parse(String(init?.body))).toEqual({ returnTo: '/catalog/c-1?intent=enroll' })
  })

  it('sends an empty body without a return path', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, { url: GOOGLE_URL }))
    await startGoogleSignIn(null)
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({})
  })

  it('rejects with the stable code of a refusal and never retries with a refresh', async () => {
    const fetchMock = mockFetch(() => jsonResponse(503, { statusCode: 503, code: 'google_unavailable', message: 'off' }))
    await expect(startGoogleSignIn(null)).rejects.toMatchObject({ status: 503, code: 'google_unavailable' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['no url', {}],
    ['a javascript: address', { url: 'javascript:alert(1)' }],
    ['an http: address', { url: 'http://accounts.google.com/o/oauth2/v2/auth' }],
    ['a relative path', { url: '/o/oauth2/v2/auth' }],
    ['credentials in the address', { url: 'https://user:pass@accounts.google.com/' }],
    ['a number', { url: 42 }],
    ['another https host', { url: 'https://evil.example/o/oauth2/v2/auth' }],
    ['a host that only starts like Google’s', { url: 'https://accounts.google.com.evil.example/o/oauth2/v2/auth' }],
    ['a host that only ends like Google’s', { url: 'https://evilaccounts.google.com/o/oauth2/v2/auth' }],
    ['another Google host', { url: 'https://www.google.com/o/oauth2/v2/auth' }],
    ['a port', { url: 'https://accounts.google.com:8443/o/oauth2/v2/auth' }],
  ])('refuses an answer with %s', async (_label, body) => {
    mockFetch(() => jsonResponse(200, body))
    await expect(startGoogleSignIn(null)).rejects.toThrow(GOOGLE_URL_INVALID)
  })

  it('takes only Google’s own authorization page', () => {
    expect(isGoogleAuthorizationUrl(GOOGLE_URL)).toBe(true)
    // The default port, written out, is the same origin.
    expect(isGoogleAuthorizationUrl('https://accounts.google.com:443/o/oauth2/v2/auth?state=s')).toBe(true)
    expect(isGoogleAuthorizationUrl('HTTPS://ACCOUNTS.GOOGLE.COM/o/oauth2/v2/auth')).toBe(true)
    expect(isGoogleAuthorizationUrl('https://accounts.google.com.evil.example/')).toBe(false)
    expect(isGoogleAuthorizationUrl('data:text/html,x')).toBe(false)
    expect(isGoogleAuthorizationUrl('')).toBe(false)
    expect(isGoogleAuthorizationUrl(null)).toBe(false)
  })
})
