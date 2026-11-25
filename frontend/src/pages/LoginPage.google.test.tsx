// The sign-in card of PORTAL-04: the frame (top bar, heading), what each API-205 flag shows or hides, Google's button,
// the callback's verdicts (`?google=`) and hand-over of a second step (`#google-mfa=`), `?returnTo=`, and the course kept
// on this device while registering.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACADEMY_PUBLIC_PATH } from '../api/academy'
import type { PublicAcademy } from '../api/academy'
import { GOOGLE_PATHS, browserNavigation } from '../api/google'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import { KEPT_COURSE_KEY, keepCourse } from '../studentRegistration/keptCourse'
import { makePublicAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import type { AuthContextValue } from '../auth/auth-context'
import { LoginPage } from './LoginPage'

const COURSE = '0192f0a0-0000-7000-8000-00000000c001'
const INTENT = `/catalog/${COURSE}?intent=enroll`
const GOOGLE_URL = 'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=s'
const CHALLENGE = 'chl_'.padEnd(43, 'g')
const google = ar.login.google

/** Where the app is now: path, query and fragment. */
function Where() {
  const location = useLocation()
  return <output data-testid="where">{`${location.pathname}${location.search}${location.hash}`}</output>
}

type Answer = () => Response | Promise<Response>

function mockApi({ academy = makePublicAcademy(), start = () => jsonResponse(200, { url: GOOGLE_URL }) }: { academy?: PublicAcademy; start?: Answer } = {}) {
  return mockFetch((url) => {
    if (url === ACADEMY_PUBLIC_PATH) return jsonResponse(200, academy)
    if (url === GOOGLE_PATHS.start) return start()
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })
  })
}

/** Mounts /login at `entry` (path, query and fragment); every other path shows where the app went. */
function renderAt(entry: string, auth: AuthContextValue = makeAuth()) {
  const { pathname, search, hash } = new URL(entry, 'https://academy.test')
  return renderWithProviders(
    <>
      <LoginPage />
      <Where />
    </>,
    { auth, route: { pathname, search, hash }, path: '/login', routes: { '*': <Where /> } },
  )
}

function googleButton(): HTMLButtonElement {
  const label = screen.queryByText(google.button) ?? screen.getByText(google.redirecting)
  return label.closest('button') as HTMLButtonElement
}

async function settled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

async function signIn() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(ar.login.identifier), 'st@example.test')
  await user.type(screen.getByLabelText(ar.login.password), 'Secret123!x')
  await user.click(screen.getByRole('button', { name: ar.login.submit }))
}

