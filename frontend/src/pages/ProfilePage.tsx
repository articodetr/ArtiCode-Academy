import { LogoutOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Col, Descriptions, Form, Input, Row, Space, Tag, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { EmailVerificationAction } from '../account/EmailVerificationAction'
import { changePassword } from '../api/auth'
import { useAuth } from '../auth/auth-context'
import { uiRoleFor } from '../auth/roles'
import { PageHeader } from '../components/PageHeader'
import { ProfilePermissions } from '../profile/ProfilePermissions'
import { PASSWORD_MIN_LENGTH, passwordChangeFailure, requestFailure } from '../profile/profile.errors'
import { useRoleLabels } from '../users/useRoleLabels'
import { roleLabel } from '../users/users.format'

interface PasswordFormValues {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

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
  // System roles are translated; a custom role needs its server label (API-022,
  // `users.read`), so the roles are read only for a user who holds one (J-F36).
  const holdsCustomRole = user?.roles.some((key) => uiRoleFor(key) === null) ?? false
  const roleLabels = useRoleLabels(holdsCustomRole)

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
      const failure = passwordChangeFailure(error)
      setPasswordError(t(failure.key, failure.values))
    } finally {
      setSaving(false)
    }
  }

  const signOut = async (everywhere: boolean) => {
    setSigningOut(true)
    try {
      await (everywhere ? logoutAll() : logout())
    } catch (error) {
      // Said instead of left as an unhandled rejection; the provider decides what remains of the session.
      const failure = requestFailure(error)
      message.error(t(failure.key, failure.values))
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
        <Alert type="warning" showIcon title={t('profile.mustChangePassword')} style={{ marginBottom: 16 }} />
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
                      {roleLabel(role, t, roleLabels.labels)}
                    </Tag>
                  ))
                )}
              </Descriptions.Item>
            </Descriptions>
            <EmailVerificationAction user={user} />
          </Card>

          <Card title={t('profile.permissions', { count: user.permissions.length })} style={{ marginTop: 16 }}>
            <ProfilePermissions permissions={user.permissions} />
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card title={t('profile.changePassword')}>
            {passwordError ? (
              <Alert type="error" showIcon title={passwordError} style={{ marginBottom: 16 }} />
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
