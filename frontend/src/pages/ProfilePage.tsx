import { LogoutOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Col, Descriptions, Form, Input, Row, Space, Tag, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { changePassword } from '../api/auth'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'

interface PasswordFormValues {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

const PASSWORD_MIN_LENGTH = 10

/** The signed-in user's own page: identity, roles, permissions, sessions and password. */
export function ProfilePage() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { user, logout, logoutAll, reloadUser } = useAuth()
  const navigate = useNavigate()
  const [form] = Form.useForm<PasswordFormValues>()
  const [saving, setSaving] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  if (!user) return null

  const onChangePassword = async (values: PasswordFormValues) => {
    setSaving(true)
    setPasswordError(null)
    try {
      await changePassword(values.currentPassword, values.newPassword)
      form.resetFields()
      message.success(t('profile.passwordChanged'))
      await reloadUser()
    } catch (error) {
      if (error instanceof ApiError && error.code === 'password_invalid') {
        setPasswordError(t('profile.errors.password_invalid'))
      } else if (error instanceof ApiError && (error.code === 'password_weak' || error.status === 400)) {
        setPasswordError(t('profile.errors.password_weak', { min: PASSWORD_MIN_LENGTH }))
      } else {
        setPasswordError(t('login.errors.generic'))
      }
    } finally {
      setSaving(false)
    }
  }

  const signOut = async (everywhere: boolean) => {
    setSigningOut(true)
    try {
      await (everywhere ? logoutAll() : logout())
    } finally {
      setSigningOut(false)
      navigate('/login', { replace: true })
    }
  }

  return (
    <>
      <PageHeader
        title={t('profile.title')}
        subtitle={t('profile.subtitle')}
        extra={
          <Space wrap>
            <Button icon={<LogoutOutlined />} loading={signingOut} onClick={() => void signOut(false)}>
              {t('common.logout')}
            </Button>
            <Button danger loading={signingOut} onClick={() => void signOut(true)}>
              {t('common.logoutAll')}
            </Button>
          </Space>
        }
      />

      {user.mustChangePassword ? (
        <Alert type="warning" showIcon message={t('profile.mustChangePassword')} style={{ marginBottom: 16 }} />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card title={t('profile.identity')}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label={t('common.name')}>{user.name}</Descriptions.Item>
              <Descriptions.Item label={t('common.email')}>{user.email ?? '—'}</Descriptions.Item>
              <Descriptions.Item label={t('profile.username')}>{user.username ?? '—'}</Descriptions.Item>
              <Descriptions.Item label={t('profile.roles')}>
                {user.roles.length === 0 ? (
                  <Typography.Text type="secondary">{t('profile.noRoles')}</Typography.Text>
                ) : (
                  user.roles.map((role) => (
                    <Tag key={role} color="blue">
                      {role}
                    </Tag>
                  ))
                )}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Card title={t('profile.permissions', { count: user.permissions.length })} style={{ marginTop: 16 }}>
            {user.permissions.length === 0 ? (
              <Typography.Text type="secondary">{t('profile.noPermissions')}</Typography.Text>
            ) : (
              <Space size={[4, 8]} wrap>
                {user.permissions.map((permission) => (
                  <Tag key={permission}>{permission}</Tag>
                ))}
              </Space>
            )}
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card title={t('profile.changePassword')}>
            {passwordError ? (
              <Alert type="error" showIcon message={passwordError} style={{ marginBottom: 16 }} />
            ) : null}
            <Form<PasswordFormValues>
              form={form}
              layout="vertical"
              requiredMark={false}
              onFinish={onChangePassword}
              disabled={saving}
            >
              <Form.Item
                name="currentPassword"
                label={t('profile.currentPassword')}
                rules={[{ required: true, message: t('login.passwordRequired') }]}
              >
                <Input.Password autoComplete="current-password" />
              </Form.Item>
              <Form.Item
                name="newPassword"
                label={t('profile.newPassword')}
                rules={[
                  { required: true, message: t('login.passwordRequired') },
                  { min: PASSWORD_MIN_LENGTH, message: t('profile.errors.password_weak', { min: PASSWORD_MIN_LENGTH }) },
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="confirmPassword"
                label={t('profile.confirmPassword')}
                dependencies={['newPassword']}
                rules={[
                  { required: true, message: t('login.passwordRequired') },
                  ({ getFieldValue }) => ({
                    validator: (_, value: string) =>
                      value === getFieldValue('newPassword')
                        ? Promise.resolve()
                        : Promise.reject(new Error(t('profile.errors.mismatch'))),
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={saving}>
                {t('common.save')}
              </Button>
            </Form>
            <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
              {t('profile.passwordHint')}
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
    </>
  )
}
