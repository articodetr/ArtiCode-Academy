// The branches tab of the settings page (MOD-02-T06 screen, API-080..API-083):
// the list the server orders (main branch first, then by code), create/edit
// through BranchModal, and the row actions holders of `branches.manage` have —
// make main (API-082 `isMain: true`; an inactive branch is activated in the
// same request), activate/deactivate (the main branch cannot be deactivated —
// the button is disabled with the reason, as the server would answer
// `branch_is_main`), and delete behind a confirmation (never the main branch;
// a branch with rooms gets the server's `branch_in_use` message). Every write
// is followed by a re-read of the list: a promotion makes another branch step
// down, and the order comes from the server. Without `branches.manage` the tab
// is read-only (the route is gated anyway).
import { CheckCircleOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, StarFilled, StarOutlined, StopOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Popconfirm, Space, Table, Tag, Tooltip, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteBranch, updateBranch } from '../api/branches'
import type { Branch } from '../api/branches'
import { useAuth } from '../auth/auth-context'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { BranchModal } from './BranchModal'
import { describeBranchesFailure, failureMessage } from './branches.errors'
import { promoteBranchBody } from './branches.form'
import { MANAGE_BRANCHES_PERMISSION } from './branches.policy'
import { useBranches } from './useBranches'

const EMPTY = '—'

