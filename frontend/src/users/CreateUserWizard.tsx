// Creation wizard (MOD-03-T11): kind → identity → profile and extra roles,
// then POST /api/users (API-014). The account is created as `invited`; the
// invitation link itself is issued from the user details (T12).
import { Alert, Button, Flex, Form, Modal, Radio, Select, Space, Steps, Typography } from 'antd'
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { createUser, USER_KINDS } from '../api/users'
import type { UserDetail, UserKind } from '../api/users'
import { useAuth } from '../auth/auth-context'
import { EmployeeProfileFields, IdentityFields, StudentProfileFields } from './UserFormFields'
import { buildCreateUserInput, extraRoleOptions, KIND_PROFILE } from './users.create'
import type { CreateUserFormValues } from './users.create'
import { describeUsersFailure, failureMessage } from './users.errors'
import { roleLabel } from './users.format'
import { ROLE_KEYS_MAX, isValidRoleKey } from './users.validation'

interface CreateUserWizardProps {
  open: boolean
  onClose: () => void
  /** Called with the created detail (full projection, status `invited`). */
  onCreated: (user: UserDetail) => void
}

export function CreateUserWizard({ open, onClose, onCreated }: CreateUserWizardProps) {
  const { t } = useTranslation()
  return (
    <Modal open={open} onCancel={onClose} title={t('users.create.title')} footer={null} width={640} maskClosable={false} destroyOnHidden>
      <WizardBody onClose={onClose} onCreated={onCreated} />
    </Modal>
  )
}

type StepKey = 'kind' | 'identity' | 'details'

const STEP_TITLES: Readonly<Record<StepKey, string>> = {
  kind: 'users.create.stepKind',
  identity: 'users.create.stepIdentity',
  details: 'users.create.stepDetails',
}

/** Fields mounted on the identity step (validated before moving on). */
const IDENTITY_FIELDS = ['fullName', 'fullNameLatin', 'displayName', 'email', 'username', 'phone', 'locale']

function WizardBody({ onClose, onCreated }: Omit<CreateUserWizardProps, 'open'>) {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const contact = hasPermission('users.read_contact')
  const canAssignRoles = hasPermission('users.roles.assign')
  const [form] = Form.useForm()
  const [kind, setKind] = useState<UserKind>('student')
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const profile = KIND_PROFILE[kind]
  const steps: StepKey[] = profile || canAssignRoles ? ['kind', 'identity', 'details'] : ['kind', 'identity']
  const current = steps[Math.min(step, steps.length - 1)] ?? 'kind'
  const isLast = current === steps[steps.length - 1]

  const goNext = async () => {
    if (current === 'identity') {
      try {
        await form.validateFields(IDENTITY_FIELDS)
      } catch {
        return
      }
    }
    setStep((value) => value + 1)
  }

  const submit = async () => {
    try {
      await form.validateFields()
    } catch {
      return
    }
    const values: CreateUserFormValues = { ...(form.getFieldsValue(true) as CreateUserFormValues), kind }
    setSubmitting(true)
    setFailure(null)
    try {
      onCreated(await createUser(buildCreateUserInput(values)))
    } catch (error) {
      const described = describeUsersFailure(error)
      const text = failureMessage(t, described)
      setFailure(text)
      if (described.field) {
        // Show the step that owns the field first (synchronously, so the field is mounted), then mark it.
        const owner: StepKey = described.field[0] === 'email' || described.field[0] === 'username' ? 'identity' : 'details'
        const index = steps.indexOf(owner)
        if (index >= 0) flushSync(() => setStep(index))
        form.setFields([{ name: described.field, errors: [text] }])
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Steps size="small" current={step} items={steps.map((key) => ({ title: t(STEP_TITLES[key]) }))} style={{ marginBottom: 24 }} />

      {failure ? <Alert type="error" showIcon message={failure} style={{ marginBottom: 16 }} /> : null}

      <Form<CreateUserFormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={submitting}
        onFinish={() => void (isLast ? submit() : goNext())}
      >
        {current === 'kind' ? (
          <Radio.Group value={kind} onChange={(event) => setKind(event.target.value as UserKind)} style={{ width: '100%' }}>
            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
              {USER_KINDS.map((option) => (
                <Radio key={option} value={option}>
                  <Typography.Text strong>{t(`users.kinds.${option}`)}</Typography.Text>
                  <br />
                  <Typography.Text type="secondary">{t(`users.kindHints.${option}`)}</Typography.Text>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        ) : null}

        {current === 'identity' ? (
          <>
            <Alert type="info" showIcon message={t('users.create.identifierHint')} style={{ marginBottom: 16 }} />
            <IdentityFields contact={contact} mode="create" />
          </>
        ) : null}

        {current === 'details' ? (
          <>
            {profile === 'student' ? <StudentProfileFields withNotes /> : null}
            {profile === 'employee' ? <EmployeeProfileFields /> : null}
            {profile === null ? <Alert type="info" showIcon message={t('users.create.noDetails')} style={{ marginBottom: 16 }} /> : null}
            {canAssignRoles ? (
              <Form.Item
                name="roleKeys"
                label={t('users.fields.roleKeys')}
                extra={t('users.create.extraRolesHint')}
                rules={[
                  {
                    validator: (_rule, value: unknown) => {
                      const keys = Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : []
                      if (keys.length > ROLE_KEYS_MAX) return Promise.reject(new Error(t('users.validation.maxLength', { max: ROLE_KEYS_MAX })))
                      return keys.every(isValidRoleKey) ? Promise.resolve() : Promise.reject(new Error(t('users.validation.roleKey')))
                    },
                  },
                ]}
              >
                <Select
                  mode="tags"
                  allowClear
                  tokenSeparators={[',', ' ']}
                  options={extraRoleOptions(kind).map((key) => ({ value: key, label: roleLabel(key, t) }))}
                />
              </Form.Item>
            ) : null}
          </>
        ) : null}

        <Flex justify="space-between" style={{ marginTop: 24 }}>
          <Button onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Space>
            {step > 0 ? (
              <Button onClick={() => setStep((value) => value - 1)} disabled={submitting}>
                {t('users.create.back')}
              </Button>
            ) : null}
            {isLast ? (
              <Button type="primary" htmlType="submit" loading={submitting}>
                {t('users.create.submit')}
              </Button>
            ) : (
              <Button type="primary" htmlType="submit">
                {t('users.create.next')}
              </Button>
            )}
          </Space>
        </Flex>
      </Form>
    </>
  )
}
