// Create / edit / view drawer of one role (MOD-03-T13): POST /api/roles for a
// new custom role, PATCH /api/roles/:id with the smallest body for an existing
// one. `academy_admin` is read-only (AC1); the other system roles expose their
// permission set only; custom roles expose everything. What the list shows
// after a save is the role the server returned (AC2).
// Since J-F39 (KI-057 — the guard of the class, user and course drawers:
// KI-052, KI-054, KI-055): while the form holds unsaved work — compared with
// the saved values through roleFormHasChanges(), so a change changed back
// holds nothing — Escape and a mask click no longer close the drawer, the close
// button asks first (common.unsaved.*), a browser back/forward asks the same
// question (NavigationBlocker), and a reload or a tab close gets the browser's
// own prompt (useUnsavedChangesGuard). The footer's Cancel is an explicit
// discard and closes at once, as an edit form's Cancel does in those drawers;
// academy_admin, shown read-only, never holds anything.
import { Alert, App, Button, Descriptions, Drawer, Flex, Form, Input, Space, Tag, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createRole, updateRole } from '../api/roles'
import type { PermissionGroup, Role } from '../api/roles'
import { useAuth } from '../auth/auth-context'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { useUnsavedChangesGuard } from '../common/useUnsavedChangesGuard'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { isValidRoleKey } from '../users/users.validation'
import { PermissionMatrix } from './PermissionMatrix'
import { describeRolesFailure, failureMessage } from './roles.errors'
import {
  LOCALIZED_TEXT_MAX_LENGTH,
  ROLE_PERMISSIONS_MAX,
  buildCreateRoleInput,
  isReservedRoleKey,
  lockedPermissions,
  planRolePatch,
  roleEditability,
  roleFormHasChanges,
  roleFormValuesOf,
} from './roles.policy'
import type { RoleFormValues } from './roles.policy'

export type EditorTarget = { mode: 'create' } | { mode: 'edit'; role: Role }

interface RoleEditorProps {
  /** What the drawer shows; null keeps it closed. */
  target: EditorTarget | null
  groups: PermissionGroup[]
  onClose: () => void
  /** Called with the role as the server returned it after a successful POST or PATCH. */
  onSaved: (role: Role, mode: EditorTarget['mode']) => void
}

export function RoleEditor({ target, groups, onClose, onSaved }: RoleEditorProps) {
  const { t } = useTranslation()
  // KI-057: whether the form holds unsaved work — reported by the body on every change.
  const [unsaved, setUnsaved] = useState(false)

  const close = () => {
    setUnsaved(false)
    onClose()
  }

  // The close button (Escape and the mask too when nothing is unsaved) asks first while the form
  // holds unsaved work, and so does a browser back/forward (NavigationBlocker below) — one question
  // (common.unsaved.*); a reload or a tab close gets the browser's own prompt (KI-055).
  const { requestClose, holdNavigation } = useUnsavedChangesGuard(unsaved, close)

  const title = target?.mode === 'edit' ? (roleEditability(target.role).permissions ? t('rolesAdmin.editor.editTitle') : t('rolesAdmin.editor.viewTitle')) : t('rolesAdmin.editor.createTitle')
  const bodyKey = target?.mode === 'edit' ? `${target.role.id}:${target.role.updatedAt}` : 'create'
  return (
    <Drawer
      open={target !== null}
      onClose={requestClose}
      // KI-057: unsaved work turns off the Escape key and the mask click.
      keyboard={!unsaved}
      mask={{ closable: !unsaved }}
      title={title}
      size={720}
      destroyOnHidden
    >
      <NavigationBlocker when={unsaved} onBlocked={holdNavigation} />
      {target ? (
        // Keyed so another role (or a fresh server copy of the same role) starts from a clean form.
        <RoleEditorBody key={bodyKey} target={target} groups={groups} onClose={close} onSaved={onSaved} onUnsavedChange={setUnsaved} />
      ) : null}
    </Drawer>
  )
}

interface RoleEditorBodyProps {
  target: EditorTarget
  groups: PermissionGroup[]
  /** The footer's Cancel / Close: an explicit discard, closes at once. */
  onClose: () => void
  onSaved: (role: Role, mode: EditorTarget['mode']) => void
  /** Whether the form holds unsaved work (KI-057): reported on every change, false once saved or left. */
  onUnsavedChange: (unsaved: boolean) => void
}

