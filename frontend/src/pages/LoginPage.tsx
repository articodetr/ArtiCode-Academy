import { LockOutlined, MailOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Form, Input, Select, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { ROLES } from '../auth/roles'
import type { Role } from '../auth/roles'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import './LoginPage.css'

interface LoginFormValues {
  email: string
  password: string
  role: Role
}

export function LoginPage() {
  const { t } = useTranslation()
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  if (user) return <Navigate to={from} replace />

  const onFinish = (values: LoginFormValues) => {
    login({ email: values.email, role: values.role })
    navigate(from, { replace: true })
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

        <Alert
          type="warning"
          showIcon
          message={t('login.demoNote')}
          style={{ marginBottom: 16 }}
        />

        <Form<LoginFormValues>
          layout="vertical"
          requiredMark={false}
          initialValues={{ email: 'admin@demo.academy', role: 'admin' }}
          onFinish={onFinish}
        >
          <Form.Item
            name="email"
            label={t('login.email')}
            rules={[
              { required: true, message: t('login.emailRequired') },
              { type: 'email', message: t('login.emailInvalid') },
            ]}
          >
            <Input prefix={<MailOutlined />} autoComplete="username" />
          </Form.Item>

          <Form.Item
            name="password"
            label={t('login.password')}
            rules={[{ required: true, message: t('login.passwordRequired') }]}
          >
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>

          <Form.Item name="role" label={t('login.role')}>
            <Select
              options={ROLES.map((role) => ({ value: role, label: t(`roles.${role}`) }))}
            />
          </Form.Item>

          <Button type="primary" htmlType="submit" block>
            {t('login.submit')}
          </Button>
        </Form>

        <div className="login-footer">
          <LanguageSwitcher />
        </div>
      </Card>
    </div>
  )
}
