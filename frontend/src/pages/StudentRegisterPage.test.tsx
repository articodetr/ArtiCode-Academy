import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as AntdApp, ConfigProvider } from 'antd'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicAcademy } from '../api/academy'
import { browserNavigation } from '../api/google'
import { AuthContext } from '../auth/auth-context'
import type { AuthUser } from '../auth/auth-context'
import { getAccessToken, setAccessToken } from '../auth/token-store'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import { KEPT_COURSE_KEY, keepCourse } from '../studentRegistration/keptCourse'
import { jsonResponse, mockFetch, sessionResponse } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders, userOfSession } from '../test/render'
import { StudentRegisterPage } from './StudentRegisterPage'

const text = ar.studentRegistration
const COURSE = '0192f0a0-0000-7000-8000-00000000c001'
const INTENT = `/catalog/${COURSE}?intent=enroll`
const NAME = 'سارة علي'
const EMAIL = 'sara@example.test'
const PASSWORD = 'Secret123!x'
const SESSION = sessionResponse('access-of-sara', {
  id: 'user-sara',
  email: EMAIL,
  username: null,
  fullName: NAME,
  roles: ['student'],
  permissions: ['catalog.read'],
})

const OPEN: PublicAcademy = { name: { ar: 'الأكاديمية' }, logoUrl: null, defaultLocale: 'ar', selfRegistration: true }

type Answer = () => Response | Promise<Response>

function mockApi({ academy = () => jsonResponse(200, OPEN), register = () => jsonResponse(201, SESSION) }: { academy?: Answer; register?: Answer } = {}) {
  return mockFetch((url) => (url.endsWith('/api/academy/public') ? academy() : register()))
}

function posts(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
}

/** The path and the query string a navigation reached. */
function PathProbe() {
  const location = useLocation()
  return <output data-testid="path">{`${location.pathname}${location.search}`}</output>
}

function renderPage(state?: unknown, auth = makeAuth(), search = '') {
  const utils = renderWithProviders(<StudentRegisterPage />, {
    auth,
    route: { pathname: '/register', search, state },
    path: '/register',
    routes: {
      '/login': <LocationProbe />,
      '/my-classes': <LocationProbe />,
      '/catalog/:courseId': <PathProbe />,
      '/': <LocationProbe />,
    },
  })
  return { ...utils, auth }
}

const returnToSearch = (path: string) => `?returnTo=${encodeURIComponent(path)}`

function submitButton(label = text.register.submit): HTMLElement {
  const button = screen.getByText(label).closest<HTMLElement>('button')
  if (!button) throw new Error('No submit button')
  return button
}

function passwordField(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(text.register.password)
}

function confirmField(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(text.register.confirmPassword)
}

function typePasswords(password = PASSWORD, confirmation = password) {
  fireEvent.change(passwordField(), { target: { value: password } })
  fireEvent.change(confirmField(), { target: { value: confirmation } })
}

async function fillIn(name = NAME, email = EMAIL, password = PASSWORD) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText(text.register.fullName), name)
  await user.type(screen.getByLabelText(text.register.email), email)
  typePasswords(password)
  return user
}

async function fillAndSend(name = NAME, email = EMAIL, password = PASSWORD) {
  const user = await fillIn(name, email, password)
  await user.click(submitButton())
  return user
}

function expectClosed() {
  expect(screen.getByText(text.closed.title)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: text.closed.signIn })).toHaveAttribute('href', '/login')
  expect(screen.queryByLabelText(text.register.fullName)).not.toBeInTheDocument()
  expect(screen.queryByLabelText(text.register.email)).not.toBeInTheDocument()
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

