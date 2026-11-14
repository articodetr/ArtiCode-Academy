import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input, Spin, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/auth-context'
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
  const { status, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<LoginFailure | null>(null)

  if (status === 'loading') {
    return (
      <div className="login-page login-page--loading">
        <Spin size="large" />
      </div>
    )
  }
  if (status === 'authenticated') return <Navigate to={from} replace />

  const onFinish = async (values: LoginFormValues) => {
    setSubmitting(true)
    setFailure(null)
    try {
      const user = await login(values.identifier.trim(), values.password)
      navigate(user.mustChangePassword ? '/profile' : from, { replace: true })
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <main className="login-form-side">
        <div className="login-form-box">
          <div className="login-brand">
            <span className="login-brand__mark" aria-hidden="true" />
            <span className="login-brand__name">{t('common.appName')}</span>
          </div>
          <Typography.Title level={2} className="login-title">
            {t('login.title')}
          </Typography.Title>
          <Typography.Text type="secondary">{t('login.subtitle')}</Typography.Text>

          {failure ? (
            <Alert
              type="error"
              showIcon
              title={t(failure.key, { minutes: failure.retryAfterMinutes ?? '' })}
              className="login-alert"
            />
          ) : null}

          <Form<LoginFormValues>
            className="login-form"
            layout="vertical"
            requiredMark={false}
            onFinish={onFinish}
            disabled={submitting}
          >
            <Form.Item
              name="identifier"
              label={t('login.identifier')}
              rules={[{ required: true, whitespace: true, message: t('login.identifierRequired') }]}
            >
              <Input size="large" prefix={<UserOutlined />} autoComplete="username" autoFocus />
            </Form.Item>

            <Form.Item
              name="password"
              label={t('login.password')}
              rules={[{ required: true, message: t('login.passwordRequired') }]}
            >
              <Input.Password size="large" prefix={<LockOutlined />} autoComplete="current-password" />
            </Form.Item>

            <Button type="primary" size="large" htmlType="submit" block loading={submitting}>
              {submitting ? t('login.signingIn') : t('login.submit')}
            </Button>
          </Form>

          <div className="login-footer">
            <LanguageSwitcher />
          </div>
        </div>
      </main>
      <LoginPreview />
    </div>
  )
}

/** A sample academy day beside the form: it shows what the app is for. Decorative — not real data. */
function LoginPreview() {
  const { t } = useTranslation()
  const rows = [
    { time: '09:00', title: 'login.preview.python', chip: 'login.preview.done', tone: '' },
    { time: '11:00', title: 'login.preview.scratch', chip: 'login.preview.attendance', tone: 'mark' },
    { time: '16:00', title: 'login.preview.react', chip: 'login.preview.room', tone: '' },
    { time: '18:30', title: 'login.preview.data', chip: 'login.preview.remote', tone: '' },
  ]
  return (
    <aside className="login-preview" aria-hidden="true">
      <div className="login-preview__inner">
        <p className="login-preview__title">{t('login.preview.title')}</p>
        <p className="login-preview__text">{t('login.preview.text')}</p>
        <div className="login-preview__card tabular-nums">
          {rows.map((row) => (
            <div key={row.time} className="login-preview__row">
              <span className="login-preview__time">{row.time}</span>
              <span className="login-preview__lesson">{t(row.title)}</span>
              <span className={row.tone ? 'login-preview__chip login-preview__chip--mark' : 'login-preview__chip'}>{t(row.chip)}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
