import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { confirmEmailVerification, requestEmailVerification } from './emailVerification'

const TOKEN = 'vrf_'.padEnd(43, 'z')

describe('e-mail verification API (API-165/166)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('asks for the confirmation e-mail as the signed-in user, with no body, and never gets a token back', async () => {
    const answer = { expiresAt: '2026-11-14T10:00:00.000Z', delivery: { transport: 'resend', status: 'sent' } }
    const fetchMock = mockFetch(() => jsonResponse(202, answer))

    await expect(requestEmailVerification()).resolves.toEqual(answer)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/account/email-verification/request')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
  })

  it('confirms on the public route: the token in the path only, no Authorization header and no refresh on 401', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, { emailVerifiedAt: '2026-11-12T10:00:00.000Z' }))

    await expect(confirmEmailVerification(TOKEN)).resolves.toEqual({ emailVerifiedAt: '2026-11-12T10:00:00.000Z' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`/api/account/email-verification/${TOKEN}/confirm`)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)

    const refused = mockFetch(() => jsonResponse(401, { statusCode: 401, code: 'token_expired' }))
    await expect(confirmEmailVerification(TOKEN)).rejects.toMatchObject({ status: 401 })
    expect(refused.mock.calls.map(([called]) => called)).toEqual([`/api/account/email-verification/${TOKEN}/confirm`])
  })

  it('rejects with the code of an expired link', async () => {
    mockFetch(() => jsonResponse(410, { statusCode: 410, code: 'verification_expired', expiredAt: '2026-11-10T10:00:00.000Z' }))
    await expect(confirmEmailVerification(TOKEN)).rejects.toMatchObject({ status: 410, code: 'verification_expired' })
  })
})
