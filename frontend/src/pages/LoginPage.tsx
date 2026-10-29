import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Form, Input, Spin, Typography } from 'antd'
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
      <div className="login-page">
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
      <Card className="login-card">
        <div className="login-header">
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            {t('common.appName')}
          </Typography.Title>
          <Typography.Text type="secondary">{t('login.subtitle')}</Typography.Text>
        </div>

        {failure ? (
          <Alert
            type="error"
            showIcon
            message={t(failure.key, { minutes: failure.retryAfterMinutes ?? '' })}
            style={{ marginBottom: 16 }}
          />
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

          <Button type="primary" htmlType="submit" block loading={submitting}>
            {submitting ? t('login.signingIn') : t('login.submit')}
          </Button>
        </Form>

        <div className="login-footer">
          <LanguageSwitcher />
        </div>
      </Card>
    </div>
  )
}
