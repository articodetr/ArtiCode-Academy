// Detail drawer of one enrollment request (MOD-19): API-225 for the request,
// its class and course and every invoice linked to the enrollment, with the
// payment lines when the server sends them (a finance read key — null
// otherwise). The office approves (API-059 `approve`) or rejects (API-059
// `reject`, a reason required) in a dialog mounted per session (KI-049); a
// holder of `payments.record` records a payment on an issued invoice with a
// balance through the finance dialog of /payments (API-151). Every amount and
// state on screen is the server's: after each write the drawer re-reads the
// request and tells the page to re-read its list. The approve button stays off
// with the server's `approveBlocker` (the server refuses again anyway).
import { CheckOutlined, CloseOutlined, DollarOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Descriptions, Drawer, Flex, Form, Input, Modal, Skeleton, Space, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getEnrollmentRequest } from '../api/enrollmentRequests'
import type { EnrollmentRequest } from '../api/enrollmentRequests'
import type { RequestInvoice } from '../api/catalog'
import { changeEnrollmentStatus } from '../api/enrollments'
import { getInvoice } from '../api/invoices'
import type { Invoice } from '../api/invoices'
import { useAuth } from '../auth/auth-context'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { RecordPaymentModal } from '../payments/RecordPaymentModal'
import { formatMoney } from '../payments/payments.format'
import { displayNameOf, formatDateTime, localizedLabel } from '../users/users.format'
import { PaymentStateTag, RequestStateTag } from './RequestTags'
import { describeRequestsFailure, failureMessage, isGoneRequest, isStaleRequest } from './requests.errors'
import { REJECTION_REASON_MAX_LENGTH, rejectionReasonOf } from './requests.format'

const DASH = '—'

interface EnrollmentRequestDrawerProps {
  requestId: string | null
  onClose: () => void
  /** A write went through (or the request moved elsewhere): the page re-reads its list. */
  onChanged: () => void
}