function RoleEditorBody({ target, groups, onClose, onSaved, onUnsavedChange }: RoleEditorBodyProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { user } = useAuth()
  const { language } = useLocalized()
  const role = target.mode === 'edit' ? target.role : null
  const editability = role ? roleEditability(role) : { metadata: true, permissions: true, deletable: true }
  const readOnly = !editability.metadata && !editability.permissions
  const callerPermissions = user?.permissions
  const locked = useMemo(
    () =>
      lockedPermissions(
        groups.flatMap((group) => group.permissions.map((permission) => permission.key)),
        callerPermissions ?? [],
        role?.permissions ?? [],
      ),
    [groups, callerPermissions, role],
  )
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // KI-057: the body left (the parent closed the drawer, or gave it another target) — nothing is held any more.
  useEffect(() => () => onUnsavedChange(false), [onUnsavedChange])

  const fail = (error: unknown) => {
    const described = describeRolesFailure(error)
    const text = failureMessage(t, described)
    if (described.field) form.setFields([{ name: described.field, errors: [text] }])
    else setFailure(text)
  }

  const submit = async (values: RoleFormValues) => {
    setFailure(null)
    if (role) {
      const patch = planRolePatch(role, values)
      if (!patch) {
        message.info(t('rolesAdmin.nothingChanged'))
        return
      }
      setSaving(true)
      try {
        const saved = await updateRole(role.id, patch)
        message.success(t('rolesAdmin.saved', { name: localizedLabel(saved.label, language) }))
        // Saved: nothing is left to lose, even before the parent closes the drawer.
        onUnsavedChange(false)
        onSaved(saved, 'edit')
      } catch (error) {
        fail(error)
      } finally {
        setSaving(false)
      }
      return
    }
    setSaving(true)
    try {
      const created = await createRole(buildCreateRoleInput(values))
      message.success(t('rolesAdmin.created', { name: localizedLabel(created.label, language) }))
      onUnsavedChange(false)
      onSaved(created, 'create')
    } catch (error) {
      fail(error)
    } finally {
      setSaving(false)
    }
  }

  const maxLengthRule = { max: LOCALIZED_TEXT_MAX_LENGTH, message: t('rolesAdmin.validation.maxLength', { max: LOCALIZED_TEXT_MAX_LENGTH }) }

  return (
    <>
      {role ? <RoleHeader role={role} /> : null}

      {readOnly ? <Alert type="info" showIcon message={t('rolesAdmin.editor.adminReadOnly')} style={{ marginBottom: 16 }} /> : null}
      {role && role.isSystem && !readOnly ? (
        <Alert type="info" showIcon message={t('rolesAdmin.editor.systemLabelsHint')} style={{ marginBottom: 16 }} />
      ) : null}
      {editability.permissions && locked.size > 0 ? (
        <Alert type="warning" showIcon message={t('rolesAdmin.editor.unreachableHint')} style={{ marginBottom: 16 }} />
      ) : null}
      {failure ? <Alert type="error" showIcon message={failure} style={{ marginBottom: 16 }} /> : null}

      <Form<RoleFormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={role ? roleFormValuesOf(role) : { permissions: [] }}
        // KI-057: compared with the saved values on every change, so a change changed back holds nothing.
        // onValuesChange is synchronous; Form.useWatch would report a MessageChannel task late, after an Escape.
        onValuesChange={(_changed, values) => onUnsavedChange(roleFormHasChanges(role, values))}
        onFinish={(values) => void submit(values)}
        disabled={saving}
      >
        {!role ? (
          <Form.Item
            name="key"
            label={t('rolesAdmin.fields.key')}
            extra={t('rolesAdmin.editor.keyHint')}
            rules={[
              {
                validator: (_rule, value: unknown) => {
                  const key = typeof value === 'string' ? value : ''
                  if (!isValidRoleKey(key)) return Promise.reject(new Error(t('rolesAdmin.validation.key')))
                  if (isReservedRoleKey(key)) return Promise.reject(new Error(t('rolesAdmin.validation.keyReserved')))
                  return Promise.resolve()
                },
              },
            ]}
          >
            <Input dir="ltr" autoComplete="off" maxLength={64} placeholder="librarian" />
          </Form.Item>
        ) : null}

        {editability.metadata ? (
          <>
            <Form.Item name="labelAr" label={t('rolesAdmin.fields.labelAr')} rules={[{ required: true, whitespace: true, message: t('rolesAdmin.validation.labelAr') }, maxLengthRule]}>
              <Input maxLength={LOCALIZED_TEXT_MAX_LENGTH} />
            </Form.Item>
            <Form.Item name="labelEn" label={t('rolesAdmin.fields.labelEn')} rules={[maxLengthRule]}>
              <Input dir="ltr" maxLength={LOCALIZED_TEXT_MAX_LENGTH} />
            </Form.Item>
            <Form.Item
              name="descriptionAr"
              label={t('rolesAdmin.fields.descriptionAr')}
              dependencies={['descriptionEn']}
              rules={[
                maxLengthRule,
                ({ getFieldValue }) => ({
                  validator: (_rule, value: unknown) => {
                    const english = String(getFieldValue('descriptionEn') ?? '').trim()
                    const arabic = typeof value === 'string' ? value.trim() : ''
                    // The server stores `{ ar, en? }` — an English description alone cannot be sent.
                    return english && !arabic ? Promise.reject(new Error(t('rolesAdmin.validation.descriptionAr'))) : Promise.resolve()
                  },
                }),
              ]}
            >
              <Input.TextArea rows={2} maxLength={LOCALIZED_TEXT_MAX_LENGTH} />
            </Form.Item>
            <Form.Item name="descriptionEn" label={t('rolesAdmin.fields.descriptionEn')} rules={[maxLengthRule]}>
              <Input.TextArea rows={2} dir="ltr" maxLength={LOCALIZED_TEXT_MAX_LENGTH} />
            </Form.Item>
          </>
        ) : null}

        <Form.Item
          name="permissions"
          label={t('rolesAdmin.fields.permissions')}
          rules={[
            {
              validator: (_rule, value: unknown) =>
                Array.isArray(value) && value.length > ROLE_PERMISSIONS_MAX
                  ? Promise.reject(new Error(t('rolesAdmin.validation.maxLength', { max: ROLE_PERMISSIONS_MAX })))
                  : Promise.resolve(),
            },
          ]}
        >
          <PermissionMatrix groups={groups} readOnly={!editability.permissions} locked={locked} />
        </Form.Item>

        <Space>
          {readOnly ? (
            <Button onClick={onClose}>{t('rolesAdmin.editor.close')}</Button>
          ) : (
            <>
              <Button type="primary" htmlType="submit" loading={saving}>
                {role ? t('common.save') : t('rolesAdmin.editor.submitCreate')}
              </Button>
              <Button onClick={onClose} disabled={saving}>
                {t('common.cancel')}
              </Button>
            </>
          )}
        </Space>
      </Form>
    </>
  )
}

function RoleHeader({ role }: { role: Role }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const editability = roleEditability(role)
  return (
    <Flex vertical gap={8} style={{ marginBottom: 16 }}>
      <Flex align="center" gap={8} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {localizedLabel(role.label, language)}
        </Typography.Title>
        <Tag color={role.isSystem ? 'geekblue' : 'green'}>{role.isSystem ? t('rolesAdmin.system') : t('rolesAdmin.custom')}</Tag>
      </Flex>
      <Descriptions
        column={1}
        size="small"
        items={[
          {
            key: 'key',
            label: t('rolesAdmin.fields.key'),
            children: (
              <Typography.Text code dir="ltr">
                {role.key}
              </Typography.Text>
            ),
          },
          { key: 'users', label: t('rolesAdmin.columns.users'), children: t('rolesAdmin.editor.usersHolding', { count: role.userCount }) },
          ...(!editability.metadata
            ? [
                ...(role.description ? [{ key: 'description', label: t('rolesAdmin.fields.description'), children: localizedLabel(role.description, language) }] : []),
              ]
            : []),
        ]}
      />
    </Flex>
  )
}