describe('StudentRegisterPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
    setAccessToken(null)
    await i18n.changeLanguage('ar')
  })

  describe('closed by default', () => {
    it('shows a spinner while it reads the academy, and no form', () => {
      mockApi({ academy: () => new Promise<Response>(() => {}) })
      const { container } = renderPage()

      expect(container.querySelector('.ant-spin')).toBeInTheDocument()
      expect(screen.queryByLabelText(text.register.fullName)).not.toBeInTheDocument()
    })

    it.each<[string, Answer]>([
      ['a server that sends no field', () => jsonResponse(200, { name: { ar: 'أ' }, logoUrl: null, defaultLocale: 'ar' })],
      ['selfRegistration: false', () => jsonResponse(200, { ...OPEN, selfRegistration: false })],
      ['a value that is not exactly true', () => jsonResponse(200, { ...OPEN, selfRegistration: 'true' })],
      ['a failed read', () => jsonResponse(503, { statusCode: 503 })],
      ['a rate-limited read', () => jsonResponse(429, { statusCode: 429 })],
      ['no network', () => Promise.reject(new TypeError('offline'))],
    ])('shows the closed notice and no form for %s', async (_label, academy) => {
      const fetchMock = mockApi({ academy })
      renderPage()

      expect(await screen.findByText(text.closed.title)).toBeInTheDocument()
      expectClosed()
      expect(posts(fetchMock)).toHaveLength(0)
    })

    it('keeps the way back to the chosen course in the sign-in link of the closed notice, as ?returnTo=', async () => {
      mockApi({ academy: () => jsonResponse(200, { ...OPEN, selfRegistration: false }) })
      renderPage({ from: INTENT })

      const link = await screen.findByRole('link', { name: text.closed.signIn })
      expect(link).toHaveAttribute('href', `/login${returnToSearch(INTENT)}`)
      await userEvent.click(link)
      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/login')
    })
  })

  describe('a signed-in user', () => {
    it('sends a learner to their classes without reading anything', async () => {
      const fetchMock = mockApi()
      renderPage(undefined, makeAuth({ user: makeUser({ role: 'student', roles: ['student'] }) }))

      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/my-classes')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('sends staff home', async () => {
      mockApi()
      renderPage(undefined, makeAuth({ user: makeUser() }))

      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
    })
  })

  describe('the form', () => {
    it('has exactly four fields — name, e-mail, password, confirmation — and «إنشاء حساب», with no checkbox', async () => {
      mockApi()
      renderPage()

      await screen.findByLabelText(text.register.fullName)
      const form = submitButton().closest('form')!
      expect(form.querySelectorAll('input')).toHaveLength(4)
      expect(form.querySelectorAll('input[type="checkbox"], select, textarea')).toHaveLength(0)
      expect([...form.querySelectorAll('label')].map((label) => label.textContent)).toEqual([
        'الاسم الكامل',
        'البريد الإلكتروني',
        'كلمة المرور',
        'تأكيد كلمة المرور',
      ])
      expect(submitButton()).toHaveTextContent('إنشاء حساب')
      // The intro no longer speaks of an e-mailed link to confirm.
      expect(screen.getByText(text.register.intro)).toBeInTheDocument()
      for (const word of ['رابط', 'رسالة', 'أكّد', 'تأكيد بريد']) expect(text.register.intro).not.toContain(word)
      expect(en.studentRegistration.register.intro).not.toMatch(/confirm|link|message/i)
    })

    it('labels the fields, with the e-mail left-to-right, and asks for the password twice with its rules in words', async () => {
      mockApi()
      renderPage()

      expect(await screen.findByLabelText(text.register.fullName)).toBeInTheDocument()
      expect(screen.getByLabelText(text.register.email)).toHaveAttribute('dir', 'ltr')
      expect(passwordField()).toHaveAttribute('type', 'password')
      expect(passwordField()).toHaveAttribute('autocomplete', 'new-password')
      expect(confirmField()).toHaveAttribute('type', 'password')
      expect(confirmField()).toHaveAttribute('autocomplete', 'new-password')
      // Both fields can show what was typed (Input.Password).
      expect(document.querySelectorAll('.ant-input-password-icon')).toHaveLength(2)
      expect(screen.getByText(i18n.t('studentRegistration.register.passwordHint', { min: 10 }))).toBeInTheDocument()
    })

    it.each<[string, string, string, string]>([
      ['no password', '', '', text.register.passwordRequired],
      ['a short password', 'short', 'short', i18n.t('account.validation.passwordPolicy', { min: 10, max: 128 })],
      ['a password of spaces only', ' '.repeat(12), ' '.repeat(12), i18n.t('account.validation.passwordPolicy', { min: 10, max: 128 })],
      ['no confirmation', PASSWORD, '', text.register.confirmRequired],
      ['a confirmation that differs', PASSWORD, 'Secret123!y', text.register.mismatch],
      ['a confirmation that differs by a space', PASSWORD, `${PASSWORD} `, text.register.mismatch],
    ])('refuses %s before sending anything', async (_label, password, confirmation, message) => {
      const fetchMock = mockApi()
      renderPage()
      const user = userEvent.setup()
      await user.type(await screen.findByLabelText(text.register.fullName), NAME)
      await user.type(screen.getByLabelText(text.register.email), EMAIL)
      if (password) fireEvent.change(passwordField(), { target: { value: password } })
      if (confirmation) fireEvent.change(confirmField(), { target: { value: confirmation } })

      await user.click(submitButton())

      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(posts(fetchMock)).toHaveLength(0)
    })

    it('puts a mismatched confirmation under its own field and sends nothing', async () => {
      const fetchMock = mockApi()
      renderPage()
      await fillIn()
      fireEvent.change(confirmField(), { target: { value: 'Different123!x' } })

      await userEvent.click(submitButton())

      expect(await screen.findByText(text.register.mismatch)).toBeInTheDocument()
      await waitFor(() => expect(confirmField()).toHaveAttribute('aria-invalid', 'true'))
      expect(passwordField()).not.toHaveAttribute('aria-invalid', 'true')
      expect(posts(fetchMock)).toHaveLength(0)
      expect(screen.queryByTestId('location')).not.toBeInTheDocument()
    })

    it.each([
      ['', EMAIL, text.validation.fullName.required],
      ['   ', EMAIL, text.validation.fullName.blank],
      ['س', EMAIL, text.validation.fullName.too_short],
      [NAME, '', text.validation.email.required],
      [NAME, 'not-an-address', text.validation.email.invalid_format],
    ])('refuses name %j and e-mail %j before sending anything', async (name, email, message) => {
      const fetchMock = mockApi()
      renderPage()
      const field = await screen.findByLabelText(text.register.fullName)
      if (name) fireEvent.change(field, { target: { value: name } })
      if (email) fireEvent.change(screen.getByLabelText(text.register.email), { target: { value: email } })

      await userEvent.click(submitButton())

      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(posts(fetchMock)).toHaveLength(0)
    })

    it('refuses a name and an e-mail over their limits', async () => {
      const fetchMock = mockApi()
      renderPage()
      fireEvent.change(await screen.findByLabelText(text.register.fullName), { target: { value: 'a'.repeat(201) } })
      fireEvent.change(screen.getByLabelText(text.register.email), { target: { value: `${'a'.repeat(320)}@example.test` } })

      await userEvent.click(submitButton())

      expect(await screen.findByText(text.validation.fullName.too_long)).toBeInTheDocument()
      expect(await screen.findByText(text.validation.email.too_long)).toBeInTheDocument()
      expect(posts(fetchMock)).toHaveLength(0)
    })

    it('sends exactly the four fields of the contract — the trimmed name and e-mail, the password as typed, the UI language — without a bearer token', async () => {
      const fetchMock = mockApi()
      renderPage()

      await fillAndSend(`  ${NAME} `, ` ${EMAIL}  `, ` ${PASSWORD} `)

      await screen.findByTestId('location')
      const [call] = posts(fetchMock)
      expect(String(call![0])).toBe('/api/account/register')
      expect(JSON.parse(String(call![1]?.body))).toEqual({ fullName: NAME, email: EMAIL, password: ` ${PASSWORD} `, locale: 'ar' })
      expect(new Headers(call![1]?.headers).has('Authorization')).toBe(false)
    })

    it('sends English as the locale when the page is in English', async () => {
      const fetchMock = mockApi()
      await i18n.changeLanguage('en')
      renderPage()
      const user = userEvent.setup()
      const words = en.studentRegistration.register
      await user.type(await screen.findByLabelText(words.fullName), NAME)
      await user.type(screen.getByLabelText(words.email), EMAIL)
      fireEvent.change(screen.getByLabelText(words.password), { target: { value: PASSWORD } })
      fireEvent.change(screen.getByLabelText(words.confirmPassword), { target: { value: PASSWORD } })
      await user.click(screen.getByText(words.submit).closest('button')!)

      await screen.findByTestId('location')
      expect(JSON.parse(String(posts(fetchMock)[0]![1]?.body)).locale).toBe('en')
    })

    it('sends one request for a double press and for Enter during the request', async () => {
      let release: (response: Response) => void = () => {}
      const fetchMock = mockApi({ register: () => new Promise<Response>((resolve) => (release = resolve)) })
      renderPage()
      const user = await fillIn()

      const button = submitButton()
      fireEvent.click(button)
      fireEvent.click(button)
      await waitFor(() => expect(posts(fetchMock)).toHaveLength(1))
      await user.type(screen.getByLabelText(text.register.email), '{Enter}')
      fireEvent.submit(button.closest('form')!)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
      expect(posts(fetchMock)).toHaveLength(1)

      await act(async () => release(jsonResponse(201, SESSION)))
      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
    })
  })

  describe('after the account is created', () => {
    it('stores the token, adopts the session, says so and goes back (replace) to the course it came from', async () => {
      mockApi()
      const { auth } = renderPage(undefined, makeAuth(), returnToSearch(INTENT))

      await fillAndSend()

      expect((await screen.findByTestId('path')).textContent).toBe(INTENT)
      expect(auth.adoptSession).toHaveBeenCalledTimes(1)
      expect(auth.adoptSession).toHaveBeenCalledWith(SESSION)
      expect(getAccessToken()).toBe(SESSION.accessToken)
      expect(await screen.findByText(text.register.created)).toBeInTheDocument()
      // Nothing about the person or the password is kept on this device.
      const all = storedText()
      for (const secret of [EMAIL, NAME, PASSWORD, SESSION.accessToken]) expect(all).not.toContain(secret)
    })

    it('reads the course from the router state too', async () => {
      mockApi()
      renderPage({ from: INTENT })

      await fillAndSend()

      expect((await screen.findByTestId('path')).textContent).toBe(INTENT)
    })

    it('goes to the default destination without a return path', async () => {
      mockApi()
      renderPage()

      await fillAndSend()

      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
      expect(getAccessToken()).toBe(SESSION.accessToken)
    })

    it.each(['//evil.example', 'https://evil.example', '/\\evil', `https://evil.example${INTENT}`, '/login'])(
      'never follows the return path %j after registering — the default destination instead',
      async (hostile) => {
        mockApi()
        renderPage(undefined, makeAuth(), returnToSearch(hostile))

        await fillAndSend()

        expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
        expect(screen.queryByTestId('path')).not.toBeInTheDocument()
      },
    )

    it('never follows a course kept on this device by an earlier visit, and clears it', async () => {
      keepCourse('0192f0a0-0000-7000-8000-00000000c002')
      mockApi()
      renderPage()

      await fillAndSend()

      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
      expect(window.localStorage.getItem(KEPT_COURSE_KEY)).toBeNull()
    })

    it('keeps nothing on this device for the course it goes back to', async () => {
      mockApi()
      renderPage(undefined, makeAuth(), returnToSearch(INTENT))

      await fillAndSend()

      expect((await screen.findByTestId('path')).textContent).toBe(INTENT)
      expect(storedText()).toBe('')
    })

    it('lands on the course, not on «my classes», once the provider itself becomes signed in', async () => {
      mockApi()
      const router = createMemoryRouter(
        [
          { path: '/', element: <LocationProbe /> },
          { path: '/my-classes', element: <LocationProbe /> },
          { path: '/catalog/:courseId', element: <PathProbe /> },
          { path: '/register', element: <StudentRegisterPage /> },
        ],
        { initialEntries: ['/explore', `/register${returnToSearch(INTENT)}`], initialIndex: 1 },
      )
      render(
        <ConfigProvider>
          <AntdApp>
            <StatefulAuth>
              <RouterProvider router={router} />
            </StatefulAuth>
          </AntdApp>
        </ConfigProvider>,
      )

      await fillAndSend()

      expect((await screen.findByTestId('path')).textContent).toBe(INTENT)
      // The registration page left the history (replace): back leads to where the visitor was before it.
      expect(router.state.historyAction).toBe('REPLACE')
    })
  })

  describe('a refusal', () => {
    it('puts each problem of registration_invalid under its own field, in words', async () => {
      mockApi({
        register: () =>
          jsonResponse(400, {
            statusCode: 400,
            code: 'registration_invalid',
            fields: { email: ['invalid_format'], fullName: ['too_short'] },
            unknown: [],
          }),
      })
      renderPage()

      await fillAndSend()

      expect(await screen.findByText(text.validation.email.invalid_format)).toBeInTheDocument()
      expect(screen.getByText(text.validation.fullName.too_short)).toBeInTheDocument()
      const emailField = screen.getByLabelText(text.register.email)
      expect(emailField).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByLabelText(text.register.fullName)).toHaveAttribute('aria-invalid', 'true')
      const describedBy = emailField.getAttribute('aria-describedby')
      expect(describedBy).toBeTruthy()
      expect(document.getElementById(describedBy!.split(' ')[0]!)).toHaveTextContent(text.validation.email.invalid_format)
      expect(screen.queryByText('invalid_format')).not.toBeInTheDocument()
      expect(screen.queryByTestId('location')).not.toBeInTheDocument()
    })

    it('puts 409 email_in_use under the e-mail field, keeps the form and goes nowhere', async () => {
      const fetchMock = mockApi({ register: () => jsonResponse(409, { statusCode: 409, code: 'email_in_use', field: 'email' }) })
      const { auth } = renderPage(undefined, makeAuth(), returnToSearch(INTENT))

      await fillAndSend()

      expect(await screen.findByText('هذا البريد الإلكتروني مسجّل بالفعل. سجّل الدخول أو استخدم بريدًا آخر.')).toBeInTheDocument()
      const emailField = screen.getByLabelText<HTMLInputElement>(text.register.email)
      expect(emailField).toHaveAttribute('aria-invalid', 'true')
      expect(emailField).toHaveFocus()
      expect(emailField.value).toBe(EMAIL)
      expect(passwordField().value).toBe(PASSWORD)
      expect(auth.adoptSession).not.toHaveBeenCalled()
      expect(getAccessToken()).toBeNull()
      expect(screen.queryByTestId('location')).not.toBeInTheDocument()
      expect(screen.queryByTestId('path')).not.toBeInTheDocument()
      expect(posts(fetchMock)).toHaveLength(1)
      // The way to sign in instead stays under the form, with the course.
      expect(within(screen.getByTestId('register-sign-in')).getByRole('link')).toHaveAttribute('href', `/login${returnToSearch(INTENT)}`)
    })

    it('puts password_weak under the password field, in this app’s words, and keeps the form', async () => {
      mockApi({ register: () => jsonResponse(400, { statusCode: 400, code: 'password_weak', problems: ['at least 10 characters'] }) })
      renderPage()

      await fillAndSend()

      expect(await screen.findByText(i18n.t('account.errors.password_weak', { min: 10 }))).toBeInTheDocument()
      expect(passwordField()).toHaveAttribute('aria-invalid', 'true')
      expect(passwordField()).toHaveFocus()
      expect(screen.queryByText('at least 10 characters')).not.toBeInTheDocument()
      expect(screen.getByLabelText<HTMLInputElement>(text.register.email).value).toBe(EMAIL)
      expect(screen.queryByTestId('location')).not.toBeInTheDocument()
    })

    it('puts a password problem of registration_invalid under the password field', async () => {
      mockApi({
        register: () =>
          jsonResponse(400, { statusCode: 400, code: 'registration_invalid', fields: { password: ['too_long'] }, unknown: [] }),
      })
      renderPage()

      await fillAndSend()

      expect(await screen.findByText(i18n.t('account.validation.passwordPolicy', { min: 10, max: 128 }))).toBeInTheDocument()
      expect(passwordField()).toHaveAttribute('aria-invalid', 'true')
    })

    it('switches to the closed notice on 403 registration_disabled', async () => {
      mockApi({ register: () => jsonResponse(403, { statusCode: 403, code: 'registration_disabled' }) })
      renderPage()

      await fillAndSend()

      expect(await screen.findByText(text.closed.title)).toBeInTheDocument()
      expectClosed()
    })

    it('says how long to wait when the server names it', async () => {
      mockApi({
        register: () =>
          new Response(JSON.stringify({ statusCode: 429, code: 'rate_limited' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After-register_ip': '300' },
          }),
      })
      renderPage()

      await fillAndSend()

      expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('studentRegistration.errors.rateLimitedMinutes', { count: 5 }))
      expect(screen.getByRole('alert')).toHaveTextContent('5 دقائق')
    })

    it('stays general on a 429 that names no wait', async () => {
      mockApi({ register: () => jsonResponse(429, { statusCode: 429 }) })
      renderPage()

      await fillAndSend()

      expect(await screen.findByRole('alert')).toHaveTextContent(text.errors.rateLimited)
    })

    it.each<[string, Answer, string]>([
      ['origin_forbidden', () => jsonResponse(403, { statusCode: 403, code: 'origin_forbidden' }), ar.users.errors.origin_forbidden],
      ['a server error', () => jsonResponse(500, { statusCode: 500 }), ar.login.errors.server],
      ['no network', () => Promise.reject(new TypeError('offline')), ar.login.errors.network],
    ])('keeps what was typed on %s, and can send again', async (_label, register, message) => {
      const fetchMock = mockApi({ register })
      renderPage()
      const user = await fillAndSend()

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(screen.getByLabelText<HTMLInputElement>(text.register.fullName).value).toBe(NAME)
      expect(screen.getByLabelText<HTMLInputElement>(text.register.email).value).toBe(EMAIL)
      expect(passwordField().value).toBe(PASSWORD)
      expect(confirmField().value).toBe(PASSWORD)

      fetchMock.mockImplementation(async () => jsonResponse(201, SESSION))
      await user.click(submitButton())
      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
    })

    it('never shows the text of a server message', async () => {
      mockApi({ register: () => jsonResponse(500, { statusCode: 500, message: 'internal details' }) })
      renderPage()

      await fillAndSend()

      await screen.findByRole('alert')
      expect(screen.queryByText(/internal details/)).not.toBeInTheDocument()
    })
  })

  describe('the way to sign in instead', () => {
    const signInHref = `/login${returnToSearch(INTENT)}`

    it('says «لديك حساب بالفعل؟ تسجيل الدخول» under the form, carrying `from` as ?returnTo=', async () => {
      mockApi()
      renderPage({ from: INTENT })

      const prompt = await screen.findByTestId('register-sign-in')
      expect(prompt).toHaveTextContent('لديك حساب بالفعل؟ تسجيل الدخول')
      // Below the form: after its submit button in the document.
      expect(submitButton().compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      const link = within(prompt).getByRole('link', { name: text.register.signIn })
      expect(link).toHaveAttribute('href', signInHref)
      await userEvent.click(link)
      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/login')
    })

    it('reads the chosen course from ?returnTo= too', async () => {
      mockApi()
      renderPage(undefined, makeAuth(), returnToSearch(INTENT))

      expect(within(await screen.findByTestId('register-sign-in')).getByRole('link')).toHaveAttribute('href', signInHref)
    })

    it('never carries a return path to another site', async () => {
      mockApi()
      renderPage({ from: 'https://evil.example/' })

      const prompt = await screen.findByTestId('register-sign-in')
      expect(within(prompt).getByRole('link', { name: text.register.signIn })).toHaveAttribute('href', '/login')
    })
  })

  describe('Google (PORTAL-04)', () => {
    const GOOGLE_URL = 'https://accounts.google.com/o/oauth2/v2/auth?state=s'

    it('heads the card with its title, then Google, «أو», the form, and the way to sign in under it', async () => {
      mockApi()
      renderPage()
      await screen.findByLabelText(text.register.fullName)
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(text.register.title)
      const google = screen.getByText(ar.login.google.button).closest('button')!
      const or = screen.getByText(ar.login.or)
      const form = submitButton().closest('form')!
      const prompt = screen.getByTestId('register-sign-in')
      expect(google.compareDocumentPosition(or) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(or.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(form.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('shows Google disabled with its reason while googleSignUp is not on', async () => {
      mockApi()
      renderPage()
      const hint = await screen.findByTestId('google-sign-in-hint')
      expect(hint).toHaveTextContent(ar.login.google.signUpNotEnabled)
      expect(screen.getByText(ar.login.google.button).closest('button')).toBeDisabled()
    })

    it('starts Google with the chosen course when googleSignUp is on', async () => {
      const fetchMock = mockFetch((url) =>
        url.endsWith('/api/academy/public')
          ? jsonResponse(200, { ...OPEN, googleSignIn: true, googleSignUp: true })
          : jsonResponse(200, { url: GOOGLE_URL }),
      )
      const assign = vi.spyOn(browserNavigation, 'assign').mockImplementation(() => {})
      renderPage({ from: INTENT })
      const button = await waitFor(() => {
        const found = screen.getByText(ar.login.google.button).closest('button')!
        expect(found).toBeEnabled()
        return found
      })

      fireEvent.click(button)

      await waitFor(() => expect(assign).toHaveBeenCalledWith(GOOGLE_URL))
      const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/auth/google/start')!
      expect(JSON.parse(String(init?.body))).toEqual({ returnTo: INTENT })
      expect(screen.queryByTestId('google-sign-in-hint')).not.toBeInTheDocument()
    })

    it('still offers Google when only the e-mail way is closed: a notice, no form', async () => {
      const fetchMock = mockApi({ academy: () => jsonResponse(200, { ...OPEN, selfRegistration: false, googleSignIn: true, googleSignUp: true }) })
      renderPage()

      expect(await screen.findByTestId('register-email-closed')).toHaveTextContent(text.register.emailClosedTitle)
      expect(screen.getByText(ar.login.google.button).closest('button')).toBeEnabled()
      expect(screen.queryByLabelText(text.register.fullName)).not.toBeInTheDocument()
      expect(screen.queryByText(text.closed.title)).not.toBeInTheDocument()
      expect(screen.getByTestId('register-sign-in')).toBeInTheDocument()
      expect(posts(fetchMock)).toHaveLength(0)
    })

    it('shows the plain closed notice, without Google, while neither way is open', async () => {
      mockApi({ academy: () => jsonResponse(200, { ...OPEN, selfRegistration: false, googleSignIn: true, googleSignUp: false }) })
      renderPage()

      expect(await screen.findByText(text.closed.title)).toBeInTheDocument()
      expect(screen.queryByText(ar.login.google.button)).not.toBeInTheDocument()
    })
  })
})