export function EnrollmentRequestDrawer({ requestId, onClose, onChanged }: EnrollmentRequestDrawerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const canRecord = hasPermission('payments.record')
  const canReadContact = hasPermission('users.read_contact')
  const [request, setRequest] = useState<EnrollmentRequest | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null)
  const [paying, setPaying] = useState<Invoice | null>(null)
  const [payReadError, setPayReadError] = useState<string | null>(null)

  useEffect(() => {
    if (!requestId) return
    const controller = new AbortController()
    getEnrollmentRequest(requestId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setRequest(loaded)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(failureMessage(t, describeRequestsFailure(error)))
      })
    return () => controller.abort()
  }, [requestId, reloadTick, t])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  const close = () => {
    setRequest(null)
    setLoadError(null)
    setDeciding(null)
    setPaying(null)
    setPayReadError(null)
    onClose()
  }

  /** After a write (or a refusal that made the request stale): the server's state on screen, in the drawer and the list. */
  const refresh = () => {
    reload()
    onChanged()
  }

  const openPayment = async (invoice: RequestInvoice) => {
    setPayReadError(null)
    try {
      setPaying(await getInvoice(invoice.id))
    } catch {
      setPayReadError(t('enrollmentRequests.payment.readFailed'))
    }
  }

  const money = (amount: number, currency: string | null) => (currency ? formatMoney(amount, currency, language) : String(amount))
  const name = request ? displayNameOf(request.student) : t('enrollmentRequests.drawer.title')
  const blocker = request?.approveBlocker ?? null
  const canApprove = request?.allowedActions.includes('approve') ?? false
  const canReject = request?.allowedActions.includes('reject') ?? false

  return (
    <Drawer
      open={requestId !== null}
      onClose={close}
      title={name}
      size="large"
      destroyOnHidden
      extra={
        request && (canApprove || canReject) ? (
          <Space>
            {canApprove ? (
              <Button type="primary" icon={<CheckOutlined />} disabled={blocker !== null} onClick={() => setDeciding('approve')}>
                {t('enrollmentRequests.actions.approve')}
              </Button>
            ) : null}
            {canReject ? (
              <Button danger icon={<CloseOutlined />} onClick={() => setDeciding('reject')}>
                {t('enrollmentRequests.actions.reject')}
              </Button>
            ) : null}
          </Space>
        ) : null
      }
    >
      {loadError ? (
        <Alert
          type="error"
          showIcon
          title={loadError}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
              {t('enrollmentRequests.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {!request && !loadError ? <Skeleton active paragraph={{ rows: 8 }} data-testid="request-loading" /> : null}

      {request ? (
        <Flex vertical gap={16}>
          {request.status === 'pending' && blocker ? (
            <Alert
              type="warning"
              showIcon
              data-testid="approve-blocker"
              title={t(`enrollmentRequests.blockers.${blocker}`, { balance: money(request.payment.balance, request.payment.currency) })}
            />
          ) : null}

          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label={t('enrollmentRequests.drawer.student')}>
              <Space direction="vertical" size={0}>
                <Typography.Text strong>{displayNameOf(request.student)}</Typography.Text>
                {canReadContact && request.student.email ? (
                  <Typography.Text type="secondary">
                    <bdi dir="ltr">{request.student.email}</bdi>
                  </Typography.Text>
                ) : null}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label={t('enrollmentRequests.drawer.state')}>
              <RequestStateTag state={request.state} />
            </Descriptions.Item>
            <Descriptions.Item label={t('enrollmentRequests.drawer.course')}>
              <Space wrap size={4}>
                <span>{localizedLabel(request.course.name, language)}</span>
                <bdi dir="ltr">({request.course.code})</bdi>
                <Tag>{t(`enrollmentRequests.pricing.${request.course.pricing}`)}</Tag>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label={t('enrollmentRequests.drawer.class')}>
              <Space wrap size={4}>
                <span>{localizedLabel(request.class.name, language)}</span>
                <bdi dir="ltr">({request.class.code})</bdi>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label={t('enrollmentRequests.drawer.classStatus')}>
              <StatusTag value={request.class.status} />
            </Descriptions.Item>
            <Descriptions.Item label={t('enrollmentRequests.drawer.seats')}>
              {t('enrollmentRequests.drawer.seatsValue', { enrolled: request.class.enrolledCount, capacity: request.class.capacity })}
            </Descriptions.Item>
            <Descriptions.Item label={t('enrollmentRequests.drawer.teacher')}>
              {request.class.leadTeacher ? displayNameOf(request.class.leadTeacher) : t('enrollmentRequests.drawer.noTeacher')}
            </Descriptions.Item>
            <Descriptions.Item label={t('enrollmentRequests.drawer.source')}>{t(`enrollmentRequests.sources.${request.source}`)}</Descriptions.Item>
            <Descriptions.Item label={t('enrollmentRequests.drawer.requestedAt')}>{formatDateTime(request.requestedAt, language)}</Descriptions.Item>
            <Descriptions.Item label={t('enrollmentRequests.drawer.decidedAt')}>{request.decidedAt ? formatDateTime(request.decidedAt, language) : DASH}</Descriptions.Item>
            {request.rejectionReason ? (
              <Descriptions.Item label={t('enrollmentRequests.drawer.rejectionReason')}>
                <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{request.rejectionReason}</Typography.Text>
              </Descriptions.Item>
            ) : null}
          </Descriptions>

          <Card size="small" title={t('enrollmentRequests.drawer.payment')} extra={<PaymentStateTag state={request.payment.state} />}>
            {request.payment.currency ? (
              <Descriptions column={{ xs: 1, sm: 3 }} size="small" style={{ marginBottom: 12 }}>
                <Descriptions.Item label={t('enrollmentRequests.drawer.total')}>
                  <bdi dir="ltr">{money(request.payment.total, request.payment.currency)}</bdi>
                </Descriptions.Item>
                <Descriptions.Item label={t('enrollmentRequests.drawer.paid')}>
                  <bdi dir="ltr">{money(request.payment.paid, request.payment.currency)}</bdi>
                </Descriptions.Item>
                <Descriptions.Item label={t('enrollmentRequests.drawer.balance')}>
                  <bdi dir="ltr" data-testid="request-balance">
                    {money(request.payment.balance, request.payment.currency)}
                  </bdi>
                </Descriptions.Item>
              </Descriptions>
            ) : null}
            {payReadError ? <Alert type="error" showIcon title={payReadError} style={{ marginBottom: 12 }} /> : null}
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              {t('enrollmentRequests.drawer.invoices')}
            </Typography.Title>
            {request.payment.invoices.length === 0 ? (
              <Typography.Text type="secondary">{t('enrollmentRequests.drawer.noInvoices')}</Typography.Text>
            ) : (
              <Flex vertical gap={8}>
                {request.payment.invoices.map((invoice) => (
                  <InvoiceCard
                    key={invoice.id}
                    invoice={invoice}
                    canRecord={canRecord}
                    onRecord={() => void openPayment(invoice)}
                  />
                ))}
              </Flex>
            )}
          </Card>
        </Flex>
      ) : null}

      {request && deciding ? (
        <DecisionModal
          // Mounted per decision, so a reason never carries over to the next one (KI-049).
          request={request}
          action={deciding}
          onDone={() => {
            setDeciding(null)
            refresh()
          }}
          onStale={refresh}
          onGone={() => {
            setDeciding(null)
            onChanged()
            close()
          }}
          onCancel={() => setDeciding(null)}
        />
      ) : null}

      <RecordPaymentModal
        invoice={paying}
        onClose={() => setPaying(null)}
        onRecorded={() => {
          setPaying(null)
          message.success(t('enrollmentRequests.payment.recorded'))
          refresh()
        }}
        onStale={() => {
          if (paying) void getInvoice(paying.id).then(setPaying, () => setPaying(null))
          refresh()
        }}
      />
    </Drawer>
  )
}

interface InvoiceCardProps {
  invoice: RequestInvoice
  canRecord: boolean
  onRecord: () => void
}

function InvoiceCard({ invoice, canRecord, onRecord }: InvoiceCardProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const money = (amount: number) => formatMoney(amount, invoice.currency, language)
  const recordable = canRecord && invoice.status === 'issued' && invoice.balance > 0

  return (
    <Card
      size="small"
      type="inner"
      data-testid={`request-invoice-${invoice.id}`}
      title={
        <Space size={8} wrap>
          <bdi dir="ltr">{invoice.number ?? DASH}</bdi>
          <Tag>{t(`enrollmentRequests.invoiceStatuses.${invoice.status}`)}</Tag>
        </Space>
      }
      extra={
        recordable ? (
          <Button size="small" icon={<DollarOutlined />} onClick={onRecord}>
            {t('enrollmentRequests.drawer.recordPayment')}
          </Button>
        ) : null
      }
    >
      <Descriptions column={{ xs: 1, sm: 2 }} size="small">
        <Descriptions.Item label={t('enrollmentRequests.drawer.total')}>
          <bdi dir="ltr">{money(invoice.total)}</bdi>
        </Descriptions.Item>
        <Descriptions.Item label={t('enrollmentRequests.drawer.paid')}>
          <bdi dir="ltr">{money(invoice.paid)}</bdi>
        </Descriptions.Item>
        <Descriptions.Item label={t('enrollmentRequests.drawer.balance')}>
          <bdi dir="ltr">{money(invoice.balance)}</bdi>
        </Descriptions.Item>
        <Descriptions.Item label={t('enrollmentRequests.drawer.issuedAt')}>{invoice.issuedAt ? formatDateTime(invoice.issuedAt, language) : DASH}</Descriptions.Item>
      </Descriptions>
      {invoice.payments === null ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('enrollmentRequests.drawer.paymentsHidden')}
        </Typography.Text>
      ) : invoice.payments.length === 0 ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('enrollmentRequests.drawer.noPayments')}
        </Typography.Text>
      ) : (
        <Flex vertical gap={4}>
          <Typography.Text strong>{t('enrollmentRequests.drawer.payments')}</Typography.Text>
          {invoice.payments.map((line) => (
            <Flex key={line.id} gap={8} wrap align="center" data-testid={`request-payment-${line.id}`}>
              <bdi dir="ltr">{line.number}</bdi>
              <bdi dir="ltr">{money(line.amount)}</bdi>
              <span>{t(`payments.methods.${line.method}`)}</span>
              <span>{formatDateTime(line.paidAt, language)}</span>
              {line.status === 'reversed' ? <Tag color="red">{t('enrollmentRequests.drawer.reversed')}</Tag> : null}
            </Flex>
          ))}
        </Flex>
      )}
    </Card>
  )
}