export function BranchesManager() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const canManage = hasPermission(MANAGE_BRANCHES_PERMISSION)
  const { branches, loading, error, reload } = useBranches()
  const [editing, setEditing] = useState<Branch | 'new' | null>(null)
  const [busy, setBusy] = useState(false)

  const nameOf = (branch: Branch) => localizedLabel(branch.name, language)

  /** Runs one write, then re-reads the list — after a refusal too (the list may be stale). */
  const run = async (task: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await task()
      message.success(success)
    } catch (caught) {
      message.error(failureMessage(t, describeBranchesFailure(caught)))
    } finally {
      setBusy(false)
      reload()
    }
  }

  const promote = (branch: Branch) => run(() => updateBranch(branch.id, promoteBranchBody(branch)), t('branches.promoted', { name: nameOf(branch) }))
  const activate = (branch: Branch) => run(() => updateBranch(branch.id, { isActive: true }), t('branches.activated', { name: nameOf(branch) }))
  const deactivate = (branch: Branch) => run(() => updateBranch(branch.id, { isActive: false }), t('branches.deactivated', { name: nameOf(branch) }))
  const remove = (branch: Branch) => run(() => deleteBranch(branch.id), t('branches.deleted', { name: nameOf(branch) }))

  const saved = (branch: Branch, created: boolean) => {
    setEditing(null)
    message.success(created ? t('branches.created', { name: nameOf(branch) }) : t('branches.saved'))
    reload()
  }

  const columns: TableProps<Branch>['columns'] = [
    {
      title: t('branches.columns.code'),
      key: 'code',
      render: (_, row) => (
        <Space size={6} wrap>
          <Typography.Text dir="ltr" strong>
            {row.code}
          </Typography.Text>
          {row.isMain ? (
            <Tag color="gold" icon={<StarFilled />}>
              {t('branches.main')}
            </Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: t('branches.columns.name'),
      key: 'name',
      render: (_, row) => (
        <Flex vertical>
          <span>{nameOf(row)}</span>
          {row.address ? <Typography.Text type="secondary">{localizedLabel(row.address, language)}</Typography.Text> : null}
        </Flex>
      ),
    },
    {
      title: t('branches.columns.phone'),
      key: 'phone',
      render: (_, row) => (row.phone ? <Typography.Text dir="ltr">{row.phone}</Typography.Text> : EMPTY),
    },
    {
      title: t('branches.columns.timezone'),
      key: 'timezone',
      render: (_, row) =>
        row.timezone ? <Typography.Text dir="ltr">{row.timezone}</Typography.Text> : <Typography.Text type="secondary">{t('branches.academyTimezone')}</Typography.Text>,
    },
    { title: t('branches.columns.status'), key: 'status', render: (_, row) => <StatusTag value={row.isActive ? 'active' : 'inactive'} /> },
  ]

  if (canManage) {
    columns.push({
      title: t('common.actions'),
      key: 'actions',
      render: (_, row) => {
        const name = nameOf(row)
        const deleteLabel = `${t('branches.actions.delete')}: ${row.code}`
        const deactivateLabel = `${t('branches.actions.deactivate')}: ${row.code}`
        return (
          <Space size={4} wrap>
            <Button size="small" icon={<EditOutlined />} aria-label={`${t('common.edit')}: ${row.code}`} disabled={busy} onClick={() => setEditing(row)} />
            {row.isMain ? null : (
              <Popconfirm
                title={t(row.isActive ? 'branches.actions.setMainConfirm' : 'branches.actions.setMainConfirmInactive', { name })}
                okText={t('branches.actions.setMain')}
                cancelText={t('common.cancel')}
                onConfirm={() => promote(row)}
              >
                <Button size="small" icon={<StarOutlined />} aria-label={`${t('branches.actions.setMain')}: ${row.code}`} disabled={busy} />
              </Popconfirm>
            )}
            {row.isActive ? (
              row.isMain ? (
                <Tooltip title={t('branches.actions.deactivateMainHint')}>
                  <span>
                    <Button size="small" icon={<StopOutlined />} aria-label={deactivateLabel} disabled />
                  </span>
                </Tooltip>
              ) : (
                <Popconfirm
                  title={t('branches.actions.deactivateConfirm', { name })}
                  okText={t('branches.actions.deactivate')}
                  cancelText={t('common.cancel')}
                  onConfirm={() => deactivate(row)}
                >
                  <Button size="small" icon={<StopOutlined />} aria-label={deactivateLabel} disabled={busy} />
                </Popconfirm>
              )
            ) : (
              <Button
                size="small"
                icon={<CheckCircleOutlined />}
                aria-label={`${t('branches.actions.activate')}: ${row.code}`}
                disabled={busy}
                onClick={() => void activate(row)}
              />
            )}
            {row.isMain ? (
              <Tooltip title={t('branches.actions.deleteMainHint')}>
                <span>
                  <Button size="small" danger icon={<DeleteOutlined />} aria-label={deleteLabel} disabled />
                </span>
              </Tooltip>
            ) : (
              <Popconfirm
                title={t('branches.actions.deleteConfirm', { name })}
                okText={t('branches.actions.delete')}
                okButtonProps={{ danger: true }}
                cancelText={t('common.cancel')}
                onConfirm={() => remove(row)}
              >
                <Button size="small" danger icon={<DeleteOutlined />} aria-label={deleteLabel} disabled={busy} />
              </Popconfirm>
            )}
          </Space>
        )
      },
    })
  }

  return (
    <Card>
      <Flex justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 16 }}>
        <Typography.Text type="secondary">{t(canManage ? 'branches.hint' : 'branches.readOnlyHint')}</Typography.Text>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={reload} aria-label={t('branches.refresh')} />
          {canManage ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
              {t('branches.add')}
            </Button>
          ) : null}
        </Space>
      </Flex>

      {error ? (
        <Alert
          type="error"
          showIcon
          title={t('branches.loadFailed')}
          description={failureMessage(t, describeBranchesFailure(error))}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={reload} loading={loading}>
              {t('branches.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Table<Branch>
        rowKey="id"
        columns={columns}
        dataSource={branches}
        loading={loading || busy}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('branches.empty') }}
      />

      {/* Mounted per session: its form starts from the chosen branch, never from the values of an earlier session (KI-049). */}
      {editing !== null ? (
        <BranchModal key={editing === 'new' ? 'new' : editing.id} open branch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={saved} />
      ) : null}
    </Card>
  )
}
