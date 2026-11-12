// The receipts tab of /payments (J-F52 — API-152): newest first with keyset
// pages, filtered by part of the receipt number, the method, the status, the
// student (`users.read`) and a range of days read in the academy's zone (the
// server's upper bound is exclusive — usePaymentsList.ts). Each row carries its
// invoice as it stands now (the server's); its number opens the invoice drawer,
// the print link opens the receipt page, and a holder of `payments.refund`
// reverses a completed payment with a reason (API-154 — the row shows the
// server's answer, and the invoices re-read).
import { PrinterOutlined, ReloadOutlined, RollbackOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Input, Select, Space, Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAcademy } from '../academy/useAcademy'
import { NUMBER_SEARCH_MAX_LENGTH } from '../api/invoices'
import { PAYMENT_METHODS, PAYMENT_STATUSES, reversePayment } from '../api/payments'
import type { Payment } from '../api/payments'
import { academyZoneOf, differsFromDevice } from '../assignments/assignments.zone'
import { useAuth } from '../auth/auth-context'
import { StudentPicker } from '../classes/ClassPickers'
import { useLocalized } from '../i18n/useLocalized'
import { isCalendarDate } from '../timetable/timetable.dates'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { displayNameOf, formatDateTime } from '../users/users.format'
import { Money, PaymentStatusTag } from './FinanceTags'
import { ReasonModal } from './ReasonModal'
import { describeFinanceFailure, failureMessage, isFinanceFailure } from './finance.errors'
import { formatMoney, invoiceNumberOf } from './finance.format'
import { canReversePayment } from './invoices.status'
import { PAYMENT_PAGE_SIZES, defaultPaymentFilters, hasActivePaymentFilters, usePaymentsList } from './usePaymentsList'
import type { PaymentsListFilters } from './usePaymentsList'

function DayInput({ value, onChange, label }: { value: string | undefined; onChange: (value: string | undefined) => void; label: string }) {
  return <input type="date" aria-label={label} className="ant-input" value={value ?? ''} onChange={(event) => onChange(isCalendarDate(event.target.value) ? event.target.value : undefined)} style={{ width: 170 }} />
}

interface ReceiptsTabProps {
  /** Opens the drawer of a receipt's invoice. */
  onOpenInvoice: (invoiceId: string) => void
  /** Bumped by the page after a payment was recorded or reversed elsewhere: the page on screen is read again. */
  refreshKey: number
  /** A payment was reversed here: the invoices re-read. */
  onReversed: () => void
}

