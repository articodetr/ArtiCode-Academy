// Users list (MOD-03-T11): GET /api/users with search, filters and keyset
// pagination; a detail/edit drawer and a creation wizard. Actions are shown by
// permission (`hasPermission`) — the server remains the security boundary.
// Since J-F12 custom roles carry their server labels in the roles column and
// in the role filter (GET /api/roles once per visit — useRoleLabels()); since
// J-F23 the drawer's roles tab reuses that read (PR #62 review, note 1).
// A student or a teacher is added in one step (QuickCreateUserModal: name,
// e-mail, phone — then the invitation link at once); the full wizard stays
// for the other kinds behind «حساب آخر».
import { PlusOutlined, ReloadOutlined, UserAddOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Checkbox, Flex, Input, Select, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IssuedLinkModal } from '../account/IssuedLinkModal'
import type { IssuedLink } from '../api/account'
import { USER_SEARCH_MAX_LENGTH, USER_STATUSES } from '../api/users'
import type { UserKind, UserListItem } from '../api/users'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { CreateUserWizard } from '../users/CreateUserWizard'
import { QuickCreateUserModal } from '../users/QuickCreateUserModal'
import type { QuickCreateOutcome } from '../users/QuickCreateUserModal'
import { UserDrawer } from '../users/UserDrawer'
import { useRoleLabels } from '../users/useRoleLabels'
import { PAGE_SIZES, useUsersList } from '../users/useUsersList'
import type { UsersListFilters } from '../users/useUsersList'
import { describeUsersFailure, failureMessage } from '../users/users.errors'
import { displayNameOf, formatDateTime, roleFilterKeys, roleLabel } from '../users/users.format'
import { OTHER_USER_KINDS, isOtherUserKind, isQuickCreateKind } from '../users/users.quickCreate'
import type { QuickCreateKind } from '../users/users.quickCreate'
import { useCreateFromLink } from '../common/useCreateFromLink'
import { useOpenFromSearch } from '../common/useOpenFromSearch'

export function UsersPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const canCreate = hasPermission('users.create')
  const contact = hasPermission('users.read_contact')
  const canSeeDeleted = hasPermission('users.deactivate')
  const list = useUsersList()
  const roles = useRoleLabels()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The global search opens a record here through `?open=<id>`.
  useOpenFromSearch(setSelectedId)
  // The one-step form of a student or a teacher; null = closed.
  const [quickKind, setQuickKind] = useState<QuickCreateKind | null>(null)
  // The invitation issued for an account just created, shown ONCE; the token lives in this state only.
  const [invitation, setInvitation] = useState<{ userId: string; link: IssuedLink } | null>(null)
  // The full wizard of the other kinds («حساب آخر»).
  const [creating, setCreating] = useState(false)
  // The kind the wizard opens on: `?create=staff|guardian`, else the first of OTHER_USER_KINDS.
  const [createKind, setCreateKind] = useState<UserKind | undefined>(undefined)
  // `?create=student|teacher` comes from the dashboard's «add a student / a teacher» (J-F59).
  useCreateFromLink((what) => {
    if (!canCreate) return
    if (isQuickCreateKind(what)) {
      setQuickKind(what)
    } else if (isOtherUserKind(what)) {
      setCreateKind(what)
      setCreating(true)
    }
  })

  const onQuickCreated = (outcome: QuickCreateOutcome) => {
    const { kind, user } = outcome
    setQuickKind(null)
    list.showNewest()
    message.success(t(`users.quick.created.${kind}`, { name: displayNameOf(user) }))
    if (outcome.invitation) {
      // The drawer opens once the link has been seen (IssuedLinkModal's onClose).
      setInvitation({ userId: user.id, link: outcome.invitation })
      return
    }
    message.warning({
      content: t('users.quick.invitationFailed', { reason: failureMessage(t, outcome.invitationFailure) }),
      duration: 8,
    })
    setSelectedId(user.id)
  }

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
            // Each value in a plain `<bdi dir="ltr">`: on an antd Typography the attribute loses to its `-rtl` class,
            // so `+966500000001` showed as `966500000001+` (QA 2026-11-17 — the audit page's rule, KI-093).
            render: (_: unknown, row: UserListItem) => (
              <Space orientation="vertical" size={0}>
                <Typography.Text>{row.email || row.username ? <bdi dir="ltr">{row.email || row.username}</bdi> : '—'}</Typography.Text>
                {row.email && row.username ? (
                  <Typography.Text type="secondary">
                    <bdi dir="ltr">{row.username}</bdi>
                  </Typography.Text>
                ) : null}
                {row.phone ? (
                  <Typography.Text type="secondary">
                    <bdi dir="ltr">{row.phone}</bdi>
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
              {roleLabel(key, t, roles.labels)}
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
            // Wraps onto a second line on a phone instead of widening the page.
            <Flex gap={8} wrap>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setQuickKind('student')}>
                {t('users.addStudent')}
              </Button>
              <Button icon={<PlusOutlined />} onClick={() => setQuickKind('teacher')}>
                {t('users.addTeacher')}
              </Button>
              <Button
                type="text"
                icon={<UserAddOutlined />}
                onClick={() => {
                  setCreateKind(undefined)
                  setCreating(true)
                }}
              >
                {t('users.addOther')}
              </Button>
            </Flex>
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
            maxLength={USER_SEARCH_MAX_LENGTH}
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
            options={roleFilterKeys(roles.keys).map((key) => ({ value: key, label: roleLabel(key, t, roles.labels) }))}
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
          // On a phone the table scrolls inside its own box instead of widening the page (KI-094). `true`, not
          // 'max-content': the table still fills its box and wraps like before whenever it fits (a desktop),
          // so the box scrolls only when the columns cannot shrink any further.
          scroll={{ x: true }}
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
        loadedRoles={roles.items}
        onClose={() => setSelectedId(null)}
        onUpdated={list.replaceItem}
        onRemoved={() => {
          setSelectedId(null)
          list.reload()
        }}
      />

      <QuickCreateUserModal kind={quickKind} onClose={() => setQuickKind(null)} onCreated={onQuickCreated} />

      <IssuedLinkModal
        kind="invitation"
        issued={invitation?.link ?? null}
        onClose={() => {
          const userId = invitation?.userId ?? null
          setInvitation(null)
          if (userId) setSelectedId(userId)
        }}
      />

      <CreateUserWizard
        open={creating}
        initialKind={createKind}
        kinds={OTHER_USER_KINDS}
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
