import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { ApiError } from './client'
import { MFA_PATHS, disableMfa, enableMfa, getMfaStatus, regenerateRecoveryCodes, setupMfa } from './mfa'
import type { MfaEnabled, MfaSetup, MfaStatus } from './mfa'

const STATUS: MfaStatus = { available: true, enabled: true, enabledAt: '2026-11-16T09:30:00.000Z', recoveryCodesLeft: 10, pendingSetup: false }
const SETUP: MfaSetup = {
  secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  otpauthUri: 'otpauth://totp/Arti%20Academy:sara%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Arti%20Academy',
  expiresAt: '2026-11-16T09:40:00.000Z',
}
const ENABLED: MfaEnabled = { enabledAt: '2026-11-16T09:31:12.000Z', recoveryCodes: ['K7QX4-M9TRB', 'P3ZWN-8HDCA'], revokedSessions: 1 }

function bodyOf(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
}

describe('MFA_PATHS', () => {
  it('names the five routes of API-206..API-210 under /api/auth/mfa', () => {
    expect(MFA_PATHS).toEqual({
      status: '/api/auth/mfa',
      setup: '/api/auth/mfa/setup',
      enable: '/api/auth/mfa/enable',
      disable: '/api/auth/mfa/disable',
      recoveryCodes: '/api/auth/mfa/recovery-codes',
    })
  })
})

describe('two-step verification API calls', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('getMfaStatus GETs the status with the bearer token, the cookie and the abort signal', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, STATUS))
    const controller = new AbortController()

    await expect(getMfaStatus(controller.signal)).resolves.toEqual(STATUS)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/auth/mfa')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
    expect(init?.signal).toBe(controller.signal)
    expect(init?.credentials).toBe('include')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
  })

  it('setupMfa POSTs the password alone and returns the one-time secret', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, SETUP))

    await expect(setupMfa('current-pass-1')).resolves.toEqual(SETUP)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/auth/mfa/setup')
    expect(init?.method).toBe('POST')
    expect(bodyOf(init)).toEqual({ password: 'current-pass-1' })
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
  })

  it('enableMfa POSTs the code alone and returns the recovery codes', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, ENABLED))

    await expect(enableMfa('492039')).resolves.toEqual(ENABLED)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/auth/mfa/enable')
    expect(init?.method).toBe('POST')
    expect(bodyOf(init)).toEqual({ code: '492039' })
  })

  it('disableMfa POSTs the password with exactly one factor: a code or a recovery code', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, { revokedSessions: 2 }))

    await expect(disableMfa({ password: 'current-pass-1', code: '492039' })).resolves.toEqual({ revokedSessions: 2 })
    await expect(disableMfa({ password: 'current-pass-1', recoveryCode: 'K7QX4-M9TRB' })).resolves.toEqual({ revokedSessions: 2 })

    const [[codeUrl, codeInit], [recoveryUrl, recoveryInit]] = fetchMock.mock.calls
    expect(codeUrl).toBe('/api/auth/mfa/disable')
    expect(recoveryUrl).toBe('/api/auth/mfa/disable')
    expect(codeInit?.method).toBe('POST')
    expect(bodyOf(codeInit)).toEqual({ password: 'current-pass-1', code: '492039' })
    expect(bodyOf(recoveryInit)).toEqual({ password: 'current-pass-1', recoveryCode: 'K7QX4-M9TRB' })
  })

  it('regenerateRecoveryCodes POSTs the password and a code', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, { recoveryCodes: ENABLED.recoveryCodes }))

    await expect(regenerateRecoveryCodes('current-pass-1', '492039')).resolves.toEqual({ recoveryCodes: ENABLED.recoveryCodes })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/auth/mfa/recovery-codes')
    expect(init?.method).toBe('POST')
    expect(bodyOf(init)).toEqual({ password: 'current-pass-1', code: '492039' })
  })

  it('hands a refusal over as an ApiError with the server code, without a second request', async () => {
    const fetchMock = mockFetch(() => jsonResponse(400, { statusCode: 400, code: 'mfa_code_invalid', message: 'The verification code is not valid' }))

    const failure = await enableMfa('000000').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).status).toBe(400)
    expect((failure as ApiError).code).toBe('mfa_code_invalid')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
