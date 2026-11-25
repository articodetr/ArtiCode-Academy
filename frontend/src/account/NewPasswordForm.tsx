// Password + confirmation form shared by the invitation and reset pages
// (MOD-03-T12). Validates the MOD-01 policy locally for immediate feedback;
// the server stays the authority (password_weak → `error`).
import { LockOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input } from 'antd'
import type { FormInstance } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, isAcceptablePassword } from './account.links'

interface NewPasswordFormValues {
  password: string
  confirmPassword: string
}

interface NewPasswordFormProps {
  submitLabel: string
  submittingLabel: string
  submitting: boolean
  /** Keeps the form visible but inert, e.g. while the app's own session check is still running. */
  disabled?: boolean
  /** Server-side rejection to show above the fields. */
  error: string | null
  /** The page's own form instance, to put a server error under a field. */
  form?: FormInstance
  /** Fields shown above the password; their values reach `onSubmit` as its second argument. */
  extraFields?: ReactNode
  /** Initial values of `extraFields`. */
  initialValues?: Record<string, unknown>
  /** The password rules in words, under the password field (the registration's last step). */
  passwordHint?: ReactNode
  onSubmit: (password: string, extra: Record<string, unknown>) => void | Promise<void>
}

export function NewPasswordForm({
  submitLabel,
  submittingLabel,
  submitting,
  disabled = false,
  error,
  form,
  extraFields,
  initialValues,
  passwordHint,
  onSubmit,
}: NewPasswordFormProps) {
  const { t } = useTranslation()
  const onFinish = (values: NewPasswordFormValues) => {
    const extra: Record<string, unknown> = { ...values }
    delete extra.password
    delete extra.confirmPassword
    void onSubmit(values.password, extra)
  }
  return (
    <Form<NewPasswordFormValues>
      form={form}
      layout="vertical"
      requiredMark={false}
      initialValues={initialValues}
      onFinish={onFinish}
      disabled={submitting || disabled}
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}

      {extraFields}

      <Form.Item
        name="password"
        label={t('account.password')}
        extra={passwordHint}
        rules={[
          { required: true, message: t('account.validation.passwordRequired') },
          {
            validator: (_, value: string | undefined) =>
              !value || isAcceptablePassword(value)
                ? Promise.resolve()
                : Promise.reject(
                    new Error(t('account.validation.passwordPolicy', { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })),
                  ),
          },
        ]}
      >
        <Input.Password prefix={<LockOutlined />} autoComplete="new-password" autoFocus />
      </Form.Item>

      <Form.Item
        name="confirmPassword"
        label={t('account.confirmPassword')}
        dependencies={['password']}
        rules={[
          { required: true, message: t('account.validation.passwordRequired') },
          ({ getFieldValue }) => ({
            validator: (_, value: string | undefined) =>
              value === getFieldValue('password')
                ? Promise.resolve()
                : Promise.reject(new Error(t('account.validation.mismatch'))),
          }),
        ]}
      >
        <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
      </Form.Item>

      <Button type="primary" htmlType="submit" block loading={submitting}>
        {submitting ? submittingLabel : submitLabel}
      </Button>
    </Form>
  )
}
