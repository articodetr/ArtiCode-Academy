// The invoice of the office view (API-145): its totals, lines, installments
// with their paid parts and its receipts — every number as the server computed
// it (ADR-068). Actions by permission: record a payment (`payments.record`, an
// issued invoice with a balance), issue a draft or cancel an issued invoice
// with a reason (`invoices.manage`), reverse a receipt with a reason
// (`payments.refund`). After every write the drawer shows the server's answer:
// API-149 answers the invoice itself; after API-151/API-154 (which answer the
// receipt) the invoice is read again. On a wide screen it docks beside the list
// (useDockedPanel). A draft (`invoices.manage`) also gets «edit» — the inline
// InvoiceEditForm with the smallest PATCH (API-147) — and «delete» behind a
// confirmation (API-148). The edit form's unsaved work is reported through
// `onUnsavedChange` (so switching rows asks first), turns off Escape and the
// mask, makes the close button ask, and holds browser back/forward and a
// reload (useUnsavedChangesGuard + NavigationBlocker — the class drawer's guard).
import { CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Descriptions, Drawer, Empty, Flex, Space, Spin, Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../academy/useAcademy'
import { changeInvoiceStatus, deleteInvoice, getInvoice } from '../api/invoices'
import type { Invoice, InvoiceInstallment, InvoiceLine, InvoicePayment } from '../api/invoices'
import { reversePayment } from '../api/payments'
import { useAuth } from '../auth/auth-context'
import { academyTimeZoneOf } from '../common/timeZone'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { dockedDrawerProps } from '../common/useDockedPanel'
import { useUnsavedChangesGuard } from '../common/useUnsavedChangesGuard'
import { useLocalized } from '../i18n/useLocalized'
import { formatLessonDateTime } from '../lessons/lessons.format'
import { formatDateTime, formatDay, localizedLabel } from '../users/users.format'
import { FinanceTag } from './FinanceTag'
import { InvoiceEditForm } from './InvoiceEditForm'
import { ReasonModal } from './ReasonModal'
import { RecordPaymentModal } from './RecordPaymentModal'
import { describePaymentsFailure, failureMessage, isStaleInvoice } from './payments.errors'
import { formatMoney, personName } from './payments.format'
import './payments.css'

interface InvoiceDrawerProps {
  invoiceId: string | null
  onClose: () => void
  /** Every invoice the server answered (a write or a re-read), so the list row follows. */
  onUpdated: (invoice: Invoice) => void
  /** A draft was deleted (API-148): the list drops its row. */
  onDeleted?: (invoiceId: string) => void
  dockedIn?: HTMLElement | null
  onUnsavedChange?: (unsaved: boolean) => void
}

export function InvoiceDrawer({ invoiceId, onClose, onUpdated, onDeleted, dockedIn, onUnsavedChange }: InvoiceDrawerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message, modal } = App.useApp()
  const { hasPermission } = useAuth()
  const { academy } = useAcademy()
  const zone = academyTimeZoneOf(academy)
  const canRecord = hasPermission('payments.record')
  const canManage = hasPermission('invoices.manage')
  const canRefund = hasPermission('payments.refund')
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [recording, setRecording] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [reversing, setReversing] = useState<InvoicePayment | null>(null)
  const [editing, setEditing] = useState(false)
  const [editUnsaved, setEditUnsaved] = useState(false)
  const unsaved = editing && editUnsaved

  useEffect(() => {
    onUnsavedChange?.(unsaved)
  }, [unsaved, onUnsavedChange])

  const onUpdatedRef = useRef(onUpdated)
  useEffect(() => {
    onUpdatedRef.current = onUpdated
  }, [onUpdated])

  useEffect(() => {
    if (!invoiceId) return
    const controller = new AbortController()
    getInvoice(invoiceId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setInvoice(loaded)
        setLoadError(null)
        if (reloadTick > 0) onUpdatedRef.current(loaded)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(failureMessage(t, describePaymentsFailure(error)))
      })
    return () => controller.abort()
  }, [invoiceId, reloadTick, t])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  const close = () => {
    setInvoice(null)
    setLoadError(null)
    setRecording(false)
    setCancelling(false)
    setReversing(null)
    setEditing(false)
    setEditUnsaved(false)
    onClose()
  }

  const { requestClose, holdNavigation } = useUnsavedChangesGuard(unsaved, close)

  const shown = invoice && invoice.id === invoiceId ? invoice : null
  const money = (amount: number) => (shown ? formatMoney(amount, shown.currency, language) : String(amount))
  const instant = (iso: string | null) => (zone ? formatLessonDateTime(iso, language, zone) : formatDateTime(iso, language))

  const applyInvoice = (updated: Invoice) => {
    setInvoice(updated)
    onUpdated(updated)
  }

  const issue = () => {
    if (!shown) return
    modal.confirm({
      title: t('payments.issue.title'),
      content: t('payments.issue.content'),
      okText: t('payments.issue.ok'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          const issued = await changeInvoiceStatus(shown.id, { action: 'issue' })
          applyInvoice(issued)
          message.success(t('payments.issue.done', { number: issued.number ?? '' }))
        } catch (error) {
          message.error(failureMessage(t, describePaymentsFailure(error)))
          if (isStaleInvoice(error)) reload()
        }
      },
    })
  }

  const remove = () => {
    if (!shown) return
    modal.confirm({
      title: t('payments.draft.delete.title'),
      content: t('payments.draft.delete.content'),
      okText: t('payments.draft.delete.ok'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await deleteInvoice(shown.id)
          message.success(t('payments.draft.delete.done'))
          onDeleted?.(shown.id)
          close()
        } catch (error) {
          message.error(failureMessage(t, describePaymentsFailure(error)))
          reload()
        }
      },
    })
  }

  const lineColumns: TableProps<InvoiceLine>['columns'] = [
    { title: t('payments.drawer.line'), key: 'description', render: (_, line) => localizedLabel(line.description, language) },
    { title: t('payments.columns.amount'), key: 'amount', align: 'end', render: (_, line) => <bdi dir="ltr">{money(line.amount)}</bdi> },
  ]

  const installmentColumns: TableProps<InvoiceInstallment>['columns'] = [
    { title: '#', dataIndex: 'seq', width: 48 },
    {
      title: t('payments.drawer.dueOn'),
      key: 'dueOn',
      render: (_, part) => <span className={part.overdue ? 'finance-overdue' : undefined}>{formatDay(part.dueOn, language)}</span>,
    },
    { title: t('payments.columns.amount'), key: 'amount', align: 'end', render: (_, part) => <bdi dir="ltr">{money(part.amount)}</bdi> },
    { title: t('payments.columns.paid'), key: 'paid', align: 'end', render: (_, part) => <bdi dir="ltr">{money(part.paid)}</bdi> },
    {
      title: t('payments.drawer.remaining'),
      key: 'remaining',
      align: 'end',
      render: (_, part) => (
        <bdi dir="ltr" className={part.overdue ? 'finance-overdue' : undefined}>
          {money(part.remaining)}
        </bdi>
      ),
    },
    { title: t('common.status'), key: 'status', render: (_, part) => <FinanceTag value={part.overdue ? 'overdue' : part.status} /> },
  ]

  const paymentColumns: TableProps<InvoicePayment>['columns'] = [
    {
      title: t('payments.drawer.receipt'),
      key: 'number',
      render: (_, payment) => (
        <span className="list-primary">
          <bdi dir="ltr">
            <b>{payment.number}</b>
          </bdi>
          <small>{instant(payment.paidAt)}</small>
        </span>
      ),
    },
    { title: t('payments.columns.amount'), key: 'amount', align: 'end', render: (_, payment) => <bdi dir="ltr">{money(payment.amount)}</bdi> },
    { title: t('payments.record.method'), key: 'method', render: (_, payment) => t(`payments.methods.${payment.method}`) },
    {
      title: t('common.status'),
      key: 'status',
      render: (_, payment) => (
        <Space orientation="vertical" size={2}>
          <FinanceTag value={payment.status} />
          {payment.reverseReason ? <Typography.Text type="secondary">{payment.reverseReason}</Typography.Text> : null}
        </Space>
      ),
    },
    {
      title: t('payments.drawer.details'),
      key: 'details',
      render: (_, payment) => {
        const parts = [payment.reference, payment.payerName, payment.recordedBy ? t('payments.drawer.recordedBy', { name: payment.recordedBy.fullName }) : null].filter(Boolean)
        return parts.length > 0 ? <Typography.Text type="secondary">{parts.join(' · ')}</Typography.Text> : '—'
      },
    },
    ...(canRefund
      ? [
          {
            title: t('common.actions'),
            key: 'actions',
            render: (_: unknown, payment: InvoicePayment) =>
              payment.status === 'completed' ? (
                <Button size="small" danger onClick={() => setReversing(payment)}>
                  {t('payments.reverse.action')}
                </Button>
              ) : null,
          },
        ]
      : []),
  ]

  const actions = shown && !editing ? (
    <Space wrap>
      {canManage && shown.status === 'draft' ? (
        <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
          {t('common.edit')}
        </Button>
      ) : null}
      {canManage && shown.status === 'draft' ? (
        <Button danger icon={<DeleteOutlined />} onClick={remove} aria-label={t('payments.draft.delete.action')}>
          {t('payments.deleteAction')}
        </Button>
      ) : null}
      {canRecord && shown.status === 'issued' && shown.balance > 0 ? (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setRecording(true)}>
          {t('payments.record.action')}
        </Button>
      ) : null}
      {canManage && shown.status === 'draft' ? (
        <Button icon={<CheckCircleOutlined />} onClick={issue}>
          {t('payments.issue.action')}
        </Button>
      ) : null}
      {canManage && shown.status === 'issued' ? (
        <Button danger icon={<CloseCircleOutlined />} onClick={() => setCancelling(true)}>
          {t('payments.cancel.action')}
        </Button>
      ) : null}
    </Space>
  ) : null

  return (
    <Drawer
      open={invoiceId !== null}
      onClose={requestClose}
      keyboard={!unsaved}
      {...dockedDrawerProps(dockedIn, unsaved, 'large')}
      title={shown ? (shown.number ? <bdi dir="ltr">{shown.number}</bdi> : t('payments.drawer.draftTitle')) : t('payments.drawer.title')}
      destroyOnHidden
      extra={actions}
    >
      <NavigationBlocker when={unsaved} onBlocked={holdNavigation} />
      {loadError ? (
        <Alert
          type="error"
          showIcon
          title={loadError}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
              {t('payments.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {!shown && !loadError ? (
        <Flex justify="center" style={{ padding: 32 }}>
          <Spin />
        </Flex>
      ) : null}
      {shown && editing ? (
        <InvoiceEditForm
          key={`${shown.id}:${shown.updatedAt}`}
          invoice={shown}
          onSaved={(updated) => {
            applyInvoice(updated)
            setEditing(false)
            message.success(t('payments.draft.saved'))
          }}
          onCancel={() => setEditing(false)}
          onUnsavedChange={setEditUnsaved}
          onStale={() => {
            setEditing(false)
            reload()
          }}
        />
      ) : null}
      {shown && !editing ? (
        <Flex vertical gap={20}>
          <div className="finance-totals">
            <div>
              <span>{t('payments.columns.total')}</span>
              <bdi dir="ltr">{money(shown.total)}</bdi>
            </div>
            <div>
              <span>{t('payments.columns.paid')}</span>
              <bdi dir="ltr">{money(shown.paid)}</bdi>
            </div>
            <div className={shown.overdue ? 'finance-totals__bad' : undefined}>
              <span>{t('payments.columns.balance')}</span>
              <bdi dir="ltr">{money(shown.balance)}</bdi>
            </div>
          </div>

          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label={t('common.status')}>
              <Space wrap>
                <FinanceTag value={shown.status} />
                {shown.status === 'issued' ? <FinanceTag value={shown.paymentState} /> : null}
                {shown.overdue ? <FinanceTag value="overdue" /> : null}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label={t('common.student')}>{personName(shown.student)}</Descriptions.Item>
            <Descriptions.Item label={t('payments.drawer.class')}>
              {shown.enrollment ? (
                <span>
                  {localizedLabel(shown.enrollment.class.name, language)} (<bdi dir="ltr">{shown.enrollment.class.code}</bdi>)
                </span>
              ) : (
                '—'
              )}
            </Descriptions.Item>
            {shown.feePlan ? <Descriptions.Item label={t('payments.drawer.feePlan')}>{localizedLabel(shown.feePlan.name, language)}</Descriptions.Item> : null}
            <Descriptions.Item label={t('payments.drawer.subtotal')}>
              <bdi dir="ltr">{money(shown.subtotal)}</bdi>
            </Descriptions.Item>
            {shown.discountAmount > 0 ? (
              <Descriptions.Item label={t('payments.drawer.discount')}>
                <bdi dir="ltr">{money(shown.discountAmount)}</bdi>
                {shown.discountReason ? ` — ${shown.discountReason}` : ''}
              </Descriptions.Item>
            ) : null}
            <Descriptions.Item label={t('payments.drawer.issuedAt')}>
              {shown.issuedAt ? `${instant(shown.issuedAt)}${shown.issuedBy ? ` — ${shown.issuedBy.fullName}` : ''}` : '—'}
            </Descriptions.Item>
            {shown.cancelledAt ? (
              <Descriptions.Item label={t('payments.drawer.cancelledAt')}>
                {instant(shown.cancelledAt)}
                {shown.cancelReason ? ` — ${shown.cancelReason}` : ''}
              </Descriptions.Item>
            ) : null}
            {shown.notes ? (
              <Descriptions.Item label={t('payments.drawer.notes')}>
                <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{shown.notes}</Typography.Paragraph>
              </Descriptions.Item>
            ) : null}
          </Descriptions>

          <section>
            <Typography.Title level={2} className="section-title">{t('payments.drawer.lines')}</Typography.Title>
            <Table<InvoiceLine> rowKey="sortOrder" size="small" columns={lineColumns} dataSource={shown.lines} pagination={false} scroll={{ x: 'max-content' }} />
          </section>

          <section>
            <Typography.Title level={2} className="section-title">{t('payments.drawer.installments')}</Typography.Title>
            <Table<InvoiceInstallment>
              rowKey="seq"
              size="small"
              columns={installmentColumns}
              dataSource={shown.installments}
              pagination={false}
              scroll={{ x: 'max-content' }}
            />
          </section>

          <section>
            <Typography.Title level={2} className="section-title">{t('payments.drawer.payments')}</Typography.Title>
            {shown.payments.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('payments.drawer.noPayments')} />
            ) : (
              <Table<InvoicePayment> rowKey="id" size="small" columns={paymentColumns} dataSource={shown.payments} pagination={false} scroll={{ x: 'max-content' }} />
            )}
          </section>
        </Flex>
      ) : null}

      <RecordPaymentModal
        invoice={recording ? shown : null}
        onClose={() => setRecording(false)}
        onStale={reload}
        onRecorded={(payment) => {
          setRecording(false)
          message.success(t('payments.record.done', { number: payment.number, balance: formatMoney(payment.invoice.balance, payment.currency, language) }))
          reload()
        }}
      />

      <ReasonModal
        open={cancelling && shown !== null}
        title={t('payments.cancel.title', { number: shown?.number ?? '' })}
        description={t('payments.cancel.content')}
        okText={t('payments.cancel.ok')}
        onCancel={() => setCancelling(false)}
        failure={(error) => {
          if (isStaleInvoice(error)) reload()
          return failureMessage(t, describePaymentsFailure(error))
        }}
        onSubmit={async (reason) => {
          if (!shown) return
          const cancelled = await changeInvoiceStatus(shown.id, { action: 'cancel', reason })
          setCancelling(false)
          applyInvoice(cancelled)
          message.success(t('payments.cancel.done'))
        }}
      />

      <ReasonModal
        open={reversing !== null}
        title={t('payments.reverse.title', { number: reversing?.number ?? '' })}
        description={t('payments.reverse.content', { amount: reversing ? money(reversing.amount) : '' })}
        okText={t('payments.reverse.ok')}
        onCancel={() => setReversing(null)}
        failure={(error) => {
          if (isStaleInvoice(error)) reload()
          return failureMessage(t, describePaymentsFailure(error))
        }}
        onSubmit={async (reason) => {
          if (!reversing) return
          const reversed = await reversePayment(reversing.id, reason)
          setReversing(null)
          message.success(t('payments.reverse.done', { number: reversed.number }))
          reload()
        }}
      />
    </Drawer>
  )
}
