// «Record a payment» (API-151, `payments.record`): the amount (≤ the balance
// the server sent with the invoice — the server checks it again under the
// invoice-row lock), the method, when it was received (blank = now on the
// server), a reference, the payer and an internal note. The body is mounted per
// session (KI-049). The answer is the receipt; the drawer then re-reads the
// invoice, so every total on screen is the server's.
import { Alert, Form, Input, InputNumber, Modal, Select } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PAYMENT_METHODS } from '../api/invoices'
import type { Invoice } from '../api/invoices'
import { PAYMENT_NOTES_MAX, PAYMENT_TEXT_MAX, recordPayment } from '../api/payments'
import type { Payment } from '../api/payments'
import { useLocalized } from '../i18n/useLocalized'
import { describePaymentsFailure, failureMessage } from './payments.errors'
import { buildRecordPaymentInput, exceeds, formatMoney, instantOfLocal, isFutureInstant, isTwoDecimalAmount } from './payments.format'
import type { RecordPaymentFormValues as FormValues } from './payments.format'

interface RecordPaymentModalProps {
  invoice: Invoice | null
  onClose: () => void
  onRecorded: (payment: Payment) => void
  /** A refusal that makes the invoice on screen stale (e.g. its balance moved). */
  onStale: () => void
}

export function RecordPaymentModal({ invoice, onClose, onRecorded, onStale }: RecordPaymentModalProps) {
  return invoice ? <RecordPaymentBody key={`${invoice.id}:${invoice.updatedAt}`} invoice={invoice} onClose={onClose} onRecorded={onRecorded} onStale={onStale} /> : null
}

function RecordPaymentBody({ invoice, onClose, onRecorded, onStale }: RecordPaymentModalProps & { invoice: Invoice }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [form] = Form.useForm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const suggested = invoice.nextDue && invoice.nextDue.remaining <= invoice.balance ? invoice.nextDue.remaining : invoice.balance

  const submit = async () => {
    let values: FormValues
    try {
      values = (await form.validateFields()) as FormValues
    } catch {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const payment = await recordPayment(invoice.id, buildRecordPaymentInput(values))
      onRecorded(payment)
    } catch (caught) {
      const failure = describePaymentsFailure(caught)
      const message = failureMessage(t, failure)
      if (failure.field) form.setFields([{ name: failure.field, errors: [message] }])
      else setError(message)
      if (failure.key === 'payments.errors.payment_exceeds_balance' || failure.key === 'payments.errors.invoice_not_issued') onStale()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={t('payments.record.title', { number: invoice.number ?? '' })}
      okText={t('payments.record.submit')}
      cancelText={t('common.cancel')}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={busy}
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} title={t('payments.record.balance', { balance: formatMoney(invoice.balance, invoice.currency, language) })} />
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Form form={form} layout="vertical" initialValues={{ amount: suggested, method: 'cash' }} requiredMark>
        <Form.Item
          name="amount"
          label={t('payments.record.amount', { currency: invoice.currency })}
          rules={[
            { required: true, message: t('payments.record.amountRequired') },
            {
              validator: (_, value: unknown) => {
                if (value === null || value === undefined) return Promise.resolve()
                if (!isTwoDecimalAmount(value) || value <= 0) return Promise.reject(new Error(t('payments.record.amountInvalid')))
                if (exceeds(value, invoice.balance)) return Promise.reject(new Error(t('payments.record.amountAboveBalance', { balance: formatMoney(invoice.balance, invoice.currency, language) })))
                return Promise.resolve()
              },
            },
          ]}
        >
          <InputNumber<number> style={{ width: '100%' }} step={0.01} precision={2} dir="ltr" />
        </Form.Item>
        <Form.Item name="method" label={t('payments.record.method')} rules={[{ required: true, message: t('payments.record.methodRequired') }]}>
          <Select options={PAYMENT_METHODS.map((method) => ({ value: method, label: t(`payments.methods.${method}`) }))} />
        </Form.Item>
        <Form.Item
          name="paidAt"
          label={t('payments.record.paidAt')}
          extra={t('payments.record.paidAtHint')}
          rules={[
            {
              validator: (_, value: string | undefined) => {
                if (!value) return Promise.resolve()
                const instant = instantOfLocal(value)
                if (!instant) return Promise.reject(new Error(t('payments.record.paidAtInvalid')))
                if (isFutureInstant(instant)) return Promise.reject(new Error(t('payments.record.paidAtFuture')))
                return Promise.resolve()
              },
            },
          ]}
        >
          <Input type="datetime-local" dir="ltr" />
        </Form.Item>
        <Form.Item name="reference" label={t('payments.record.reference')} rules={[{ max: PAYMENT_TEXT_MAX, message: t('payments.record.tooLong', { max: PAYMENT_TEXT_MAX }) }]}>
          <Input dir="auto" />
        </Form.Item>
        <Form.Item name="payerName" label={t('payments.record.payerName')} rules={[{ max: PAYMENT_TEXT_MAX, message: t('payments.record.tooLong', { max: PAYMENT_TEXT_MAX }) }]}>
          <Input dir="auto" />
        </Form.Item>
        <Form.Item
          name="notes"
          label={t('payments.record.notes')}
          extra={t('payments.record.notesHint')}
          rules={[{ max: PAYMENT_NOTES_MAX, message: t('payments.record.tooLong', { max: PAYMENT_NOTES_MAX }) }]}
        >
          <Input.TextArea rows={2} dir="auto" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
