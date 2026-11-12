// Detail drawer of one invoice (J-F52 — API-145): its student, class, fee plan,
// totals, its lines, its 1..24 installments with their due days and the paid
// part, remaining part, status and overdue flag the server computes on every
// read (D-R62, ADR-068 — shown as returned, never recomputed), and its payments
// (completed and reversed, newest first) with a link to print each receipt.
// Actions follow the mirrored status machine and the keys of D-R65
// (invoices.status.ts): for `invoices.manage` a draft is edited (the smallest
// PATCH — API-147), issued (API-149 `issue`, the number `INV-YYYY-NNNNN` comes
// back) or deleted (API-148), and an issued invoice is cancelled with a
// required reason while no completed payment stands (`invoice_has_payments` —
// the button says why it is off); `payments.record` records a payment on an
// issued invoice with a balance left (API-151) and `payments.refund` reverses a
// completed one with a reason (API-154). After every write the drawer re-reads
// the invoice (the server's numbers) and the lists follow (`onChanged`). While
// the edit form or a window opened here holds unsaved work, Escape and a mask
// click no longer close the drawer, the close button asks first
// (common.unsaved.*), a browser back asks the same question (NavigationBlocker)
// and a reload gets the browser's own prompt (useUnsavedChangesGuard).
import { CheckCircleOutlined, DeleteOutlined, EditOutlined, PrinterOutlined, RollbackOutlined, StopOutlined, WalletOutlined } from '@ant-design/icons'
import { Alert, App, Button, Descriptions, Drawer, Flex, Form, Modal, Skeleton, Space, Switch, Table, Tooltip, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAcademy } from '../academy/useAcademy'
import { changeInvoiceStatus, deleteInvoice, getInvoice, updateInvoice } from '../api/invoices'
import type { Invoice, InvoicePayment } from '../api/invoices'
import { reversePayment } from '../api/payments'
import type { Payment } from '../api/payments'
import { academyZoneOf } from '../assignments/assignments.zone'
import { useAuth } from '../auth/auth-context'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { useUnsavedChangesGuard } from '../common/useUnsavedChangesGuard'
import type { Language } from '../i18n/language'
import { useLocalized } from '../i18n/useLocalized'
import { todayIn } from '../lessons/lessons.format'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { displayNameOf, formatDateTime, formatDay, localizedLabel } from '../users/users.format'
import { InvoiceContentFields } from './InvoiceContentFields'
import { InstallmentsTable, InvoiceLinesTable } from './InvoiceTables'
import { InvoiceStatusTag, Money, OverdueTag, PaymentStateTag, PaymentStatusTag } from './FinanceTags'
import { ReasonModal } from './ReasonModal'
import { RecordPaymentModal } from './RecordPaymentModal'
import { FinanceFailureAlert, FormProblemsAlert } from './FinanceAlerts'
import { describeFinanceFailure, failureMessage, isFinanceFailure } from './finance.errors'
import type { FinanceFailure } from './finance.errors'
import { formatMoney, invoiceNumberOf } from './finance.format'
import { invoiceEditFormValuesOf, invoiceFormHasChanges, invoiceFormProblems, planInvoicePatch } from './invoices.form'
import type { InvoiceEditFormValues } from './invoices.form'
import type { InvoiceProblem } from './invoices.rules'
import { availableInvoiceActions, cancelBlocker, canReversePayment } from './invoices.status'

/** The invoice changed elsewhere (another status, deleted, already reversed): the drawer re-reads it. */
const STALE_CODES = ['invalid_transition', 'invoice_not_draft', 'invoice_not_found', 'invoice_has_payments', 'payment_reversed', 'payment_not_found']

type PendingAction = 'issue' | 'delete' | 'cancel' | 'record'

/** The editors that report unsaved work: the edit form of a draft and a window opened from the drawer. */
type EditorPart = 'edit' | 'window'

const NOTHING_UNSAVED: Readonly<Record<EditorPart, boolean>> = { edit: false, window: false }

interface InvoiceDrawerProps {
  invoiceId: string | null
  onClose: () => void
  /** The invoice changed here (saved, issued, cancelled, deleted, a payment recorded or reversed): the lists re-read. */
  onChanged: () => void
}

