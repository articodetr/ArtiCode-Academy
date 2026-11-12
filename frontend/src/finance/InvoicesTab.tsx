// The invoices tab of /payments (J-F52 — API-144): newest first with keyset
// pages, filtered by part of the number, the stored status, what is paid of an
// issued invoice, overdue, the class (`classes.read`), the student
// (`users.read`) and the fee plan (API-140 — `fee_plans.manage` or
// `invoices.manage`). Every amount and state is the server's: the total, the
// paid amount, the balance, the payment state, overdue and the next installment
// are computed on read (D-R62, ADR-068) and shown as returned. A row opens the
// invoice drawer (the page owns it, so a receipt can open it too).
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Flex, Input, Select, Space, Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { INVOICE_STATUSES, NUMBER_SEARCH_MAX_LENGTH, PAYMENT_STATES } from '../api/invoices'
import type { InvoiceSummary } from '../api/invoices'
import { useAuth } from '../auth/auth-context'
import { StudentPicker } from '../classes/ClassPickers'
import { useLocalized } from '../i18n/useLocalized'
import { ClassPicker } from '../timetable/TimetablePickers'
import { displayNameOf, formatDay, localizedLabel } from '../users/users.format'
import { InvoiceStatusTag, Money, OverdueTag, PaymentStateTag } from './FinanceTags'
import { describeFinanceFailure, failureMessage, isFinanceFailure } from './finance.errors'
import { formatMoney, invoiceNumberOf } from './finance.format'
import { FEE_PLAN_READ_PERMISSIONS, holdsAny } from './finance.policy'
import { useFeePlans } from './useFeePlans'
import { DEFAULT_INVOICE_FILTERS, INVOICE_PAGE_SIZES, hasActiveInvoiceFilters, useInvoicesList } from './useInvoicesList'
import type { InvoicesListFilters } from './useInvoicesList'

type OverdueChoice = 'yes' | 'no'

interface InvoicesTabProps {
  /** Opens the invoice drawer. */
  onOpen: (invoiceId: string) => void
  /** Bumped by the page after a write elsewhere (the drawer, a new invoice, a class batch): the page on screen is read again. */
  refreshKey: number
}

