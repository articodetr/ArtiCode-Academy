import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as AntdApp, ConfigProvider } from 'antd'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { RegistrationPreview } from '../api/registration'
import { getAccessToken } from '../auth/token-store'
import { AuthContext } from '../auth/auth-context'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { KEPT_COURSE_KEY, KEPT_COURSE_TTL_MS, keepCourse } from '../studentRegistration/keptCourse'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { LoginPage } from './LoginPage'
import { StudentRegisterCompletePage } from './StudentRegisterCompletePage'

const text = ar.studentRegistration
const TOKEN = 'reg_'.padEnd(43, 'x')
const PASSWORD = 'Secret123!x'
const COURSE = '0192f0a0-0000-7000-8000-00000000c001'
const PREVIEW: RegistrationPreview = {
  fullName: 'سارة علي',
  maskedEmail: 's***@example.test',
  expiresAt: '2026-11-26T10:00:00.000Z',
}

type Answer = () => Response | Promise<Response>

function mockApi({
  preview = () => jsonResponse(200, PREVIEW),
  complete = () => jsonResponse(200, { completed: true }),
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

function renderPage(token: string = TOKEN, auth = makeAuth()) {
  const utils = renderWithProviders(<StudentRegisterCompletePage />, {
    auth,
    route: `/register/complete/${token}`,
    path: '/register/complete/:token',
    routes: {
      '/login': <LocationProbe />,
      '/register': <LocationProbe />,
      '/my-classes': <LocationProbe />,
      '/': <LocationProbe />,
    },
  })
  return { ...utils, auth }
}

function submitButton(): HTMLElement {
  const button = screen.getByText(text.complete.submit).closest<HTMLElement>('button')
  if (!button) throw new Error('No submit button')
  return button
}

async function typePasswords(password = PASSWORD, confirmation = password) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText(ar.account.password), password)
  await user.type(screen.getByLabelText(ar.account.confirmPassword), confirmation)
  return user
}

