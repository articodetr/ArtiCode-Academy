import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken, getSessionUserId, setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch, sessionResponse } from '../test/http'
import { getPublicAcademy, isSelfRegistrationOpen } from './academy'
import { ApiError } from './client'
import { REGISTRATION_PATHS, completeRegistration, getRegistrationLink, register } from './registration'

const TOKEN = 'reg_'.padEnd(43, 'x')

function onlyCall(fetchMock: ReturnType<typeof mockFetch>) {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0]!
  return { url: String(url), init, headers: new Headers(init?.headers) }
}

describe('REGISTRATION_PATHS', () => {
  it('builds the three public routes and percent-encodes the token', () => {
    expect(REGISTRATION_PATHS.register).toBe('/api/account/register')
    expect(REGISTRATION_PATHS.link(TOKEN)).toBe(`/api/account/register/${TOKEN}`)
    expect(REGISTRATION_PATHS.complete(TOKEN)).toBe(`/api/account/register/${TOKEN}/complete`)
    expect(REGISTRATION_PATHS.link('a/b?c')).toBe('/api/account/register/a%2Fb%3Fc')
    expect(REGISTRATION_PATHS.complete('a/b')).toBe('/api/account/register/a%2Fb/complete')
  })
})

describe('the registration requests', () => {
  beforeEach(() => setAccessToken('access-of-somebody', 'user-1'))
  afterEach(() => setAccessToken(null))

  it('register posts exactly the input, the password as typed, without a bearer token, and stores the access token of the session it hands back', async () => {
    const session = sessionResponse('access-of-sara', { id: 'user-sara', roles: ['student'], permissions: [] })
    const fetchMock = mockFetch(() => jsonResponse(201, session))
    const input = { fullName: 'سارة علي', email: 's@example.test', password: ' Secret123!x ', locale: 'ar' as const }
    await expect(register(input)).resolves.toEqual(session)

    const { url, init, headers } = onlyCall(fetchMock)
    expect(url).toBe('/api/account/register')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ fullName: 'سارة علي', email: 's@example.test', password: ' Secret123!x ', locale: 'ar' })
    expect(headers.has('Authorization')).toBe(false)
    expect(getAccessToken()).toBe('access-of-sara')
    expect(getSessionUserId()).toBe('user-sara')
  })

  it('register sends no other field, even when one is handed in, and no locale when none is given', async () => {
    const fetchMock = mockFetch(() => jsonResponse(201, sessionResponse()))
    const sneaky = { fullName: 'سارة', email: 's@example.test', password: 'Secret123!x', roleKeys: ['academy_admin'], confirmPassword: 'x' }
    await register(sneaky as unknown as Parameters<typeof register>[0])
    expect(JSON.parse(String(onlyCall(fetchMock).init?.body))).toEqual({ fullName: 'سارة', email: 's@example.test', password: 'Secret123!x' })
  })

  it('register keeps the stored token on a refusal, and carries the code of an address that already has an account', async () => {
    mockFetch(() => jsonResponse(409, { statusCode: 409, code: 'email_in_use', field: 'email' }))
    await expect(register({ fullName: 'سارة', email: 's@example.test', password: 'Secret123!x' })).rejects.toMatchObject({
      status: 409,
      code: 'email_in_use',
    })
    expect(getAccessToken()).toBe('access-of-somebody')
  })

  it('getRegistrationLink reads the preview on its own route, without a bearer token', async () => {
    const preview = { fullName: 'سارة علي', maskedEmail: 's***@example.test', expiresAt: '2026-11-26T10:00:00.000Z' }
    const fetchMock = mockFetch(() => jsonResponse(200, preview))
    await expect(getRegistrationLink(TOKEN)).resolves.toEqual(preview)

    const { url, init, headers } = onlyCall(fetchMock)
    expect(url).toBe(`/api/account/register/${TOKEN}`)
    expect(init?.method).toBe('GET')
    expect(headers.has('Authorization')).toBe(false)
  })

  it('completeRegistration posts the password alone, and stores the access token of the session it hands back', async () => {
    const session = sessionResponse('access-of-sara', { id: 'user-sara', roles: ['student'], permissions: [] })
    const fetchMock = mockFetch(() => jsonResponse(200, session))
    await expect(completeRegistration(TOKEN, { password: 'Secret123!x' })).resolves.toEqual(session)

    const { url, init, headers } = onlyCall(fetchMock)
    expect(url).toBe(`/api/account/register/${TOKEN}/complete`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ password: 'Secret123!x' })
    expect(headers.has('Authorization')).toBe(false)
    expect(getAccessToken()).toBe('access-of-sara')
    expect(getSessionUserId()).toBe('user-sara')
  })

  it('completeRegistration sends no other field, even when one is handed in', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, sessionResponse()))
    const sneaky = { password: 'Secret123!x', fullName: 'سارة', roleKeys: ['academy_admin'] } as unknown as { password: string }
    await completeRegistration(TOKEN, sneaky)
    expect(JSON.parse(String(onlyCall(fetchMock).init?.body))).toEqual({ password: 'Secret123!x' })
  })

  it('completeRegistration keeps the stored token on a refusal, and carries the attempts left', async () => {
    mockFetch(() => jsonResponse(400, { statusCode: 400, code: 'registration_password_incorrect', attemptsLeft: 3 }))
    await expect(completeRegistration(TOKEN, { password: 'Wrong123!x' })).rejects.toMatchObject({
      status: 400,
      code: 'registration_password_incorrect',
      body: expect.objectContaining({ attemptsLeft: 3 }),
    })
    expect(getAccessToken()).toBe('access-of-somebody')
  })

  it('never tries a session refresh on a 401, and carries the code of a refusal', async () => {
    const fetchMock = mockFetch(() => jsonResponse(401, { statusCode: 401, code: 'token_expired' }))
    await expect(register({ fullName: 'سارة', email: 's@example.test', password: 'Secret123!x' })).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockImplementation(async () => jsonResponse(410, { statusCode: 410, code: 'registration_link_expired' }))
    await expect(getRegistrationLink(TOKEN)).rejects.toMatchObject({ status: 410, code: 'registration_link_expired' })
  })

  it('reads how long to wait from the register_ip throttler header', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ statusCode: 429, code: 'rate_limited' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After-register_ip': '180' },
        }),
    )
    await expect(register({ fullName: 'سارة', email: 's@example.test', password: 'Secret123!x' })).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 180,
    })
  })
})

describe('isSelfRegistrationOpen', () => {
  it('is open only for an explicit true', () => {
    expect(isSelfRegistrationOpen({ selfRegistration: true })).toBe(true)
    for (const academy of [{ selfRegistration: false }, {}, null, undefined]) {
      expect(isSelfRegistrationOpen(academy)).toBe(false)
    }
    expect(isSelfRegistrationOpen({ selfRegistration: 'true' as unknown as boolean })).toBe(false)
    expect(isSelfRegistrationOpen({ selfRegistration: 1 as unknown as boolean })).toBe(false)
  })

  it('reads a server that sends no field as closed', async () => {
    vi.unstubAllGlobals()
    mockFetch(() => jsonResponse(200, { name: { ar: 'الأكاديمية' }, logoUrl: null, defaultLocale: 'ar' }))
    expect(isSelfRegistrationOpen(await getPublicAcademy())).toBe(false)
  })
})
