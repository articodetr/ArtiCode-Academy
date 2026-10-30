import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AuthContextValue } from '../auth/auth-context'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch, sessionResponse } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, renderWithProviders } from '../test/render'
import { ResetPasswordPage } from './ResetPasswordPage'

const TOKEN = 'rst_'.padEnd(43, 'y')
const PASSWORD = 'Another123!'

function renderPage(token = TOKEN, auth: AuthContextValue = makeAuth()) {
  const utils = renderWithProviders(<ResetPasswordPage />, {
    auth,
    route: `/reset-password/${token}`,
    path: '/reset-password/:token',
    routes: { '/': <LocationProbe />, '/profile': <LocationProbe />, '/login': <LocationProbe /> },
  })
  return { ...utils, auth }
}

async function chooseAndSubmit(password = PASSWORD) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(ar.account.password), password)
  await user.type(screen.getByLabelText(ar.account.confirmPassword), password)
  await user.click(screen.getByRole('button', { name: ar.account.reset.submit }))
}

describe('ResetPasswordPage', () => {
  it('shows the form at once, confirms the new password on the public route and lands on / signed in', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, sessionResponse('access-reset')))
    const { auth } = renderPage()

    expect(screen.getByText(ar.account.reset.intro)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    await chooseAndSubmit()

    await waitFor(() => expect(auth.adoptSession).toHaveBeenCalledTimes(1))
    expect(vi.mocked(auth.adoptSession).mock.calls[0][0]).toMatchObject({ accessToken: 'access-reset' })
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/account/password-reset/${TOKEN}/confirm`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ newPassword: PASSWORD })
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
  })

  it.each([
    [410, 'reset_expired'],
    [404, 'reset_invalid'],
  ])('replaces the form with the %i %s verdict and the way to the login page', async (status, code) => {
    mockFetch(() => jsonResponse(status, { statusCode: status, code }))
    const { auth } = renderPage()

    await chooseAndSubmit()

    expect(await screen.findByRole('alert')).toHaveTextContent(ar.account.errors[code as keyof typeof ar.account.errors])
    expect(screen.queryByLabelText(ar.account.password)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: ar.account.goToLogin })).toBeInTheDocument()
    expect(auth.adoptSession).not.toHaveBeenCalled()
  })

  it('keeps the form when the server refuses the current password again', async () => {
    mockFetch(() =>
      jsonResponse(400, { statusCode: 400, code: 'password_weak', problems: ['different from the current password'] }),
    )
    renderPage()

    await chooseAndSubmit()

    expect(await screen.findByRole('alert')).toHaveTextContent(ar.account.errors.password_same)
    expect(screen.getByLabelText(ar.account.password)).toBeInTheDocument()
  })

  it('treats a malformed token as an invalid link without a form or a request', () => {
    const fetchMock = mockFetch(() => jsonResponse(500))
    renderPage('short')

    expect(screen.getByRole('alert')).toHaveTextContent(ar.account.errors.reset_invalid)
    expect(screen.queryByLabelText(ar.account.password)).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
