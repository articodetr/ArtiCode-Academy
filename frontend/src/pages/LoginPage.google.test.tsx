// The sign-in card of PORTAL-04: the frame (top bar, heading), what each API-205 flag shows or hides (no Google button
// since PORTAL-04-GOOGLE-OFF),
// the callback's verdicts (`?google=`) and hand-over of a second step (`#google-mfa=`), `?returnTo=`, and the course kept
// on this device while registering.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACADEMY_PUBLIC_PATH } from '../api/academy'
import type { PublicAcademy } from '../api/academy'
import { GOOGLE_PATHS } from '../api/google'
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
      expect(screen.getByLabelText(ar.login.password)).toHaveAttribute('type', 'password')
    })

    it('renders in English, left to right', async () => {
      mockApi({ academy: makePublicAcademy({ googleSignIn: true }) })
      await i18n.changeLanguage('en')
      renderAt('/login')

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en.login.title)
      expect(document.documentElement).toHaveAttribute('dir', 'ltr')
      expect(await screen.findByText('ArtiCode Academy')).toBeInTheDocument()
      expect(screen.queryByText(en.login.google.button)).not.toBeInTheDocument()
      expect(screen.getByText(en.login.layout.backHome)).toBeInTheDocument()
      expect(screen.getByLabelText(en.login.identifier)).toBeInTheDocument()
    })
  })

  // PORTAL-04-GOOGLE-OFF (the owner's request): the ordinary sign-in only — no Google button, no «أو», whatever API-205 says.
  describe('what API-205 shows and hides', () => {
    it.each([
      ['Google is not configured', makePublicAcademy()],
      ['Google sign-in and sign-up are on', makePublicAcademy({ googleSignIn: true, googleSignUp: true })],
    ])('shows no Google button, no reason and no «أو» when %s', async (_label, academy) => {
      mockApi({ academy })
      renderAt('/login')

      expect(await screen.findByText('أكاديمية آرتي كود')).toBeInTheDocument()
      expect(screen.queryByText(google.button)).not.toBeInTheDocument()
      expect(screen.queryByTestId('google-sign-in-hint')).not.toBeInTheDocument()
      expect(screen.queryByText(ar.login.or)).not.toBeInTheDocument()
      expect(screen.getByLabelText(ar.login.identifier)).toBeInTheDocument()
      // A Google sign-up alone opens no way to an account: there is no Google button to take it.
      expect(screen.queryByTestId('login-register')).not.toBeInTheDocument()
    })

    it('offers to create an account while e-mail registration is open, carrying ?returnTo=', async () => {
      mockApi({ academy: makePublicAcademy({ selfRegistration: true }) })
      renderAt(`/login?returnTo=${encodeURIComponent(INTENT)}`)

      const prompt = await screen.findByTestId('login-register')
      expect(prompt).toHaveTextContent(ar.studentRegistration.entry.noAccount)
      const link = within(prompt).getByRole('link', { name: ar.studentRegistration.entry.createAccountNow })
      expect(link).toHaveAttribute('href', `/register?returnTo=${encodeURIComponent(INTENT)}`)
      // «الحسابات تُنشئها إدارة الأكاديمية» is untrue then.
      expect(screen.getByTestId('login-enroll-intent')).toHaveTextContent(ar.studentRegistration.entry.courseNote)
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
