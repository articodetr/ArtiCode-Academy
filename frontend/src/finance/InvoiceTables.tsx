// The lines and the installments of an invoice as the server returns them
// (J-F52 — API-145 and API-155 alike): the paid part, the remaining part, the
// status and overdue of each installment are computed by the server from the
// paid amount, oldest first (D-R62, ADR-068) — shown as they come, never
// recomputed here.
import { Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useTranslation } from 'react-i18next'
import type { InvoiceInstallment, InvoiceLine } from '../api/invoices'
import { useLocalized } from '../i18n/useLocalized'
import { formatDay, localizedLabel } from '../users/users.format'
import { InstallmentStatusTag, Money, OverdueTag } from './FinanceTags'

export function InvoiceLinesTable({ lines, currency }: { lines: readonly InvoiceLine[]; currency: string }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const columns: TableProps<InvoiceLine>['columns'] = [
    { title: t('finance.columns.line'), key: 'description', render: (_, line) => localizedLabel(line.description, language) },
    { title: t('finance.columns.amount'), key: 'amount', align: 'end', render: (_, line) => <Money amount={line.amount} currency={currency} /> },
  ]
  return (
    <Table<InvoiceLine>
      size="small"
      rowKey="sortOrder"
      columns={columns}
      dataSource={[...lines]}
      pagination={false}
      data-testid="invoice-lines"
      locale={{ emptyText: t('finance.noLines') }}
    />
  )
}

/** The server flags `overdue` on the installments of an issued invoice only. */
export function InstallmentsTable({ installments, currency }: { installments: readonly InvoiceInstallment[]; currency: string }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const columns: TableProps<InvoiceInstallment>['columns'] = [
    { title: t('finance.columns.seq'), key: 'seq', width: 56, render: (_, part) => <bdi dir="ltr">{part.seq}</bdi> },
    { title: t('finance.columns.dueOn'), key: 'dueOn', render: (_, part) => formatDay(part.dueOn, language) },
    { title: t('finance.columns.amount'), key: 'amount', align: 'end', render: (_, part) => <Money amount={part.amount} currency={currency} /> },
    { title: t('finance.columns.paid'), key: 'paid', align: 'end', render: (_, part) => <Money amount={part.paid} currency={currency} /> },
    { title: t('finance.columns.remaining'), key: 'remaining', align: 'end', render: (_, part) => <Money amount={part.remaining} currency={currency} /> },
    {
      title: t('finance.columns.status'),
      key: 'status',
      render: (_, part) => (
        <span>
          <InstallmentStatusTag status={part.status} />
          {part.overdue ? <OverdueTag /> : null}
        </span>
      ),
    },
  ]
  return (
    <>
      <Table<InvoiceInstallment>
        size="small"
        rowKey="seq"
        columns={columns}
        dataSource={[...installments]}
        pagination={false}
        scroll={{ x: 'max-content' }}
        data-testid="invoice-installments"
        locale={{ emptyText: t('finance.noInstallments') }}
      />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
        {t('finance.allocationHint')}
      </Typography.Paragraph>
    </>
  )
}
