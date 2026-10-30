// Users list (MOD-03-T11): GET /api/users with search, filters and keyset
// pagination; a detail/edit drawer and a creation wizard. Actions are shown by
// permission (`hasPermission`) — the server remains the security boundary.
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Checkbox, Flex, Input, Select, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { USER_STATUSES } from '../api/users'
import type { UserListItem } from '../api/users'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { CreateUserWizard } from '../users/CreateUserWizard'
import { UserDrawer } from '../users/UserDrawer'
import { PAGE_SIZES, useUsersList } from '../users/useUsersList'
import type { UsersListFilters } from '../users/useUsersList'
import { describeUsersFailure, failureMessage } from '../users/users.errors'
import { SYSTEM_ROLE_KEYS, displayNameOf, formatDateTime, roleLabel } from '../users/users.format'

export function UsersPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const canCreate = hasPermission('users.create')
  const contact = hasPermission('users.read_contact')
  const canSeeDeleted = hasPermission('users.deactivate')
  const list = useUsersList()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const selected = list.items.find((item) => item.id === selectedId)

  const columns: TableProps<UserListItem>['columns'] = [
    {
      title: t('common.name'),
      key: 'name',
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{row.fullName}</Typography.Text>
          {row.displayName && row.displayName !== row.fullName ? (
            <Typography.Text type="secondary">{row.displayName}</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    ...(contact
      ? [
          {
            title: t('users.columns.contact'),
            key: 'contact',
            render: (_: unknown, row: UserListItem) => (
              <Space orientation="vertical" size={0}>
                <Typography.Text dir="ltr">{row.email ?? row.username ?? '—'}</Typography.Text>
                {row.email && row.username ? (
                  <Typography.Text type="secondary" dir="ltr">
                    {row.username}
                  </Typography.Text>
                ) : null}
                {row.phone ? (
                  <Typography.Text type="secondary" dir="ltr">
                    {row.phone}
                  </Typography.Text>
                ) : null}
              </Space>
            ),
          },
        ]
      : []),
    {
      title: t('users.columns.roles'),
      key: 'roles',
      render: (_, row) => (
        <Space size={[4, 4]} wrap>
          {row.roles.map((key) => (
            <Tag key={key} color="blue">
              {roleLabel(key, t)}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t('common.status'),
      key: 'status',
      render: (_, row) => (
        <Space size={[4, 4]} wrap>
          <StatusTag value={row.status} />
          {row.deletedAt ? <Tag color="volcano">{t('users.deleted')}</Tag> : null}
        </Space>
      ),
    },
    {
      title: t('users.columns.createdAt'),
      key: 'createdAt',
      render: (_, row) => formatDateTime(row.createdAt, language),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => setSelectedId(row.id)} aria-label={`${t('common.view')}: ${displayNameOf(row)}`}>
          {t('common.view')}
        </Button>
      ),
    },
  ]

  const failure = list.error ? describeUsersFailure(list.error) : null

  return (
    <>
      <PageHeader
        title={t('users.title')}
        subtitle={t('users.subtitle')}
        extra={
          canCreate ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              {t('users.addUser')}
            </Button>
          ) : null
        }
      />

      {!contact ? <Alert type="info" showIcon message={t('users.reducedHint')} style={{ marginBottom: 16 }} /> : null}

      <Card>
        <Flex gap={12} wrap style={{ marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder={contact ? t('users.searchByNameOrContact') : t('users.searchByName')}
            aria-label={t('common.search')}
            defaultValue={list.filters.q}
            onSearch={(value) => list.setFilters({ q: value })}
            style={{ maxWidth: 320 }}
          />
          <Select<UsersListFilters['status']>
            allowClear
            placeholder={t('users.allStatuses')}
            aria-label={t('common.status')}
            value={list.filters.status}
            onChange={(value) => list.setFilters({ status: value })}
            options={USER_STATUSES.map((status) => ({ value: status, label: t(`labels.${status}`) }))}
            style={{ minWidth: 150 }}
          />
          <Select<string>
            allowClear
            placeholder={t('users.allRoles')}
            aria-label={t('users.role')}
            value={list.filters.role}
            onChange={(value) => list.setFilters({ role: value })}
            options={SYSTEM_ROLE_KEYS.map((key) => ({ value: key, label: roleLabel(key, t) }))}
            style={{ minWidth: 160 }}
          />
          <Select<UsersListFilters['sort']>
            value={list.filters.sort}
            onChange={(value) => list.setFilters({ sort: value })}
            options={[
              { value: 'createdAt', label: t('users.sortNewest') },
              { value: 'fullName', label: t('users.sortByName') },
            ]}
            style={{ minWidth: 150 }}
          />
          {canSeeDeleted ? (
            <Checkbox checked={list.filters.includeDeleted} onChange={(event) => list.setFilters({ includeDeleted: event.target.checked })}>
              {t('users.includeDeleted')}
            </Checkbox>
          ) : null}
          <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('users.refresh')} />
        </Flex>

        {failure ? (
          <Alert
            type="error"
            showIcon
            message={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={() => (failure.key.endsWith('cursor_invalid') ? list.setFilters({}) : list.reload())}>
                {t('users.refresh')}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<UserListItem>
          rowKey="id"
          columns={columns}
          dataSource={list.items}
          loading={list.loading}
          pagination={false}
          locale={{ emptyText: t('users.empty') }}
          onRow={(row) => ({ onClick: () => setSelectedId(row.id), style: { cursor: 'pointer' } })}
        />

        <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
          <Space>
            <Typography.Text type="secondary">{t('users.pagination.page', { page: list.pageNumber })}</Typography.Text>
            <Select<UsersListFilters['limit']>
              size="small"
              value={list.filters.limit}
              onChange={(value) => list.setFilters({ limit: value })}
              options={PAGE_SIZES.map((size) => ({ value: size, label: t('users.pagination.pageSize', { count: size }) }))}
            />
          </Space>
          <Space>
            <Button onClick={list.back} disabled={!list.canGoBack || list.loading}>
              {t('users.pagination.previous')}
            </Button>
            <Button onClick={list.next} disabled={!list.nextCursor || list.loading}>
              {t('users.pagination.next')}
            </Button>
          </Space>
        </Flex>
      </Card>

      <UserDrawer
        userId={selectedId}
        includeDeleted={Boolean(selected?.deletedAt)}
        onClose={() => setSelectedId(null)}
        onUpdated={list.replaceItem}
      />

      <CreateUserWizard
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(user) => {
          setCreating(false)
          list.showNewest()
          setSelectedId(user.id)
          message.success(t('users.create.created', { name: displayNameOf(user) }))
        }}
      />
    </>
  )
}
