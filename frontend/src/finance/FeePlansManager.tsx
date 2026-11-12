// The fee plans tab of the settings page (J-F52 — MOD-11-T07, API-140..API-143;
// owner decision D-R60): the plans in the server's order (creation) with what
// each prices (nothing in particular, a course or a class), its total (the
// server's sum of the lines, in the academy currency), its shares, the invoices
// created from it and its state. Reading needs `fee_plans.manage` or
// `invoices.manage` — the latter sees the active plans only, read-only (to
// create invoices from them); `fee_plans.manage` also sees the inactive ones
// and the invoice counts, creates and edits plans (FeePlanModal), activates and
// deactivates them, and deletes a plan no invoice was created from — a used
// plan is deactivated instead (the button says why; the server's
// `fee_plan_in_use { invoiceCount }` covers a plan used meanwhile). Every write
// is followed by a re-read of the list. The route (`guarded('feePlans')`), the
// nav entry and SettingsPage (`RequireAccess navKey="feePlans"`) mount it for
// those two keys only; the server stays the boundary.
import { CheckCircleOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Popconfirm, Space, Table, Tag, Tooltip, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../academy/useAcademy'
import { deleteFeePlan, updateFeePlan } from '../api/feePlans'
import type { FeePlan } from '../api/feePlans'
import { useAuth } from '../auth/auth-context'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { FeePlanModal } from './FeePlanModal'
import { Money } from './FinanceTags'
import { describeFinanceFailure, failureMessage } from './finance.errors'
import { feePlanScopeOf, feePlanTargetLabel, sharesSummary } from './finance.format'
import { FEE_PLANS_MANAGE_PERMISSION } from './finance.policy'
import { useFeePlans } from './useFeePlans'

export function FeePlansManager() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const canManage = hasPermission(FEE_PLANS_MANAGE_PERMISSION)
  const { academy } = useAcademy()
  const currency = academy?.currency ?? null
  const { plans, loading, error, reload } = useFeePlans()
  const [editing, setEditing] = useState<FeePlan | 'new' | null>(null)
  const [busy, setBusy] = useState(false)

  const nameOf = (plan: FeePlan) => localizedLabel(plan.name, language)

  /** Runs one write, then re-reads the list — after a refusal too (the list may be stale). */
  const run = async (task: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await task()
      message.success(success)
    } catch (caught) {
      message.error(failureMessage(t, describeFinanceFailure(caught)))
    } finally {
      setBusy(false)
      reload()
    }
  }

  const activate = (plan: FeePlan) => run(() => updateFeePlan(plan.id, { isActive: true }), t('feePlans.activated', { name: nameOf(plan) }))
  const deactivate = (plan: FeePlan) => run(() => updateFeePlan(plan.id, { isActive: false }), t('feePlans.deactivated', { name: nameOf(plan) }))
  const remove = (plan: FeePlan) => run(() => deleteFeePlan(plan.id), t('feePlans.deleted', { name: nameOf(plan) }))

  const saved = (plan: FeePlan, created: boolean) => {
    setEditing(null)
    message.success(created ? t('feePlans.created', { name: nameOf(plan) }) : t('feePlans.saved'))
    reload()
  }

  const columns: TableProps<FeePlan>['columns'] = [
    { title: t('feePlans.columns.name'), key: 'name', render: (_, row) => <Typography.Text strong>{nameOf(row)}</Typography.Text> },
    {
      title: t('feePlans.columns.scope'),
      key: 'scope',
      render: (_, row) => {
        const target = feePlanTargetLabel(row, language)
        return (
          <span>
            <Tag>{t(`feePlans.scope.${feePlanScopeOf(row)}`)}</Tag>
            {target ? (
              <>
                <br />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  <bdi>{target}</bdi>
                </Typography.Text>
              </>
            ) : null}
          </span>
        )
      },
    },
    { title: t('feePlans.columns.total'), key: 'total', align: 'end', render: (_, row) => <Money amount={row.total} currency={currency} strong /> },
    {
      title: t('feePlans.columns.installments'),
      key: 'installments',
      render: (_, row) => (
        <span>
          {t('feePlans.sharesCount', { count: row.installments.length })}
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <bdi dir="ltr">{sharesSummary(row.installments)}</bdi>
          </Typography.Text>
        </span>
      ),
    },
    { title: t('feePlans.columns.invoices'), key: 'invoices', render: (_, row) => (row.invoiceCount === null ? '—' : row.invoiceCount) },
    { title: t('feePlans.columns.status'), key: 'status', render: (_, row) => <StatusTag value={row.isActive ? 'active' : 'inactive'} /> },
    ...(canManage
      ? [
          {
            title: t('common.actions'),
            key: 'actions',
            render: (_: unknown, row: FeePlan) => {
              const name = nameOf(row)
              const deleteLabel = `${t('feePlans.actions.delete')}: ${name}`
              const used = (row.invoiceCount ?? 0) > 0
              return (
                <Space size={4} wrap>
                  <Button size="small" icon={<EditOutlined />} aria-label={`${t('common.edit')}: ${name}`} disabled={busy} onClick={() => setEditing(row)} />
                  {row.isActive ? (
                    <Popconfirm
                      title={t('feePlans.actions.deactivateConfirm', { name })}
                      okText={t('feePlans.actions.deactivate')}
                      cancelText={t('common.cancel')}
                      onConfirm={() => deactivate(row)}
                    >
                      <Button size="small" icon={<StopOutlined />} aria-label={`${t('feePlans.actions.deactivate')}: ${name}`} disabled={busy} />
                    </Popconfirm>
                  ) : (
                    <Button size="small" icon={<CheckCircleOutlined />} aria-label={`${t('feePlans.actions.activate')}: ${name}`} disabled={busy} onClick={() => void activate(row)} />
                  )}
                  {used ? (
                    <Tooltip title={t('feePlans.actions.deleteInUseHint', { count: row.invoiceCount ?? 0 })}>
                      <span>
                        <Button size="small" danger icon={<DeleteOutlined />} aria-label={deleteLabel} disabled />
                      </span>
                    </Tooltip>
                  ) : (
                    <Popconfirm
                      title={t('feePlans.actions.deleteConfirm', { name })}
                      okText={t('feePlans.actions.delete')}
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
          },
        ]
      : []),
  ]

  return (
    <Card>
      <Flex justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 16 }}>
        <Typography.Text type="secondary">{t('feePlans.hint')}</Typography.Text>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={reload} aria-label={t('feePlans.refresh')} />
          {canManage ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
              {t('feePlans.add')}
            </Button>
          ) : null}
        </Space>
      </Flex>

      {!canManage ? <Alert type="info" showIcon title={t('feePlans.readOnlyHint')} style={{ marginBottom: 16 }} /> : null}

      {error ? (
        <Alert
          type="error"
          showIcon
          title={t('feePlans.loadFailed')}
          description={failureMessage(t, describeFinanceFailure(error))}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={reload} loading={loading}>
              {t('feePlans.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Table<FeePlan>
        rowKey="id"
        columns={columns}
        dataSource={plans}
        loading={loading || busy}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('feePlans.empty') }}
      />

      {/* Mounted per session: its form starts from the chosen plan, never from the values of an earlier session (KI-049). */}
      {editing !== null ? (
        <FeePlanModal
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.updatedAt}`}
          plan={editing === 'new' ? null : editing}
          currency={currency}
          onClose={() => setEditing(null)}
          onSaved={saved}
          onStale={reload}
        />
      ) : null}
    </Card>
  )
}
