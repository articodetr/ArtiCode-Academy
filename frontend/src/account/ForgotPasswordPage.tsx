// Public "forgot my password" page: /forgot-password (API-021), in the frame of the account pages (auth/AuthLayout.tsx).
// One identifier field; the server answers 202 whatever it is (nothing about the account is revealed), so the page
// always says «إن كان الحساب موجودًا فستصلك رسالة …». While self-service reset is switched off
// (AUTH_SELF_SERVICE_RESET_ENABLED, launch task LR-01) the server refuses with 403 reset_disabled and the page points to
// the academy administration instead; a 429 says how long to wait when the server names it. The e-mailed link opens
// the existing /reset-password/:token page.
import { UserOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input } from 'antd'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { requestPasswordReset } from '../api/account'
import { ApiError } from '../api/client'
import { AuthLayout } from '../auth/AuthLayout'
import { rateLimitMessage } from '../studentRegistration/registration.errors'
import { describeForgotPasswordFailure } from './account.errors'

/** The DTO limit of RequestPasswordResetDto.identifier. */
export const IDENTIFIER_MAX_LENGTH = 320

interface ForgotPasswordValues {
  identifier: string
}

interface ForgotFailure {
  key: string
  params?: Record<string, string | number>
  type: 'warning' | 'error'
}

/** A refused request in words: a 429 with the wait the server named, else account.errors' wording. */
function describeFailure(error: unknown): ForgotFailure {
  if (error instanceof ApiError && (error.status === 429 || error.code === 'rate_limited') && error.retryAfterSeconds !== null) {
    return { ...rateLimitMessage(error.retryAfterSeconds), type: 'warning' }
  }
  return describeForgotPasswordFailure(error)
}

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [failure, setFailure] = useState<ForgotFailure | null>(null)
  // A second press lands before React has re-rendered the loading button: one request per press.
  const busy = useRef(false)

  const onFinish = async (values: ForgotPasswordValues) => {
    if (busy.current) return
    busy.current = true
    setSubmitting(true)
    setFailure(null)
    try {
      await requestPasswordReset(values.identifier.trim())
      setSent(true)
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      busy.current = false
      setSubmitting(false)
    }
  }

  const backToLogin = (
    <div className="auth-layout__links">
      <Link to="/login">{t('forgotPassword.backToLogin')}</Link>
    </div>
  )

  return (
    <AuthLayout title={t('forgotPassword.title')} subtitle={sent ? undefined : t('forgotPassword.intro')}>
      {sent ? (
        <>
          <Alert type="success" showIcon title={t('forgotPassword.sentTitle')} description={t('forgotPassword.sent')} />
          {backToLogin}
        </>
      ) : (
        <>
          {failure ? (
            <Alert type={failure.type} showIcon title={t(failure.key, { ...failure.params })} style={{ marginBottom: 16 }} />
          ) : null}
          <Form<ForgotPasswordValues> layout="vertical" requiredMark={false} onFinish={onFinish} disabled={submitting}>
            <Form.Item
              name="identifier"
              label={t('forgotPassword.identifier')}
              rules={[
                { required: true, whitespace: true, message: t('forgotPassword.identifierRequired') },
                { max: IDENTIFIER_MAX_LENGTH, message: t('forgotPassword.identifierTooLong') },
              ]}
            >
              <Input prefix={<UserOutlined />} autoComplete="username" autoFocus />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={submitting}>
              {submitting ? t('forgotPassword.submitting') : t('forgotPassword.submit')}
            </Button>
          </Form>
          {backToLogin}
        </>
      )}
    </AuthLayout>
  )
}