async function chooseAndSubmit(password = PASSWORD) {
  const user = await typePasswords(password)
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

describe('StudentRegisterCompletePage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  describe('the link', () => {
    it.each(['not-a-token', 'x'.repeat(42), 'x'.repeat(44), `${'x'.repeat(42)}!`])('treats the malformed token %s as dead without a request', (token) => {
      const fetchMock = mockApi()
      renderPage(encodeURIComponent(token))

      expect(screen.getByRole('alert')).toHaveTextContent(text.complete.linkInvalid)
      expect(screen.queryByLabelText(ar.account.password)).not.toBeInTheDocument()
      expect(linkCalls(fetchMock)).toHaveLength(0)
    })

    it('shows a spinner while it reads the link', () => {
      mockApi({ preview: () => new Promise<Response>(() => {}) })
      const { container } = renderPage()

      expect(container.querySelector('.ant-spin')).toBeInTheDocument()
      expect(screen.queryByLabelText(ar.account.password)).not.toBeInTheDocument()
    })

    it('reads the preview once on its own route, without a bearer token', async () => {
      const fetchMock = mockApi()
      renderPage()

      await screen.findByLabelText(text.complete.fullName)
      expect(linkCalls(fetchMock)).toHaveLength(1)
      const [url, init] = linkCalls(fetchMock)[0]!
      expect(String(url)).toBe(`/api/account/register/${TOKEN}`)
      expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    })

    it('shows the masked e-mail read-only and left-to-right, and the name editable', async () => {
      mockApi()
      renderPage()

      const email = await screen.findByText(PREVIEW.maskedEmail)
      expect(email.tagName).toBe('BDI')
      expect(email).toHaveAttribute('dir', 'ltr')
      expect(screen.queryByDisplayValue(PREVIEW.maskedEmail)).not.toBeInTheDocument()
      const name = screen.getByLabelText<HTMLInputElement>(text.complete.fullName)
      expect(name.value).toBe(PREVIEW.fullName)
      expect(name).not.toHaveAttribute('readonly')
      expect(name).toBeEnabled()
      expect(screen.getByLabelText(ar.account.password)).toBeInTheDocument()
      expect(screen.getByLabelText(ar.account.confirmPassword)).toBeInTheDocument()
    })

    it('heads the card with its title and words the password rules under the password', async () => {
      mockApi()
      renderPage()

      const password = await screen.findByLabelText(ar.account.password)
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(text.complete.title)
      expect(password).toHaveAttribute('type', 'password')
      expect(screen.getByLabelText(ar.account.confirmPassword)).toHaveAttribute('type', 'password')
      expect(screen.getByText(i18n.t('studentRegistration.complete.passwordHint', { min: 10 }))).toBeInTheDocument()
      // Both fields can show what was typed (Input.Password).
      expect(document.querySelectorAll('.ant-input-password-icon')).toHaveLength(2)
    })

    it.each<[string, Answer]>([
      ['404 registration_link_invalid', () => jsonResponse(404, { statusCode: 404, code: 'registration_link_invalid' })],
      ['a 404 with no code', () => jsonResponse(404, { statusCode: 404, message: 'Cannot GET' })],
    ])('shows %s as a dead link with the way to sign in', async (_label, preview) => {
      mockApi({ preview })
      renderPage()

      expect(await screen.findByRole('alert')).toHaveTextContent(text.complete.linkInvalid)
      expect(screen.queryByLabelText(ar.account.password)).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: text.complete.registerAgain })).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: ar.account.goToLogin })).toHaveAttribute('href', '/login')
    })

    it('shows 410 as a dead link that offers to register again', async () => {
      mockApi({ preview: () => jsonResponse(410, { statusCode: 410, code: 'registration_link_expired' }) })
      renderPage()

      expect(await screen.findByRole('alert')).toHaveTextContent(text.complete.linkExpired)
      expect(screen.queryByLabelText(ar.account.password)).not.toBeInTheDocument()
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
      const returnTo = encodeURIComponent(`/catalog/${COURSE}?intent=enroll`)
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
      expect(screen.queryByLabelText(ar.account.password)).not.toBeInTheDocument()
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
      expect(screen.queryByLabelText(ar.account.password)).not.toBeInTheDocument()

      fetchMock.mockImplementation(async () => jsonResponse(200, PREVIEW))
      await userEvent.click(screen.getByText(text.complete.retry).closest('button')!)
      expect(await screen.findByLabelText(text.complete.fullName)).toBeInTheDocument()
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
    it('sends the password alone while the name is unchanged', async () => {
      const fetchMock = mockApi()
      renderPage()

      await chooseAndSubmit()

      await screen.findByTestId('location')
      const [call] = posts(fetchMock)
      expect(String(call![0])).toBe(`/api/account/register/${TOKEN}/complete`)
      expect(JSON.parse(String(call![1]?.body))).toEqual({ password: PASSWORD })
      expect(new Headers(call![1]?.headers).has('Authorization')).toBe(false)
    })

    it('does not send a name that differs only by spaces', async () => {
      const fetchMock = mockApi()
      renderPage()
      const name = await screen.findByLabelText(text.complete.fullName)
      fireEvent.change(name, { target: { value: `  ${PREVIEW.fullName} ` } })

      await chooseAndSubmit()

      await screen.findByTestId('location')
      expect(JSON.parse(String(posts(fetchMock)[0]![1]?.body))).toEqual({ password: PASSWORD })
    })

    it('sends the trimmed name when the visitor changed it', async () => {
      const fetchMock = mockApi()
      renderPage()
      const name = await screen.findByLabelText(text.complete.fullName)
      fireEvent.change(name, { target: { value: '  سارة أحمد ' } })

      await chooseAndSubmit()

      await screen.findByTestId('location')
      expect(JSON.parse(String(posts(fetchMock)[0]![1]?.body))).toEqual({ password: PASSWORD, fullName: 'سارة أحمد' })
    })

    it('refuses an emptied name and a mismatched confirmation before sending', async () => {
      const fetchMock = mockApi()
      renderPage()
      fireEvent.change(await screen.findByLabelText(text.complete.fullName), { target: { value: '   ' } })

      const user = await typePasswords(PASSWORD, 'Different123!')
      await user.click(submitButton())

      expect(await screen.findByText(text.validation.fullName.blank)).toBeInTheDocument()
      expect(await screen.findByText(ar.account.validation.mismatch)).toBeInTheDocument()
      expect(posts(fetchMock)).toHaveLength(0)
    })

    it('sends one request for a double press', async () => {
      let release: (response: Response) => void = () => {}
      const fetchMock = mockApi({ complete: () => new Promise<Response>((resolve) => (release = resolve)) })
      renderPage()
      await typePasswords()

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

      await act(async () => release(jsonResponse(200, { completed: true })))
      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/login')
    })
  })

  describe('a refused completion', () => {
    it('keeps the form with password_weak under the password field', async () => {
      mockApi({ complete: () => jsonResponse(400, { statusCode: 400, code: 'password_weak', problems: ['too common'] }) })
      renderPage()

      await chooseAndSubmit()

      const message = i18n.t('account.errors.password_weak', { min: 10 })
      expect(await screen.findByText(message)).toBeInTheDocument()
      const field = screen.getByLabelText(ar.account.password)
      expect(field).toHaveAttribute('aria-invalid', 'true')
      expect(screen.queryByText('too common')).not.toBeInTheDocument()
      expect(screen.queryByTestId('location')).not.toBeInTheDocument()
    })

    it('keeps the form with registration_invalid under the name field', async () => {
      mockApi({
        complete: () =>
          jsonResponse(400, { statusCode: 400, code: 'registration_invalid', fields: { fullName: ['too_long'] }, unknown: [] }),
      })
      renderPage()

      await chooseAndSubmit()

      expect(await screen.findByText(text.validation.fullName.too_long)).toBeInTheDocument()
      expect(screen.getByLabelText(text.complete.fullName)).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByLabelText(ar.account.password)).toBeInTheDocument()
    })

    it.each<[string, Answer, string]>([
      ['a rate limit', () => jsonResponse(429, { statusCode: 429 }), text.errors.rateLimited],
      ['a server error', () => jsonResponse(500, { statusCode: 500 }), ar.login.errors.server],
      ['no network', () => Promise.reject(new TypeError('offline')), ar.login.errors.network],
      ['origin_forbidden', () => jsonResponse(403, { statusCode: 403, code: 'origin_forbidden' }), ar.users.errors.origin_forbidden],
    ])('keeps the form and what was typed on %s, and can send again', async (_label, complete, message) => {
      const fetchMock = mockApi({ complete })
      renderPage()
      const user = await chooseAndSubmit()

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(screen.getByLabelText<HTMLInputElement>(ar.account.password).value).toBe(PASSWORD)

      fetchMock.mockImplementation(async () => jsonResponse(200, { completed: true }))
      await user.click(submitButton())
      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/login')
    })

    it.each<[string, Answer, string]>([
      ['invalid', () => jsonResponse(404, { statusCode: 404, code: 'registration_link_invalid' }), text.complete.linkInvalid],
      ['with no code', () => jsonResponse(404, { statusCode: 404 }), text.complete.linkInvalid],
      ['expired', () => jsonResponse(410, { statusCode: 410, code: 'registration_link_expired' }), text.complete.linkExpired],
      ['disabled', () => jsonResponse(403, { statusCode: 403, code: 'registration_disabled' }), text.closed.title],
    ])('replaces the form when the link turns out %s', async (_label, complete, message) => {
      mockApi({ complete })
      renderPage()

      await chooseAndSubmit()

      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(screen.queryByLabelText(ar.account.password)).not.toBeInTheDocument()
    })

    it('does not use the kept course up on a refusal', async () => {
      keepCourse(COURSE)
      mockApi({ complete: () => jsonResponse(500, { statusCode: 500 }) })
      renderPage()

      await chooseAndSubmit()

      await screen.findByRole('alert')
      expect(window.localStorage.getItem(KEPT_COURSE_KEY)).not.toBeNull()
    })
  })

  describe('success', () => {
    it('opens no session and goes to the sign-in page with the notice', async () => {
      mockApi()
      const { auth } = renderPage()

      await chooseAndSubmit()

      const probe = await screen.findByTestId('location')
      expect(probe).toHaveAttribute('data-pathname', '/login')
      expect(locationState()).toEqual({ notice: 'registration_completed' })
      expect(auth.adoptSession).not.toHaveBeenCalled()
      expect(auth.login).not.toHaveBeenCalled()
      expect(getAccessToken()).toBeNull()
    })

    it('shows the notice on the real sign-in page, with no form field of the password step filled', async () => {
      keepCourse(COURSE)
      mockApi()
      renderWithProviders(<StudentRegisterCompletePage />, {
        route: `/register/complete/${TOKEN}`,
        path: '/register/complete/:token',
        routes: { '/login': <LoginPage /> },
      })

      await chooseAndSubmit()

      expect(await screen.findByText(text.notices.accountCreated)).toBeInTheDocument()
      expect(screen.getByTestId('login-enroll-intent')).toBeInTheDocument()
      expect(screen.getByLabelText<HTMLInputElement>(ar.login.password).value).toBe('')
    })

    it('drops the history entry that carries the token', async () => {
      mockApi()
      const router = createMemoryRouter(
        [
          { path: '/home', element: <LocationProbe /> },
          { path: '/login', element: <LocationProbe /> },
          { path: '/register/complete/:token', element: <StudentRegisterCompletePage /> },
        ],
        { initialEntries: ['/home', `/register/complete/${TOKEN}`], initialIndex: 1 },
      )
      render(
        <ConfigProvider>
          <AntdApp>
            <AuthContext value={makeAuth()}>
              <RouterProvider router={router} />
            </AuthContext>
          </AntdApp>
        </ConfigProvider>,
      )

      await chooseAndSubmit()

      await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
      expect(router.state.historyAction).toBe('REPLACE')
      await act(async () => {
        await router.navigate(-1)
      })
      expect(router.state.location.pathname).toBe('/home')
      expect(router.state.location.pathname).not.toContain(TOKEN)
    })

    it('stores neither the token, the password nor the name', async () => {
      keepCourse(COURSE)
      mockApi()
      renderPage()

      await chooseAndSubmit()

      await screen.findByTestId('location')
      const stored = storedText()
      expect(stored).not.toContain(TOKEN)
      expect(stored).not.toContain(PASSWORD)
      expect(stored).not.toContain(PREVIEW.fullName)
      expect(JSON.stringify(locationState())).not.toContain(TOKEN)
    })

    it('hands a kept course to the sign-in page and clears it', async () => {
      keepCourse(COURSE)
      mockApi()
      renderPage()

      await chooseAndSubmit()

      await screen.findByTestId('location')
      expect(locationState()).toEqual({ notice: 'registration_completed', from: `/catalog/${COURSE}?intent=enroll` })
      expect(window.localStorage.getItem(KEPT_COURSE_KEY)).toBeNull()
    })

    it('ignores an expired kept course and clears it', async () => {
      keepCourse(COURSE, Date.now() - KEPT_COURSE_TTL_MS - 1000)
      mockApi()
      renderPage()

      await chooseAndSubmit()

      await screen.findByTestId('location')
      expect(locationState()).toEqual({ notice: 'registration_completed' })
      expect(window.localStorage.getItem(KEPT_COURSE_KEY)).toBeNull()
    })

    it('ignores a tampered kept course', async () => {
      window.localStorage.setItem(KEPT_COURSE_KEY, JSON.stringify({ courseId: '../evil', savedAt: Date.now() }))
      mockApi()
      renderPage()

      await chooseAndSubmit()

      await screen.findByTestId('location')
      expect(locationState()).toEqual({ notice: 'registration_completed' })
    })
  })
})