export function InvoicesTab({ onOpen, refreshKey }: InvoicesTabProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { user, hasPermission } = useAuth()
  const list = useInvoicesList()
  const { reload } = list
  const [search, setSearch] = useState('')
  const canPickClass = hasPermission('classes.read')
  const canPickStudent = hasPermission('users.read')
  const canReadPlans = holdsAny(user?.permissions ?? [], FEE_PLAN_READ_PERMISSIONS)
  const feePlans = useFeePlans(canReadPlans)

  useEffect(() => {
    if (refreshKey > 0) reload()
  }, [refreshKey, reload])

  const columns: TableProps<InvoiceSummary>['columns'] = [
    {
      title: t('invoices.columns.number'),
      key: 'number',
      render: (_, row) => {
        const number = invoiceNumberOf(row)
        return number ? (
          <Typography.Text strong dir="ltr">
            {number}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">{t('finance.draftNumber')}</Typography.Text>
        )
      },
    },
    {
      title: t('invoices.columns.student'),
      key: 'student',
      render: (_, row) => (
        <span>
          {displayNameOf(row.student)}
          {row.enrollment ? (
            <>
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                <bdi dir="ltr">{row.enrollment.class.code}</bdi> — {localizedLabel(row.enrollment.class.name, language)}
              </Typography.Text>
            </>
          ) : null}
        </span>
      ),
    },
    { title: t('invoices.columns.total'), key: 'total', align: 'end', render: (_, row) => <Money amount={row.total} currency={row.currency} strong /> },
    { title: t('invoices.columns.paid'), key: 'paid', align: 'end', render: (_, row) => (row.status === 'draft' ? '—' : <Money amount={row.paid} currency={row.currency} />) },
    { title: t('invoices.columns.balance'), key: 'balance', align: 'end', render: (_, row) => (row.status === 'draft' ? '—' : <Money amount={row.balance} currency={row.currency} />) },
    {
      title: t('invoices.columns.payment'),
      key: 'payment',
      render: (_, row) =>
        row.status === 'issued' ? (
          <span>
            <PaymentStateTag state={row.paymentState} />
            {row.overdue ? <OverdueTag /> : null}
          </span>
        ) : (
          '—'
        ),
    },
    {
      title: t('invoices.columns.nextDue'),
      key: 'nextDue',
      render: (_, row) =>
        row.nextDue ? (
          <span>
            {formatDay(row.nextDue.dueOn, language)}
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <bdi>{formatMoney(row.nextDue.remaining, row.currency, language)}</bdi>
            </Typography.Text>
          </span>
        ) : (
          '—'
        ),
    },
    { title: t('invoices.columns.status'), key: 'status', render: (_, row) => <InvoiceStatusTag status={row.status} /> },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          onClick={(event) => {
            event.stopPropagation()
            onOpen(row.id)
          }}
          aria-label={`${t('common.view')}: ${invoiceNumberOf(row) ?? t('finance.draftNumber')}`}
        >
          {t('common.view')}
        </Button>
      ),
    },
  ]

  const failure = list.error ? describeFinanceFailure(list.error) : null
  const overdueChoice: OverdueChoice | undefined = list.filters.overdue === undefined ? undefined : list.filters.overdue ? 'yes' : 'no'

  return (
    <Card>
      <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          value={search}
          maxLength={NUMBER_SEARCH_MAX_LENGTH}
          placeholder={t('invoices.filters.search')}
          aria-label={t('invoices.filters.search')}
          onChange={(event) => {
            setSearch(event.target.value)
            // The clear button empties the box: the list follows at once.
            if (event.target.value === '' && list.filters.q) list.setFilters({ q: '' })
          }}
          onSearch={(value) => list.setFilters({ q: value.trim() })}
          style={{ width: 220 }}
        />
        <Select<InvoicesListFilters['status']>
          allowClear
          placeholder={t('invoices.filters.allStatuses')}
          aria-label={t('invoices.columns.status')}
          value={list.filters.status}
          onChange={(value) => list.setFilters({ status: value })}
          options={INVOICE_STATUSES.map((status) => ({ value: status, label: t(`finance.invoiceStatus.${status}`) }))}
          style={{ minWidth: 140 }}
        />
        <Select<InvoicesListFilters['balance']>
          allowClear
          placeholder={t('invoices.filters.allBalances')}
          aria-label={t('invoices.columns.payment')}
          value={list.filters.balance}
          onChange={(value) => list.setFilters({ balance: value })}
          options={PAYMENT_STATES.map((state) => ({ value: state, label: t(`finance.paymentState.${state}`) }))}
          style={{ minWidth: 160 }}
        />
        <Select<OverdueChoice>
          allowClear
          placeholder={t('invoices.filters.overdueAny')}
          aria-label={t('invoices.filters.overdue')}
          value={overdueChoice}
          onChange={(value) => list.setFilters({ overdue: value === undefined ? undefined : value === 'yes' })}
          options={[
            { value: 'yes', label: t('invoices.filters.overdueOnly') },
            { value: 'no', label: t('invoices.filters.notOverdue') },
          ]}
          style={{ minWidth: 150 }}
        />
        {canPickClass ? (
          <ClassPicker
            allowClear
            placeholder={t('invoices.filters.allClasses')}
            aria-label={t('invoices.columns.class')}
            value={list.filters.classId}
            onChange={(value) => list.setFilters({ classId: value })}
            style={{ minWidth: 220 }}
          />
        ) : null}
        {canPickStudent ? (
          <StudentPicker
            allowClear
            placeholder={t('invoices.filters.allStudents')}
            aria-label={t('invoices.columns.student')}
            value={list.filters.studentId}
            onChange={(value) => list.setFilters({ studentId: value })}
            style={{ minWidth: 200 }}
          />
        ) : null}
        {canReadPlans ? (
          <Select<string>
            allowClear
            placeholder={t('invoices.filters.allPlans')}
            aria-label={t('invoices.filters.plan')}
            value={list.filters.feePlanId}
            onChange={(value) => list.setFilters({ feePlanId: value })}
            loading={feePlans.loading}
            options={feePlans.plans.map((plan) => ({ value: plan.id, label: localizedLabel(plan.name, language) }))}
            style={{ minWidth: 180 }}
            popupMatchSelectWidth={false}
          />
        ) : null}
        <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('invoices.refresh')} />
      </Flex>
      {list.filters.balance ? (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -8 }}>
          {t('invoices.filters.balanceHint')}
        </Typography.Paragraph>
      ) : null}

      {failure ? (
        <Alert
          type="error"
          showIcon
          title={failureMessage(t, failure)}
          action={
            <Button
              size="small"
              onClick={() => {
                if (isFinanceFailure(failure, 'cursor_invalid')) {
                  setSearch('')
                  list.setFilters(DEFAULT_INVOICE_FILTERS)
                } else list.reload()
              }}
            >
              {t('invoices.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Table<InvoiceSummary>
        rowKey="id"
        columns={columns}
        dataSource={list.items}
        loading={list.loading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: hasActiveInvoiceFilters(list.filters) ? t('invoices.emptyFiltered') : t('invoices.empty') }}
        onRow={(row) => ({ onClick: () => onOpen(row.id), style: { cursor: 'pointer' } })}
      />

      <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
        <Space>
          <Typography.Text type="secondary">{t('payments.pagination.page', { page: list.pageNumber })}</Typography.Text>
          <Select<InvoicesListFilters['limit']>
            size="small"
            value={list.filters.limit}
            aria-label={t('payments.pagination.pageSizeLabel')}
            onChange={(value) => list.setFilters({ limit: value })}
            options={INVOICE_PAGE_SIZES.map((size) => ({ value: size, label: t('payments.pagination.pageSize', { count: size }) }))}
          />
        </Space>
        <Space>
          <Button onClick={list.back} disabled={!list.canGoBack || list.loading}>
            {t('payments.pagination.previous')}
          </Button>
          <Button onClick={list.next} disabled={!list.nextCursor || list.loading}>
            {t('payments.pagination.next')}
          </Button>
        </Space>
      </Flex>
    </Card>
  )
}
