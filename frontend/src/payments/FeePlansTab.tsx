// The «Fee plans» tab of /payments (API-140..143): every plan the caller may
// read — active ones for `invoices.manage`, inactive ones and their invoice
// counts too for `fee_plans.manage` — with what it prices, its total (the
// server's sum of the lines), its installment count and its state. With
// `fee_plans.manage`: create, edit (smallest PATCH), activate/deactivate and
// delete. A plan invoices were created from is refused with
// `409 fee_plan_in_use`; the tab then offers to deactivate it, as the server
// asks. Every write re-reads the list.
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../academy/useAcademy'
import { FEE_PLANS_MANAGE_PERMISSION, deleteFeePlan, listFeePlans, updateFeePlan } from '../api/feePlans'
import type { FeePlan } from '../api/feePlans'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { FeePlanModal } from './FeePlanModal'
import { describePaymentsFailure, failureMessage } from './payments.errors'
import { formatMoney } from './payments.format'

export function FeePlansTab() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message, modal } = App.useApp()
  const { hasPermission } = useAuth()
  const canManage = hasPermission(FEE_PLANS_MANAGE_PERMISSION)
  const { academy } = useAcademy()
  const currency = academy?.currency ?? ''
  const [tick, setTick] = useState(0)
  const [page, setPage] = useState<{ tick: number; plans: FeePlan[]; error: string | null }>({ tick: -1, plans: [], error: null })
  const [editing, setEditing] = useState<FeePlan | 'new' | null>(null)
  const reload = useCallback(() => setTick((value) => value + 1), [])
  const { plans, error } = page
  const loading = page.tick !== tick

  useEffect(() => {
    const controller = new AbortController()
    listFeePlans({}, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setPage({ tick, plans: list.items, error: null })
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setPage((current) => ({ ...current, tick, error: failureMessage(t, describePaymentsFailure(caught)) }))
      })
    return () => controller.abort()
  }, [tick, t])

  const setActive = async (plan: FeePlan, isActive: boolean) => {
    try {
      await updateFeePlan(plan.id, { isActive })
      message.success(t(isActive ? 'payments.feePlans.activated' : 'payments.feePlans.deactivated'))
    } catch (caught) {
      message.error(failureMessage(t, describePaymentsFailure(caught)))
    }
    reload()
  }

  const offerDeactivate = (plan: FeePlan, invoiceCount: number) => {
    modal.confirm({
      title: t('payments.feePlans.inUse.title'),
      content: t('payments.feePlans.inUse.content', { count: invoiceCount }),
      okText: t('payments.feePlans.deactivate'),
      cancelText: t('common.cancel'),
      onOk: () => setActive(plan, false),
    })
  }

  const remove = (plan: FeePlan) => {
    modal.confirm({
      title: t('payments.feePlans.delete.title', { name: localizedLabel(plan.name, language) }),
      content: t('payments.feePlans.delete.content'),
      okText: t('payments.feePlans.delete.ok'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await deleteFeePlan(plan.id)
          message.success(t('payments.feePlans.delete.done'))
          reload()
        } catch (caught) {
          if (caught instanceof ApiError && caught.code === 'fee_plan_in_use') {
            const body = (caught.body ?? {}) as { invoiceCount?: unknown }
            offerDeactivate(plan, typeof body.invoiceCount === 'number' ? body.invoiceCount : (plan.invoiceCount ?? 0))
            return
          }
          message.error(failureMessage(t, describePaymentsFailure(caught)))
          reload()
        }
      },
    })
  }

  const columns: TableProps<FeePlan>['columns'] = [
    {
      title: t('payments.feePlans.columns.name'),
      key: 'name',
      render: (_, plan) => (
        <span className="list-primary">
          <b>{localizedLabel(plan.name, language)}</b>
          {plan.invoiceCount !== null ? <small>{t('payments.feePlans.invoiceCount', { count: plan.invoiceCount })}</small> : null}
        </span>
      ),
    },
    {
      title: t('payments.feePlans.columns.scope'),
      key: 'scope',
      render: (_, plan) => {
        const ref = plan.class ?? plan.course
        if (!ref) return t('payments.feePlans.scopes.any')
        return (
          <span>
            {t(plan.class ? 'payments.feePlans.class' : 'payments.feePlans.course')}: {localizedLabel(ref.name, language)} (<bdi dir="ltr">{ref.code}</bdi>)
          </span>
        )
      },
    },
    { title: t('payments.columns.total'), key: 'total', align: 'end', render: (_, plan) => <bdi dir="ltr">{currency ? formatMoney(plan.total, currency, language) : plan.total}</bdi> },
    { title: t('payments.feePlans.columns.installments'), key: 'installments', align: 'end', render: (_, plan) => plan.installments.length },
    {
      title: t('common.status'),
      key: 'state',
      render: (_, plan) => <Tag className={`status-tag status-tag--${plan.isActive ? 'ok' : 'neutral'}`}>{t(plan.isActive ? 'payments.feePlans.active' : 'payments.feePlans.inactive')}</Tag>,
    },
    ...(canManage
      ? [
          {
            title: t('common.actions'),
            key: 'actions',
            render: (_: unknown, plan: FeePlan) => (
              <Space size={4} wrap>
                <Button size="small" onClick={() => setEditing(plan)}>
                  {t('common.edit')}
                </Button>
                <Button size="small" onClick={() => void setActive(plan, !plan.isActive)}>
                  {t(plan.isActive ? 'payments.feePlans.deactivate' : 'payments.feePlans.activate')}
                </Button>
                <Button size="small" danger onClick={() => remove(plan)}>
                  {t('payments.deleteAction')}
                </Button>
              </Space>
            ),
          },
        ]
      : []),
  ]

  return (
    <Card>
      <Flex justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 16 }}>
        <Typography.Text type="secondary">{t(canManage ? 'payments.feePlans.hintManage' : 'payments.feePlans.hintRead')}</Typography.Text>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={reload} aria-label={t('payments.refresh')} />
          {canManage ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
              {t('payments.feePlans.create')}
            </Button>
          ) : null}
        </Space>
      </Flex>
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Table<FeePlan> rowKey="id" columns={columns} dataSource={plans} loading={loading} pagination={false} scroll={{ x: 'max-content' }} locale={{ emptyText: t('payments.feePlans.empty') }} />
      <FeePlanModal
        plan={editing}
        currency={currency}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          setEditing(null)
          message.success(t('payments.feePlans.saved', { name: localizedLabel(saved.name, language) }))
          reload()
        }}
      />
    </Card>
  )
}
