// «My invoices» (API-155) for students and guardians: one card per invoice
// with its total, what is paid, the balance and the next installment due, the
// `self`/`child` relation for a guardian, and the installments and valid
// receipts on demand. Issued and cancelled invoices only, newest first, no
// pagination; every amount is the server's.
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Collapse, Empty, Flex, Space, Spin, Table, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listMyInvoices } from '../api/invoices'
import type { InvoiceInstallment, MyInvoice, MyInvoicePayment } from '../api/invoices'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime, formatDay, localizedLabel } from '../users/users.format'
import { FinanceTag } from './FinanceTag'
import { describePaymentsFailure, failureMessage } from './payments.errors'
import { formatMoney, personName } from './payments.format'
import './payments.css'

export function MyInvoices() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [items, setItems] = useState<MyInvoice[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listMyInvoices({}, controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return
        setItems(list.items)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(caught)
      })
    return () => controller.abort()
  }, [tick])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  const showRelation = (items ?? []).some((item) => item.relation === 'child')

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        title={failureMessage(t, describePaymentsFailure(error))}
        action={
          <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
            {t('payments.refresh')}
          </Button>
        }
      />
    )
  }
  if (items === null) {
    return (
      <Flex justify="center" style={{ padding: 48 }}>
        <Spin />
      </Flex>
    )
  }
  if (items.length === 0) return <Empty description={t('payments.mine.empty')} />

  return (
    <div className="my-invoices">
      {items.map((item) => {
        const money = (amount: number) => <bdi dir="ltr">{formatMoney(amount, item.currency, language)}</bdi>
        return (
          <Card key={`${item.id}:${item.relation}`} className="my-invoice" size="small">
            <Flex justify="space-between" align="start" gap={8} wrap>
              <div className="list-primary">
                <b>
                  <bdi dir="ltr">{item.number}</bdi>
                </b>
                <small>
                  {showRelation ? `${personName(item.student)} · ` : ''}
                  {item.enrollment ? localizedLabel(item.enrollment.class.name, language) : t('payments.mine.noClass')}
                </small>
              </div>
              <Space size={4} wrap>
                {showRelation ? <Tag>{t(`payments.mine.relation.${item.relation}`)}</Tag> : null}
                <FinanceTag value={item.status === 'issued' ? item.paymentState : item.status} />
                {item.overdue ? <FinanceTag value="overdue" /> : null}
              </Space>
            </Flex>
            <div className="finance-totals finance-totals--compact">
              <div>
                <span>{t('payments.columns.total')}</span>
                {money(item.total)}
              </div>
              <div>
                <span>{t('payments.columns.paid')}</span>
                {money(item.paid)}
              </div>
              <div className={item.overdue ? 'finance-totals__bad' : undefined}>
                <span>{t('payments.columns.balance')}</span>
                {money(item.balance)}
              </div>
            </div>
            {item.status === 'issued' && item.nextDue ? (
              <Typography.Text className={item.overdue ? 'finance-overdue' : undefined}>
                {t('payments.mine.nextDue', { day: formatDay(item.nextDue.dueOn, language) })} <bdi dir="ltr">{formatMoney(item.nextDue.remaining, item.currency, language)}</bdi>
              </Typography.Text>
            ) : null}
            {item.status === 'cancelled' ? <Typography.Text type="secondary">{t('payments.mine.cancelled')}</Typography.Text> : null}
            <Collapse
              ghost
              size="small"
              items={[
                {
                  key: 'details',
                  label: t('payments.mine.details'),
                  children: (
                    <Flex vertical gap={12}>
                      <Table<InvoiceInstallment>
                        rowKey="seq"
                        size="small"
                        pagination={false}
                        scroll={{ x: 'max-content' }}
                        dataSource={item.installments}
                        columns={[
                          { title: t('payments.drawer.dueOn'), key: 'dueOn', render: (_, part) => formatDay(part.dueOn, language) },
                          { title: t('payments.columns.amount'), key: 'amount', align: 'end', render: (_, part) => money(part.amount) },
                          { title: t('payments.drawer.remaining'), key: 'remaining', align: 'end', render: (_, part) => money(part.remaining) },
                          { title: t('common.status'), key: 'status', render: (_, part) => <FinanceTag value={part.overdue ? 'overdue' : part.status} /> },
                        ]}
                      />
                      {item.payments.length > 0 ? (
                        <Table<MyInvoicePayment>
                          rowKey="id"
                          size="small"
                          pagination={false}
                          scroll={{ x: 'max-content' }}
                          dataSource={item.payments}
                          columns={[
                            { title: t('payments.drawer.receipt'), key: 'number', render: (_, payment) => <bdi dir="ltr">{payment.number}</bdi> },
                            { title: t('payments.drawer.paidAt'), key: 'paidAt', render: (_, payment) => formatDateTime(payment.paidAt, language) },
                            { title: t('payments.columns.amount'), key: 'amount', align: 'end', render: (_, payment) => money(payment.amount) },
                            { title: t('payments.record.method'), key: 'method', render: (_, payment) => t(`payments.methods.${payment.method}`) },
                          ]}
                        />
                      ) : (
                        <Typography.Text type="secondary">{t('payments.drawer.noPayments')}</Typography.Text>
                      )}
                    </Flex>
                  ),
                },
              ]}
            />
          </Card>
        )
      })}
    </div>
  )
}
