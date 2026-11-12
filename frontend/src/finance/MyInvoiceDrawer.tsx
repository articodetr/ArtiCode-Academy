// One of «my invoices» (J-F52 — API-155): the owner's projection of an invoice —
// its student (with the relation for a guardian), its class, its totals, its
// lines, its installments with the paid part, remaining part, status and
// overdue flag the server computes (ADR-068), and its valid receipts (completed
// payments only — the server never sends a reversed one, nor a recorder, an
// internal note, the issuer or the fee plan), each with a link to print it.
import { PrinterOutlined } from '@ant-design/icons'
import { Alert, Descriptions, Drawer, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { MyInvoiceItem, MyInvoicePayment } from '../api/myInvoices'
import { useLocalized } from '../i18n/useLocalized'
import { displayNameOf, formatDateTime, formatDay, localizedLabel } from '../users/users.format'
import { InstallmentsTable, InvoiceLinesTable } from './InvoiceTables'
import { InvoiceStatusTag, Money, OverdueTag, PaymentStateTag } from './FinanceTags'
import { formatMoney, invoiceNumberOf } from './finance.format'

interface MyInvoiceDrawerProps {
  invoice: MyInvoiceItem | null
  /** Whether to name the student (a guardian, or anyone owning another student's invoice). */
  showStudent: boolean
  onClose: () => void
}

export function MyInvoiceDrawer({ invoice, showStudent, onClose }: MyInvoiceDrawerProps) {
  const { t } = useTranslation()
  const number = invoice ? (invoiceNumberOf(invoice) ?? '—') : t('myInvoices.drawer.title')
  return (
    <Drawer
      open={invoice !== null}
      onClose={onClose}
      title={
        invoice ? (
          <Space wrap>
            <bdi dir="ltr">{number}</bdi>
            <InvoiceStatusTag status={invoice.status} />
            {invoice.status === 'issued' ? <PaymentStateTag state={invoice.paymentState} /> : null}
            {invoice.overdue ? <OverdueTag /> : null}
          </Space>
        ) : (
          number
        )
      }
      size="min(820px, 100vw)"
      destroyOnHidden
    >
      {invoice ? <MyInvoiceBody invoice={invoice} showStudent={showStudent} /> : null}
    </Drawer>
  )
}

function MyInvoiceBody({ invoice, showStudent }: { invoice: MyInvoiceItem; showStudent: boolean }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const money = (amount: number) => formatMoney(amount, invoice.currency, language)

  const receiptColumns: TableProps<MyInvoicePayment>['columns'] = [
    { title: t('myInvoices.drawer.receipt'), key: 'number', render: (_, payment) => <bdi dir="ltr">{payment.number}</bdi> },
    { title: t('myInvoices.drawer.paidAt'), key: 'paidAt', render: (_, payment) => formatDateTime(payment.paidAt, language) },
    { title: t('finance.columns.amount'), key: 'amount', align: 'end', render: (_, payment) => <Money amount={payment.amount} currency={invoice.currency} /> },
    { title: t('myInvoices.drawer.method'), key: 'method', render: (_, payment) => t(`finance.methods.${payment.method}`) },
    {
      title: t('myInvoices.drawer.details'),
      key: 'details',
      render: (_, payment) => (
        <span style={{ fontSize: 12 }}>
          {payment.reference ? (
            <>
              {t('invoices.drawer.reference')}: <bdi>{payment.reference}</bdi>
              <br />
            </>
          ) : null}
          {payment.payerName ? `${t('invoices.drawer.payerName')}: ${payment.payerName}` : null}
        </span>
      ),
    },
    {
      title: t('common.actions'),
      key: 'print',
      render: (_, payment) => (
        <Link to={`/my-invoices/receipts/${encodeURIComponent(payment.id)}`} target="_blank" rel="noopener" aria-label={`${t('payments.receipts.print')}: ${payment.number}`}>
          <PrinterOutlined /> {t('invoices.drawer.print')}
        </Link>
      ),
    },
  ]

  return (
    <>
      {invoice.status === 'cancelled' ? (
        <Alert
          type="warning"
          showIcon
          title={t('myInvoices.drawer.cancelled', { date: formatDateTime(invoice.cancelledAt, language), reason: invoice.cancelReason ?? '—' })}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }} data-testid="my-invoice-details">
        {showStudent ? (
          <Descriptions.Item label={t('invoices.drawer.student')}>
            <Space wrap size={4}>
              <span>{displayNameOf(invoice.student)}</span>
              <Tag color={invoice.relation === 'child' ? 'purple' : 'blue'}>{t(`myClasses.relation.${invoice.relation}`)}</Tag>
            </Space>
          </Descriptions.Item>
        ) : null}
        <Descriptions.Item label={t('invoices.drawer.class')}>
          {invoice.enrollment ? (
            <Space wrap size={4}>
              <Typography.Text dir="ltr" strong>
                {invoice.enrollment.class.code}
              </Typography.Text>
              <span>{localizedLabel(invoice.enrollment.class.name, language)}</span>
            </Space>
          ) : (
            <Typography.Text type="secondary">{t('invoices.drawer.noClass')}</Typography.Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('finance.fields.subtotal')}>
          <Money amount={invoice.subtotal} currency={invoice.currency} />
        </Descriptions.Item>
        {invoice.discountAmount > 0 ? (
          <Descriptions.Item label={t('finance.fields.discount')}>
            <Money amount={invoice.discountAmount} currency={invoice.currency} />
            {invoice.discountReason ? <Typography.Text type="secondary"> — {invoice.discountReason}</Typography.Text> : null}
          </Descriptions.Item>
        ) : null}
        <Descriptions.Item label={t('finance.fields.total')}>
          <Money amount={invoice.total} currency={invoice.currency} strong />
        </Descriptions.Item>
        <Descriptions.Item label={t('finance.fields.paid')}>
          <Money amount={invoice.paid} currency={invoice.currency} />
        </Descriptions.Item>
        <Descriptions.Item label={t('finance.fields.balance')}>
          <Money amount={invoice.balance} currency={invoice.currency} strong />
        </Descriptions.Item>
        {invoice.nextDue ? (
          <Descriptions.Item label={t('finance.fields.nextDue')}>
            {t('finance.nextDue', { seq: invoice.nextDue.seq, date: formatDay(invoice.nextDue.dueOn, language), amount: money(invoice.nextDue.remaining) })}
          </Descriptions.Item>
        ) : null}
        {invoice.issuedAt ? <Descriptions.Item label={t('invoices.drawer.issued')}>{formatDateTime(invoice.issuedAt, language)}</Descriptions.Item> : null}
      </Descriptions>
      <Typography.Title level={5}>{t('invoices.drawer.lines')}</Typography.Title>
      <InvoiceLinesTable lines={invoice.lines} currency={invoice.currency} />
      <Typography.Title level={5} style={{ marginTop: 16 }}>
        {t('invoices.drawer.installments')}
      </Typography.Title>
      <InstallmentsTable installments={invoice.installments} currency={invoice.currency} />
      <Typography.Title level={5} style={{ marginTop: 16 }}>
        {t('myInvoices.drawer.receipts')}
      </Typography.Title>
      <Table<MyInvoicePayment>
        size="small"
        rowKey="id"
        columns={receiptColumns}
        dataSource={invoice.payments}
        pagination={false}
        scroll={{ x: 'max-content' }}
        data-testid="my-invoice-receipts"
        locale={{ emptyText: t('myInvoices.drawer.noReceipts') }}
      />
    </>
  )
}
