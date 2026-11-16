import { beforeEach, describe, expect, it } from 'vitest'
import { getAccessToken, getSessionUserId, setAccessToken } from '../auth/token-store'
import { jsonResponse, mfaChallengeResponse, mockFetch, sessionResponse } from '../test/http'
import { AUTH_PATHS, completeMfaLogin, isMfaChallenge, login } from './auth'

const CHALLENGE = mfaChallengeResponse()

describe('isMfaChallenge', () => {
  it('tells the challenge of the second step from a session', () => {
    expect(isMfaChallenge(CHALLENGE)).toBe(true)
    expect(isMfaChallenge(sessionResponse())).toBe(false)
    for (const value of [null, undefined, 'mfaRequired', 1, {}, { mfaRequired: false }, { mfaRequired: 'true' }]) {
      expect(isMfaChallenge(value)).toBe(false)
    }
  })
})

describe('login (API-005)', () => {
  beforeEach(() => {
    setAccessToken(null)
  })

  it('POSTs { identifier, password } without a bearer token and stores the access token of a session', async () => {
    setAccessToken('access-stale', 'user-0')
    const session = sessionResponse('access-1')
    const fetchMock = mockFetch(() => jsonResponse(200, session))

    await expect(login('admin', 'Secret123!')).resolves.toEqual(session)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/login')
    expect(url).toBe(AUTH_PATHS.login)
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    expect(JSON.parse(String(init?.body))).toEqual({ identifier: 'admin', password: 'Secret123!' })
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    expect(getAccessToken()).toBe('access-1')
    expect(getSessionUserId()).toBe('user-1')
  })

  it('returns the challenge of an account with two-step verification and stores no token: nobody is signed in yet', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, CHALLENGE))

    const result = await login('admin', 'Secret123!')

    expect(result).toEqual(CHALLENGE)
    expect(isMfaChallenge(result)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
    expect(getSessionUserId()).toBeNull()
    // The challenge is handed to the caller only — never persisted.
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it.each([
    [401, 'invalid_credentials'],
    [503, 'mfa_unavailable'],
  ])('rejects a %i %s without a session refresh and leaves no token behind', async (status, code) => {
    const fetchMock = mockFetch(() => jsonResponse(status, { statusCode: status, code }))

    await expect(login('admin', 'wrong')).rejects.toMatchObject({ status, code })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
  })
})

describe('completeMfaLogin (API-211)', () => {
  beforeEach(() => {
    setAccessToken(null)
  })

  it('POSTs { challenge, code } to the public route without a bearer token and stores the session’s access token', async () => {
    setAccessToken('access-stale', 'user-0')
    const session = sessionResponse('access-mfa', { id: 'user-7' })
    const fetchMock = mockFetch(() => jsonResponse(200, session))

    await expect(completeMfaLogin(CHALLENGE.challenge, { code: '123456' })).resolves.toEqual(session)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/login/mfa')
    expect(url).toBe(AUTH_PATHS.loginMfa)
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    expect(JSON.parse(String(init?.body))).toEqual({ challenge: CHALLENGE.challenge, code: '123456' })
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    expect(getAccessToken()).toBe('access-mfa')
    expect(getSessionUserId()).toBe('user-7')
  })

  it('sends a recovery code as { challenge, recoveryCode } — exactly one factor per request', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, sessionResponse('access-recovery')))

    await completeMfaLogin(CHALLENGE.challenge, { recoveryCode: 'ABCDE-FGHJK' })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(init?.body))).toEqual({ challenge: CHALLENGE.challenge, recoveryCode: 'ABCDE-FGHJK' })
    expect(getAccessToken()).toBe('access-recovery')
  })

  it.each([
    [401, 'mfa_code_invalid'],
    [401, 'mfa_challenge_invalid'],
    [423, 'account_locked'],
    [429, 'rate_limited'],
  ])('rejects a %i %s without a retry or a session refresh and stores nothing', async (status, code) => {
    const fetchMock = mockFetch(() => jsonResponse(status, { statusCode: status, code, retryAfterSeconds: 900 }))

    await expect(completeMfaLogin(CHALLENGE.challenge, { code: '000000' })).rejects.toMatchObject({ status, code })

    // One request: a 401 here is an answer about the code, never a reason to refresh the session.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
  })
})
