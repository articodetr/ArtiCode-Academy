// The profile's e-mail confirmation action (LR-01-T02, API-165).
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AuthUser } from '../auth/auth-context'
import { setAccessToken } from '../auth/token-store'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import type { FetchHandler } from '../test/http'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeUserDetail } from '../test/users'
import { formatDateTime } from '../users/users.format'
import { ProfilePage } from './ProfilePage'

const STUDENT: Partial<AuthUser> = {
  id: 'user-st',
  email: 'st@test.local',
  role: 'student',
  roles: ['student'],
  permissions: ['courses.read'],
}

function renderProfile(user: Partial<AuthUser>, handler: FetchHandler) {
  const calls: string[] = []
  mockFetch((url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    return handler(url, init)
  })
  renderWithProviders(<ProfilePage />, { auth: makeAuth({ user: makeUser(user) }), route: '/profile', routes: { '/login': <LocationProbe /> } })
  return calls
}

function identity(): HTMLElement {
  const card = screen.getByText(ar.profile.identity).closest<HTMLElement>('.ant-card')
  if (!card) throw new Error('No identity card')
  return card
}

async function sendButton(): Promise<HTMLElement> {
  const button = (await within(identity()).findByText(ar.emailVerification.request.button)).closest<HTMLElement>('button')
  if (!button) throw new Error('No send button')
  return button
}

const SENT = { expiresAt: '2026-11-16T10:00:00.000Z', delivery: { transport: 'resend', status: 'sent' } }

describe('ProfilePage — e-mail confirmation', () => {
  beforeEach(() => setAccessToken(null))

  it('reads its own detail with users.read + users.read_contact and shows the confirmed date without the action', async () => {
    const calls = renderProfile({}, (url) =>
      url === '/api/users/user-1'
        ? jsonResponse(200, makeUserDetail({ id: 'user-1', email: 'admin@test.local', emailVerifiedAt: '2026-11-10T08:00:00.000Z' }))
        : jsonResponse(404),
    )

    expect(await within(identity()).findByText(ar.emailVerification.status.label)).toBeInTheDocument()
    expect(within(identity()).getByText(/^مؤكَّد منذ /)).toBeInTheDocument()
    expect(within(identity()).queryByText(ar.emailVerification.request.button)).not.toBeInTheDocument()
    expect(calls).toEqual(['GET /api/users/user-1'])
  })

  it('shows the unconfirmed state and sends API-165 on demand, naming the address', async () => {
    const calls = renderProfile({}, (url) => {
      if (url === '/api/users/user-1') return jsonResponse(200, makeUserDetail({ id: 'user-1', email: 'admin@test.local', emailVerifiedAt: null }))
      if (url === '/api/account/email-verification/request') return jsonResponse(202, SENT)
      return jsonResponse(404)
    })

    await userEvent.click(await sendButton())

    expect(within(identity()).getByText(ar.emailVerification.status.unverified)).toBeInTheDocument()
    const alert = await within(identity()).findByRole('alert')
    expect(alert).toHaveTextContent(
      i18n.t('emailVerification.request.sent', { email: 'admin@test.local', expiresAt: formatDateTime(SENT.expiresAt, 'ar') }),
    )
    expect(calls).toEqual(['GET /api/users/user-1', 'POST /api/account/email-verification/request'])
  })

  it('cannot know the state without the contact keys: offers the action and reads no detail', async () => {
    const calls = renderProfile(STUDENT, (url) =>
      url === '/api/account/email-verification/request' ? jsonResponse(202, SENT) : jsonResponse(404),
    )

    expect(within(identity()).getByText(ar.emailVerification.request.hintUnknown)).toBeInTheDocument()
    await userEvent.click(await sendButton())
    expect(await within(identity()).findByRole('alert')).toHaveTextContent('st@test.local')
    expect(calls).toEqual(['POST /api/account/email-verification/request'])
  })

  it('says the address is already confirmed on 409 and drops the action', async () => {
    renderProfile(STUDENT, () =>
      jsonResponse(409, { statusCode: 409, code: 'email_already_verified', emailVerifiedAt: '2026-11-10T08:00:00.000Z' }),
    )

    await userEvent.click(await sendButton())

    expect(await within(identity()).findByRole('alert')).toHaveTextContent(ar.emailVerification.errors.email_already_verified)
    expect(within(identity()).getByText(ar.emailVerification.status.confirmed)).toBeInTheDocument()
    expect(within(identity()).queryByText(ar.emailVerification.request.button)).not.toBeInTheDocument()
  })

  it.each([
    [503, 'mail_unavailable'],
    [422, 'email_missing'],
    [429, 'rate_limited'],
  ] as const)('words the %i %s refusal and keeps the action', async (status, code) => {
    renderProfile(STUDENT, () => jsonResponse(status, { statusCode: status, code }))

    await userEvent.click(await sendButton())

    expect(await within(identity()).findByRole('alert')).toHaveTextContent(ar.emailVerification.errors[code])
    expect(within(identity()).getByText(ar.emailVerification.request.button)).toBeInTheDocument()
  })

  it('reports a failed delivery instead of claiming the e-mail is on its way', async () => {
    renderProfile(STUDENT, () => jsonResponse(202, { ...SENT, delivery: { transport: 'resend', status: 'failed' } }))

    await userEvent.click(await sendButton())

    expect(await within(identity()).findByRole('alert')).toHaveTextContent(ar.emailVerification.request.deliveryFailed)
  })

  it('shows nothing for an account without an e-mail address and asks nothing', async () => {
    const calls = renderProfile({ email: null }, () => jsonResponse(404))

    await act(async () => {})
    expect(within(identity()).queryByText(ar.emailVerification.status.label)).not.toBeInTheDocument()
    expect(calls).toEqual([])
  })
})
