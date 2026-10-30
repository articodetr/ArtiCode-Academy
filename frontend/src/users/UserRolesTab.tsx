// Roles tab of the user drawer (MOD-03-T14): a multi-select over the roles of
// GET /api/roles (API-022) saved as one full replacement through
// PUT /api/users/:id/roles (API-034). Locks mirror the server rules
// (users.roles.ts): roles the caller could not grant are disabled, a user out
// of the caller's reach is read-only, and `academy_admin` cannot be removed
// from oneself. After changing the signed-in user's own roles the session user
// is reloaded so the new permissions apply at once (AC2).
import { Alert, App, Button, Flex, Form, Radio, Select, Spin, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listRoles } from '../api/roles'
import type { Role } from '../api/roles'
import { EMPLOYEE_KINDS, replaceUserRoles } from '../api/users'
import type { EmployeeKind, UserDetail } from '../api/users'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { describeUsersFailure, failureMessage } from './users.errors'
import {
  diffRoleKeys,
  employeeKindRequired,
  heldRoleKeys,
  normaliseRoleKeys,
  outOfReachHeldRoles,
  planRolesReplacement,
  removesOwnAdmin,
  roleOptionsFor,
} from './users.roles'
import { ROLE_KEYS_MAX } from './users.validation'

interface UserRolesTabProps {
  user: UserDetail
  /** Called with the detail the server returned after the replacement. */
  onSaved: (user: UserDetail) => void
}

interface RolesFormValues {
  roleKeys?: string[]
  employeeKind?: EmployeeKind
}

export function UserRolesTab({ user, onSaved }: UserRolesTabProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { language } = useLocalized()
  const { user: me, reloadUser } = useAuth()
  const permissions = me?.permissions ?? []
  const selfId = me?.id ?? null
  const [roles, setRoles] = useState<Role[] | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Untyped: `setFields` receives the `string[]` name path of the backend failure.
  const [form] = Form.useForm()
  const selected = Form.useWatch('roleKeys', form) as string[] | undefined

  useEffect(() => {
    const controller = new AbortController()
    listRoles(controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setRoles(list.items)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error)
      })
    return () => controller.abort()
  }, [])

  // The form starts from the roles the detail holds and follows them after every save
  // (the Form element exists only once the roles are loaded).
  const held = heldRoleKeys(user)
  const heldKey = held.join(',')
  useEffect(() => {
    if (!roles) return
    form.setFieldsValue({ roleKeys: heldKey ? heldKey.split(',') : [], employeeKind: undefined })
  }, [form, heldKey, roles])

  if (loadError) {
    return <Alert type="error" showIcon message={t('users.rolesTab.loadFailed')} description={failureMessage(t, describeUsersFailure(loadError))} />
  }
  if (!roles) {
    return (
      <Flex justify="center" style={{ padding: 32 }}>
        <Spin />
      </Flex>
    )
  }

  const outOfReach = outOfReachHeldRoles(roles, user, permissions)
  const readOnly = Boolean(user.deletedAt) || outOfReach.length > 0
  const options = roleOptionsFor(roles, user, { permissions, selfId, language })
  const added = diffRoleKeys(held, normaliseRoleKeys(selected ?? held)).added
  const needsKind = employeeKindRequired(user, added)

  const onFinish = async (values: RolesFormValues) => {
    const plan = planRolesReplacement(user, values.roleKeys ?? [], values.employeeKind)
    if (!plan) {
      message.info(t('users.rolesTab.nothingChanged'))
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await replaceUserRoles(user.id, plan)
      const self = selfId !== null && selfId === user.id
      // AC2: the signed-in user's permissions come from their roles — refresh the session user.
      if (self) await reloadUser().catch(() => undefined)
      message.success(t(self ? 'users.rolesTab.savedSelf' : 'users.rolesTab.saved'))
      onSaved(updated)
    } catch (error) {
      const failure = describeUsersFailure(error)
      const text = failureMessage(t, failure)
      if (failure.key.endsWith('employee_kind_required')) form.setFields([{ name: 'employeeKind', errors: [text] }])
      else if (failure.field) form.setFields([{ name: failure.field, errors: [text] }])
      else setSaveError(text)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Form<RolesFormValues>
      form={form}
      layout="vertical"
      requiredMark={false}
      initialValues={{ roleKeys: held }}
      onFinish={onFinish}
      disabled={saving || readOnly}
    >
      {user.deletedAt ? (
        <Alert type="info" showIcon message={t('users.rolesTab.readOnlyDeleted')} style={{ marginBottom: 16 }} />
      ) : outOfReach.length > 0 ? (
        <Alert type="warning" showIcon message={t('users.rolesTab.outOfReach', { list: `(${outOfReach.join(', ')})` })} style={{ marginBottom: 16 }} />
      ) : null}
      {saveError ? <Alert type="error" showIcon message={saveError} style={{ marginBottom: 16 }} /> : null}

      <Form.Item
        name="roleKeys"
        label={t('users.rolesTab.label')}
        extra={t('users.rolesTab.hint')}
        rules={[
          {
            validator: (_rule, value: unknown) => {
              const keys = Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : []
              if (keys.length > ROLE_KEYS_MAX) return Promise.reject(new Error(t('users.rolesTab.maxRoles', { max: ROLE_KEYS_MAX })))
              if (removesOwnAdmin(user, selfId, keys)) return Promise.reject(new Error(t('users.rolesTab.lockedSelfAdmin')))
              return Promise.resolve()
            },
          },
        ]}
      >
        <Select
          mode="multiple"
          optionFilterProp="label"
          options={options.map((option) => ({
            value: option.value,
            label: option.label,
            disabled: option.lock !== null,
            title: option.lock === 'unreachable' ? t('users.rolesTab.lockedUnreachable') : option.lock === 'self_admin' ? t('users.rolesTab.lockedSelfAdmin') : undefined,
          }))}
        />
      </Form.Item>

      {needsKind ? (
        <Form.Item
          name="employeeKind"
          label={t('users.rolesTab.employeeKind')}
          extra={t('users.rolesTab.employeeKindHint')}
          rules={[{ required: true, message: t('users.links.required') }]}
        >
          <Radio.Group options={EMPLOYEE_KINDS.map((kind) => ({ value: kind, label: t(`users.kinds.${kind}`) }))} />
        </Form.Item>
      ) : null}

      <Typography.Paragraph type="secondary">{t('users.rolesTab.profilesHint')}</Typography.Paragraph>

      {!readOnly ? (
        <Button type="primary" htmlType="submit" loading={saving}>
          {t('users.rolesTab.save')}
        </Button>
      ) : null}
    </Form>
  )
}