interface DecisionModalProps {
  request: EnrollmentRequest
  action: 'approve' | 'reject'
  onDone: () => void
  /** The server refused because the request moved (paid less, a seat taken, decided elsewhere). */
  onStale: () => void
  /** The request no longer exists for the caller. */
  onGone: () => void
  onCancel: () => void
}

function DecisionModal({ request, action, onDone, onStale, onGone, onCancel }: DecisionModalProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [form] = Form.useForm<{ reason?: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = displayNameOf(request.student)

  const confirm = async () => {
    let reason: string | null = null
    if (action === 'reject') {
      try {
        const values = await form.validateFields()
        reason = rejectionReasonOf(values.reason)
      } catch {
        return
      }
      if (reason === null) return
    }
    setBusy(true)
    setError(null)
    try {
      await changeEnrollmentStatus(request.id, reason === null ? { action } : { action, reason })
      message.success(t(`enrollmentRequests.${action}.done`))
      onDone()
    } catch (caught) {
      const failure = describeRequestsFailure(caught)
      setError(failureMessage(t, failure))
      setBusy(false)
      if (isGoneRequest(failure)) onGone()
      else if (isStaleRequest(failure)) onStale()
    }
  }

  return (
    <Modal
      open
      title={t(`enrollmentRequests.${action}.title`, { name })}
      okText={t(`enrollmentRequests.${action}.ok`)}
      okButtonProps={{ danger: action === 'reject' }}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      onOk={() => void confirm()}
      onCancel={() => {
        if (!busy) onCancel()
      }}
    >
      <Typography.Paragraph>{t(`enrollmentRequests.${action}.content`)}</Typography.Paragraph>
      {action === 'reject' ? (
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            name="reason"
            label={t('enrollmentRequests.reject.reason')}
            extra={t('enrollmentRequests.reject.reasonHint')}
            rules={[
              { required: true, whitespace: true, message: t('enrollmentRequests.reject.reasonMissing') },
              { max: REJECTION_REASON_MAX_LENGTH, message: t('enrollmentRequests.reject.reasonTooLong') },
            ]}
          >
            <Input.TextArea rows={3} maxLength={REJECTION_REASON_MAX_LENGTH} disabled={busy} dir="auto" />
          </Form.Item>
        </Form>
      ) : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Modal>
  )
}
