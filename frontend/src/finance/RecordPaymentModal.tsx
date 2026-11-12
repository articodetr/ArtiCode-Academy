// Records a manual payment on an issued invoice (J-F52 — API-151, D-R63): the
// amount (two decimals at most, never above the balance the server sent —
// `payment_exceeds_balance` mirrored), the method, the moment the money was
// received (now by default — the server stamps it; else a day and a time on
// this device's clock, at most PAID_AT_SKEW_MS ahead), a reference, the payer
// and an internal note. The receipt number `RCPT-YYYY-NNNNN` comes from the
// server's answer. A refusal that says the invoice changed meanwhile (a balance
// paid by someone else, a cancelled invoice) re-reads it. Mounted per session
// (KI-049); it reports unsaved work to the drawer it lives in, and while it
// holds any, Escape and a mask click no longer close it and «إلغاء»/× ask first.
import { Alert, App, Col, Form, Input, InputNumber, Modal, Row, Select, Switch, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PAYMENT_METHODS, PAYMENT_NOTES_MAX, PAYMENT_TEXT_MAX, recordPayment } from '../api/payments'
import type { Payment } from '../api/payments'
import type { InvoiceSummary } from '../api/invoices'
import { useLocalized } from '../i18n/useLocalized'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { describeFinanceFailure, failureMessage, isFinanceFailure } from './finance.errors'
import { formatMoney, invoiceNumberOf } from './finance.format'
import { isPositiveAmount } from './finance.money'
import { buildRecordPaymentInput, exceedsBalance, isFutureInstant, newRecordPaymentForm, paidAtOf, recordPaymentFormHasChanges } from './payments.form'
import type { RecordPaymentFormValues } from './payments.form'
import { useFinanceUnsavedGuard } from './useFinanceUnsavedGuard'

/** The invoice changed meanwhile: the drawer re-reads it (the balance, the status). */
const STALE_CODES = ['payment_exceeds_balance', 'invoice_not_issued', 'invoice_not_found']

interface RecordPaymentModalProps {
  invoice: Pick<InvoiceSummary, 'id' | 'number' | 'currency' | 'balance' | 'nextDue'>
  onRecorded: (payment: Payment) => void
  /** The invoice changed elsewhere meanwhile: re-read it. */
  onStale: () => void
  onClose: () => void
  onUnsavedChange: (unsaved: boolean) => void
}

export function RecordPaymentModal({ invoice, onRecorded, onStale, onClose, onUnsavedChange }: RecordPaymentModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [initialValues] = useState<RecordPaymentFormValues>(() => newRecordPaymentForm(invoice, new Date()))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const receivedNow = (Form.useWatch('receivedNow', form) as boolean | undefined) ?? true
  const { requestClose } = useFinanceUnsavedGuard(dirty, onClose)
  const money = (amount: number) => formatMoney(amount, invoice.currency, language)

  useEffect(() => () => onUnsavedChange(false), [onUnsavedChange])

  const submit = async (values: RecordPaymentFormValues) => {
    setError(null)
    setSaving(true)
    try {
      const payment = await recordPayment(invoice.id, buildRecordPaymentInput(values))
      onUnsavedChange(false)
      message.success(t('payments.record.done', { number: payment.number }))
      onRecorded(payment)
    } catch (caught) {
      const failure = describeFinanceFailure(caught, money)
      const text = failureMessage(t, failure)
      if (isFinanceFailure(failure, 'payment_exceeds_balance')) form.setFields([{ name: ['amount'], errors: [text] }])
      else setError(text)
      if (STALE_CODES.some((code) => isFinanceFailure(failure, code))) onStale()
      setSaving(false)
    }
  }

  const number = invoiceNumberOf(invoice) ?? t('finance.draftNumber')

  return (
    <Modal
      open
      title={t('payments.record.title', { number })}
      okText={t('payments.record.ok')}
      cancelText={t('common.cancel')}
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={() => {
        if (!saving) requestClose()
      }}
      keyboard={!dirty}
      mask={{ closable: !dirty }}
      destroyOnHidden
      width={640}
    >
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={initialValues}
        disabled={saving}
        onFinish={(values) => void submit(values as RecordPaymentFormValues)}
        onValuesChange={() => {
          const unsaved = recordPaymentFormHasChanges(initialValues, form.getFieldsValue(true) as RecordPaymentFormValues)
          setDirty(unsaved)
          onUnsavedChange(unsaved)
        }}
      >
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item
              name="amount"
              label={t('payments.record.amount')}
              extra={t('payments.record.balance', { balance: money(invoice.balance) })}
              rules={[
                {
                  validator: (_, value: unknown) => {
                    if (value === null || value === undefined) return Promise.reject(new Error(t('finance.validation.amountRequired')))
                    if (!isPositiveAmount(value)) return Promise.reject(new Error(t('finance.validation.amount')))
                    // `exceedsBalance()` on the balance the server sent with the invoice.
                    if (exceedsBalance(value, invoice.balance)) return Promise.reject(new Error(t('finance.validation.exceedsBalance', { balance: money(invoice.balance) })))
                    return Promise.resolve()
                  },
                },
              ]}
            >
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="method" label={t('payments.record.method')} rules={[{ required: true, message: t('finance.validation.methodRequired') }]}>
              <Select options={PAYMENT_METHODS.map((method) => ({ value: method, label: t(`finance.methods.${method}`) }))} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="receivedNow" label={t('payments.record.receivedNow')} valuePropName="checked" extra={t('payments.record.receivedNowHint')}>
          <Switch />
        </Form.Item>
        {receivedNow ? null : (
          <Row gutter={12}>
            <Col xs={12}>
              <Form.Item name="paidDate" label={t('payments.record.paidDate')} rules={[{ required: true, message: t('finance.validation.paidAtRequired') }]}>
                <Input type="date" dir="ltr" />
              </Form.Item>
            </Col>
            <Col xs={12}>
              <Form.Item
                name="paidTime"
                label={t('payments.record.paidTime')}
                dependencies={['paidDate']}
                rules={[
                  ({ getFieldValue }) => ({
                    validator: (_, value: string | undefined) => {
                      const paidAt = paidAtOf(getFieldValue('paidDate') as string | undefined, value)
                      if (!paidAt) return Promise.reject(new Error(t('finance.validation.paidAtRequired')))
                      // `isFutureInstant()`: never more than the tolerated skew ahead of now.
                      if (isFutureInstant(paidAt, new Date())) return Promise.reject(new Error(t('finance.validation.paidAtFuture')))
                      return Promise.resolve()
                    },
                  }),
                ]}
              >
                <Input type="time" dir="ltr" />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -8 }}>
                {t('payments.record.paidAtHint', { zone: deviceTimeZone() })}
              </Typography.Paragraph>
            </Col>
          </Row>
        )}
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="reference" label={t('payments.record.reference')} rules={[{ max: PAYMENT_TEXT_MAX, message: t('finance.validation.textMax', { max: PAYMENT_TEXT_MAX }) }]}>
              <Input dir="auto" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="payerName" label={t('payments.record.payerName')} rules={[{ max: PAYMENT_TEXT_MAX, message: t('finance.validation.textMax', { max: PAYMENT_TEXT_MAX }) }]}>
              <Input />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="notes" label={t('payments.record.notes')} extra={t('payments.record.notesHint')} rules={[{ max: PAYMENT_NOTES_MAX, message: t('finance.validation.notesMax', { max: PAYMENT_NOTES_MAX }) }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
