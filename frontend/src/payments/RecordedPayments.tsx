// The «Recorded payments» tab of /payments (API-152/153), for holders of
// `invoices.read_all`, `invoices.manage` or `payments.record`: every receipt,
// newest first, with its invoice, student, amount, method, when it was paid
// and its state — keyset pages, filters by receipt number, student, method,
// state and paid-at days (academy zone). A row opens the receipt (API-153)
// with a link that opens its invoice in the invoice drawer.
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Descriptions, Drawer, Flex, Input, Select, Space, Spin, Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../academy/useAcademy'
import { FINANCE_SEARCH_MAX_LENGTH, PAYMENT_METHODS } from '../api/invoices'
import { PAYMENT_STATUSES, getPayment } from '../api/payments'
import type { Payment } from '../api/payments'
import { useAuth } from '../auth/auth-context'
import { StudentPicker } from '../classes/ClassPickers'
import { academyTimeZoneOf } from '../common/timeZone'
import { useLocalized } from '../i18n/useLocalized'
import { DateFilter } from '../lessons/DateFilter'
import { formatLessonDateTime } from '../lessons/lessons.format'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { FinanceTag } from './FinanceTag'
import { InvoiceDrawer } from './InvoiceDrawer'
import { describePaymentsFailure, failureMessage } from './payments.errors'
import { formatMoney, personName } from './payments.format'
import { PAYMENT_PAGE_SIZES, usePaymentsList } from './usePaymentsList'
import type { PaymentsListFilters } from './usePaymentsList'

export function RecordedPayments() {
  const { academy, loading } = useAcademy()
  if (!academy && loading) {
    return (
      <Flex justify="center" style={{ padding: 32 }}>
        <Spin />
      </Flex>
    )
  }
  return <RecordedPaymentsList timeZone={academyTimeZoneOf(academy) ?? deviceTimeZone()} />
}

