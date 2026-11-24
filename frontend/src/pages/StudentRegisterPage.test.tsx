import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PublicAcademy } from '../api/academy'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import { KEPT_COURSE_KEY, keepCourse } from '../studentRegistration/keptCourse'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { StudentRegisterPage } from './StudentRegisterPage'

const text = ar.studentRegistration
const COURSE = '0192f0a0-0000-7000-8000-00000000c001'
const NAME = 'سارة علي'
const EMAIL = 'sara@example.test'

const OPEN: PublicAcademy = { name: { ar: 'الأكاديمية' }, logoUrl: null, defaultLocale: 'ar', selfRegistration: true }

type Answer = () => Response | Promise<Response>

function mockApi({ academy = () => jsonResponse(200, OPEN), register = () => jsonResponse(202) }: { academy?: Answer; register?: Answer } = {}) {
  return mockFetch((url) => (url.endsWith('/api/academy/public') ? academy() : register()))
}

function posts(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
}

function renderPage(state?: unknown, auth = makeAuth()) {
  return renderWithProviders(<StudentRegisterPage />, {
    auth,
    route: { pathname: '/register', state },
    path: '/register',
    routes: { '/login': <LocationProbe />, '/my-classes': <LocationProbe />, '/': <LocationProbe /> },
  })
}

function submitButton(label = text.register.submit): HTMLElement {
  const button = screen.getByText(label).closest<HTMLElement>('button')
  if (!button) throw new Error('No submit button')
  return button
}

async function fillIn(name = NAME, email = EMAIL) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText(text.register.fullName), name)
  await user.type(screen.getByLabelText(text.register.email), email)
  return user
}