export function InvoiceDrawer({ invoiceId, onClose, onChanged }: InvoiceDrawerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { user } = useAuth()
  const permissions = useMemo(() => user?.permissions ?? [], [user])
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [reversing, setReversing] = useState<InvoicePayment | null>(null)
  const [lastReceipt, setLastReceipt] = useState<Payment | null>(null)
  const [unsavedParts, setUnsavedParts] = useState<Readonly<Record<EditorPart, boolean>>>(NOTHING_UNSAVED)

  // One stable reporter per editor (the windows report from an effect that depends on it).
  const reportUnsaved = useMemo(() => {
    const reporter = (part: EditorPart) => (unsaved: boolean) => setUnsavedParts((current) => (current[part] === unsaved ? current : { ...current, [part]: unsaved }))
    return { edit: reporter('edit'), window: reporter('window') }
  }, [])
  const unsaved = (editing && unsavedParts.edit) || unsavedParts.window

  useEffect(() => {
    if (!invoiceId) return
    const controller = new AbortController()
    getInvoice(invoiceId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setInvoice(loaded)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const failure = describeFinanceFailure(error)
        // An invoice that is gone (a deleted draft) no longer shows its last known details.
        if (isFinanceFailure(failure, 'invoice_not_found')) {
          setInvoice(null)
          setEditing(false)
        }
        setLoadError(failureMessage(t, failure))
      })
    return () => controller.abort()
  }, [invoiceId, reloadTick, t])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  const close = () => {
    setInvoice(null)
    setLoadError(null)
    setEditing(false)
    setPending(null)
    setReversing(null)
    setLastReceipt(null)
    setUnsavedParts(NOTHING_UNSAVED)
    onClose()
  }

  const { requestClose, holdNavigation } = useUnsavedChangesGuard(unsaved, close)

  /** A write's answer: the drawer shows it and the lists re-read. */
  const applyUpdate = (updated: Invoice) => {
    setInvoice(updated)
    onChanged()
  }

  /** A write elsewhere (a payment) changed the invoice's computed numbers: read it again. */
  const afterPaymentWrite = () => {
    reload()
    onChanged()
  }

  const actions = invoice && !editing ? availableInvoiceActions(invoice, permissions) : []
  const blocker = invoice ? cancelBlocker(invoice) : null
  const number = invoice ? (invoiceNumberOf(invoice) ?? t('finance.draftNumber')) : t('invoices.drawer.title')

  return (
    <Drawer
      open={invoiceId !== null}
      onClose={requestClose}
      // Unsaved work turns off the Escape key and the mask click; a window open on top still takes its own Escape first.
      keyboard={!unsaved}
      mask={{ closable: !unsaved }}
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
      // antd 6: `size` takes a CSS length; the panel never exceeds a phone viewport.
      size="min(860px, 100vw)"
      destroyOnHidden
      extra={
        actions.length > 0 ? (
          <Space wrap>
            {actions.includes('edit') ? (
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                {t('invoices.actions.edit')}
              </Button>
            ) : null}
            {actions.includes('issue') ? (
              <Button icon={<CheckCircleOutlined />} onClick={() => setPending('issue')}>
                {t('invoices.actions.issue')}
              </Button>
            ) : null}
            {actions.includes('record') ? (
              <Button type="primary" icon={<WalletOutlined />} onClick={() => setPending('record')}>
                {t('invoices.actions.record')}
              </Button>
            ) : null}
            {actions.includes('cancel') ? (
              // A disabled button swallows the pointer events, so the reason sits on a wrapper.
              <Tooltip title={blocker ? t('invoices.actions.cancelBlocked', { count: blocker.paymentCount }) : undefined}>
                <span style={{ display: 'inline-block' }}>
                  <Button danger icon={<StopOutlined />} disabled={blocker !== null} onClick={() => setPending('cancel')}>
                    {t('invoices.actions.cancel')}
                  </Button>
                </span>
              </Tooltip>
            ) : null}
            {actions.includes('delete') ? (
              <Button danger icon={<DeleteOutlined />} onClick={() => setPending('delete')}>
                {t('invoices.actions.delete')}
              </Button>
            ) : null}
          </Space>
        ) : null
      }
    >
      <NavigationBlocker when={unsaved} onBlocked={holdNavigation} />
      {loadError ? (
        <Alert
          type="error"
          showIcon
          title={loadError}
          action={
            <Button size="small" onClick={reload}>
              {t('invoices.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {!invoice && !loadError ? <Skeleton active paragraph={{ rows: 8 }} data-testid="invoice-loading" /> : null}

      {invoice && lastReceipt ? (
        <Alert
          type="success"
          showIcon
          closable={{ onClose: () => setLastReceipt(null) }}
          title={t('invoices.drawer.recorded', { number: lastReceipt.number })}
          action={
            <Link to={`/payments/${encodeURIComponent(lastReceipt.id)}/receipt`} target="_blank" rel="noopener">
              {t('payments.receipts.print')}
            </Link>
          }
          style={{ marginBottom: 16 }}
          data-testid="invoice-last-receipt"
        />
      ) : null}

      {invoice ? <Alert type={invoice.status === 'cancelled' ? 'warning' : 'info'} showIcon title={statusHint(t, invoice, language)} style={{ marginBottom: 16 }} data-testid="invoice-status-hint" /> : null}

      {invoice && editing ? (
        <InvoiceEditForm
          // Remount per server version so the form starts from what the server holds (KI-049).
          key={`${invoice.id}:${invoice.updatedAt}`}
          invoice={invoice}
          onSaved={(updated) => {
            applyUpdate(updated)
            setEditing(false)
          }}
          onStale={() => {
            setEditing(false)
            reload()
          }}
          onCancel={() => setEditing(false)}
          onUnsavedChange={reportUnsaved.edit}
        />
      ) : null}

      {invoice && !editing ? (
        <>
          <InvoiceDetails invoice={invoice} />
          <Typography.Title level={5}>{t('invoices.drawer.lines')}</Typography.Title>
          <InvoiceLinesTable lines={invoice.lines} currency={invoice.currency} />
          <Typography.Title level={5} style={{ marginTop: 16 }}>
            {t('invoices.drawer.installments')}
          </Typography.Title>
          <InstallmentsTable installments={invoice.installments} currency={invoice.currency} />
          <Typography.Title level={5} style={{ marginTop: 16 }}>
            {t('invoices.drawer.payments')}
          </Typography.Title>
          <InvoicePaymentsTable invoice={invoice} permissions={permissions} onReverse={setReversing} />
        </>
      ) : null}

      {invoice && (pending === 'issue' || pending === 'delete') ? (
        <ConfirmInvoiceAction
          // Mounted per action.
          invoice={invoice}
          action={pending}
          onDone={(updated) => {
            setPending(null)
            if (updated) applyUpdate(updated)
            else {
              onChanged()
              close()
            }
          }}
          onStale={reload}
          onCancel={() => setPending(null)}
        />
      ) : null}

      {invoice && pending === 'cancel' ? (
        <ReasonModal
          title={t('invoices.confirm.cancelTitle', { number })}
          description={t('invoices.confirm.cancel')}
          reasonLabel={t('invoices.confirm.cancelReason')}
          okText={t('invoices.actions.cancel')}
          onUnsavedChange={reportUnsaved.window}
          onClose={() => setPending(null)}
          onSubmit={async (reason) => {
            try {
              const updated = await changeInvoiceStatus(invoice.id, { action: 'cancel', reason })
              setPending(null)
              message.success(t('invoices.done.cancel', { number: updated.number ?? '' }))
              applyUpdate(updated)
            } catch (caught) {
              const failure = describeFinanceFailure(caught)
              if (STALE_CODES.some((code) => isFinanceFailure(failure, code))) reload()
              throw new Error(failureMessage(t, failure))
            }
          }}
        />
      ) : null}

      {invoice && pending === 'record' ? (
        <RecordPaymentModal
          invoice={invoice}
          onUnsavedChange={reportUnsaved.window}
          onClose={() => setPending(null)}
          onStale={reload}
          onRecorded={(payment) => {
            setPending(null)
            setLastReceipt(payment)
            afterPaymentWrite()
          }}
        />
      ) : null}

      {invoice && reversing ? (
        <ReasonModal
          title={t('payments.reverseModal.title', { number: reversing.number })}
          description={t('payments.reverseModal.hint', { amount: formatMoney(reversing.amount, invoice.currency, language) })}
          reasonLabel={t('payments.reverseModal.reason')}
          okText={t('payments.reverseModal.ok')}
          onUnsavedChange={reportUnsaved.window}
          onClose={() => setReversing(null)}
          onSubmit={async (reason) => {
            try {
              const reversed = await reversePayment(reversing.id, { reason })
              setReversing(null)
              message.success(t('payments.reverseModal.done', { number: reversed.number }))
              afterPaymentWrite()
            } catch (caught) {
              const failure = describeFinanceFailure(caught)
              if (STALE_CODES.some((code) => isFinanceFailure(failure, code))) reload()
              throw new Error(failureMessage(t, failure))
            }
          }}
        />
      ) : null}
    </Drawer>
  )
}

/** What the invoice's status means for the reader, in one sentence. */
function statusHint(t: (key: string, options?: Record<string, unknown>) => string, invoice: Invoice, language: Language): string {
  if (invoice.status === 'cancelled') return t('invoices.drawer.cancelledHint', { date: formatDateTime(invoice.cancelledAt, language), reason: invoice.cancelReason ?? '—' })
  return t(`invoices.drawer.statusHint.${invoice.status}`)
}

function InvoiceDetails({ invoice }: { invoice: Invoice }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const money = (amount: number) => formatMoney(amount, invoice.currency, language)
  return (
    <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }} data-testid="invoice-details">
      <Descriptions.Item label={t('invoices.drawer.student')}>{displayNameOf(invoice.student)}</Descriptions.Item>
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
      <Descriptions.Item label={t('invoices.drawer.feePlan')}>
        {invoice.feePlan ? localizedLabel(invoice.feePlan.name, language) : <Typography.Text type="secondary">{t('invoices.drawer.noPlan')}</Typography.Text>}
      </Descriptions.Item>
      <Descriptions.Item label={t('finance.fields.subtotal')}>
        <Money amount={invoice.subtotal} currency={invoice.currency} />
      </Descriptions.Item>
      <Descriptions.Item label={t('finance.fields.discount')}>
        {invoice.discountAmount > 0 ? (
          <span>
            <Money amount={invoice.discountAmount} currency={invoice.currency} />
            {invoice.discountReason ? <Typography.Text type="secondary"> — {invoice.discountReason}</Typography.Text> : null}
          </span>
        ) : (
          '—'
        )}
      </Descriptions.Item>
      <Descriptions.Item label={t('finance.fields.total')}>
        <Money amount={invoice.total} currency={invoice.currency} strong />
      </Descriptions.Item>
      {invoice.status !== 'draft' ? (
        <>
          <Descriptions.Item label={t('finance.fields.paid')}>
            <Money amount={invoice.paid} currency={invoice.currency} />
          </Descriptions.Item>
          <Descriptions.Item label={t('finance.fields.balance')}>
            <Space wrap size={4}>
              <Money amount={invoice.balance} currency={invoice.currency} strong />
              {invoice.status === 'issued' ? <PaymentStateTag state={invoice.paymentState} /> : null}
              {invoice.overdue ? <OverdueTag /> : null}
            </Space>
          </Descriptions.Item>
        </>
      ) : null}
      {invoice.nextDue ? (
        <Descriptions.Item label={t('finance.fields.nextDue')}>
          {t('finance.nextDue', { seq: invoice.nextDue.seq, date: formatDay(invoice.nextDue.dueOn, language), amount: money(invoice.nextDue.remaining) })}
        </Descriptions.Item>
      ) : null}
      <Descriptions.Item label={t('finance.fields.currency')}>
        <bdi dir="ltr">{invoice.currency}</bdi>
      </Descriptions.Item>
      {invoice.issuedAt ? (
        <Descriptions.Item label={t('invoices.drawer.issued')}>
          {formatDateTime(invoice.issuedAt, language)}
          {invoice.issuedBy ? <Typography.Text type="secondary"> — {invoice.issuedBy.fullName}</Typography.Text> : null}
        </Descriptions.Item>
      ) : null}
      {invoice.notes ? (
        <Descriptions.Item label={t('invoices.drawer.notes')}>
          <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{invoice.notes}</Typography.Paragraph>
        </Descriptions.Item>
      ) : null}
      <Descriptions.Item label={t('invoices.drawer.created')}>{formatDateTime(invoice.createdAt, language)}</Descriptions.Item>
      <Descriptions.Item label={t('invoices.drawer.updated')}>{formatDateTime(invoice.updatedAt, language)}</Descriptions.Item>
    </Descriptions>
  )
}

interface InvoicePaymentsTableProps {
  invoice: Invoice
  permissions: readonly string[]
  onReverse: (payment: InvoicePayment) => void
}

/** The invoice's payments as the server lists them (newest first, reversed ones kept), each with its receipt. */
function InvoicePaymentsTable({ invoice, permissions, onReverse }: InvoicePaymentsTableProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const columns: TableProps<InvoicePayment>['columns'] = [
    { title: t('invoices.drawer.receipt'), key: 'number', render: (_, payment) => <bdi dir="ltr">{payment.number}</bdi> },
    { title: t('invoices.drawer.paidAt'), key: 'paidAt', render: (_, payment) => formatDateTime(payment.paidAt, language) },
    { title: t('finance.columns.amount'), key: 'amount', align: 'end', render: (_, payment) => <Money amount={payment.amount} currency={invoice.currency} /> },
    { title: t('invoices.drawer.method'), key: 'method', render: (_, payment) => t(`finance.methods.${payment.method}`) },
    {
      title: t('finance.columns.status'),
      key: 'status',
      render: (_, payment) => (
        <span>
          <PaymentStatusTag status={payment.status} />
          {payment.status === 'reversed' ? (
            <>
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('invoices.drawer.reversed', { date: formatDateTime(payment.reversedAt, language), reason: payment.reverseReason ?? '—' })}
              </Typography.Text>
            </>
          ) : null}
        </span>
      ),
    },
    {
      title: t('invoices.drawer.details'),
      key: 'details',
      render: (_, payment) => (
        <span style={{ fontSize: 12 }}>
          {payment.reference ? (
            <>
              {t('invoices.drawer.reference')}: <bdi>{payment.reference}</bdi>
              <br />
            </>
          ) : null}
          {payment.payerName ? (
            <>
              {t('invoices.drawer.payerName')}: {payment.payerName}
              <br />
            </>
          ) : null}
          {payment.recordedBy ? `${t('invoices.drawer.recordedBy')}: ${payment.recordedBy.fullName}` : null}
        </span>
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, payment) => (
        <Space size={4} wrap>
          <Link to={`/payments/${encodeURIComponent(payment.id)}/receipt`} target="_blank" rel="noopener" aria-label={`${t('payments.receipts.print')}: ${payment.number}`}>
            <PrinterOutlined /> {t('invoices.drawer.print')}
          </Link>
          {canReversePayment(payment, permissions) ? (
            <Button size="small" danger icon={<RollbackOutlined />} onClick={() => onReverse(payment)} aria-label={`${t('payments.receipts.reverse')}: ${payment.number}`}>
              {t('invoices.drawer.reverse')}
            </Button>
          ) : null}
        </Space>
      ),
    },
  ]
  return (
    <Table<InvoicePayment>
      size="small"
      rowKey="id"
      columns={columns}
      dataSource={invoice.payments}
      pagination={false}
      scroll={{ x: 'max-content' }}
      data-testid="invoice-payments"
      locale={{ emptyText: t('invoices.drawer.noPayments') }}
    />
  )
}

interface ConfirmInvoiceActionProps {
  invoice: Invoice
  action: 'issue' | 'delete'
  /** The invoice after an issue, or null after a deletion. */
  onDone: (invoice: Invoice | null) => void
  /** The invoice changed elsewhere meanwhile: re-read it. */
  onStale: () => void
  onCancel: () => void
}

/** Issue a draft (its number comes back) or delete it — confirmed in a window; a refusal names every problem. */
function ConfirmInvoiceAction({ invoice, action, onDone, onStale, onCancel }: ConfirmInvoiceActionProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<FinanceFailure | null>(null)

  const confirm = async () => {
    setBusy(true)
    setFailure(null)
    try {
      if (action === 'delete') {
        await deleteInvoice(invoice.id)
        message.success(t('invoices.done.delete'))
        onDone(null)
        return
      }
      const updated = await changeInvoiceStatus(invoice.id, { action: 'issue' })
      message.success(t('invoices.done.issue', { number: updated.number ?? '' }))
      onDone(updated)
    } catch (caught) {
      const described = describeFinanceFailure(caught)
      setFailure(described)
      if (STALE_CODES.some((code) => isFinanceFailure(described, code))) onStale()
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={t(action === 'issue' ? 'invoices.confirm.issueTitle' : 'invoices.confirm.deleteTitle')}
      okText={t(action === 'issue' ? 'invoices.actions.issue' : 'invoices.actions.delete')}
      okButtonProps={{ danger: action === 'delete' }}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      onOk={() => void confirm()}
      onCancel={() => {
        if (!busy) onCancel()
      }}
      destroyOnHidden
    >
      <Typography.Paragraph>{t(action === 'issue' ? 'invoices.confirm.issue' : 'invoices.confirm.delete')}</Typography.Paragraph>
      {failure ? <FinanceFailureAlert failure={failure} /> : null}
    </Modal>
  )
}

interface InvoiceEditFormProps {
  invoice: Invoice
  onSaved: (invoice: Invoice) => void
  /** The server refused the save because the draft changed elsewhere (issued, deleted): close the form and re-read. */
  onStale: () => void
  onCancel: () => void
  /** Whether a field holds unsaved work: reported on every change, false once saved or left. */
  onUnsavedChange: (unsaved: boolean) => void
}

/**
 * The edit form of a draft (API-147), one per edit session (KI-049): its lines,
 * discount, installments and note, and — for a draft tied to an enrollment —
 * whether it stays tied. The mirrored invoice rules run before any request; the
 * smallest PATCH is sent (none when nothing changed). It reports unsaved work
 * from onValuesChange, compared with the draft as loaded (all values, the
 * hidden fields included — getFieldsValue(true)).
 */
function InvoiceEditForm({ invoice, onSaved, onStale, onCancel, onUnsavedChange }: InvoiceEditFormProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { academy } = useAcademy()
  const [form] = Form.useForm()
  const [initialValues] = useState<InvoiceEditFormValues>(() => invoiceEditFormValuesOf(invoice))
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<FinanceFailure | null>(null)
  const [problems, setProblems] = useState<InvoiceProblem[]>([])
  const today = todayIn(academyZoneOf(academy) ?? deviceTimeZone())

  // The form left (saved, cancelled, stale, or the drawer closed) — nothing is held any more.
  useEffect(() => () => onUnsavedChange(false), [onUnsavedChange])

  const save = async (values: InvoiceEditFormValues) => {
    setFailure(null)
    const found = invoiceFormProblems(values)
    setProblems(found)
    if (found.length > 0) return
    const patch = planInvoicePatch(invoice, values)
    if (!patch) {
      message.info(t('invoices.drawer.nothingChanged'))
      onUnsavedChange(false)
      onCancel()
      return
    }
    setSaving(true)
    try {
      const updated = await updateInvoice(invoice.id, patch)
      message.success(t('invoices.drawer.saved'))
      onUnsavedChange(false)
      onSaved(updated)
    } catch (caught) {
      const described = describeFinanceFailure(caught, (amount) => formatMoney(amount, invoice.currency, language))
      if (isFinanceFailure(described, 'invoice_not_draft') || isFinanceFailure(described, 'invoice_not_found')) {
        message.error(failureMessage(t, described))
        onStale()
        return
      }
      setFailure(described)
      setSaving(false)
    }
  }

  return (
    <Form
      form={form}
      layout="vertical"
      requiredMark={false}
      initialValues={initialValues}
      disabled={saving}
      onFinish={(values) => void save(values as InvoiceEditFormValues)}
      onValuesChange={() => {
        setProblems([])
        onUnsavedChange(invoiceFormHasChanges(initialValues, form.getFieldsValue(true) as InvoiceEditFormValues))
      }}
      data-testid="invoice-edit-form"
    >
      {invoice.enrollment ? (
        <Form.Item
          name="keepEnrollment"
          label={t('invoices.drawer.keepEnrollment', { class: invoice.enrollment.class.code })}
          extra={t('invoices.drawer.keepEnrollmentHint')}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
      ) : null}
      <InvoiceContentFields form={form} currency={invoice.currency} manual today={today} />
      <FormProblemsAlert problems={problems} style={{ marginBottom: 16 }} />
      {failure ? <FinanceFailureAlert failure={failure} style={{ marginBottom: 16 }} /> : null}
      <Flex gap={8} justify="flex-end">
        <Button onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="primary" htmlType="submit" loading={saving}>
          {t('common.save')}
        </Button>
      </Flex>
    </Form>
  )
}
