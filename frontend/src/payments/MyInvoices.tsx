// «My invoices» (API-155) for students and guardians: one card per invoice
// with its total, what is paid, the balance and the next installment due, the
// `self`/`child` relation for a guardian, and the installments and valid
// receipts on demand. Issued and cancelled invoices only, newest first, no
// pagination; every amount is the server's.
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Collapse, Empty, Flex, Space, Spin, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listMyInvoices } from '../api/invoices'
import type { MyInvoice } from '../api/invoices'
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

  // Redesign (2026-11-14): one full-width row per invoice instead of narrow cards whose tables scrolled sideways:
  // what is paid as a bar with the three amounts beside it, the next instalment, and the instalments and receipts
  // as two plain lists side by side (stacked on a phone).
  return (
    <ul className="my-invoices">
      {items.map((item) => {
        const money = (amount: number) => <bdi dir="ltr">{formatMoney(amount, item.currency, language)}</bdi>
        const share = item.total > 0 ? Math.min(100, Math.round((item.paid / item.total) * 100)) : 0
        return (
          <li key={`${item.id}:${item.relation}`} className={item.status === 'cancelled' ? 'my-invoice my-invoice--cancelled' : 'my-invoice'}>
            <div className="my-invoice__head">
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
            </div>

            <div className="my-invoice__money">
              <div className={item.overdue ? 'my-invoice__bar my-invoice__bar--overdue' : 'my-invoice__bar'} role="meter" aria-valuemin={0} aria-valuemax={item.total} aria-valuenow={item.paid} aria-label={t('payments.columns.paid')}>
                <i style={{ width: `${share}%` }} />
              </div>
              <dl className="my-invoice__totals tabular-nums">
                <div>
                  <dt>{t('payments.columns.total')}</dt>
                  <dd>{money(item.total)}</dd>
                </div>
                <div>
                  <dt>{t('payments.columns.paid')}</dt>
                  <dd>{money(item.paid)}</dd>
                </div>
                <div className={item.overdue ? 'finance-totals__bad' : undefined}>
                  <dt>{t('payments.columns.balance')}</dt>
                  <dd>{money(item.balance)}</dd>
                </div>
              </dl>
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
              className="my-invoice__more"
              items={[
                {
                  key: 'details',
                  label: t('payments.mine.details'),
                  children: (
                    <div className="my-invoice__lists">
                      <section>
                        <h3>{t('payments.drawer.installments')}</h3>
                        <ul>
                          {item.installments.map((part) => (
                            <li key={part.seq}>
                              <span>{formatDay(part.dueOn, language)}</span>
                              <span className="tabular-nums">{money(part.amount)}</span>
                              <FinanceTag value={part.overdue ? 'overdue' : part.status} />
                            </li>
                          ))}
                        </ul>
                      </section>
                      <section>
                        <h3>{t('payments.drawer.payments')}</h3>
                        {item.payments.length > 0 ? (
                          <ul>
                            {item.payments.map((payment) => (
                              <li key={payment.id}>
                                <span>
                                  <bdi dir="ltr">{payment.number}</bdi>
                                  <small>{`${formatDateTime(payment.paidAt, language)} · ${t(`payments.methods.${payment.method}`)}`}</small>
                                </span>
                                <span className="tabular-nums">{money(payment.amount)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <Typography.Text type="secondary">{t('payments.drawer.noPayments')}</Typography.Text>
                        )}
                      </section>
                    </div>
                  ),
                },
              ]}
            />
          </li>
        )
      })}
    </ul>
  )
}