export function ReceiptsTab({ onOpenInvoice, refreshKey, onReversed }: ReceiptsTabProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { user, hasPermission } = useAuth()
  const permissions = user?.permissions ?? []
  const { academy } = useAcademy()
  // The days are read in the academy's zone, this device's until it is known.
  const dayZone = academyZoneOf(academy) ?? deviceTimeZone()
  const [defaults] = useState(() => defaultPaymentFilters(dayZone))
  const list = usePaymentsList(defaults)
  const { reload } = list
  const [search, setSearch] = useState('')
  const [reversing, setReversing] = useState<Payment | null>(null)
  const canPickStudent = hasPermission('users.read')

  useEffect(() => {
    if (refreshKey > 0) reload()
  }, [refreshKey, reload])

  const columns: TableProps<Payment>['columns'] = [
    {
      title: t('payments.receipts.columns.number'),
      key: 'number',
      render: (_, row) => (
        <Typography.Text strong dir="ltr">
          {row.number}
        </Typography.Text>
      ),
    },
    { title: t('payments.receipts.columns.paidAt'), key: 'paidAt', render: (_, row) => formatDateTime(row.paidAt, language) },
    { title: t('payments.receipts.columns.student'), key: 'student', render: (_, row) => displayNameOf(row.student) },
    {
      title: t('payments.receipts.columns.invoice'),
      key: 'invoice',
      render: (_, row) => {
        const number = invoiceNumberOf(row.invoice) ?? t('finance.draftNumber')
        return (
          <Button type="link" size="small" style={{ paddingInline: 0 }} onClick={() => onOpenInvoice(row.invoice.id)} aria-label={t('payments.receipts.openInvoice', { number })}>
            <bdi dir="ltr">{number}</bdi>
          </Button>
        )
      },
    },
    { title: t('payments.receipts.columns.amount'), key: 'amount', align: 'end', render: (_, row) => <Money amount={row.amount} currency={row.currency} strong /> },
    { title: t('payments.receipts.columns.method'), key: 'method', render: (_, row) => t(`finance.methods.${row.method}`) },
    {
      title: t('payments.receipts.columns.status'),
      key: 'status',
      render: (_, row) => (
        <span>
          <PaymentStatusTag status={row.status} />
          {row.status === 'reversed' && row.reversedAt ? (
            <>
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('payments.receipts.reversedOn', { date: formatDateTime(row.reversedAt, language) })}
              </Typography.Text>
            </>
          ) : null}
        </span>
      ),
    },
    { title: t('payments.receipts.columns.recordedBy'), key: 'recordedBy', render: (_, row) => row.recordedBy?.fullName ?? '—' },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, row) => (
        <Space size={4} wrap>
          <Link to={`/payments/${encodeURIComponent(row.id)}/receipt`} target="_blank" rel="noopener" aria-label={`${t('payments.receipts.print')}: ${row.number}`}>
            <PrinterOutlined /> {t('payments.receipts.printShort')}
          </Link>
          {canReversePayment(row, permissions) ? (
            <Button size="small" danger icon={<RollbackOutlined />} onClick={() => setReversing(row)} aria-label={`${t('payments.receipts.reverse')}: ${row.number}`}>
              {t('payments.receipts.reverseShort')}
            </Button>
          ) : null}
        </Space>
      ),
    },
  ]

  const failure = list.error ? describeFinanceFailure(list.error) : null

  return (
    <Card>
      <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          value={search}
          maxLength={NUMBER_SEARCH_MAX_LENGTH}
          placeholder={t('payments.receipts.filters.search')}
          aria-label={t('payments.receipts.filters.search')}
          onChange={(event) => {
            setSearch(event.target.value)
            if (event.target.value === '' && list.filters.q) list.setFilters({ q: '' })
          }}
          onSearch={(value) => list.setFilters({ q: value.trim() })}
          style={{ width: 220 }}
        />
        <Select<PaymentsListFilters['method']>
          allowClear
          placeholder={t('payments.receipts.filters.allMethods')}
          aria-label={t('payments.receipts.columns.method')}
          value={list.filters.method}
          onChange={(value) => list.setFilters({ method: value })}
          options={PAYMENT_METHODS.map((method) => ({ value: method, label: t(`finance.methods.${method}`) }))}
          style={{ minWidth: 150 }}
        />
        <Select<PaymentsListFilters['status']>
          allowClear
          placeholder={t('payments.receipts.filters.allStatuses')}
          aria-label={t('payments.receipts.columns.status')}
          value={list.filters.status}
          onChange={(value) => list.setFilters({ status: value })}
          options={PAYMENT_STATUSES.map((status) => ({ value: status, label: t(`finance.paymentStatus.${status}`) }))}
          style={{ minWidth: 140 }}
        />
        {canPickStudent ? (
          <StudentPicker
            allowClear
            placeholder={t('payments.receipts.filters.allStudents')}
            aria-label={t('payments.receipts.columns.student')}
            value={list.filters.studentId}
            onChange={(value) => list.setFilters({ studentId: value })}
            style={{ minWidth: 200 }}
          />
        ) : null}
        <DayInput label={t('payments.receipts.filters.from')} value={list.filters.from} onChange={(value) => list.setFilters({ from: value, timeZone: dayZone })} />
        <DayInput label={t('payments.receipts.filters.to')} value={list.filters.to} onChange={(value) => list.setFilters({ to: value, timeZone: dayZone })} />
        <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('invoices.refresh')} />
        {differsFromDevice(dayZone) ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }} data-testid="receipts-filter-zone">
            {t('payments.receipts.filters.zone')} (<span dir="ltr">{dayZone}</span>)
          </Typography.Text>
        ) : null}
      </Flex>

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
                  list.setFilters(defaultPaymentFilters(dayZone))
                } else list.reload()
              }}
            >
              {t('invoices.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Table<Payment>
        rowKey="id"
        columns={columns}
        dataSource={list.items}
        loading={list.loading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: hasActivePaymentFilters(list.filters) ? t('payments.receipts.emptyFiltered') : t('payments.receipts.empty') }}
      />

      <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
        <Space>
          <Typography.Text type="secondary">{t('payments.pagination.page', { page: list.pageNumber })}</Typography.Text>
          <Select<PaymentsListFilters['limit']>
            size="small"
            value={list.filters.limit}
            aria-label={t('payments.pagination.pageSizeLabel')}
            onChange={(value) => list.setFilters({ limit: value })}
            options={PAYMENT_PAGE_SIZES.map((size) => ({ value: size, label: t('payments.pagination.pageSize', { count: size }) }))}
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

      {reversing ? (
        <ReasonModal
          // Mounted per payment, so a reason never carries over.
          key={reversing.id}
          title={t('payments.reverseModal.title', { number: reversing.number })}
          description={t('payments.reverseModal.hint', { amount: formatMoney(reversing.amount, reversing.currency, language) })}
          reasonLabel={t('payments.reverseModal.reason')}
          okText={t('payments.reverseModal.ok')}
          onClose={() => setReversing(null)}
          onSubmit={async (reason) => {
            try {
              const updated = await reversePayment(reversing.id, { reason })
              list.replaceItem(updated)
              setReversing(null)
              message.success(t('payments.reverseModal.done', { number: updated.number }))
              onReversed()
            } catch (caught) {
              const described = describeFinanceFailure(caught)
              // Reversed or gone meanwhile: the row is read again.
              if (isFinanceFailure(described, 'payment_reversed') || isFinanceFailure(described, 'payment_not_found')) list.reload()
              throw new Error(failureMessage(t, described))
            }
          }}
        />
      ) : null}
    </Card>
  )
}
