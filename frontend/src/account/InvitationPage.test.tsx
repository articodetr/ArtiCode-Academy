import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InvitationPreview } from '../api/account'
import type { AuthContextValue } from '../auth/auth-context'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import { jsonResponse, mockFetch, sessionResponse } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, renderWithProviders } from '../test/render'
import { InvitationPage } from './InvitationPage'

const TOKEN = 'inv_'.padEnd(43, 'x')
const PASSWORD = 'Secret123!x'

function makePreview(overrides: Partial<InvitationPreview> = {}): InvitationPreview {
  return {
    fullName: 'عمر خالد',
    displayName: null,
    locale: 'ar',
    email: 'o***@test.local',
    username: null,
    roles: ['student'],
    expiresAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  }
}

/** GET preview → `preview`; POST accept → `accept`. Records every call. */
function mockAccountApi(preview: InvitationPreview | Response = makePreview(), accept: Response = jsonResponse(200, sessionResponse('access-new'))) {
  return mockFetch((url, init) => {
    if ((init?.method ?? 'GET') === 'POST') return accept
    if (preview instanceof Response) return preview
    return url.endsWith(`/api/account/invitations/${TOKEN}`) ? jsonResponse(200, preview) : jsonResponse(404, { code: 'invitation_invalid' })
  })
}

function renderPage(token = TOKEN, auth: AuthContextValue = makeAuth()) {
  const utils = renderWithProviders(<InvitationPage />, {
    auth,
    route: `/invite/${token}`,
    path: '/invite/:token',
    routes: { '/': <LocationProbe />, '/profile': <LocationProbe />, '/login': <LocationProbe /> },
  })
  return { ...utils, auth }
}

async function chooseAndSubmit(password = PASSWORD, confirmation = password) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText(ar.account.password), password)
  await user.type(screen.getByLabelText(ar.account.confirmPassword), confirmation)
  await user.click(screen.getByRole('button', { name: ar.account.invitation.submit }))
}

function storedValues(): string[] {
  const values: string[] = []
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key !== null) values.push(key, storage.getItem(key) ?? '')
    }
  }
  return values
}

describe('InvitationPage', () => {
  afterEach(async () => {
    await i18n.changeLanguage('ar')
  })

  it('previews the invitation (name, masked e-mail, roles, expiry), accepts it with the chosen password and lands on / signed in', async () => {
    const fetchMock = mockAccountApi()
    const { auth } = renderPage()

    expect(await screen.findByText('عمر خالد')).toBeInTheDocument()
    expect(screen.getByText('o***@test.local')).toBeInTheDocument()
    expect(screen.getByText(ar.roles.student)).toBeInTheDocument()
    expect(screen.getByText(ar.account.invitation.expiresAt)).toBeInTheDocument()
    expect(screen.queryByText(ar.account.invitation.username)).not.toBeInTheDocument()

    await chooseAndSubmit()

    await waitFor(() => expect(auth.adoptSession).toHaveBeenCalledTimes(1))
    expect(vi.mocked(auth.adoptSession).mock.calls[0][0]).toMatchObject({ accessToken: 'access-new' })
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')

    // The token travelled only to its own public route, without a bearer token, and was never stored.
    const calls = fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init }))
    expect(calls.map((call) => call.url)).toEqual([`/api/account/invitations/${TOKEN}`, `/api/account/invitations/${TOKEN}/accept`])
    for (const call of calls) expect(new Headers(call.init?.headers).has('Authorization')).toBe(false)
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ password: PASSWORD })
    expect(storedValues().some((value) => value.includes(TOKEN))).toBe(false)
  })

  it('sends a user who must change the password to the profile page instead', async () => {
    mockAccountApi(makePreview(), jsonResponse(200, sessionResponse('access-new', { mustChangePassword: true })))
    renderPage()

    await chooseAndSubmit()

    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/profile')
  })

  it.each([
    [410, 'invitation_expired'],
    [409, 'invitation_consumed'],
    [404, 'invitation_invalid'],
  ])('shows the %i %s verdict of the preview without a form, with the way to the login page', async (status, code) => {
    mockAccountApi(jsonResponse(status, { statusCode: status, code }))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(ar.account.errors[code as keyof typeof ar.account.errors])
    expect(screen.queryByLabelText(ar.account.password)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: ar.account.goToLogin }))
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/login')
  })

  it('treats a malformed token as an invalid link without asking the server', () => {
    const fetchMock = mockAccountApi()
    renderPage('not-a-token')

    expect(screen.getByRole('alert')).toHaveTextContent(ar.account.errors.invitation_invalid)
    expect(screen.queryByLabelText(ar.account.password)).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the form with the policy message on password_weak, and replaces it when the accept finds the link dead', async () => {
    const fetchMock = mockAccountApi(
      makePreview(),
      jsonResponse(400, { statusCode: 400, code: 'password_weak', problems: ['at least 10 characters'] }),
    )
    const { auth } = renderPage()

    await chooseAndSubmit()
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('account.errors.password_weak', { min: 10 }))
    expect(screen.getByLabelText(ar.account.password)).toBeInTheDocument()
    expect(auth.adoptSession).not.toHaveBeenCalled()

    fetchMock.mockImplementation(async () => jsonResponse(409, { statusCode: 409, code: 'invitation_consumed' }))
    await userEvent.click(screen.getByRole('button', { name: ar.account.invitation.submit }))
    expect(await screen.findByText(ar.account.errors.invitation_consumed)).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.account.password)).not.toBeInTheDocument()
  })

  it('refuses a confirmation that differs from the password before calling the server', async () => {
    const fetchMock = mockAccountApi()
    renderPage()

    await chooseAndSubmit(PASSWORD, 'Different123!')

    expect(await screen.findByText(ar.account.validation.mismatch)).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  })

  it('offers a retry when the preview fails for a reason that is not the link itself', async () => {
    const fetchMock = mockAccountApi(jsonResponse(503, { statusCode: 503 }))
    renderPage()

    expect(await screen.findByText(ar.account.invitation.loadFailed)).toBeInTheDocument()
    expect(screen.getByText(ar.login.errors.server)).toBeInTheDocument()

    fetchMock.mockImplementation(async () => jsonResponse(200, makePreview()))
    await userEvent.click(screen.getByRole('button', { name: ar.account.invitation.retry }))
    expect(await screen.findByText('عمر خالد')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('renders left-to-right in English with the translated texts', async () => {
    mockAccountApi()
    renderPage()
    await act(async () => {
      await i18n.changeLanguage('en')
    })

    expect(document.documentElement).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText(en.account.invitation.subtitle)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: en.account.invitation.submit })).toBeInTheDocument()
  })
})
