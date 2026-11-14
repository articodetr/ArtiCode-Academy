import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { AuthContextValue } from '../auth/auth-context'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { VerifyEmailPage } from './VerifyEmailPage'

const TOKEN = 'evf_'.padEnd(43, 'z')

function renderPage(token = TOKEN, auth: AuthContextValue = makeAuth()) {
  return renderWithProviders(<VerifyEmailPage />, {
    auth,
    route: `/verify-email/${token}`,
    path: '/verify-email/:token',
    routes: { '/': <LocationProbe />, '/login': <LocationProbe /> },
  })
}

function confirmButton(): HTMLElement {
  const button = screen.getByText(ar.emailVerification.page.confirm).closest<HTMLElement>('button')
  if (!button) throw new Error('No confirm button')
  return button
}

describe('VerifyEmailPage', () => {
  it('sends nothing on load — only the button confirms the token, on the public route without a bearer', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, { emailVerifiedAt: '2026-11-14T09:00:00.000Z' }))
    renderPage()

    expect(screen.getByText(ar.emailVerification.page.intro)).toBeInTheDocument()
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()

    await userEvent.click(confirmButton())

    expect(await screen.findByText(ar.emailVerification.page.success)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/account/email-verification/${TOKEN}/confirm`)
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    expect(screen.getByRole('link', { name: ar.account.goToLogin })).toHaveAttribute('href', '/login')
    expect(screen.queryByText(ar.emailVerification.page.confirm)).not.toBeInTheDocument()
  })

  it('offers the way into the app instead of the sign-in when the visitor is signed in', async () => {
    mockFetch(() => jsonResponse(200, { emailVerifiedAt: '2026-11-14T09:00:00.000Z' }))
    renderPage(TOKEN, makeAuth({ user: makeUser() }))

    await userEvent.click(confirmButton())

    expect(await screen.findByRole('link', { name: ar.emailVerification.page.goToApp })).toHaveAttribute('href', '/')
  })

  it.each([
    [404, 'verification_invalid'],
    [410, 'verification_expired'],
  ] as const)('replaces the button with the %i %s verdict and the way to the login page', async (status, code) => {
    mockFetch(() => jsonResponse(status, { statusCode: status, code }))
    renderPage()

    await userEvent.click(confirmButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(ar.emailVerification.errors[code])
    expect(screen.queryByText(ar.emailVerification.page.confirm)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: ar.account.goToLogin })).toBeInTheDocument()
  })

  it('keeps the button after a passing failure (rate limit) so the person can try again', async () => {
    const answers = [
      jsonResponse(429, { statusCode: 429, code: 'rate_limited' }),
      jsonResponse(200, { emailVerifiedAt: '2026-11-14T09:00:00.000Z' }),
    ]
    const fetchMock = mockFetch(() => answers.shift() ?? jsonResponse(500))
    renderPage()

    await userEvent.click(confirmButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(ar.login.errors.rate_limited)

    await userEvent.click(confirmButton())
    expect(await screen.findByText(ar.emailVerification.page.success)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats a malformed token as an invalid link without a button or a request', async () => {
    const fetchMock = mockFetch(() => jsonResponse(500))
    renderPage('short')

    expect(screen.getByRole('alert')).toHaveTextContent(ar.emailVerification.errors.verification_invalid)
    expect(screen.queryByText(ar.emailVerification.page.confirm)).not.toBeInTheDocument()
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
