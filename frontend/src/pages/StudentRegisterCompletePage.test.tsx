import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as AntdApp, ConfigProvider } from 'antd'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import type { RegistrationPreview } from '../api/registration'
import { getAccessToken, setAccessToken } from '../auth/token-store'
import { AuthContext } from '../auth/auth-context'
import type { AuthUser } from '../auth/auth-context'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { KEPT_COURSE_KEY, KEPT_COURSE_TTL_MS, keepCourse } from '../studentRegistration/keptCourse'
import { jsonResponse, mockFetch, sessionResponse } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders, userOfSession } from '../test/render'
import { StudentRegisterCompletePage } from './StudentRegisterCompletePage'

const text = ar.studentRegistration
const TOKEN = 'reg_'.padEnd(43, 'x')
const PASSWORD = 'Secret123!x'
const COURSE = '0192f0a0-0000-7000-8000-00000000c001'
const INTENT = `/catalog/${COURSE}?intent=enroll`
const PREVIEW: RegistrationPreview = {
  fullName: 'سارة علي',
  maskedEmail: 's***@example.test',
  expiresAt: '2026-11-26T10:00:00.000Z',
}
const SESSION = sessionResponse('access-of-sara', {
  id: 'user-sara',
  email: 'sara@example.test',
  username: null,
  fullName: PREVIEW.fullName,
  roles: ['student'],
  permissions: ['catalog.read'],
})

type Answer = () => Response | Promise<Response>

function mockApi({
  preview = () => jsonResponse(200, PREVIEW),
  complete = () => jsonResponse(200, SESSION),
}: { preview?: Answer; complete?: Answer } = {}) {
  return mockFetch((url, init) => {
    if (url.endsWith('/api/academy/public')) return jsonResponse(200, { name: { ar: 'أ' }, logoUrl: null, defaultLocale: 'ar' })
    return (init?.method ?? 'GET') === 'POST' ? complete() : preview()
  })
}

/** The requests of the link itself — without the frame's own read of API-205 for the academy's name. */
function linkCalls(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls.filter(([url]) => !String(url).endsWith('/api/academy/public'))
}

function posts(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
}

/** The path and the query string a navigation reached. */
function PathProbe() {
  const location = useLocation()
  return <output data-testid="path">{`${location.pathname}${location.search}`}</output>
}

function renderPage(token: string = TOKEN, auth = makeAuth(), search = '') {
  const utils = renderWithProviders(<StudentRegisterCompletePage />, {
    auth,
    route: `/register/complete/${token}${search}`,
    path: '/register/complete/:token',
    routes: {
      '/login': <LocationProbe />,
      '/register': <LocationProbe />,
      '/my-classes': <LocationProbe />,
      '/my-school': <LocationProbe />,
      '/catalog/:courseId': <PathProbe />,
      '/': <LocationProbe />,
    },
  })
  return { ...utils, auth }
}

function passwordField(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(text.complete.password)
}

function submitButton(): HTMLElement {
  const button = screen.getByText(text.complete.submit).closest<HTMLElement>('button')
  if (!button) throw new Error('No submit button')
  return button
}

async function typePassword(password = PASSWORD) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText(text.complete.password), password)
  return user
}

async function enterAndSubmit(password = PASSWORD) {
  const user = await typePassword(password)
  await user.click(submitButton())
  return user
}

function storedText(): string {
  const parts: string[] = []
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key !== null) parts.push(key, storage.getItem(key) ?? '')
    }
  }
  return parts.join('\n')
}

function locationState() {
  return JSON.parse(screen.getByTestId('location').getAttribute('data-state')!)
}

