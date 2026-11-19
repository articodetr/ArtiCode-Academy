import { BookOutlined, LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Form, Input, Spin, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { usePublicAcademy } from '../academy/usePublicAcademy'
import { isCatalogPublic } from '../api/academy'
import { isMfaChallenge } from '../api/auth'
import type { MfaChallenge } from '../api/auth'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/auth-context'
import type { AuthUser } from '../auth/auth-context'
import { MfaChallengeStep } from '../auth/MfaChallengeStep'
import { signInNotice, signInNoticeOf } from '../auth/mfa.signIn'
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
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<LoginFailure | null>(null)
  // Two-step verification: the password was right and the second step is still to come. Only the
  // challenge is kept — the password form unmounts with its values the moment the challenge arrives.
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null)
  // Why the visitor is (back) at the password form: the second step ended, or a password reset sent them here.
  // From the router state only a known notice id (and the whole minutes of a lock) is ever read — never text.
  const [notice, setNotice] = useState<ShownSignInNotice | null>(() => signInNoticeOf(location.state))
  // API-205, once the visitor is known to be signed out: whether the academy opens its catalog to visitors (D-R138).
  const publicAcademy = usePublicAcademy(status === 'anonymous')

  if (status === 'loading') {
    return (
      <div className="login-page">
        <Spin size="large" />
      </div>
    )
  }
  /** Where a signed-in user belongs: the profile page while the password must be changed, else where they were going. */
  const destinationOf = (signedIn: AuthUser) => (signedIn.mustChangePassword ? '/profile' : from)

  // Signed in already — or just now: the provider's new state reaches this render before the navigation
  // of `enter()` lands, and whichever redirect comes last wins, so the two must name the same destination.
  if (status === 'authenticated') return <Navigate to={user ? destinationOf(user) : from} replace />

  const enter = (signedIn: AuthUser) => {
    navigate(destinationOf(signedIn), { replace: true })
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
