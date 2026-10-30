import { beforeEach, describe, expect, it } from 'vitest'
import { getAccessToken, setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch, sessionResponse } from '../test/http'
import {
  ACCOUNT_PATHS,
  acceptInvitation,
  confirmPasswordReset,
  issueInvitation,
  issuePasswordReset,
  previewInvitation,
} from './account'
import type { InvitationPreview, IssuedLink } from './account'

const TOKEN = 'tok_'.padEnd(43, 'x')
const USER_ID = '0192f0a0-0000-7000-8000-000000000002'

const issued: IssuedLink = {
  userId: USER_ID,
  token: TOKEN,
  link: `/invite/${TOKEN}`,
  expiresAt: '2026-11-01T10:00:00.000Z',
  delivery: { transport: 'none', status: 'skipped' },
}

const preview: InvitationPreview = {
  fullName: 'عمر خالد',
  displayName: null,
  locale: 'ar',
  email: 'o***@test.local',
  username: null,
  roles: ['student'],
  expiresAt: '2026-11-01T10:00:00.000Z',
}

describe('ACCOUNT_PATHS', () => {
  it('builds the routes of API-015/016/017/019/020 and percent-encodes the path parameters', () => {
    expect(ACCOUNT_PATHS.issueInvitation(USER_ID)).toBe(`/api/users/${USER_ID}/invitations`)
    expect(ACCOUNT_PATHS.issuePasswordReset(USER_ID)).toBe(`/api/users/${USER_ID}/password-reset`)
    expect(ACCOUNT_PATHS.invitation(TOKEN)).toBe(`/api/account/invitations/${TOKEN}`)
    expect(ACCOUNT_PATHS.acceptInvitation(TOKEN)).toBe(`/api/account/invitations/${TOKEN}/accept`)
    expect(ACCOUNT_PATHS.confirmPasswordReset(TOKEN)).toBe(`/api/account/password-reset/${TOKEN}/confirm`)
    expect(ACCOUNT_PATHS.invitation('a/b?c')).toBe('/api/account/invitations/a%2Fb%3Fc')
  })
})

describe('account API calls', () => {
  beforeEach(() => {
    setAccessToken(null)
  })

  it('issueInvitation and issuePasswordReset POST with the bearer token and return the one-time link', async () => {
    setAccessToken('access-1')
    const fetchMock = mockFetch(() => jsonResponse(201, issued))

    await expect(issueInvitation(USER_ID)).resolves.toEqual(issued)
    await expect(issuePasswordReset(USER_ID)).resolves.toEqual(issued)

    const [[inviteUrl, inviteInit], [resetUrl, resetInit]] = fetchMock.mock.calls
    expect(inviteUrl).toBe(`/api/users/${USER_ID}/invitations`)
    expect(resetUrl).toBe(`/api/users/${USER_ID}/password-reset`)
    for (const init of [inviteInit, resetInit]) {
      expect(init?.method).toBe('POST')
      expect(init?.body).toBeUndefined()
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    }
  })

  it('previewInvitation GETs the public route without a bearer token even when one is held, and passes the signal', async () => {
    setAccessToken('access-1')
    const fetchMock = mockFetch(() => jsonResponse(200, preview))
    const controller = new AbortController()

    await expect(previewInvitation(TOKEN, controller.signal)).resolves.toEqual(preview)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/account/invitations/${TOKEN}`)
    expect(init?.method).toBe('GET')
    expect(init?.signal).toBe(controller.signal)
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
  })

  it('acceptInvitation POSTs { password } without a bearer token and stores the returned access token', async () => {
    const session = sessionResponse('access-new')
    const fetchMock = mockFetch(() => jsonResponse(200, session))

    await expect(acceptInvitation(TOKEN, 'Secret123!x')).resolves.toEqual(session)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/account/invitations/${TOKEN}/accept`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ password: 'Secret123!x' })
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    expect(getAccessToken()).toBe('access-new')
  })

  it('confirmPasswordReset POSTs { newPassword } the same way', async () => {
    const session = sessionResponse('access-reset')
    const fetchMock = mockFetch(() => jsonResponse(200, session))

    await expect(confirmPasswordReset(TOKEN, 'Another123!')).resolves.toEqual(session)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/account/password-reset/${TOKEN}/confirm`)
    expect(JSON.parse(String(init?.body))).toEqual({ newPassword: 'Another123!' })
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    expect(getAccessToken()).toBe('access-reset')
  })

  it('a rejected accept never triggers a session refresh and leaves no access token behind', async () => {
    const fetchMock = mockFetch(() => jsonResponse(410, { statusCode: 410, code: 'invitation_expired' }))

    await expect(acceptInvitation(TOKEN, 'Secret123!x')).rejects.toMatchObject({ status: 410, code: 'invitation_expired' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
  })
})