describe('LoginPage — PORTAL-04', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(async () => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    await i18n.changeLanguage('ar')
  })

  describe('the frame', () => {
    it('names the academy in the top bar, leads home, offers the language switch and the forgotten password', async () => {
      mockApi()
      renderAt('/login')

      expect(await screen.findByText('أكاديمية آرتي كود')).toBeInTheDocument()
      expect(screen.getByTestId('auth-academy-name').closest('a')).toHaveAttribute('href', '/home')
      expect(screen.getByText(ar.login.layout.backHome).closest('a')).toHaveAttribute('href', '/home')
      expect(screen.getByText('English')).toBeInTheDocument()
      expect(screen.getByText(ar.forgotPassword.link).closest('a')).toHaveAttribute('href', '/forgot-password')
      expect(screen.getByText(ar.login.or)).toBeInTheDocument()
      expect(screen.getByLabelText(ar.login.password)).toHaveAttribute('type', 'password')
    })

    it('renders in English, left to right', async () => {
      mockApi({ academy: makePublicAcademy({ googleSignIn: true }) })
      await i18n.changeLanguage('en')
      renderAt('/login')

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en.login.title)
      expect(document.documentElement).toHaveAttribute('dir', 'ltr')
      expect(await screen.findByText('ArtiCode Academy')).toBeInTheDocument()
      expect(screen.getByText(en.login.google.button)).toBeInTheDocument()
      expect(screen.getByText(en.login.layout.backHome)).toBeInTheDocument()
      expect(screen.getByLabelText(en.login.identifier)).toBeInTheDocument()
    })
  })

  describe('what API-205 shows and hides', () => {
    it('shows Google’s button disabled, with its reason, while the server does not say Google is configured', async () => {
      mockApi({ academy: makePublicAcademy() })
      renderAt('/login')

      const hint = await screen.findByTestId('google-sign-in-hint')
      expect(hint).toHaveTextContent(google.notEnabled)
      expect(googleButton()).toBeDisabled()
      expect(googleButton()).toHaveAttribute('aria-describedby', hint.id)
      // No way to an account while neither registration nor Google's sign-up is open.
      expect(screen.queryByTestId('login-register')).not.toBeInTheDocument()
    })

    it('gives no reason while the academy is still being read', () => {
      mockFetch(() => new Promise<Response>(() => {}))
      renderAt('/login')
      expect(googleButton()).toBeDisabled()
      expect(screen.queryByTestId('google-sign-in-hint')).not.toBeInTheDocument()
    })

    it('enables Google’s button, with its «G» and no reason, when googleSignIn is true', async () => {
      mockApi({ academy: makePublicAcademy({ googleSignIn: true }) })
      renderAt('/login')

      await waitFor(() => expect(googleButton()).toBeEnabled())
      expect(googleButton().querySelector('svg.google-sign-in__mark')).not.toBeNull()
      expect(screen.queryByTestId('google-sign-in-hint')).not.toBeInTheDocument()
    })

    it('offers to create an account when only a Google sign-up is open, carrying ?returnTo=', async () => {
      mockApi({ academy: makePublicAcademy({ googleSignIn: true, googleSignUp: true }) })
      renderAt(`/login?returnTo=${encodeURIComponent(INTENT)}`)

      const prompt = await screen.findByTestId('login-register')
      expect(prompt).toHaveTextContent(ar.studentRegistration.entry.noAccount)
      const link = within(prompt).getByRole('link', { name: ar.studentRegistration.entry.createAccountNow })
      expect(link).toHaveAttribute('href', `/register?returnTo=${encodeURIComponent(INTENT)}`)
      // «الحسابات تُنشئها إدارة الأكاديمية» is untrue then too.
      expect(screen.getByTestId('login-enroll-intent')).toHaveTextContent(ar.studentRegistration.entry.courseNote)
    })
  })

  describe('Google’s button', () => {
    it('starts with the return path, then leaves for the address the server answered', async () => {
      const fetchMock = mockApi({ academy: makePublicAcademy({ googleSignIn: true }) })
      const assign = vi.spyOn(browserNavigation, 'assign').mockImplementation(() => {})
      renderAt(`/login?returnTo=${encodeURIComponent(INTENT)}`)
      await waitFor(() => expect(googleButton()).toBeEnabled())

      fireEvent.click(googleButton())
      fireEvent.click(googleButton())

      await waitFor(() => expect(assign).toHaveBeenCalledWith(GOOGLE_URL))
      const starts = fetchMock.mock.calls.filter(([url]) => url === GOOGLE_PATHS.start)
      expect(starts).toHaveLength(1)
      expect(starts[0]![1]?.method).toBe('POST')
      expect(starts[0]![1]?.credentials).toBe('include')
      expect(JSON.parse(String(starts[0]![1]?.body))).toEqual({ returnTo: INTENT })
      // The page is leaving: the button keeps waiting.
      expect(screen.getByText(google.redirecting)).toBeInTheDocument()
      expect(assign).toHaveBeenCalledTimes(1)
    })

    it('sends no return path for the home page or none', async () => {
      const fetchMock = mockApi({ academy: makePublicAcademy({ googleSignIn: true }) })
      vi.spyOn(browserNavigation, 'assign').mockImplementation(() => {})
      renderAt('/login?returnTo=%2F')
      await waitFor(() => expect(googleButton()).toBeEnabled())

      fireEvent.click(googleButton())

      await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === GOOGLE_PATHS.start)).toBe(true))
      const [, init] = fetchMock.mock.calls.find(([url]) => url === GOOGLE_PATHS.start)!
      expect(JSON.parse(String(init?.body))).toEqual({})
    })

    it.each<[string, Answer, string]>([
      ['503 google_unavailable', () => jsonResponse(503, { statusCode: 503, code: 'google_unavailable', message: 'off' }), google.errors.unavailable],
      ['no network', () => Promise.reject(new TypeError('Failed to fetch')), ar.login.errors.network],
      ['an answer that is no Google address', () => jsonResponse(200, { url: 'javascript:alert(1)' }), google.errors.failed],
    ])('says what went wrong on %s, leaves nowhere, and can start again', async (_label, start, message) => {
      mockApi({ academy: makePublicAcademy({ googleSignIn: true }), start })
      const assign = vi.spyOn(browserNavigation, 'assign').mockImplementation(() => {})
      renderAt('/login')
      await waitFor(() => expect(googleButton()).toBeEnabled())

      fireEvent.click(googleButton())

      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(assign).not.toHaveBeenCalled()
      expect(googleButton()).toBeEnabled()
      expect(screen.getByText(google.button)).toBeInTheDocument()
    })
  })

  describe('the callback’s verdicts (?google=)', () => {
    it.each([
      'cancelled',
      'failed',
      'unavailable',
      'registration_closed',
      'link_required',
      'link_conflict',
      'email_not_authoritative',
      'account_unavailable',
      'mfa_unavailable',
    ] as const)(
      'words %s and drops it from the address, keeping the return path',
      async (code) => {
        mockApi()
        renderAt(`/login?google=${code}&returnTo=${encodeURIComponent(INTENT)}`)

        expect(screen.getByTestId('login-google-result')).toHaveTextContent(google.results[code])
        await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/login?returnTo=${encodeURIComponent(INTENT)}`))
        // Still shown once the address is clean; the chosen course still waits.
        expect(screen.getByTestId('login-google-result')).toHaveTextContent(google.results[code])
        expect(screen.getByTestId('login-enroll-intent')).toBeInTheDocument()
      },
    )

    it('reads the e-mail rules of link_required, link_conflict and email_not_authoritative as the review words them', () => {
      expect(google.results.link_required).toBe(
        'يوجد حساب بهذا البريد. سجّل الدخول بكلمة المرور؛ ولاستخدام Google لاحقًا أكّد بريدك من «حسابي» أو اطلب ذلك من إدارة الأكاديمية.',
      )
      expect(google.results.link_conflict).toBe(
        'حسابك في الأكاديمية مرتبط بحساب Google آخر. سجّل الدخول بكلمة المرور أو بحساب Google المرتبط.',
      )
      expect(google.results.email_not_authoritative).toBe(
        'لا يمكن إنشاء الحساب أو ربطه عبر Google لهذا البريد. أنشئ حسابك بالبريد الإلكتروني، أو سجّل الدخول بكلمة المرور.',
      )
      // The second step of an account with two-step verification cannot run without the server's key.
      expect(google.results.mfa_unavailable).toBe(ar.login.errors.mfa_unavailable)
    })

    it('never shows an unknown code, and clears the verdict at the next sign-in attempt', async () => {
      mockApi()
      const auth = makeAuth()
      vi.mocked(auth.login).mockRejectedValue(new TypeError('offline'))
      renderAt('/login?google=%3Cb%3Ex%3C%2Fb%3E', auth)

      expect(screen.getByTestId('login-google-result')).toHaveTextContent(google.results.failed)
      expect(screen.queryByText(/<b>/)).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/login'))

      await signIn()
      expect(await screen.findByText(ar.login.errors.network)).toBeInTheDocument()
      expect(screen.queryByTestId('login-google-result')).not.toBeInTheDocument()
    })
  })

  describe('the hand-over of a second step (#google-mfa=)', () => {
    const handoff = `#google-mfa=${CHALLENGE}&expiresAt=2026-11-24T10%3A05%3A00.000Z&returnTo=${encodeURIComponent(INTENT)}`

    it('shows the second step at once, clears the fragment, stores nothing, and finishes where Google was asked to return', async () => {
      mockApi()
      const auth = makeAuth()
      vi.mocked(auth.completeMfaLogin).mockResolvedValue(makeUser({ role: 'student', roles: ['student'] }))
      renderAt(`/login${handoff}`, auth)

      const code = screen.getByLabelText(ar.login.mfa.code)
      expect(screen.queryByLabelText(ar.login.password)).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/login'))
      expect(document.body.innerHTML).not.toContain(CHALLENGE)
      expect(JSON.stringify({ ...window.localStorage })).not.toContain(CHALLENGE)
      expect(window.sessionStorage.length).toBe(0)

      await userEvent.type(code, '123456{Enter}')

      await waitFor(() => expect(auth.completeMfaLogin).toHaveBeenCalledWith(CHALLENGE, { code: '123456' }))
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(INTENT))
      expect(auth.login).not.toHaveBeenCalled()
    })

    it('takes no second step from a fragment whose challenge cannot be one, and clears it all the same', async () => {
      mockApi()
      renderAt('/login#google-mfa=%3Cscript%3E')

      expect(screen.getByLabelText(ar.login.password)).toBeInTheDocument()
      expect(screen.queryByLabelText(ar.login.mfa.code)).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/login'))
    })
  })

  describe('where a sign-in leads', () => {
    it('goes to ?returnTo= after a password sign-in', async () => {
      mockApi()
      const auth = makeAuth()
      vi.mocked(auth.login).mockResolvedValue(makeUser({ role: 'student', roles: ['student'] }))
      renderAt(`/login?returnTo=${encodeURIComponent(INTENT)}`, auth)

      await signIn()

      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(INTENT))
    })

    it('never follows a ?returnTo= that leaves the site', async () => {
      mockApi()
      const auth = makeAuth()
      vi.mocked(auth.login).mockResolvedValue(makeUser({ role: 'student', roles: ['student'] }))
      renderAt(`/login?returnTo=${encodeURIComponent('//evil.example/x')}`, auth)

      await signIn()

      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'))
    })

    it('takes a student without a return path to the course kept on this device, and uses it up', async () => {
      keepCourse(COURSE)
      mockApi()
      const auth = makeAuth()
      vi.mocked(auth.login).mockResolvedValue(makeUser({ role: 'student', roles: ['student'] }))
      renderAt('/login', auth)

      await signIn()

      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(INTENT))
      expect(window.localStorage.getItem(KEPT_COURSE_KEY)).toBeNull()
    })

    it('takes a student to the kept course after the second step too', async () => {
      keepCourse(COURSE)
      mockApi()
      const auth = makeAuth()
      vi.mocked(auth.completeMfaLogin).mockResolvedValue(makeUser({ role: 'student', roles: ['student'] }))
      renderAt(`/login#google-mfa=${CHALLENGE}`, auth)

      await userEvent.type(screen.getByLabelText(ar.login.mfa.code), '123456{Enter}')

      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(INTENT))
      expect(window.localStorage.getItem(KEPT_COURSE_KEY)).toBeNull()
    })

    it('lets a return path win over the kept course, and keeps the course for later', async () => {
      keepCourse(COURSE)
      mockApi()
      const auth = makeAuth()
      vi.mocked(auth.login).mockResolvedValue(makeUser({ role: 'student', roles: ['student'] }))
      renderAt('/login?returnTo=%2Fmy-classes', auth)

      await signIn()

      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/my-classes'))
      expect(window.localStorage.getItem(KEPT_COURSE_KEY)).not.toBeNull()
    })

    it('never takes staff to a kept course: the default, and the course stays', async () => {
      keepCourse(COURSE)
      mockApi()
      const auth = makeAuth()
      vi.mocked(auth.login).mockResolvedValue(makeUser())
      renderAt('/login', auth)

      await signIn()

      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'))
      await settled()
      expect(window.localStorage.getItem(KEPT_COURSE_KEY)).not.toBeNull()
    })
  })
})