function RecordedPaymentsList({ timeZone }: { timeZone: string }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { hasPermission } = useAuth()
  const list = usePaymentsList(timeZone)
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [invoiceId, setInvoiceId] = useState<string | null>(null)
  const when = (iso: string) => formatLessonDateTime(iso, language, timeZone)

  const columns: TableProps<Payment>['columns'] = [
    {
      title: t('payments.drawer.receipt'),
      key: 'number',
      render: (_, row) => (
        <span className="list-primary">
          <b>
            <bdi dir="ltr">{row.number}</bdi>
          </b>
          <small>{when(row.paidAt)}</small>
        </span>
      ),
    },
    { title: t('payments.recorded.invoice'), key: 'invoice', render: (_, row) => <bdi dir="ltr">{row.invoice.number ?? t('payments.drawer.draftTitle')}</bdi> },
    { title: t('common.student'), key: 'student', render: (_, row) => personName(row.student) },
    { title: t('payments.columns.amount'), key: 'amount', align: 'end', render: (_, row) => <bdi dir="ltr">{formatMoney(row.amount, row.currency, language)}</bdi> },
    { title: t('payments.record.method'), key: 'method', render: (_, row) => t(`payments.methods.${row.method}`) },
    { title: t('common.status'), key: 'status', render: (_, row) => <FinanceTag value={row.status} /> },
  ]

  const failure = list.error ? describePaymentsFailure(list.error) : null
  const f = list.filters
  const filtered = Boolean(f.q || f.studentId || f.method || f.status || f.fromDay || f.toDay)

  return (
    <Card>
      <Flex gap={12} wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder={t('payments.recorded.searchPlaceholder')}
          aria-label={t('payments.recorded.searchPlaceholder')}
          maxLength={FINANCE_SEARCH_MAX_LENGTH}
          defaultValue={f.q}
          onSearch={(value) => list.setFilters({ q: value.trim() || undefined })}
          style={{ maxWidth: 240 }}
        />
        {hasPermission('users.read') ? (
          <StudentPicker
            allowClear
            placeholder={t('payments.filters.allStudents')}
            aria-label={t('common.student')}
            value={f.studentId}
            onChange={(value) => list.setFilters({ studentId: value })}
            style={{ minWidth: 200 }}
          />
        ) : null}
        <Select<PaymentsListFilters['method']>
          allowClear
          placeholder={t('payments.recorded.allMethods')}
          aria-label={t('payments.record.method')}
          value={f.method}
          onChange={(value) => list.setFilters({ method: value })}
          options={PAYMENT_METHODS.map((method) => ({ value: method, label: t(`payments.methods.${method}`) }))}
          style={{ minWidth: 150 }}
        />
        <Select<PaymentsListFilters['status']>
          allowClear
          placeholder={t('payments.filters.allStatuses')}
          aria-label={t('common.status')}
          value={f.status}
          onChange={(value) => list.setFilters({ status: value })}
          options={PAYMENT_STATUSES.map((status) => ({ value: status, label: t(`payments.status.${status}`) }))}
          style={{ minWidth: 140 }}
        />
        <Space size={4} align="center">
          <DateFilter label={t('payments.recorded.from')} value={f.fromDay} onChange={(value) => list.setFilters({ fromDay: value })} />
          <Typography.Text type="secondary">–</Typography.Text>
          <DateFilter label={t('payments.recorded.to')} value={f.toDay} onChange={(value) => list.setFilters({ toDay: value })} />
        </Space>
        <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('payments.refresh')} />
      </Flex>

      {failure ? (
        <Alert
          type="error"
          showIcon
          title={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={() => (failure.key.endsWith('cursor_invalid') ? list.setFilters({}) : list.reload())}>
              {t('payments.refresh')}
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
        locale={{ emptyText: filtered ? t('payments.recorded.emptyFiltered') : t('payments.recorded.empty') }}
        onRow={(row) => ({ onClick: () => setReceiptId(row.id), style: { cursor: 'pointer' } })}
        rowClassName={(row) => (row.id === receiptId ? 'list-row--open' : '')}
      />

      <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
        <Space>
          <Typography.Text type="secondary">{t('payments.pagination.page', { page: list.pageNumber })}</Typography.Text>
          <Select<PaymentsListFilters['limit']>
            size="small"
            value={f.limit}
            aria-label={t('payments.recorded.pageSizeLabel')}
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

      <ReceiptDrawer
        paymentId={receiptId}
        timeZone={timeZone}
        onClose={() => setReceiptId(null)}
        onLoaded={list.replaceItem}
        onOpenInvoice={(id) => {
          setReceiptId(null)
          setInvoiceId(id)
        }}
      />
      <InvoiceDrawer invoiceId={invoiceId} onClose={() => setInvoiceId(null)} onUpdated={() => list.reload()} onDeleted={() => list.reload()} />
    </Card>
  )
}

interface ReceiptDrawerProps {
  paymentId: string | null
  timeZone: string
  onClose: () => void
  onLoaded: (payment: Payment) => void
  onOpenInvoice: (invoiceId: string) => void
}

/** One receipt (API-153) with its invoice as it stands now. */
function ReceiptDrawer({ paymentId, timeZone, onClose, onLoaded, onOpenInvoice }: ReceiptDrawerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [state, setState] = useState<{ id: string; payment: Payment | null; error: string | null } | null>(null)

  useEffect(() => {
    if (!paymentId) return
    const controller = new AbortController()
    getPayment(paymentId, controller.signal)
      .then((payment) => {
        if (controller.signal.aborted) return
        setState({ id: paymentId, payment, error: null })
        onLoaded(payment)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setState({ id: paymentId, payment: null, error: failureMessage(t, describePaymentsFailure(caught)) })
      })
    return () => controller.abort()
  }, [paymentId, onLoaded, t])

  const current = state && state.id === paymentId ? state : null
  const payment = current?.payment ?? null
  const money = (amount: number) => (payment ? formatMoney(amount, payment.currency, language) : String(amount))
  const when = (iso: string | null) => (iso ? formatLessonDateTime(iso, language, timeZone) : '—')

  return (
    <Drawer open={paymentId !== null} onClose={onClose} size="default" title={payment ? <bdi dir="ltr">{payment.number}</bdi> : t('payments.drawer.receipt')} destroyOnHidden>
      {current?.error ? <Alert type="error" showIcon title={current.error} /> : null}
      {!current ? (
        <Flex justify="center" style={{ padding: 32 }}>
          <Spin />
        </Flex>
      ) : null}
      {payment ? (
        <Flex vertical gap={16}>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label={t('common.status')}>
              <FinanceTag value={payment.status} />
            </Descriptions.Item>
            <Descriptions.Item label={t('payments.columns.amount')}>
              <bdi dir="ltr">{money(payment.amount)}</bdi>
            </Descriptions.Item>
            <Descriptions.Item label={t('payments.record.method')}>{t(`payments.methods.${payment.method}`)}</Descriptions.Item>
            <Descriptions.Item label={t('payments.drawer.paidAt')}>{when(payment.paidAt)}</Descriptions.Item>
            <Descriptions.Item label={t('common.student')}>{personName(payment.student)}</Descriptions.Item>
            <Descriptions.Item label={t('payments.recorded.invoice')}>
              <Space wrap>
                <bdi dir="ltr">{payment.invoice.number ?? t('payments.drawer.draftTitle')}</bdi>
                <Typography.Text type="secondary">{t('payments.recorded.invoiceBalance', { balance: money(payment.invoice.balance) })}</Typography.Text>
              </Space>
            </Descriptions.Item>
            {payment.reference ? <Descriptions.Item label={t('payments.record.reference')}>{payment.reference}</Descriptions.Item> : null}
            {payment.payerName ? <Descriptions.Item label={t('payments.record.payerName')}>{payment.payerName}</Descriptions.Item> : null}
            {payment.notes ? (
              <Descriptions.Item label={t('payments.record.notes')}>
                <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{payment.notes}</Typography.Paragraph>
              </Descriptions.Item>
            ) : null}
            <Descriptions.Item label={t('payments.recorded.recordedBy')}>{payment.recordedBy?.fullName ?? '—'}</Descriptions.Item>
            {payment.status === 'reversed' ? (
              <Descriptions.Item label={t('payments.recorded.reversed')}>
                {when(payment.reversedAt)}
                {payment.reversedBy ? ` — ${payment.reversedBy.fullName}` : ''}
                {payment.reverseReason ? ` — ${payment.reverseReason}` : ''}
              </Descriptions.Item>
            ) : null}
          </Descriptions>
          <Button type="link" style={{ alignSelf: 'start', padding: 0 }} onClick={() => onOpenInvoice(payment.invoice.id)}>
            {t('payments.recorded.openInvoice')}
          </Button>
        </Flex>
      ) : null}
    </Drawer>
  )
}