/** A stand-in for AuthProvider that, like it, becomes signed in when a session is adopted. */
function StatefulAuth({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const value = useMemo(
    () =>
      makeAuth({
        user,
        adoptSession: (session) => {
          const adopted = userOfSession(session)
          setUser(adopted)
          return adopted
        },
      }),
    [user],
  )
  return <AuthContext value={value}>{children}</AuthContext>
}

function renderInDataRouter(initialEntries: string[], withProvider = false) {
  const router = createMemoryRouter(
    [
      { path: '/home', element: <LocationProbe /> },
      { path: '/', element: <LocationProbe /> },
      { path: '/my-classes', element: <LocationProbe /> },
      { path: '/catalog/:courseId', element: <PathProbe /> },
      { path: '/register/complete/:token', element: <StudentRegisterCompletePage /> },
    ],
    { initialEntries, initialIndex: initialEntries.length - 1 },
  )
  const routed = <RouterProvider router={router} />
  render(
    <ConfigProvider>
      <AntdApp>{withProvider ? <StatefulAuth>{routed}</StatefulAuth> : <AuthContext value={makeAuth()}>{routed}</AuthContext>}</AntdApp>
    </ConfigProvider>,
  )
  return router
}

describe('StudentRegisterCompletePage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    setAccessToken(null)
  })

  describe('the link', () => {
    it.each(['not-a-token', 'x'.repeat(42), 'x'.repeat(44), `${'x'.repeat(42)}!`])('treats the malformed token %s as dead without a request', (token) => {
      const fetchMock = mockApi()
      renderPage(encodeURIComponent(token))

      expect(screen.getByRole('alert')).toHaveTextContent(text.complete.linkInvalid)
      expect(screen.queryByLabelText(text.complete.password)).not.toBeInTheDocument()
      expect(linkCalls(fetchMock)).toHaveLength(0)
    })

    it('shows a spinner while it reads the link', () => {
      mockApi({ preview: () => new Promise<Response>(() => {}) })
      const { container } = renderPage()

      expect(container.querySelector('.ant-spin')).toBeInTheDocument()
      expect(screen.queryByLabelText(text.complete.password)).not.toBeInTheDocument()
    })

    it('reads the preview once on its own route, without a bearer token', async () => {
      const fetchMock = mockApi()
      renderPage()

      await screen.findByLabelText(text.complete.password)
      expect(linkCalls(fetchMock)).toHaveLength(1)
      const [url, init] = linkCalls(fetchMock)[0]!
      expect(String(url)).toBe(`/api/account/register/${TOKEN}`)
      expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    })

    it('shows the name and the masked e-mail read-only, the e-mail left-to-right', async () => {
      mockApi()
      renderPage()

      const email = await screen.findByText(PREVIEW.maskedEmail)
      expect(email.tagName).toBe('BDI')
      expect(email).toHaveAttribute('dir', 'ltr')
      expect(screen.getByText(PREVIEW.fullName)).toBeInTheDocument()
      expect(screen.queryByDisplayValue(PREVIEW.maskedEmail)).not.toBeInTheDocument()
      // The name is no longer part of the request: nothing on the page edits it.
      expect(screen.queryByDisplayValue(PREVIEW.fullName)).not.toBeInTheDocument()
    })

    it('heads the card with its title and asks for ONE password, the one chosen at registration, that can be shown', async () => {
      mockApi()
      renderPage()

      const password = await screen.findByLabelText(text.complete.password)
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(text.complete.title)
      expect(screen.getByText(text.complete.intro)).toBeInTheDocument()
      expect(password).toHaveAttribute('type', 'password')
      expect(password).toHaveAttribute('autocomplete', 'current-password')
      expect(document.querySelectorAll('input[type="password"]')).toHaveLength(1)
      expect(document.querySelectorAll('.ant-input-password-icon')).toHaveLength(1)
      expect(screen.queryByLabelText(ar.account.confirmPassword)).not.toBeInTheDocument()
      expect(submitButton()).toHaveTextContent(text.complete.submit)
    })

    it('offers to register again for a forgotten password, carrying a kept course', async () => {
      keepCourse(COURSE)
      mockApi()
      renderPage()

      await screen.findByLabelText(text.complete.password)
      expect(screen.getByText(text.complete.forgotPassword, { exact: false })).toBeInTheDocument()
      const link = screen.getByRole('link', { name: text.complete.registerWithNewPassword })
      expect(link).toHaveAttribute('href', `/register?returnTo=${encodeURIComponent(INTENT)}`)
    })

    it.each<[string, Answer]>([
      ['404 registration_link_invalid', () => jsonResponse(404, { statusCode: 404, code: 'registration_link_invalid' })],
      ['a 404 with no code', () => jsonResponse(404, { statusCode: 404, message: 'Cannot GET' })],
    ])('shows %s as a dead link that offers to register again', async (_label, preview) => {
      mockApi({ preview })
      renderPage()

      expect(await screen.findByRole('alert')).toHaveTextContent(text.complete.linkInvalid)
      expect(screen.queryByLabelText(text.complete.password)).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: text.complete.registerAgain })).toHaveAttribute('href', '/register')
      expect(screen.getByRole('link', { name: ar.account.goToLogin })).toHaveAttribute('href', '/login')
    })

    it('shows 410 as a dead link that offers to register again', async () => {
      mockApi({ preview: () => jsonResponse(410, { statusCode: 410, code: 'registration_link_expired' }) })
      renderPage()

      expect(await screen.findByRole('alert')).toHaveTextContent(text.complete.linkExpired)
      expect(screen.queryByLabelText(text.complete.password)).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: ar.account.goToLogin })).toHaveAttribute('href', '/login')

      await userEvent.click(screen.getByRole('link', { name: text.complete.registerAgain }))
      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/register')
      expect(locationState()).toBeNull()
    })

    it('carries a course still kept on this device when registering again, without using it up', async () => {
      keepCourse(COURSE)
      mockApi({ preview: () => jsonResponse(410, { statusCode: 410, code: 'registration_link_expired' }) })
      renderPage()

      const again = await screen.findByRole('link', { name: text.complete.registerAgain })
      const returnTo = encodeURIComponent(INTENT)
      expect(again).toHaveAttribute('href', `/register?returnTo=${returnTo}`)
      expect(screen.getByRole('link', { name: ar.account.goToLogin })).toHaveAttribute('href', `/login?returnTo=${returnTo}`)
      await userEvent.click(again)

      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/register')
      expect(window.localStorage.getItem(KEPT_COURSE_KEY)).not.toBeNull()
    })

    it('shows the closed notice on 403 registration_disabled, and no form', async () => {
      mockApi({ preview: () => jsonResponse(403, { statusCode: 403, code: 'registration_disabled' }) })
      renderPage()

      expect(await screen.findByText(text.closed.title)).toBeInTheDocument()
      expect(screen.queryByLabelText(text.complete.password)).not.toBeInTheDocument()
    })

    it.each<[string, Answer, string]>([
      ['a server error', () => jsonResponse(503, { statusCode: 503 }), ar.login.errors.server],
      ['no network', () => Promise.reject(new TypeError('offline')), ar.login.errors.network],
      ['a rate limit', () => jsonResponse(429, { statusCode: 429 }), text.errors.rateLimited],
    ])('offers a retry of the read after %s', async (_label, preview, message) => {
      const fetchMock = mockApi({ preview })
      renderPage()

      expect(await screen.findByText(text.complete.loadFailed)).toBeInTheDocument()
      expect(screen.getByText(message)).toBeInTheDocument()
      expect(screen.queryByLabelText(text.complete.password)).not.toBeInTheDocument()

      fetchMock.mockImplementation(async () => jsonResponse(200, PREVIEW))
      await userEvent.click(screen.getByText(text.complete.retry).closest('button')!)
      expect(await screen.findByLabelText(text.complete.password)).toBeInTheDocument()
      expect(linkCalls(fetchMock)).toHaveLength(2)
    })

    it('sends a signed-in learner to their classes without reading the link', async () => {
      const fetchMock = mockApi()
      renderPage(TOKEN, makeAuth({ user: makeUser({ role: 'student', roles: ['student'] }) }))

      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/my-classes')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('submitting', () => {
    it('sends the password alone, exactly as typed, without a bearer token', async () => {
      const fetchMock = mockApi()
      renderPage()

      await enterAndSubmit(` ${PASSWORD} `)

      await screen.findByTestId('location')
      const [call] = posts(fetchMock)
      expect(String(call![0])).toBe(`/api/account/register/${TOKEN}/complete`)
      expect(JSON.parse(String(call![1]?.body))).toEqual({ password: ` ${PASSWORD} ` })
      expect(new Headers(call![1]?.headers).has('Authorization')).toBe(false)
    })

    it('refuses an empty password before sending', async () => {
      const fetchMock = mockApi()
      renderPage()
      await screen.findByLabelText(text.complete.password)

      await userEvent.click(submitButton())

      expect(await screen.findByText(text.complete.passwordRequired)).toBeInTheDocument()
      expect(posts(fetchMock)).toHaveLength(0)
    })

    it('refuses a password that cannot be the chosen one, so it costs no attempt', async () => {
      const fetchMock = mockApi()
      renderPage()

      await enterAndSubmit('short')

      expect(await screen.findByText(i18n.t('account.validation.passwordPolicy', { min: 10, max: 128 }))).toBeInTheDocument()
      expect(posts(fetchMock)).toHaveLength(0)
    })

    it('sends one request for a double press and for Enter during the request', async () => {
      let release: (response: Response) => void = () => {}
      const fetchMock = mockApi({ complete: () => new Promise<Response>((resolve) => (release = resolve)) })
      renderPage()
      await typePassword()

      const button = submitButton()
      const form = button.closest('form')!
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.submit(form)
      await waitFor(() => expect(posts(fetchMock)).toHaveLength(1))
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
      expect(posts(fetchMock)).toHaveLength(1)

      await act(async () => release(jsonResponse(200, SESSION)))
      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
    })
  })

  describe('a wrong password', () => {
    const incorrect = (attemptsLeft?: number) => () =>
      jsonResponse(400, {
        statusCode: 400,
        code: 'registration_password_incorrect',
        ...(attemptsLeft === undefined ? {} : { attemptsLeft }),
      })

    it('says under the field how many attempts are left, keeps the form, and can activate next', async () => {
      const fetchMock = mockApi({ complete: incorrect(3) })
      const { auth } = renderPage()
      const user = await enterAndSubmit('Wrong12345!')

      const message = i18n.t('studentRegistration.complete.passwordIncorrectAttempts', { count: 3 })
      expect(message).toContain('3 محاولات')
      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(passwordField()).toHaveAttribute('aria-invalid', 'true')
      expect(screen.queryByText('registration_password_incorrect')).not.toBeInTheDocument()
      expect(screen.queryByTestId('location')).not.toBeInTheDocument()
      expect(auth.adoptSession).not.toHaveBeenCalled()
      expect(getAccessToken()).toBeNull()

      fetchMock.mockImplementation(async () => jsonResponse(200, SESSION))
      await user.clear(passwordField())
      await user.type(passwordField(), PASSWORD)
      await user.click(submitButton())
      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
      expect(JSON.parse(String(posts(fetchMock)[1]![1]?.body))).toEqual({ password: PASSWORD })
    })

    it('warns that the last attempt is the last', async () => {
      mockApi({ complete: incorrect(1) })
      renderPage()

      await enterAndSubmit('Wrong12345!')

      expect(await screen.findByText(text.complete.passwordIncorrectAttempts_one)).toBeInTheDocument()
    })

    it('stays general when the server names no number', async () => {
      mockApi({ complete: incorrect() })
      renderPage()

      await enterAndSubmit('Wrong12345!')

      expect(await screen.findByText(text.complete.passwordIncorrect)).toBeInTheDocument()
    })

    it('replaces the form with the way to register again when no attempt is left', async () => {
      keepCourse(COURSE)
      mockApi({ complete: incorrect(0) })
      renderPage()

      await enterAndSubmit('Wrong12345!')

      expect(await screen.findByRole('alert')).toHaveTextContent(text.complete.linkExhausted)
      expect(screen.queryByLabelText(text.complete.password)).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: text.complete.registerAgain })).toHaveAttribute(
        'href',
        `/register?returnTo=${encodeURIComponent(INTENT)}`,
      )
      expect(window.localStorage.getItem(KEPT_COURSE_KEY)).not.toBeNull()
    })
  })

  describe('a refused completion', () => {
    it('keeps the form with registration_invalid under the password field', async () => {
      mockApi({
        complete: () =>
          jsonResponse(400, { statusCode: 400, code: 'registration_invalid', fields: { password: ['required'] }, unknown: [] }),
      })
      renderPage()

      await enterAndSubmit()

      expect(await screen.findByText(ar.account.validation.passwordRequired)).toBeInTheDocument()
      expect(passwordField()).toHaveAttribute('aria-invalid', 'true')
    })

    it.each<[string, Answer, string]>([
      ['a rate limit', () => jsonResponse(429, { statusCode: 429 }), text.errors.rateLimited],
      ['a server error', () => jsonResponse(500, { statusCode: 500 }), ar.login.errors.server],
      ['no network', () => Promise.reject(new TypeError('offline')), ar.login.errors.network],
      ['origin_forbidden', () => jsonResponse(403, { statusCode: 403, code: 'origin_forbidden' }), ar.users.errors.origin_forbidden],
    ])('keeps the form and what was typed on %s, and can send again', async (_label, complete, message) => {
      const fetchMock = mockApi({ complete })
      renderPage()
      const user = await enterAndSubmit()

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(passwordField().value).toBe(PASSWORD)

      fetchMock.mockImplementation(async () => jsonResponse(200, SESSION))
      await user.click(submitButton())
      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
    })

    it.each<[string, Answer, string]>([
      ['invalid', () => jsonResponse(404, { statusCode: 404, code: 'registration_link_invalid' }), text.complete.linkInvalid],
      ['with no code', () => jsonResponse(404, { statusCode: 404 }), text.complete.linkInvalid],
      ['expired', () => jsonResponse(410, { statusCode: 410, code: 'registration_link_expired' }), text.complete.linkExpired],
      ['disabled', () => jsonResponse(403, { statusCode: 403, code: 'registration_disabled' }), text.closed.title],
    ])('replaces the form when the link turns out %s', async (_label, complete, message) => {
      mockApi({ complete })
      renderPage()

      await enterAndSubmit()

      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(screen.queryByLabelText(text.complete.password)).not.toBeInTheDocument()
    })

    it('does not use the kept course up on a refusal', async () => {
      keepCourse(COURSE)
      mockApi({ complete: () => jsonResponse(500, { statusCode: 500 }) })
      renderPage()

      await enterAndSubmit()

      await screen.findByRole('alert')
      expect(window.localStorage.getItem(KEPT_COURSE_KEY)).not.toBeNull()
    })
  })

  describe('success', () => {
    it('adopts the session the server returned, keeps its access token in memory, and goes home', async () => {
      mockApi()
      const { auth } = renderPage()

      await enterAndSubmit()

      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
      expect(auth.adoptSession).toHaveBeenCalledTimes(1)
      expect(auth.adoptSession).toHaveBeenCalledWith(SESSION)
      expect(auth.login).not.toHaveBeenCalled()
      expect(getAccessToken()).toBe(SESSION.accessToken)
      expect(locationState()).toBeNull()
    })

    it('goes on to the course kept on this device, and uses it up', async () => {
      keepCourse(COURSE)
      mockApi()
      renderPage()

      await enterAndSubmit()

      expect((await screen.findByTestId('path')).textContent).toBe(INTENT)
      expect(window.localStorage.getItem(KEPT_COURSE_KEY)).toBeNull()
    })

    it('follows a return path of this site that names a page', async () => {
      mockApi()
      renderPage(TOKEN, makeAuth(), `?returnTo=${encodeURIComponent('/my-school')}`)

      await enterAndSubmit()

      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/my-school')
    })

    it('never follows a return path to another site', async () => {
      mockApi()
      renderPage(TOKEN, makeAuth(), `?returnTo=${encodeURIComponent('https://evil.example/')}`)

      await enterAndSubmit()

      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
    })

    it.each([
      ['an expired kept course', () => keepCourse(COURSE, Date.now() - KEPT_COURSE_TTL_MS - 1000)],
      ['a tampered kept course', () => window.localStorage.setItem(KEPT_COURSE_KEY, JSON.stringify({ courseId: '../evil', savedAt: Date.now() }))],
    ])('ignores %s, goes home and clears it', async (_label, keep) => {
      keep()
      mockApi()
      renderPage()

      await enterAndSubmit()

      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
      expect(window.localStorage.getItem(KEPT_COURSE_KEY)).toBeNull()
    })

    it('stores neither the token, the password, the name nor the access token', async () => {
      keepCourse(COURSE)
      mockApi()
      renderPage()

      await enterAndSubmit()

      await screen.findByTestId('path')
      const stored = storedText()
      expect(stored).not.toContain(TOKEN)
      expect(stored).not.toContain(PASSWORD)
      expect(stored).not.toContain(PREVIEW.fullName)
      expect(stored).not.toContain(SESSION.accessToken)
    })

    it('drops the history entry that carries the token', async () => {
      mockApi()
      const router = renderInDataRouter(['/home', `/register/complete/${TOKEN}`])

      await enterAndSubmit()

      await waitFor(() => expect(router.state.location.pathname).toBe('/'))
      expect(router.state.historyAction).toBe('REPLACE')
      await act(async () => {
        await router.navigate(-1)
      })
      expect(router.state.location.pathname).toBe('/home')
      expect(router.state.location.pathname).not.toContain(TOKEN)
    })

    it('reaches the kept course when the provider signs the learner in at once, not their classes', async () => {
      keepCourse(COURSE)
      mockApi()
      const router = renderInDataRouter(['/home', `/register/complete/${TOKEN}`], true)

      await enterAndSubmit()

      expect((await screen.findByTestId('path')).textContent).toBe(INTENT)
      expect(router.state.location.pathname).toBe(`/catalog/${COURSE}`)
      expect(router.state.historyAction).toBe('REPLACE')
      expect(screen.queryByTestId('location')).not.toBeInTheDocument()
    })
  })
})
