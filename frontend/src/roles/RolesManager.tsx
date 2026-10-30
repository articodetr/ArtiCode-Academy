// Roles and permissions management (MOD-03-T13, D-R06): the table of
// GET /api/roles, creation / editing in a drawer, deletion of unassigned
// custom roles. Rendered inside the settings page under /settings/roles for
// holders of `roles.manage` — the server remains the security boundary.
import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Popconfirm, Space, Table, Tag, Tooltip, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteRole } from '../api/roles'
import type { Role } from '../api/roles'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime, localizedLabel } from '../users/users.format'
import { RoleEditor } from './RoleEditor'
import type { EditorTarget } from './RoleEditor'
import { describeRolesFailure, failureMessage } from './roles.errors'
import { roleEditability } from './roles.policy'
import { useRoles } from './useRoles'

export function RolesManager() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const roles = useRoles()
  const [target, setTarget] = useState<EditorTarget | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const remove = async (role: Role) => {
    setDeletingId(role.id)
    try {
      await deleteRole(role.id)
      roles.removeRole(role.id)
      message.success(t('rolesAdmin.deleted', { name: localizedLabel(role.label, language) }))
    } catch (error) {
      message.error(failureMessage(t, describeRolesFailure(error)))
    } finally {
      setDeletingId(null)
    }
  }

  const columns: TableProps<Role>['columns'] = [
    {
      title: t('rolesAdmin.columns.role'),
      key: 'role',
      render: (_, role) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{localizedLabel(role.label, language)}</Typography.Text>
          <Typography.Text type="secondary" code dir="ltr">
            {role.key}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('rolesAdmin.columns.type'),
      key: 'type',
      render: (_, role) => <Tag color={role.isSystem ? 'geekblue' : 'green'}>{role.isSystem ? t('rolesAdmin.system') : t('rolesAdmin.custom')}</Tag>,
    },
    { title: t('rolesAdmin.columns.users'), key: 'users', render: (_, role) => role.userCount },
    {
      title: t('rolesAdmin.columns.permissions'),
      key: 'permissions',
      render: (_, role) => t('rolesAdmin.matrix.selectedCount', { count: role.permissions.length, total: roles.catalogSize }),
    },
    { title: t('rolesAdmin.columns.updatedAt'), key: 'updatedAt', render: (_, role) => formatDateTime(role.updatedAt, language) },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, role) => {
        const name = localizedLabel(role.label, language)
        const editability = roleEditability(role)
        const canEdit = editability.metadata || editability.permissions
        return (
          <Space size={4}>
            <Button
              type="link"
              size="small"
              icon={canEdit ? <EditOutlined /> : <EyeOutlined />}
              aria-label={`${canEdit ? t('rolesAdmin.actions.edit') : t('rolesAdmin.actions.view')}: ${name}`}
              onClick={() => setTarget({ mode: 'edit', role })}
            >
              {canEdit ? t('rolesAdmin.actions.edit') : t('rolesAdmin.actions.view')}
            </Button>
            {role.isSystem ? null : editability.deletable ? (
              <Popconfirm
                title={t('rolesAdmin.deleteConfirm', { name })}
                okText={t('rolesAdmin.actions.delete')}
                cancelText={t('common.cancel')}
                okButtonProps={{ danger: true }}
                onConfirm={() => void remove(role)}
              >
                <Button type="link" size="small" danger icon={<DeleteOutlined />} loading={deletingId === role.id} aria-label={`${t('rolesAdmin.actions.delete')}: ${name}`}>
                  {t('rolesAdmin.actions.delete')}
                </Button>
              </Popconfirm>
            ) : (
              <Tooltip title={t('rolesAdmin.deleteDisabledInUse', { count: role.userCount })}>
                <span>
                  <Button type="link" size="small" danger disabled icon={<DeleteOutlined />} aria-label={`${t('rolesAdmin.actions.delete')}: ${name}`}>
                    {t('rolesAdmin.actions.delete')}
                  </Button>
                </span>
              </Tooltip>
            )}
          </Space>
        )
      },
    },
  ]

  const failure = roles.error ? describeRolesFailure(roles.error) : null

  return (
    <>
      <Card>
        <Flex justify="space-between" align="center" gap={12} wrap style={{ marginBottom: 16 }}>
          <Typography.Text type="secondary">{t('rolesAdmin.intro')}</Typography.Text>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={roles.reload} loading={roles.loading}>
              {t('rolesAdmin.refresh')}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setTarget({ mode: 'create' })} disabled={roles.loading || roles.catalog.length === 0}>
              {t('rolesAdmin.addRole')}
            </Button>
          </Space>
        </Flex>

        {failure ? (
          <Alert
            type="error"
            showIcon
            message={t('rolesAdmin.loadFailed')}
            description={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={roles.reload}>
                {t('rolesAdmin.refresh')}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<Role>
          rowKey="id"
          columns={columns}
          dataSource={roles.roles}
          loading={roles.loading}
          pagination={false}
          size="middle"
          locale={{ emptyText: t('rolesAdmin.empty') }}
        />
      </Card>

      <RoleEditor
        target={target}
        groups={roles.catalog}
        onClose={() => setTarget(null)}
        onSaved={(role, mode) => {
          // The row shows the role exactly as the server returned it — no optimistic state.
          if (mode === 'create') roles.addRole(role)
          else roles.replaceRole(role)
          setTarget(null)
        }}
      />
    </>
  )
}
