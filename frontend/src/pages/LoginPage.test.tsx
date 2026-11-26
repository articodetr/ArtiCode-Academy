import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ACADEMY_PUBLIC_PATH } from '../api/academy'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { makePublicAcademy } from '../test/academy'
import { jsonResponse, mfaChallengeResponse, mockFetch } from '../test/http'
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
  // API-205 (read for the «تصفّح الدورات» link): closed by default, so the other tests see no link.
  beforeEach(() => {
    mockFetch((url) => (url === ACADEMY_PUBLIC_PATH ? jsonResponse(200, makePublicAcademy()) : jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })))
  })

  it('renders the sign-in form in Arabic (RTL) by default', () => {
    renderLogin()
    // The card's heading; the frame names the academy, never the product (PORTAL-04).
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ar.login.title)
    expect(screen.queryByText(ar.common.appName)).not.toBeInTheDocument()
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
    // Where the user was going travels along, so the profile page continues there after the change (PORTAL-04).
    expect(screen.getByTestId('location')).toHaveAttribute('data-state', JSON.stringify({ from: '/users' }))
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

  it('asks a student who registered to confirm the e-mail first (403 email_not_verified), in both languages', async () => {
    const auth = makeAuth()
    vi.mocked(auth.login).mockRejectedValue(
      new ApiError(403, 'Forbidden', { statusCode: 403, code: 'email_not_verified', message: 'raw server words' }),
    )
    renderLogin(auth)
    await submitCredentials('sara@example.test', 'Secret123!x')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(ar.login.errors.email_not_verified)
    expect(ar.login.errors.email_not_verified).toContain('أكّد بريدك الإلكتروني أولًا')
    expect(alert).not.toHaveTextContent('raw server words')
    expect(alert).not.toHaveTextContent(ar.login.errors.generic)
    expect(screen.queryByTestId('location')).not.toBeInTheDocument()
    expect(fields().submit).toBeEnabled()
    expect(i18n.t('login.errors.email_not_verified', { lng: 'en' })).toMatch(/^Confirm your e-mail first/)
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
    expect(screen.getByTestId('location')).toHaveAttribute('data-state', JSON.stringify({ from: '/users' }))
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
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ar.login.title)
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
      expect(screen.getByTestId('location')).toHaveAttribute('data-state', JSON.stringify({ from: '/users' }))
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

/** Where the page navigated, query string included (LocationProbe shows the pathname only). */
function PathProbe() {
  const location = useLocation()
  return <output data-testid="path">{`${location.pathname}${location.search}`}</output>
}

describe('LoginPage — the public catalog and the intended action (MOD-20, D-R138)', () => {
  const browseLink = () => screen.queryByText(ar.login.browseCourses)?.closest('a') ?? null

  function mockPublicAcademy(body: unknown, status = 200) {
    return mockFetch((url) => (url === ACADEMY_PUBLIC_PATH ? jsonResponse(status, body) : jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })))
  }

  /** Lets the answer of API-205 reach the page. */
  async function settle(fetchMock: ReturnType<typeof mockFetch>) {
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  it('links to the public catalog when API-205 says the academy offers it, reading it without a token', async () => {
    const fetchMock = mockPublicAcademy(makePublicAcademy({ catalogPublic: true }))
    renderLogin()

    await waitFor(() => expect(browseLink()).not.toBeNull())
    expect(browseLink()).toHaveAttribute('href', '/explore')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(ACADEMY_PUBLIC_PATH)
    expect(new Headers(init?.headers).get('Authorization')).toBeNull()

    await userEvent.click(browseLink()!)
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/explore')
  })

  it('shows no link while the catalog is closed, on a server before MOD-20 and when the read fails', async () => {
    for (const [body, status] of [[makePublicAcademy({ catalogPublic: false }), 200], [{ name: { ar: 'أ' }, logoUrl: null, defaultLocale: 'ar' }, 200], [{ statusCode: 429, code: 'rate_limited', message: 'slow' }, 429]] as const) {
      const fetchMock = mockPublicAcademy(body, status)
      const { unmount } = renderLogin()
      await settle(fetchMock)
      expect(browseLink()).toBeNull()
      // The form itself is untouched by the read.
      expect(screen.getByLabelText(ar.login.identifier)).toBeInTheDocument()
      unmount()
    }
  })

  it('reads nothing while the session is still being restored, nor for a signed-in user', async () => {
    const fetchMock = mockPublicAcademy(makePublicAcademy({ catalogPublic: true }))
    const { unmount } = renderLogin(makeAuth({ status: 'loading' }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    unmount()
    renderLogin(makeAuth({ user: makeUser() }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns to the intended action with its query string after the sign-in', async () => {
    mockPublicAcademy(makePublicAcademy({ catalogPublic: true }))
    const auth = makeAuth()
    vi.mocked(auth.login).mockResolvedValue(makeUser({ role: 'student', roles: ['student'] }))
    renderWithProviders(<LoginPage />, {
      auth,
      route: { pathname: '/login', state: { from: '/catalog/c-1?intent=enroll' } },
      routes: { '*': <PathProbe /> },
    })
    await submitCredentials()
    expect((await screen.findByTestId('path')).textContent).toBe('/catalog/c-1?intent=enroll')
  })

  it('still sends a user who must change the password to the profile page first (KI-086), carrying the chosen course', async () => {
    mockPublicAcademy(makePublicAcademy({ catalogPublic: true }))
    const auth = makeAuth()
    vi.mocked(auth.login).mockResolvedValue(makeUser({ mustChangePassword: true }))
    renderLogin(auth, '/catalog/c-1?intent=enroll')
    await submitCredentials()
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/profile')
    expect(screen.getByTestId('location')).toHaveAttribute('data-state', JSON.stringify({ from: '/catalog/c-1?intent=enroll' }))
  })

  it('returns to the chosen course after the second step of a sign-in too (PORTAL-04)', async () => {
    mockPublicAcademy(makePublicAcademy({ catalogPublic: true }))
    const auth = makeAuth()
    vi.mocked(auth.login).mockResolvedValue(mfaChallengeResponse())
    vi.mocked(auth.completeMfaLogin).mockResolvedValue(makeUser({ role: 'student', roles: ['student'] }))
    renderWithProviders(<LoginPage />, {
      auth,
      route: { pathname: '/login', state: { from: '/catalog/c-1?intent=enroll' } },
      routes: { '*': <PathProbe /> },
    })
    await submitCredentials()
    // The notice about the chosen course stays above the second step.
    expect(screen.getByTestId('login-enroll-intent')).toBeInTheDocument()
    await userEvent.type(await screen.findByLabelText(ar.login.mfa.code), '123456{Enter}')
    expect((await screen.findByTestId('path')).textContent).toBe('/catalog/c-1?intent=enroll')
  })

  it('says the chosen course waits behind the sign-in, with its way back while the catalog is public (PORTAL-04)', async () => {
    const fetchMock = mockPublicAcademy(makePublicAcademy({ catalogPublic: true }))
    const auth = makeAuth()
    renderLogin(auth, '/catalog/c-1?intent=enroll')
    const notice = screen.getByTestId('login-enroll-intent')
    expect(notice).toHaveTextContent(ar.login.enrollIntent.title)
    expect(notice).toHaveTextContent(ar.login.enrollIntent.text)
    await settle(fetchMock)
    const back = await within(notice).findByRole('link', { name: ar.login.enrollIntent.back })
    expect(back).toHaveAttribute('href', '/explore/c-1')
    // Going back signs nobody in and enrolls nothing.
    await userEvent.click(back)
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/explore/c-1')
    expect(auth.login).not.toHaveBeenCalled()
  })

  it('offers no way back to a public page while the catalog is closed, and no notice without a chosen course', async () => {
    const fetchMock = mockPublicAcademy(makePublicAcademy({ catalogPublic: false }))
    const { unmount } = renderLogin(makeAuth(), '/catalog/c-1?intent=enroll')
    await settle(fetchMock)
    expect(screen.getByTestId('login-enroll-intent')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: ar.login.enrollIntent.back })).not.toBeInTheDocument()
    unmount()
    renderLogin(makeAuth(), '/catalog/c-1')
    expect(screen.queryByTestId('login-enroll-intent')).not.toBeInTheDocument()
  })

  it('never follows a return path that leaves this site — the sign-in goes home instead', async () => {
    mockPublicAcademy(makePublicAcademy({ catalogPublic: true }))
    for (const hostile of ['https://evil.example/catalog/c-1?intent=enroll', '//evil.example', '/\\evil.example']) {
      const auth = makeAuth()
      vi.mocked(auth.login).mockResolvedValue(makeUser({ role: 'student', roles: ['student'] }))
      const { unmount } = renderLogin(auth, hostile)
      expect(screen.queryByTestId('login-enroll-intent')).not.toBeInTheDocument()
      await submitCredentials()
      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
      unmount()
    }
  })

  describe('creating an account (PORTAL-04, the contract of #207)', () => {
    const INTENT = '/catalog/c-1?intent=enroll'
    const entry = ar.studentRegistration.entry
    const registerLink = () => screen.queryByRole('link', { name: entry.createAccountNow })

    it.each([
      ['the field absent', makePublicAcademy(), 200],
      ['false', makePublicAcademy({ selfRegistration: false }), 200],
      ['a truthy non-boolean', { ...makePublicAcademy(), selfRegistration: 'true' }, 200],
      ['a failed read', { statusCode: 503, code: 'academy_not_configured', message: 'none' }, 503],
    ])('offers nothing and keeps the original words with %s', async (_case, body, status) => {
      const fetchMock = mockPublicAcademy(body, status)
      renderLogin(makeAuth(), INTENT)
      await settle(fetchMock)
      expect(registerLink()).not.toBeInTheDocument()
      expect(screen.queryByTestId('login-register')).not.toBeInTheDocument()
      expect(screen.queryByText(entry.noAccount)).not.toBeInTheDocument()
      expect(screen.getByTestId('login-enroll-intent')).toHaveTextContent(ar.login.enrollIntent.text)
      expect(screen.getByTestId('login-enroll-intent')).not.toHaveTextContent(entry.courseNote)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('links to /register with no return path when the visitor came for nothing in particular', async () => {
      const fetchMock = mockPublicAcademy(makePublicAcademy({ selfRegistration: true }))
      renderWithProviders(<LoginPage />, { auth: makeAuth(), route: '/login', routes: { '/register': <PathProbe /> } })
      const link = await waitFor(() => {
        const found = registerLink()
        expect(found).not.toBeNull()
        return found!
      })
      expect(link).toHaveAttribute('href', '/register')
      expect(screen.getByText(entry.noAccount)).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      fireEvent.click(link)
      expect((await screen.findByTestId('path')).textContent).toBe('/register')
    })

    it('carries the chosen course to /register as ?returnTo= and stops saying accounts come from the administration', async () => {
      mockPublicAcademy(makePublicAcademy({ selfRegistration: true }))
      renderWithProviders(<LoginPage />, {
        auth: makeAuth(),
        route: { pathname: '/login', state: { from: INTENT } },
        routes: { '/register': <PathProbe /> },
      })
      const link = await screen.findByRole('link', { name: entry.createAccountNow })
      const notice = screen.getByTestId('login-enroll-intent')
      expect(notice).toHaveTextContent(entry.courseNote)
      expect(notice).not.toHaveTextContent(ar.login.enrollIntent.text)
      fireEvent.click(link)
      expect((await screen.findByTestId('path')).textContent).toBe(`/register?returnTo=${encodeURIComponent(INTENT)}`)
    })

    it('never carries a return path that leaves this site', async () => {
      mockPublicAcademy(makePublicAcademy({ selfRegistration: true }))
      renderWithProviders(<LoginPage />, {
        auth: makeAuth(),
        route: { pathname: '/login', state: { from: 'https://evil.example/x' } },
        routes: { '/register': <PathProbe /> },
      })
      fireEvent.click(await screen.findByRole('link', { name: entry.createAccountNow }))
      expect((await screen.findByTestId('path')).textContent).toBe('/register')
    })

    it('words the way to a new account «ليس لديك حساب؟ إنشاء حساب جديد», under the sign-in form', async () => {
      mockPublicAcademy(makePublicAcademy({ selfRegistration: true }))
      renderLogin(makeAuth(), INTENT)
      const prompt = await screen.findByTestId('login-register')
      expect(prompt).toHaveTextContent('ليس لديك حساب؟ إنشاء حساب جديد')
      expect(within(prompt).getByRole('link', { name: 'إنشاء حساب جديد' })).toHaveAttribute(
        'href',
        `/register?returnTo=${encodeURIComponent(INTENT)}`,
      )
      // Below the form: after its submit button in the document.
      const submit = prompt.closest('section')!.querySelector('button[type="submit"]')!
      expect(submit.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('still offers the way to a new account to a visitor who arrives with an old «registration completed» notice', async () => {
      const fetchMock = mockPublicAcademy(makePublicAcademy({ selfRegistration: true }))
      renderWithProviders(<LoginPage />, {
        auth: makeAuth(),
        route: { pathname: '/login', state: { notice: 'registration_completed', from: INTENT } },
      })
      await settle(fetchMock)
      expect(registerLink()).toBeInTheDocument()
      expect(screen.getByTestId('login-enroll-intent')).toHaveTextContent(entry.courseNote)
    })

    it('shows no way to register, and no talk of accounts, during the second step of a sign-in', async () => {
      mockPublicAcademy(makePublicAcademy({ selfRegistration: true }))
      const auth = makeAuth()
      vi.mocked(auth.login).mockResolvedValue(mfaChallengeResponse())
      renderLogin(auth, INTENT)
      await screen.findByRole('link', { name: entry.createAccountNow })
      await submitCredentials()
      await screen.findByLabelText(ar.login.mfa.code)
      expect(registerLink()).not.toBeInTheDocument()
      const notice = screen.getByTestId('login-enroll-intent')
      expect(notice).toHaveTextContent(ar.login.enrollIntent.title)
      expect(notice).not.toHaveTextContent(entry.courseNote)
      expect(notice).not.toHaveTextContent(ar.login.enrollIntent.text)
    })
  })
})
