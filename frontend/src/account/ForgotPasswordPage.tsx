// Public "forgot my password" page: /forgot-password (API-021). One identifier
// field; the server answers 202 whatever it is (nothing about the account is
// revealed), so the page always says "if an account exists, a link was sent".
// While self-service reset is switched off (AUTH_SELF_SERVICE_RESET_ENABLED,
// launch task LR-01) the server refuses with 403 reset_disabled and the page
// points to the academy administration instead. The e-mailed link opens the
// existing /reset-password/:token page.
import { UserOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { requestPasswordReset } from '../api/account'
import { describeForgotPasswordFailure } from './account.errors'
import { PublicCard } from './PublicCard'

/** The DTO limit of RequestPasswordResetDto.identifier. */
export const IDENTIFIER_MAX_LENGTH = 320

interface ForgotPasswordValues {
  identifier: string
}

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [failure, setFailure] = useState<{ key: string; type: 'warning' | 'error' } | null>(null)

  const onFinish = async (values: ForgotPasswordValues) => {
    setSubmitting(true)
    setFailure(null)
    try {
      await requestPasswordReset(values.identifier.trim())
      setSent(true)
    } catch (error) {
      setFailure(describeForgotPasswordFailure(error))
    } finally {
      setSubmitting(false)
    }
  }

  const backToLogin = (
    <div className="public-page__actions">
      <Link to="/login">{t('forgotPassword.backToLogin')}</Link>
    </div>
  )

  return (
    <PublicCard subtitle={t('forgotPassword.subtitle')}>
      {sent ? (
        <>
          <Alert type="success" showIcon title={t('forgotPassword.sent')} />
          {backToLogin}
        </>
      ) : (
        <>
          <Typography.Paragraph type="secondary">{t('forgotPassword.intro')}</Typography.Paragraph>
          {failure ? <Alert type={failure.type} showIcon title={t(failure.key)} style={{ marginBottom: 16 }} /> : null}
          <Form<ForgotPasswordValues> layout="vertical" requiredMark={false} onFinish={onFinish} disabled={submitting}>
            <Form.Item
              name="identifier"
              label={t('forgotPassword.identifier')}
              rules={[
                { required: true, whitespace: true, message: t('forgotPassword.identifierRequired') },
                { max: IDENTIFIER_MAX_LENGTH, message: t('forgotPassword.identifierTooLong') },
              ]}
            >
              <Input size="large" prefix={<UserOutlined />} autoComplete="username" autoFocus />
            </Form.Item>
            <Button type="primary" size="large" htmlType="submit" block loading={submitting}>
              {submitting ? t('forgotPassword.submitting') : t('forgotPassword.submit')}
            </Button>
          </Form>
          {backToLogin}
        </>
      )}
    </PublicCard>
  )
}
