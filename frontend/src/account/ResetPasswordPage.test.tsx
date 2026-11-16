import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { AuthContextValue } from '../auth/auth-context'
import { ar } from '../i18n/ar'
import { jsonResponse, mfaChallengeResponse, mockFetch, sessionResponse } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
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
    // An account without two-step verification never sees the second step.
    expect(auth.completeMfaLogin).not.toHaveBeenCalled()

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

  describe('an account with two-step verification (API-020 answers a challenge)', () => {
    const mfa = ar.login.mfa

    /** Confirms the new password; the server changes it and answers the challenge of the second step. */
    async function reachSecondStep(auth: AuthContextValue = makeAuth()) {
      const challenge = mfaChallengeResponse()
      const fetchMock = mockFetch(() => jsonResponse(200, challenge))
      renderPage(TOKEN, auth)
      await chooseAndSubmit()
      const code = await screen.findByLabelText(mfa.code)
      return { auth, challenge, fetchMock, code }
    }

    it('says the password was changed, asks for the code and signs in through the second step', async () => {
      const auth = makeAuth()
      vi.mocked(auth.completeMfaLogin).mockResolvedValue(makeUser())
      const { challenge, fetchMock, code } = await reachSecondStep(auth)

      // The password is changed, but there is no session yet: nothing to adopt, nowhere to go.
      expect(screen.getByText(mfa.passwordChanged)).toBeInTheDocument()
      expect(screen.getByText(mfa.subtitle)).toBeInTheDocument()
      expect(auth.adoptSession).not.toHaveBeenCalled()
      expect(screen.queryByTestId('location')).not.toBeInTheDocument()
      expect(screen.queryByLabelText(ar.account.password)).not.toBeInTheDocument()
      expect(document.body.innerHTML).not.toContain(PASSWORD)

      await userEvent.type(code, '123456{Enter}')

      await waitFor(() => expect(auth.completeMfaLogin).toHaveBeenCalledWith(challenge.challenge, { code: '123456' }))
      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
      // The reset token was sent once, to its own route; the second step is the auth context's business.
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe(`/api/account/password-reset/${TOKEN}/confirm`)
      expect(auth.adoptSession).not.toHaveBeenCalled()
    })

    it('sends a user who must change the password to the profile page after the second step', async () => {
      const auth = makeAuth()
      vi.mocked(auth.completeMfaLogin).mockResolvedValue(makeUser({ mustChangePassword: true }))
      const { code } = await reachSecondStep(auth)

      await userEvent.type(code, '123456{Enter}')

      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/profile')
    })

    it('keeps the step after a wrong code — the used reset link is never asked again', async () => {
      const auth = makeAuth()
      vi.mocked(auth.completeMfaLogin).mockRejectedValue(
        new ApiError(401, 'refused', { statusCode: 401, code: 'mfa_code_invalid' }),
      )
      const { fetchMock, code } = await reachSecondStep(auth)

      await userEvent.type(code, '111111{Enter}')

      expect(await screen.findByText(mfa.errors.code_invalid)).toBeInTheDocument()
      expect(screen.getByText(mfa.passwordChanged)).toBeInTheDocument()
      expect(screen.queryByTestId('location')).not.toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('goes to the sign-in page, saying the password was changed, when the visitor leaves the step', async () => {
      await reachSecondStep()

      await userEvent.click(screen.getByText(mfa.backToSignIn))

      const location = await screen.findByTestId('location')
      expect(location).toHaveAttribute('data-pathname', '/login')
      expect(JSON.parse(location.getAttribute('data-state') ?? 'null')).toEqual({ notice: 'password_changed' })
    })

    it('says the password was changed when the server cannot offer the second step (503 mfa_unavailable), without the form', async () => {
      // The server answers 503 AFTER the reset committed: the link is used up and the new password stands.
      const fetchMock = mockFetch(() => jsonResponse(503, { statusCode: 503, code: 'mfa_unavailable' }))
      const { auth } = renderPage()

      await chooseAndSubmit()

      expect(await screen.findByRole('alert')).toHaveTextContent(mfa.passwordChangedUnavailable)
      expect(screen.queryByLabelText(ar.account.password)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(mfa.code)).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: ar.account.goToLogin })).toBeInTheDocument()
      expect(auth.adoptSession).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('goes to the sign-in page with the reason when the challenge expired or was used', async () => {
      const auth = makeAuth()
      vi.mocked(auth.completeMfaLogin).mockRejectedValue(
        new ApiError(401, 'refused', { statusCode: 401, code: 'mfa_challenge_invalid' }),
      )
      const { code } = await reachSecondStep(auth)

      await userEvent.type(code, '123456{Enter}')

      const location = await screen.findByTestId('location')
      expect(location).toHaveAttribute('data-pathname', '/login')
      expect(JSON.parse(location.getAttribute('data-state') ?? 'null')).toEqual({ notice: 'password_changed_step_ended' })
    })
  })

  it('treats a malformed token as an invalid link without a form or a request', () => {
    const fetchMock = mockFetch(() => jsonResponse(500))
    renderPage('short')

    expect(screen.getByRole('alert')).toHaveTextContent(ar.account.errors.reset_invalid)
    expect(screen.queryByLabelText(ar.account.password)).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
