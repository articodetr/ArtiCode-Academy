import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { mfaChallengeResponse } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import type { AuthContextValue } from '../auth/auth-context'
import { LoginPage } from './LoginPage'

/** Mounts the page at /login; every other path renders the location probe. `extra` joins the router state as it is. */
function renderLogin(auth: AuthContextValue = makeAuth(), from?: string, notice?: string, extra: Record<string, unknown> = {}) {
  const state = from || notice ? { ...(from ? { from } : {}), ...(notice ? { notice } : {}), ...extra } : null
  return renderWithProviders(<LoginPage />, {
    auth,
    route: { pathname: '/login', state },
    routes: { '*': <LocationProbe /> },
  })
}

function fields() {
  return {
    identifier: screen.getByLabelText(ar.login.identifier),
    password: screen.getByLabelText(ar.login.password),
    submit: screen.getByRole('button', { name: ar.login.submit }),
  }
}

async function submitCredentials(identifier = 'admin', password = 'Secret123!') {
  const user = userEvent.setup()
  await user.type(fields().identifier, identifier)
  await user.type(fields().password, password)
  await user.click(fields().submit)
}

describe('LoginPage', () => {
  it('renders the sign-in form in Arabic (RTL) by default', () => {
    renderLogin()
    expect(screen.getByText(ar.common.appName)).toBeInTheDocument()
    const { identifier, password, submit } = fields()
    expect(identifier).toHaveAttribute('autocomplete', 'username')
    expect(password).toHaveAttribute('type', 'password')
    expect(submit).toBeEnabled()
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
    expect(document.documentElement).toHaveAttribute('lang', 'ar')
  })

  it('requires both fields before calling login', async () => {
    const auth = makeAuth()
    renderLogin(auth)
    await userEvent.click(fields().submit)
    expect(await screen.findByText(ar.login.identifierRequired)).toBeInTheDocument()
    expect(await screen.findByText(ar.login.passwordRequired)).toBeInTheDocument()
    expect(auth.login).not.toHaveBeenCalled()
  })

  it('signs in with the trimmed identifier and returns to the page the visitor came from', async () => {
    const auth = makeAuth()
    vi.mocked(auth.login).mockResolvedValue(makeUser())
    renderLogin(auth, '/users')
    await submitCredentials('  admin@test.local ', 'Secret123!')
    await waitFor(() => expect(auth.login).toHaveBeenCalledWith('admin@test.local', 'Secret123!'))
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/users')
    // An account without two-step verification never sees the second step.
    expect(auth.completeMfaLogin).not.toHaveBeenCalled()
  })

  it('sends a user who must change the password to the profile page instead', async () => {
    const auth = makeAuth()
    vi.mocked(auth.login).mockResolvedValue(makeUser({ mustChangePassword: true }))
    renderLogin(auth, '/users')
    await submitCredentials()
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/profile')
  })

  it('shows the dedicated message for a known backend code and stays on the page', async () => {
    const auth = makeAuth()
    vi.mocked(auth.login).mockRejectedValue(
      new ApiError(401, 'Invalid credentials', { statusCode: 401, code: 'invalid_credentials' }),
    )
    renderLogin(auth)
    await submitCredentials()
    expect(await screen.findByRole('alert')).toHaveTextContent(ar.login.errors.invalid_credentials)
    expect(screen.queryByTestId('location')).not.toBeInTheDocument()
    expect(fields().submit).toBeEnabled()
  })

  it('tells a locked-out user how many minutes to wait (rounded up)', async () => {
    const auth = makeAuth()
    vi.mocked(auth.login).mockRejectedValue(
      new ApiError(423, 'Locked', { statusCode: 423, code: 'account_locked', retryAfterSeconds: 290 }),
    )
    renderLogin(auth)
    await submitCredentials()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('login.errors.account_locked', { minutes: 5 }),
    )
  })

  it('uses the generic, server and network messages for everything else', async () => {
    const auth = makeAuth()
    const login = vi.mocked(auth.login)
    renderLogin(auth)

    login.mockRejectedValueOnce(new ApiError(400, 'Bad request', { message: ['identifier must be a string'] }))
    await submitCredentials()
    expect(await screen.findByRole('alert')).toHaveTextContent(ar.login.errors.generic)

    login.mockRejectedValueOnce(new ApiError(503, 'Service Unavailable'))
    await userEvent.click(fields().submit)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(ar.login.errors.server))

    login.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await userEvent.click(fields().submit)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(ar.login.errors.network))
  })

  it('redirects an already signed-in user away from the login page', () => {
    renderLogin(makeAuth({ user: makeUser() }), '/users')
    expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/users')
    expect(screen.queryByRole('button', { name: ar.login.submit })).not.toBeInTheDocument()
  })

  it('sends a signed-in user who must change the password to the profile page, like the sign-in itself does', () => {
    // The provider's state can reach the page before the navigation of the sign-in: both name one destination.
    renderLogin(makeAuth({ user: makeUser({ mustChangePassword: true }) }), '/users')
    expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/profile')
  })

  it('shows only a spinner while the session is still being restored', () => {
    renderLogin(makeAuth({ status: 'loading' }))
    expect(screen.queryByRole('button', { name: ar.login.submit })).not.toBeInTheDocument()
    expect(document.querySelector('.ant-spin')).not.toBeNull()
  })

  describe('two-step verification', () => {
    const mfa = ar.login.mfa
    const refused = (status: number, code: string) => new ApiError(status, 'refused', { statusCode: status, code })

    /** Signs in with a password the server answers with a challenge; resolves once the second step shows. */
    async function reachSecondStep(auth: AuthContextValue, from?: string) {
      const challenge = mfaChallengeResponse()
      vi.mocked(auth.login).mockResolvedValue(challenge)
      const utils = renderLogin(auth, from)
      await submitCredentials('admin', 'Secret123!')
      const code = await screen.findByLabelText(mfa.code)
      return { ...utils, challenge, code }
    }

    it('replaces the password form with the second step in the same card and enters after the code', async () => {
      const auth = makeAuth()
      vi.mocked(auth.completeMfaLogin).mockResolvedValue(makeUser())
      const { challenge, code, container } = await reachSecondStep(auth, '/users')

      // Same card, second step: the subtitle says so and nobody is signed in or sent anywhere yet.
      expect(screen.getByText(ar.common.appName)).toBeInTheDocument()
      expect(screen.getByText(mfa.subtitle)).toBeInTheDocument()
      expect(screen.queryByText(ar.login.subtitle)).not.toBeInTheDocument()
      expect(screen.queryByTestId('location')).not.toBeInTheDocument()
      expect(code).toHaveFocus()
      // The password form is gone, and the password with it.
      expect(screen.queryByLabelText(ar.login.identifier)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(ar.login.password)).not.toBeInTheDocument()
      expect(container.querySelector('input[type="password"]')).toBeNull()
      expect(document.body.innerHTML).not.toContain('Secret123!')

      await userEvent.type(code, '123456{Enter}')

      await waitFor(() => expect(auth.completeMfaLogin).toHaveBeenCalledWith(challenge.challenge, { code: '123456' }))
      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/users')
      expect(auth.login).toHaveBeenCalledTimes(1)
    })

    it('sends a user who must change the password to the profile page after the second step too', async () => {
      const auth = makeAuth()
      vi.mocked(auth.completeMfaLogin).mockResolvedValue(makeUser({ mustChangePassword: true }))
      const { code } = await reachSecondStep(auth, '/users')

      await userEvent.type(code, '123456{Enter}')

      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/profile')
    })

    it('keeps the second step after a wrong code', async () => {
      const auth = makeAuth()
      vi.mocked(auth.completeMfaLogin).mockRejectedValue(refused(401, 'mfa_code_invalid'))
      const { code } = await reachSecondStep(auth)

      await userEvent.type(code, '111111{Enter}')

      expect(await screen.findByText(mfa.errors.code_invalid)).toBeInTheDocument()
      expect(screen.getByLabelText(mfa.code)).toHaveValue('')
      expect(screen.getByText(mfa.subtitle)).toBeInTheDocument()
      expect(screen.queryByLabelText(ar.login.password)).not.toBeInTheDocument()
      expect(screen.queryByTestId('location')).not.toBeInTheDocument()
    })

    it('returns to an empty password form with the reason when the challenge expired or was used', async () => {
      const auth = makeAuth()
      vi.mocked(auth.completeMfaLogin).mockRejectedValue(refused(401, 'mfa_challenge_invalid'))
      const { code } = await reachSecondStep(auth)

      await userEvent.type(code, '123456{Enter}')

      expect(await screen.findByRole('alert')).toHaveTextContent(mfa.errors.challenge_invalid)
      expect(screen.queryByLabelText(mfa.code)).not.toBeInTheDocument()
      expect(screen.getByText(ar.login.subtitle)).toBeInTheDocument()
      expect(fields().identifier).toHaveValue('')
      expect(fields().password).toHaveValue('')
      // The focus is in the form that came back, not lost with the step.
      expect(fields().identifier).toHaveFocus()
      expect(screen.queryByTestId('location')).not.toBeInTheDocument()

      // Signing in again starts a new second step and drops the notice.
      await submitCredentials('admin', 'Secret123!')
      expect(await screen.findByLabelText(mfa.code)).toBeInTheDocument()
      expect(screen.queryByText(mfa.errors.challenge_invalid)).not.toBeInTheDocument()
      expect(auth.login).toHaveBeenCalledTimes(2)
    })

    it('leaves the second step for the password form, with the lock message and its minutes, when the account is locked', async () => {
      const auth = makeAuth()
      vi.mocked(auth.completeMfaLogin).mockRejectedValue(
        new ApiError(423, 'Locked', { statusCode: 423, code: 'account_locked', retryAfterSeconds: 841 }),
      )
      const { code } = await reachSecondStep(auth)

      await userEvent.type(code, '111111{Enter}')

      // The same message as when the password step itself is refused for a locked account —
      // and no live code form (or "this step expires in…") beside it.
      expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('login.errors.account_locked', { minutes: 15 }))
      expect(screen.getAllByRole('alert')).toHaveLength(1)
      expect(screen.queryByLabelText(mfa.code)).not.toBeInTheDocument()
      expect(screen.queryByText(mfa.subtitle)).not.toBeInTheDocument()
      expect(screen.getByText(ar.login.subtitle)).toBeInTheDocument()
      expect(fields().identifier).toHaveValue('')
      expect(fields().password).toHaveValue('')
      expect(fields().submit).toBeEnabled()
      expect(screen.queryByTestId('location')).not.toBeInTheDocument()
      expect(auth.completeMfaLogin).toHaveBeenCalledTimes(1)

      // The next sign-in drops the lock message like any other failure.
      await submitCredentials('admin', 'Secret123!')
      expect(await screen.findByLabelText(mfa.code)).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('returns to the password form with the reason after the fifth wrong code of one challenge', async () => {
      const auth = makeAuth()
      // A lockout threshold above five: the server answers the fifth wrong code with `mfa_code_invalid` too.
      vi.mocked(auth.completeMfaLogin).mockRejectedValue(refused(401, 'mfa_code_invalid'))
      const { container } = await reachSecondStep(auth)
      const form = container.querySelector('form') as HTMLFormElement

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        fireEvent.change(screen.getByLabelText(mfa.code), { target: { value: '111111' } })
        fireEvent.submit(form)
        await waitFor(() => expect(auth.completeMfaLogin).toHaveBeenCalledTimes(attempt))
        if (attempt < 5) await waitFor(() => expect(screen.getByLabelText(mfa.code)).toHaveValue(''))
      }

      expect(await screen.findByRole('alert')).toHaveTextContent(mfa.errors.challenge_invalid)
      expect(screen.queryByLabelText(mfa.code)).not.toBeInTheDocument()
      expect(fields().password).toHaveValue('')
      expect(auth.completeMfaLogin).toHaveBeenCalledTimes(5)
    })

    it('goes back to the password form without a notice when the visitor asks for it', async () => {
      const auth = makeAuth()
      await reachSecondStep(auth)

      await userEvent.click(screen.getByText(mfa.backToSignIn))

      expect(fields().password).toHaveValue('')
      expect(screen.queryByLabelText(mfa.code)).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(auth.completeMfaLogin).not.toHaveBeenCalled()
    })

    it('says that two-step verification is unavailable when the password step answers 503 mfa_unavailable', async () => {
      const auth = makeAuth()
      vi.mocked(auth.login).mockRejectedValue(refused(503, 'mfa_unavailable'))
      renderLogin(auth)

      await submitCredentials()

      expect(await screen.findByRole('alert')).toHaveTextContent(ar.login.errors.mfa_unavailable)
      expect(screen.queryByLabelText(mfa.code)).not.toBeInTheDocument()
      expect(fields().submit).toBeEnabled()
    })

    it.each([
      ['password_changed', mfa.notices.passwordChanged],
      ['password_changed_step_ended', mfa.notices.passwordChangedStepEnded],
    ])('shows the %s notice a password reset sent the visitor here with', (notice, message) => {
      renderLogin(makeAuth(), undefined, notice)
      expect(screen.getByRole('alert')).toHaveTextContent(message)
      expect(fields().submit).toBeEnabled()
    })

    it('shows nothing for a notice it does not know', () => {
      renderLogin(makeAuth(), '/users', '<b>anything</b>')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('says after a password reset that ended in a locked account when the new password will work', () => {
      renderLogin(makeAuth(), undefined, 'password_changed_account_locked', { minutes: 15 })
      expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('login.mfa.notices.passwordChangedLockedFor', { minutes: 15 }))
      expect(screen.getByRole('alert')).toHaveTextContent('15')
      expect(fields().submit).toBeEnabled()
    })

    it.each([
      ['no minutes', {}],
      ['text instead of minutes', { minutes: '<b>999</b>' }],
      ['a fraction', { minutes: 2.5 }],
      ['more than a day', { minutes: 100_000 }],
      ['zero', { minutes: 0 }],
    ])('words the locked-account notice without a number when the router state carries %s', (_label, extra) => {
      renderLogin(makeAuth(), undefined, 'password_changed_account_locked', extra)
      // Only the notice id and a whole number of minutes are ever read from the router state.
      expect(screen.getByRole('alert')).toHaveTextContent(mfa.notices.passwordChangedLocked)
      expect(screen.getByRole('alert')).not.toHaveTextContent(/[0-9<]/)
    })

    it('never puts minutes from the router state into a notice that names none', () => {
      renderLogin(makeAuth(), undefined, 'password_changed', { minutes: 15 })
      expect(screen.getByRole('alert')).toHaveTextContent(mfa.notices.passwordChanged)
      expect(screen.getByRole('alert')).not.toHaveTextContent('15')
    })
  })

  it('links to the forgotten-password page from the sign-in form', async () => {
    renderLogin()
    const link = screen.getByRole('link', { name: ar.forgotPassword.link })
    expect(link).toHaveAttribute('href', '/forgot-password')
    await userEvent.click(link)
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/forgot-password')
  })
})