async function fillAndSend(name = NAME, email = EMAIL) {
  const user = await fillIn(name, email)
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

describe('StudentRegisterPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  afterEach(async () => {
    window.localStorage.clear()
    window.sessionStorage.clear()
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

    it('keeps the way back to the chosen course in the sign-in link of the closed notice', async () => {
      mockApi({ academy: () => jsonResponse(200, { ...OPEN, selfRegistration: false }) })
      renderPage({ from: `/catalog/${COURSE}?intent=enroll` })

      await userEvent.click(await screen.findByRole('link', { name: text.closed.signIn }))

      const probe = await screen.findByTestId('location')
      expect(JSON.parse(probe.getAttribute('data-state')!)).toEqual({ from: `/catalog/${COURSE}?intent=enroll` })
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
    it('labels the two fields, with the e-mail left-to-right, and asks for no password', async () => {
      mockApi()
      renderPage()

      expect(await screen.findByLabelText(text.register.fullName)).toBeInTheDocument()
      expect(screen.getByLabelText(text.register.email)).toHaveAttribute('dir', 'ltr')
      expect(screen.queryByLabelText(ar.account.password)).not.toBeInTheDocument()
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

    it('sends the trimmed name and e-mail with the UI language, without a bearer token', async () => {
      const fetchMock = mockApi()
      renderPage()

      await fillAndSend(`  ${NAME} `, ` ${EMAIL}  `)

      await screen.findByText(text.register.sentTitle)
      const [call] = posts(fetchMock)
      expect(String(call![0])).toBe('/api/account/register')
      expect(JSON.parse(String(call![1]?.body))).toEqual({ fullName: NAME, email: EMAIL, locale: 'ar' })
      expect(new Headers(call![1]?.headers).has('Authorization')).toBe(false)
    })

    it('sends English as the locale when the page is in English', async () => {
      const fetchMock = mockApi()
      await i18n.changeLanguage('en')
      renderPage()
      const user = userEvent.setup()
      await user.type(await screen.findByLabelText(en.studentRegistration.register.fullName), NAME)
      await user.type(screen.getByLabelText(en.studentRegistration.register.email), EMAIL)
      await user.click(screen.getByText(en.studentRegistration.register.submit).closest('button')!)

      await screen.findByText(en.studentRegistration.register.sentTitle)
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

      await act(async () => release(jsonResponse(202)))
      expect(await screen.findByText(text.register.sentTitle)).toBeInTheDocument()
    })
  })

  describe('after the 202', () => {
    it('shows one neutral message that says nothing about the address', async () => {
      mockApi()
      renderPage()

      await fillAndSend()

      const alert = (await screen.findByText(text.register.sentTitle)).closest<HTMLElement>('[role="alert"]')!
      expect(alert).toHaveTextContent(text.register.sentText)
      expect(text.register.sentText).toContain('إن كان البريد صحيحًا')
      expect(alert).not.toHaveTextContent(EMAIL)
      expect(alert).not.toHaveTextContent(NAME)
      for (const revealing of ['لديك حساب', 'موجود', 'مسجّل', 'مستخدم', 'جديد']) {
        expect(text.register.sentText).not.toContain(revealing)
      }
      for (const revealing of [/already/i, /exists/i, /registered/i, /new account/i]) {
        expect(en.studentRegistration.register.sentText).not.toMatch(revealing)
      }
      expect(screen.queryByLabelText(text.register.email)).not.toBeInTheDocument()
    })

    it('offers the sign-in page', async () => {
      mockApi()
      renderPage()

      await fillAndSend()

      expect(await screen.findByRole('link', { name: text.register.goToSignIn })).toHaveAttribute('href', '/login')
    })

    it('goes back for another address, keeping the name and sending again', async () => {
      const fetchMock = mockApi()
      renderPage()
      const user = await fillAndSend()

      await user.click(await screen.findByText(text.register.anotherAddress))

      const nameField = await screen.findByLabelText<HTMLInputElement>(text.register.fullName)
      const emailField = screen.getByLabelText<HTMLInputElement>(text.register.email)
      expect(nameField.value).toBe(NAME)
      expect(emailField.value).toBe('')
      expect(emailField).toHaveFocus()

      await user.type(emailField, 'other@example.test')
      await user.click(submitButton())
      await screen.findByText(text.register.sentTitle)
      expect(posts(fetchMock)).toHaveLength(2)
      expect(JSON.parse(String(posts(fetchMock)[1]![1]?.body)).email).toBe('other@example.test')
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
      expect(screen.queryByText(text.register.sentTitle)).not.toBeInTheDocument()
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

      fetchMock.mockImplementation(async () => jsonResponse(202))
      await user.click(submitButton())
      expect(await screen.findByText(text.register.sentTitle)).toBeInTheDocument()
    })

    it('never shows the text of a server message', async () => {
      mockApi({ register: () => jsonResponse(500, { statusCode: 500, message: 'internal details' }) })
      renderPage()

      await fillAndSend()

      await screen.findByRole('alert')
      expect(screen.queryByText(/internal details/)).not.toBeInTheDocument()
    })
  })

  describe('the chosen course', () => {
    const fromCourse = { from: `/catalog/${COURSE}?intent=enroll` }

    it('keeps only the course id and the time, after the 202', async () => {
      mockApi()
      renderPage(fromCourse)
      await fillIn()
      expect(window.localStorage.getItem(KEPT_COURSE_KEY)).toBeNull()

      await userEvent.click(submitButton())
      await screen.findByText(text.register.sentTitle)

      const stored = JSON.parse(window.localStorage.getItem(KEPT_COURSE_KEY)!)
      expect(Object.keys(stored).sort()).toEqual(['courseId', 'savedAt'])
      expect(stored.courseId).toBe(COURSE)
      expect(typeof stored.savedAt).toBe('number')
      const all = storedText()
      expect(all).not.toContain(EMAIL)
      expect(all).not.toContain(NAME)
    })

    it('keeps nothing when the server refused', async () => {
      mockApi({ register: () => jsonResponse(500, { statusCode: 500 }) })
      renderPage(fromCourse)

      await fillAndSend()

      await screen.findByRole('alert')
      expect(window.localStorage.getItem(KEPT_COURSE_KEY)).toBeNull()
    })

    it.each([
      ['no return path', undefined],
      ['a path that is no enroll intent', { from: '/my-classes' }],
      ['another site', { from: `https://evil.example/catalog/${COURSE}?intent=enroll` }],
      ['a value that is no course id', { from: '/catalog/sara@example.test?intent=enroll' }],
    ])('keeps nothing for %s', async (_label, state) => {
      mockApi()
      renderPage(state)

      await fillAndSend()

      await screen.findByText(text.register.sentTitle)
      expect(storedText()).toBe('')
    })

    it('clears an older choice when this visit named no course', async () => {
      keepCourse('0192f0a0-0000-7000-8000-00000000c002')
      mockApi()
      renderPage()

      await fillAndSend()

      await screen.findByText(text.register.sentTitle)
      expect(window.localStorage.getItem(KEPT_COURSE_KEY)).toBeNull()
    })

    it('keeps `from` in the sign-in link of the form', async () => {
      mockApi()
      renderPage(fromCourse)

      await userEvent.click(await screen.findByRole('link', { name: text.register.haveAccount }))

      const probe = await screen.findByTestId('location')
      expect(probe).toHaveAttribute('data-pathname', '/login')
      expect(JSON.parse(probe.getAttribute('data-state')!)).toEqual(fromCourse)
    })

    it('keeps `from` in the sign-in link after the 202', async () => {
      mockApi()
      renderPage(fromCourse)
      const user = await fillAndSend()

      await user.click(await screen.findByRole('link', { name: text.register.goToSignIn }))

      expect(JSON.parse((await screen.findByTestId('location')).getAttribute('data-state')!)).toEqual(fromCourse)
    })

    it('never carries a return path to another site', async () => {
      mockApi()
      renderPage({ from: 'https://evil.example/' })

      await userEvent.click(await screen.findByRole('link', { name: text.register.haveAccount }))

      expect(within(document.body).getByTestId('location')).toHaveAttribute('data-state', 'null')
    })
  })
})
