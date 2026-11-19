// One of the reader's own enrollment requests (MOD-19, API-222): the course
// and class, the state, when it was asked and decided, what is invoiced, paid
// and due (the server's sums over the issued invoices), the invoices by
// number, the rejection reason, and «cancel the request» while it is pending
// (API-223, behind a confirmation). «My School» (MOD-20) adds the context
// action of the state through `action` — pay, wait for approval, ask again.
import { Alert, Button, Card, Descriptions, Popconfirm, Space, Tag, Typography } from 'antd'
import type { DescriptionsProps } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { MyEnrollmentRequest } from '../api/catalog'
import { useLocalized } from '../i18n/useLocalized'
import { formatMoney } from '../payments/payments.format'
import { formatDateTime, localizedLabel } from '../users/users.format'
import { REQUEST_STATE_COLORS } from './catalog.view'

interface RequestCardProps {
  request: MyEnrollmentRequest
  busy: boolean
  onCancel: (request: MyEnrollmentRequest) => void
  /** The context action of the state (MOD-20), shown beside «cancel the request». */
  action?: ReactNode
}

export function RequestCard({ request, busy, onCancel, action }: RequestCardProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const payment = request.payment
  const money = (amount: number) => (payment.currency ? <bdi dir="ltr">{formatMoney(amount, payment.currency, language)}</bdi> : <bdi dir="ltr">{amount.toFixed(2)}</bdi>)

  const items: DescriptionsProps['items'] = [
    {
      key: 'class',
      label: t('myCourses.requests.class'),
      children: (
        <Space size={6} wrap>
          <span>{localizedLabel(request.class.name, language)}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <bdi dir="ltr">{request.class.code}</bdi>
          </Typography.Text>
        </Space>
      ),
    },
  ]
  if (request.requestedAt) items.push({ key: 'requestedAt', label: t('myCourses.requests.requestedAt'), children: formatDateTime(request.requestedAt, language) })
  if (request.decidedAt) items.push({ key: 'decidedAt', label: t('myCourses.requests.decidedAt'), children: formatDateTime(request.decidedAt, language) })
  // A closed request (rejected, cancelled, withdrawn) has no payment to make: its cancelled invoices are listed below with
  // their status, never «no invoice issued» and totals of 0.00 (MOD-19 acceptance, 2026-11-19).
  const closed = request.state === 'rejected' || request.state === 'cancelled' || request.state === 'withdrawn'
  if (payment.required && !closed) {
    items.push({ key: 'payment', label: t('myCourses.requests.payment'), children: <Tag>{t(`myCourses.paymentStates.${payment.state}`)}</Tag> })
    items.push({ key: 'total', label: t('myCourses.requests.total'), children: money(payment.total) })
    items.push({ key: 'paid', label: t('myCourses.requests.paid'), children: money(payment.paid) })
    items.push({ key: 'balance', label: t('myCourses.requests.balance'), children: money(payment.balance) })
  }
  const numbered = payment.invoices.filter((invoice) => invoice.number !== null)
  if (numbered.length > 0) {
    items.push({
      key: 'invoices',
      label: t('myCourses.requests.invoices'),
      children: (
        <Space size={[6, 4]} wrap>
          {numbered.map((invoice) => (
            <Tag key={invoice.id} color={invoice.status === 'issued' ? 'blue' : 'default'}>
              <bdi dir="ltr">{invoice.number}</bdi> · {t(`myCourses.invoiceStatus.${invoice.status}`)}
            </Tag>
          ))}
        </Space>
      ),
    })
  }

  return (
    <Card
      size="small"
      data-testid={`request-${request.id}`}
      title={localizedLabel(request.course.name, language)}
      extra={<Tag color={REQUEST_STATE_COLORS[request.state]}>{t(`catalog.states.${request.state}`)}</Tag>}
      styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12 } }}
    >
      <Descriptions size="small" column={1} items={items} />
      {request.state === 'pending_payment' ? <Typography.Text type="secondary">{t('myCourses.requests.payHint')}</Typography.Text> : null}
      {request.state === 'pending_approval' ? <Typography.Text type="secondary">{t('myCourses.requests.approvalHint')}</Typography.Text> : null}
      {request.state === 'rejected' && request.rejectionReason ? (
        <Alert type="warning" showIcon title={t('myCourses.requests.rejectionReason')} description={request.rejectionReason} />
      ) : null}
      {action || request.status === 'pending' ? (
        <Space size={8} wrap>
          {action}
          {request.status === 'pending' ? (
            <Popconfirm
              title={t('myCourses.requests.cancelConfirm')}
              okText={t('myCourses.requests.cancelOk')}
              cancelText={t('myCourses.requests.cancelKeep')}
              onConfirm={() => onCancel(request)}
            >
              <Button danger loading={busy}>
                {t('myCourses.requests.cancel')}
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      ) : null}
    </Card>
  )
}
