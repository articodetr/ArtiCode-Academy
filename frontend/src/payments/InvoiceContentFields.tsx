// The content fields of a draft invoice (API-146/147), shared by the «new
// invoice» modal and the draft edit form of the invoice drawer: lines and
// installments by hand (when `byHand`), the one invoice-level discount with
// its reason (D-R64) and the internal note. Problems (local or the server's
// `invoice_invalid { problems }`) arrive already grouped by field.
import { Form, Input, InputNumber, Typography } from 'antd'
import type { FormInstance } from 'antd'
import { useTranslation } from 'react-i18next'
import { FINANCE_REASON_MAX, INVOICE_NOTES_MAX } from '../api/invoices'
import { MONEY_MAX } from '../api/payments'
import { useLocalized } from '../i18n/useLocalized'
import { InstallmentsField, LinesField } from './FinanceFormFields'
import { linesTotal } from './feePlans.rules'
import { invoiceTotals, spreadEvenly } from './invoices.form'
import type { InvoiceFormValues, InvoiceProblem } from './invoices.form'
import { formatMoney, isTwoDecimalAmount } from './payments.format'

interface InvoiceContentFieldsProps {
  form: FormInstance
  values: InvoiceFormValues
  problems: Record<string, InvoiceProblem[]>
  currency: string
  byHand: boolean
  /** Called after the fields were changed in code (the spread button), so the parent re-reads the values. */
  onProgrammaticChange: () => void
}

export function InvoiceContentFields({ form, values, problems, currency, byHand, onProgrammaticChange }: InvoiceContentFieldsProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const text = (field: string) => (problems[field] ?? []).map((problem) => t(`payments.problems.${problem}`))
  const status = (field: string) => ((problems[field]?.length ?? 0) > 0 ? ('error' as const) : undefined)
  const help = (field: string) => (status(field) ? text(field).join(' ') : undefined)
  const money = (value: number) => formatMoney(value, currency, language)
  const { total } = invoiceTotals({ lines: (values.lines ?? []).map((line) => ({ amount: Number(line.amount ?? 0) })), discountAmount: Number(values.discountAmount ?? 0) })

  return (
    <>
      {byHand ? (
        <>
          <LinesField currency={currency} />
          <Form.ErrorList errors={text('lines')} />
          <Typography.Paragraph type="secondary" style={{ marginTop: 4 }}>
            {t('payments.draft.totals', { subtotal: money(linesTotal(values.lines ?? [])), total: money(total) })}
          </Typography.Paragraph>
          <InstallmentsField
            currency={currency}
            listErrors={text('installments')}
            onSpread={() => {
              const current = (form.getFieldValue('installments') as InvoiceFormValues['installments']) ?? []
              form.setFieldValue('installments', spreadEvenly(total, current))
              onProgrammaticChange()
            }}
          />
        </>
      ) : null}
      <Form.Item
        name="discountAmount"
        label={t('payments.draft.discount', { currency })}
        validateStatus={status('discountAmount')}
        help={help('discountAmount')}
        rules={[
          {
            validator: (_, value: unknown) =>
              value === null || value === undefined || (isTwoDecimalAmount(value) && value <= MONEY_MAX) ? Promise.resolve() : Promise.reject(new Error(t('payments.form.amountInvalid'))),
          },
        ]}
        style={{ marginTop: byHand ? 12 : 0 }}
      >
        <InputNumber<number> style={{ width: '100%' }} step={0.01} precision={2} dir="ltr" />
      </Form.Item>
      <Form.Item
        name="discountReason"
        label={t('payments.draft.discountReason')}
        validateStatus={status('discountReason')}
        help={help('discountReason')}
        rules={[{ max: FINANCE_REASON_MAX, message: t('payments.record.tooLong', { max: FINANCE_REASON_MAX }) }]}
      >
        <Input dir="auto" />
      </Form.Item>
      <Form.Item
        name="notes"
        label={t('payments.record.notes')}
        extra={t('payments.record.notesHint')}
        rules={[{ max: INVOICE_NOTES_MAX, message: t('payments.record.tooLong', { max: INVOICE_NOTES_MAX }) }]}
      >
        <Input.TextArea rows={2} dir="auto" />
      </Form.Item>
    </>
  )
}
