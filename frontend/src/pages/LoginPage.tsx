import { BookOutlined, LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Form, Input, Spin, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { usePublicAcademy } from '../academy/usePublicAcademy'
import { isCatalogPublic, isSelfRegistrationOpen } from '../api/academy'
import { isMfaChallenge } from '../api/auth'
import type { MfaChallenge } from '../api/auth'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/auth-context'
import type { AuthUser } from '../auth/auth-context'
import { MfaChallengeStep } from '../auth/MfaChallengeStep'
import { signInNotice, signInNoticeOf } from '../auth/mfa.signIn'
import { enrollIntentCourseOf, returnPathOf, signInDestination } from '../auth/returnPath'
import type { MfaRestartLock, MfaRestartReason, ShownSignInNotice } from '../auth/mfa.signIn'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import './LoginPage.css'

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
  // Where the visitor was going (RequireAuth, or «سجّل في هذه الدورة» on the public course page): a path of this site
  // only — anything else in the router state is ignored (returnPath.ts).
  const from = returnPathOf(location.state)
  // The course a visitor chose to enroll in: the page says they come back to it, and nothing enrolls before they confirm.
  const intentCourse = enrollIntentCourseOf(from)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<LoginFailure | null>(null)
  // Two-step verification: the password was right and the second step is still to come. Only the
  // challenge is kept — the password form unmounts with its values the moment the challenge arrives.
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null)
  // Why the visitor is (back) at the password form: the second step ended, or a password reset sent them here.
  // From the router state only a known notice id (and the whole minutes of a lock) is ever read — never text.
  const [notice, setNotice] = useState<ShownSignInNotice | null>(() => signInNoticeOf(location.state))
  // Arrived from a finished registration: fixed on arrival, because the notice itself clears at the first sign-in attempt.
  const [justRegistered] = useState(() => signInNoticeOf(location.state)?.id === 'registration_completed')
  // API-205, once the visitor is known to be signed out: whether the academy opens its catalog to visitors (D-R138).
  const publicAcademy = usePublicAcademy(status === 'anonymous')
  // PORTAL-04, on the contract of #207: only the server's `true` opens the way to create an account.
  const registrationOpen = isSelfRegistrationOpen(publicAcademy.academy)

  if (status === 'loading') {
    return (
      <div className="login-page">
        <Spin size="large" />
      </div>
    )
  }
  /**
   * Where a signed-in user belongs: the profile page while the password must be changed — carrying where they were
   * going, so the chosen course survives that step too — else where they were going.
   */
  const destinationOf = (signedIn: AuthUser) => signInDestination(signedIn, from)

  // Signed in already — or just now: the provider's new state reaches this render before the navigation
  // of `enter()` lands, and whichever redirect comes last wins, so the two must name the same destination.
  if (status === 'authenticated') {
    const destination = user ? destinationOf(user) : { path: from ?? '/' }
    return <Navigate to={destination.path} state={destination.state} replace />
  }

  const enter = (signedIn: AuthUser) => {
    const destination = destinationOf(signedIn)
    navigate(destination.path, { replace: true, state: destination.state })
  }

  const onFinish = async (values: LoginFormValues) => {
    setSubmitting(true)
    setFailure(null)
    setNotice(null)
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
    <div className="login-page">
      <Card className="login-card">
        <div className="login-header">
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            {t('common.appName')}
          </Typography.Title>
          <Typography.Text type="secondary">{t(challenge ? 'login.mfa.subtitle' : 'login.subtitle')}</Typography.Text>
        </div>

        {/* PORTAL-04, the learner journey: the course chosen on the public page waits behind the sign-in. Its way back
            leads to the public course page, offered only while the academy opens its catalog to visitors (API-205). */}
        {intentCourse ? (
          <Alert
            type="info"
            showIcon
            data-testid="login-enroll-intent"
            style={{ marginBottom: 16 }}
            title={t('login.enrollIntent.title')}
            description={
              <>
                {/* «الحسابات تُنشئها إدارة الأكاديمية» is untrue while a visitor may register; the second step speaks of neither. */}
                {!registrationOpen && !justRegistered ? (
                  <div>{t('login.enrollIntent.text')}</div>
                ) : !challenge ? (
                  <div>{t(justRegistered ? 'studentRegistration.entry.courseAfterRegister' : 'studentRegistration.entry.courseNote')}</div>
                ) : null}
                {isCatalogPublic(publicAcademy.academy) ? (
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
              <Alert
                type="error"
                showIcon
                title={t(failure.key, { minutes: failure.retryAfterMinutes ?? '' })}
                style={{ marginBottom: 16 }}
              />
            ) : notice ? (
              <Alert type={notice.type} showIcon title={t(notice.key, { minutes: notice.minutes })} style={{ marginBottom: 16 }} />
            ) : null}

            <Form<LoginFormValues> layout="vertical" requiredMark={false} onFinish={onFinish} disabled={submitting}>
              <Form.Item
                name="identifier"
                label={t('login.identifier')}
                rules={[{ required: true, whitespace: true, message: t('login.identifierRequired') }]}
              >
                <Input prefix={<UserOutlined />} autoComplete="username" autoFocus />
              </Form.Item>

              <Form.Item
                name="password"
                label={t('login.password')}
                rules={[{ required: true, message: t('login.passwordRequired') }]}
              >
                <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
              </Form.Item>

              {/* The self-service reset request (API-021); the page says when the academy has not enabled it yet. */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -8, marginBottom: 16 }}>
                <Link to="/forgot-password">{t('forgotPassword.link')}</Link>
              </div>
              <Button type="primary" htmlType="submit" block loading={submitting}>
                {submitting ? t('login.signingIn') : t('login.submit')}
              </Button>
            </Form>

            {/* Creating an account, carrying the chosen course (a path `returnPathOf()` already checked). Not to someone
                who has just finished creating one. */}
            {registrationOpen && !justRegistered ? (
              <div data-testid="login-register" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4, marginTop: 16 }}>
                <Typography.Text type="secondary">{t('studentRegistration.entry.noAccount')}</Typography.Text>
                <Link to="/register" state={from ? { from } : undefined}>
                  {t('studentRegistration.entry.createAccountLink')}
                </Link>
              </div>
            ) : null}

            {/* The public catalog (/explore) — only while the academy offers it; a failed read shows no link. */}
            {isCatalogPublic(publicAcademy.academy) ? (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                <Link to="/explore">
                  <BookOutlined /> {t('login.browseCourses')}
                </Link>
              </div>
            ) : null}
          </>
        )}

        <div className="login-footer">
          <LanguageSwitcher />
        </div>
      </Card>
    </div>
  )
}
