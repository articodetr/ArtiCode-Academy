// /login (MOD-01; PORTAL-04 redesign): the sign-in card of the academy's site, in the frame of the account pages
// (auth/AuthLayout.tsx). The identifier and the password; «نسيت كلمة المرور؟»; «أو» and «المتابعة باستخدام Google» —
// enabled only while API-205 says `googleSignIn`; «ليس لديك حساب؟ أنشئ حسابك الآن» only while a visitor may create an
// account (`selfRegistration` or `googleSignUp`); «تصفّح الدورات» while the catalog is public.
//
// Where a sign-in leads (returnPath.ts): the return path the page was opened with (`?returnTo=` — the public course
// page's visitor button —, else the router state's `from` — RequireAuth), else for a student the course kept on this
// device while registering, else the home page; a user who must change the password goes to the profile page first.
//
// Google's callback comes back here when it did not open a session: `?google=<code>` is worded once and dropped from the
// address; `#google-mfa=<challenge>&expiresAt=…&returnTo=…` (an account with two-step verification — a fragment, never
// sent to a server) is read once, cleared from the address at once and held in memory only, and the existing second
// step finishes the sign-in.
import { BookOutlined, LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Divider, Form, Input } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { usePublicAcademy } from '../academy/usePublicAcademy'
import { canCreateAccount, isCatalogPublic, isGoogleSignInOn } from '../api/academy'
import { isMfaChallenge } from '../api/auth'
import type { MfaChallenge } from '../api/auth'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/auth-context'
import type { AuthUser } from '../auth/auth-context'
import { AuthLayout, AuthLoading, AuthPrompt } from '../auth/AuthLayout'
import { GoogleSignInButton } from '../auth/GoogleSignInButton'
import { googleMfaHandoffOf, googleResultOf, isGoogleMfaFragment, withoutGoogleResult } from '../auth/google.signIn'
import { MfaChallengeStep } from '../auth/MfaChallengeStep'
import { signInNotice, signInNoticeOf } from '../auth/mfa.signIn'
import type { MfaRestartLock, MfaRestartReason, ShownSignInNotice } from '../auth/mfa.signIn'
import { enrollIntentCourseOf, requestedReturnPath, signInTarget, withReturnTo } from '../auth/returnPath'
import type { SignInDestination } from '../auth/returnPath'
import { clearKeptCourse, readKeptCourse } from '../studentRegistration/keptCourse'

interface LoginFormValues {
  identifier: string
  password: string
}

/** Backend error codes with a dedicated message (login.errors.*). */
const KNOWN_CODES = new Set([
  'invalid_credentials',
  'account_locked',
  'account_suspended',
  'account_pending',
  'account_not_activated',
  // A self-registered student whose address is not confirmed yet (contract v3): answered only after the password matched.
  'email_not_verified',
  'rate_limited',
  // An account with two-step verification on a server without its key: never a session without the second step.
  'mfa_unavailable',
])

interface LoginFailure {
  key: string
  retryAfterMinutes?: number
}

function describeFailure(error: unknown): LoginFailure {
  if (error instanceof ApiError) {
    if (error.code && KNOWN_CODES.has(error.code)) {
      const body = error.body as { retryAfterSeconds?: number } | undefined
      return {
        key: `login.errors.${error.code}`,
        retryAfterMinutes: body?.retryAfterSeconds ? Math.max(1, Math.ceil(body.retryAfterSeconds / 60)) : undefined,
      }
    }
    return { key: error.status >= 500 ? 'login.errors.server' : 'login.errors.generic' }
  }
  return { key: 'login.errors.network' }
}

