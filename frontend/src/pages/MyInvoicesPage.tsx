// «My invoices» (MOD-11 — J-F52, MOD-11-T07): GET /api/me/invoices (API-155)
// for a student (their own invoices, `relation: self`, with
// `invoices.read_own`) and a guardian (their linked children's, `relation:
// child`, with `invoices.read_linked` while they hold the `guardian` role — the
// server decides). Issued and cancelled invoices only, newest first, no
// pagination; each with its total, paid amount, balance, payment state,
// overdue flag and next installment as the server computes them (ADR-068), and
// a drawer with the lines, the installments and the valid receipts (each one
// printable). Filters: status, student and class — their options are gathered
// from what the server returned. The route opens to the holders of the
// `student` or `guardian` server role key only (nav entry `myInvoices`, like
// «my classes»); a caller holding neither key reads a 403 the page words.
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Flex, Select, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MY_INVOICE_STATUSES } from '../api/myInvoices'
import type { MyInvoiceItem, MyInvoiceStatus } from '../api/myInvoices'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { InvoiceStatusTag, Money, OverdueTag, PaymentStateTag } from '../finance/FinanceTags'
import { MyInvoiceDrawer } from '../finance/MyInvoiceDrawer'
import { describeFinanceFailure, failureMessage, isFinanceFailure } from '../finance/finance.errors'
import { formatMoney, invoiceNumberOf } from '../finance/finance.format'
import { useMyInvoices } from '../finance/useMyInvoices'
import { useLocalized } from '../i18n/useLocalized'
import { displayNameOf, formatDateTime, formatDay, localizedLabel } from '../users/users.format'

export function MyInvoicesPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { user } = useAuth()
  const list = useMyInvoices()
  const [openId, setOpenId] = useState<string | null>(null)
  const open = list.items.find((item) => item.id === openId) ?? null
  // A guardian, or anyone whose invoices are someone else's too, sees whose invoice each row is.
  const showStudent = (user?.roles ?? []).includes('guardian') || list.students.some((student) => student.relation === 'child')
  const canPickStudent = list.students.length > 1
  const failure = list.error ? describeFinanceFailure(list.error) : null
  const forbidden = failure !== null && isFinanceFailure(failure, 'permission_denied')
  const narrowed = Boolean(list.filters.status || list.filters.studentId || list.filters.classId)

  const columns: TableProps<MyInvoiceItem>['columns'] = [
    {
      title: t('invoices.columns.number'),
      key: 'number',
      render: (_, row) => (
        <span>
          <Typography.Text strong dir="ltr">
            {invoiceNumberOf(row) ?? '—'}
          </Typography.Text>
          {row.issuedAt ? (
            <>
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {formatDateTime(row.issuedAt, language)}
              </Typography.Text>
            </>
          ) : null}
        </span>
      ),
    },
    ...(showStudent
      ? [
          {
            title: t('invoices.columns.student'),
            key: 'student',
            render: (_: unknown, row: MyInvoiceItem) => (
              <span>
                {displayNameOf(row.student)}{' '}
                <Tag color={row.relation === 'child' ? 'purple' : 'blue'}>{t(`myClasses.relation.${row.relation}`)}</Tag>
              </span>
            ),
          },
        ]
      : []),
    {
      title: t('invoices.columns.class'),
      key: 'class',
      render: (_, row) =>
        row.enrollment ? (
          <span>
            <Typography.Text dir="ltr">{row.enrollment.class.code}</Typography.Text>
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {localizedLabel(row.enrollment.class.name, language)}
            </Typography.Text>
          </span>
        ) : (
          '—'
        ),
    },
    { title: t('invoices.columns.total'), key: 'total', align: 'end', render: (_, row) => <Money amount={row.total} currency={row.currency} strong /> },
    { title: t('invoices.columns.paid'), key: 'paid', align: 'end', render: (_, row) => <Money amount={row.paid} currency={row.currency} /> },
    { title: t('invoices.columns.balance'), key: 'balance', align: 'end', render: (_, row) => <Money amount={row.balance} currency={row.currency} /> },
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
            setOpenId(row.id)
          }}
          aria-label={`${t('common.view')}: ${invoiceNumberOf(row) ?? ''}`}
        >
          {t('common.view')}
        </Button>
      ),
    },
  ]

  return (
    <>
      <PageHeader title={t('myInvoices.title')} subtitle={t('myInvoices.subtitle')} />
      <Card>
        <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
          <Select<MyInvoiceStatus>
            allowClear
            placeholder={t('myInvoices.filters.allStatuses')}
            aria-label={t('invoices.columns.status')}
            value={list.filters.status}
            onChange={(value) => list.setFilters({ status: value })}
            options={MY_INVOICE_STATUSES.map((status) => ({ value: status, label: t(`finance.invoiceStatus.${status}`) }))}
            style={{ minWidth: 150 }}
          />
          {canPickStudent ? (
            <Select<string>
              allowClear
              placeholder={t('myInvoices.filters.allStudents')}
              aria-label={t('invoices.columns.student')}
              value={list.filters.studentId}
              onChange={(value) => list.setFilters({ studentId: value })}
              options={list.students.map((student) => ({ value: student.id, label: `${displayNameOf(student)} (${t(`myClasses.relation.${student.relation}`)})` }))}
              style={{ minWidth: 200 }}
            />
          ) : null}
          {list.classes.length > 0 ? (
            <Select<string>
              allowClear
              placeholder={t('myInvoices.filters.allClasses')}
              aria-label={t('invoices.columns.class')}
              value={list.filters.classId}
              onChange={(value) => list.setFilters({ classId: value })}
              options={list.classes.map((klass) => ({ value: klass.id, label: `${klass.code} — ${localizedLabel(klass.name, language)}` }))}
              style={{ minWidth: 220 }}
            />
          ) : null}
          <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('myInvoices.refresh')} />
        </Flex>

        {failure ? (
          <Alert
            type={forbidden ? 'warning' : 'error'}
            showIcon
            title={forbidden ? t('myInvoices.forbidden', failure.params ?? { list: '' }) : failureMessage(t, failure)}
            action={
              forbidden ? undefined : (
                <Button size="small" onClick={list.reload}>
                  {t('myInvoices.refresh')}
                </Button>
              )
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<MyInvoiceItem>
          rowKey="id"
          columns={columns}
          dataSource={list.items}
          loading={list.loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: narrowed ? t('myInvoices.emptyFiltered') : t('myInvoices.empty') }}
          onRow={(row) => ({ onClick: () => setOpenId(row.id), style: { cursor: 'pointer' } })}
        />
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          {t('myInvoices.hint')}
        </Typography.Paragraph>
      </Card>

      <MyInvoiceDrawer invoice={open} showStudent={showStudent} onClose={() => setOpenId(null)} />
    </>
  )
}