export function LoginPage() {
  const { t } = useTranslation()
  const { status, user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // Google's hand-over of a second step, read once on arrival: from here on it lives in memory only.
  const [googleMfa] = useState(() => googleMfaHandoffOf(location.hash))
  // Google's verdict when its callback opened no session (`?google=<code>`), worded by this app; it clears at the next try.
  const [googleNotice, setGoogleNotice] = useState(() => googleResultOf(location.search))
  // Where the visitor was going: a path of this site only (returnPath.ts) — the one Google's hand-over names first.
  const from = googleMfa?.returnTo ?? requestedReturnPath(location.search, location.state)
  // The course a visitor kept on this device while registering (keptCourse.ts), read once: both redirects below name it.
  const [keptCourse] = useState(() => readKeptCourse())
  // The course a visitor chose to enroll in: the page says they come back to it, and nothing enrolls before they confirm.
  const intentCourse = enrollIntentCourseOf(from)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<LoginFailure | null>(null)
  // Two-step verification: the password was right — or Google's callback handed the step over — and the second step is
  // still to come. Only the challenge is kept; the password form unmounts with its values the moment it arrives.
  const [challenge, setChallenge] = useState<MfaChallenge | null>(() => googleMfa?.challenge ?? null)
  // Why the visitor is (back) at the password form: the second step ended, or a password reset sent them here.
  // From the router state only a known notice id (and the whole minutes of a lock) is ever read — never text.
  const [notice, setNotice] = useState<ShownSignInNotice | null>(() => signInNoticeOf(location.state))
  // Arrived from a finished registration: fixed on arrival, because the notice itself clears at the first sign-in attempt.
  const [justRegistered] = useState(() => signInNoticeOf(location.state)?.id === 'registration_completed')
  // API-205, once the visitor is known to be signed out: the catalog (D-R138), registration (#221) and Google flags.
  const publicAcademy = usePublicAcademy(status === 'anonymous')
  const academy = publicAcademy.academy
  const accountsOpen = canCreateAccount(academy)

  // The callback's leftovers leave the address at once (replace): the second step's challenge must survive neither a
  // reload nor the history, and a reload must not say again what `?google=` said. The return path stays.
  const fromCallback = isGoogleMfaFragment(location.hash) || googleResultOf(location.search) !== null
  useEffect(() => {
    if (!fromCallback) return
    navigate({ pathname: location.pathname, search: withoutGoogleResult(location.search), hash: '' }, { replace: true, state: location.state })
  }, [fromCallback, location.pathname, location.search, location.state, navigate])

  // A sign-in that led to the kept course used it up: it is offered once (here for a visitor who arrives signed in,
  // in `enter()` for a sign-in on this page).
  const signedInTarget = status === 'authenticated' && user ? signInTarget(user, from, keptCourse) : null
  const usedKeptCourse = signedInTarget?.usesKeptCourse === true
  useEffect(() => {
    if (usedKeptCourse) clearKeptCourse()
  }, [usedKeptCourse])

  if (status === 'loading') return <AuthLoading />

  // Signed in already — or just now: the provider's new state reaches this render before the navigation
  // of `enter()` lands, and whichever redirect comes last wins, so the two must name the same destination.
  if (status === 'authenticated') {
    const destination: SignInDestination = signedInTarget ?? { path: from ?? '/' }
    return <Navigate to={destination.path} state={destination.state} replace />
  }

  const enter = (signedIn: AuthUser) => {
    const destination = signInTarget(signedIn, from, keptCourse)
    if (destination.usesKeptCourse) clearKeptCourse()
    navigate(destination.path, { replace: true, state: destination.state })
  }

  const onFinish = async (values: LoginFormValues) => {
    setSubmitting(true)
    setFailure(null)
    setNotice(null)
    setGoogleNotice(null)
    try {
      const result = await login(values.identifier.trim(), values.password)
      if (isMfaChallenge(result)) setChallenge(result)
      else enter(result)
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setSubmitting(false)
    }
  }

  const restart = (reason: MfaRestartReason, lock?: MfaRestartLock) => {
    setChallenge(null)
    setNotice(reason === 'ended' ? signInNotice('mfa_step_ended') : null)
    // The second step found the account locked: the password form says so exactly as when the
    // password step itself is refused for it, with the minutes the server named.
    setFailure(reason === 'locked' ? { key: 'login.errors.account_locked', retryAfterMinutes: lock?.minutes } : null)
  }

  return (
    <AuthLayout title={t('login.title')} subtitle={t(challenge ? 'login.mfa.subtitle' : 'login.subtitle')} academy={publicAcademy}>
      {/* PORTAL-04, the learner journey: the course chosen on the public page waits behind the sign-in. Its way back
          leads to the public course page, offered only while the academy opens its catalog to visitors (API-205). */}
      {intentCourse ? (
        <Alert
          type="info"
          showIcon
          data-testid="login-enroll-intent"
          style={{ marginBottom: 20 }}
          title={t('login.enrollIntent.title')}
          description={
            <>
              {/* «الحسابات تُنشئها إدارة الأكاديمية» is untrue while a visitor may create one; the second step speaks of neither. */}
              {!accountsOpen && !justRegistered ? (
                <div>{t('login.enrollIntent.text')}</div>
              ) : !challenge ? (
                <div>{t(justRegistered ? 'studentRegistration.entry.courseAfterRegister' : 'studentRegistration.entry.courseNote')}</div>
              ) : null}
              {isCatalogPublic(academy) ? (
                <Link to={`/explore/${encodeURIComponent(intentCourse)}`}>{t('login.enrollIntent.back')}</Link>
              ) : null}
            </>
          }
        />
      ) : null}

      {challenge ? (
        <MfaChallengeStep challenge={challenge} onSuccess={enter} onRestart={restart} />
      ) : (
        <>
          {failure ? (
            <Alert type="error" showIcon title={t(failure.key, { minutes: failure.retryAfterMinutes ?? '' })} style={{ marginBottom: 16 }} />
          ) : notice ? (
            <Alert type={notice.type} showIcon title={t(notice.key, { minutes: notice.minutes })} style={{ marginBottom: 16 }} />
          ) : googleNotice ? (
            <Alert type={googleNotice.type} showIcon title={t(googleNotice.key)} data-testid="login-google-result" style={{ marginBottom: 16 }} />
          ) : null}

          <Form<LoginFormValues> layout="vertical" requiredMark={false} onFinish={onFinish} disabled={submitting}>
            <Form.Item
              name="identifier"
              label={t('login.identifier')}
              rules={[{ required: true, whitespace: true, message: t('login.identifierRequired') }]}
            >
              <Input prefix={<UserOutlined />} autoComplete="username" autoFocus />
            </Form.Item>

            <Form.Item name="password" label={t('login.password')} rules={[{ required: true, message: t('login.passwordRequired') }]}>
              <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
            </Form.Item>

            {/* The self-service reset request (API-021); the page says when the academy has not enabled it yet. */}
            <div className="auth-layout__aside">
              <Link to="/forgot-password">{t('forgotPassword.link')}</Link>
            </div>
            <Button type="primary" htmlType="submit" block loading={submitting}>
              {submitting ? t('login.signingIn') : t('login.submit')}
            </Button>
          </Form>

          <Divider plain className="auth-layout__divider">
            {t('login.or')}
          </Divider>
          <GoogleSignInButton
            enabled={isGoogleSignInOn(academy)}
            disabledHint={publicAcademy.loading ? null : t('login.google.notEnabled')}
            returnTo={from}
          />

          {/* Creating an account, carrying the chosen course (a path `requestedReturnPath()` already checked). Not to
              someone who has just finished creating one. */}
          {accountsOpen && !justRegistered ? (
            <AuthPrompt question={t('studentRegistration.entry.noAccount')} testId="login-register">
              <Link to={withReturnTo('/register', from)}>{t('studentRegistration.entry.createAccountNow')}</Link>
            </AuthPrompt>
          ) : null}

          {/* The public catalog (/explore) — only while the academy offers it; a failed read shows no link. */}
          {isCatalogPublic(academy) ? (
            <div className="auth-layout__links">
              <Link to="/explore">
                <BookOutlined /> {t('login.browseCourses')}
              </Link>
            </div>
          ) : null}
        </>
      )}
    </AuthLayout>
  )
}
