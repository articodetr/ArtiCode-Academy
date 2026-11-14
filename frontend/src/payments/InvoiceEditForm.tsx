// The draft edit form of the invoice drawer (API-147, `invoices.manage`): the
// lines, installments, discount with its reason and the internal note, as the
// draft holds them. It sends the smallest PATCH (`planInvoicePatch()`; nothing
// when nothing changed) and the draft must stay valid — the rules of
// invoices.calc.ts run locally first, the server's `invoice_invalid
// { problems }` lands on the same fields. It reports unsaved work (a non-empty
// patch) through `onUnsavedChange`, so the drawer and the list ask before
// dropping it. Mount it per server version (KI-049).
import { Alert, App, Button, Flex, Form } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client'
import { updateInvoice } from '../api/invoices'
import type { Invoice } from '../api/invoices'
import { InvoiceContentFields } from './InvoiceContentFields'
import { checkInvoiceValues, invoiceFormValues, isInvoiceProblem, planInvoicePatch, problemFields } from './invoices.form'
import type { InvoiceFormValues, InvoiceProblem } from './invoices.form'
import { describePaymentsFailure, failureMessage, isStaleInvoice, problemsOf } from './payments.errors'

interface InvoiceEditFormProps {
  invoice: Invoice
  onSaved: (invoice: Invoice) => void
  onCancel: () => void
  onUnsavedChange: (unsaved: boolean) => void
  /** The draft is no longer one (or is gone): the drawer re-reads it. */
  onStale: () => void
}

export function InvoiceEditForm({ invoice, onSaved, onCancel, onUnsavedChange, onStale }: InvoiceEditFormProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [initial] = useState(() => invoiceFormValues(invoice))
  const [values, setValues] = useState<InvoiceFormValues>(initial)
  const [shown, setShown] = useState(false)
  const [serverProblems, setServerProblems] = useState<InvoiceProblem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => () => onUnsavedChange(false), [onUnsavedChange])

  const local = shown ? checkInvoiceValues(values) : []
  const problems = problemFields([...new Set([...local, ...serverProblems])])

  const sync = () => {
    const all = form.getFieldsValue(true) as InvoiceFormValues
    setValues(all)
    setServerProblems([])
    onUnsavedChange(Object.keys(planInvoicePatch(invoice, all)).length > 0)
  }

  const submit = async () => {
    setShown(true)
    try {
      await form.validateFields()
    } catch {
      return
    }
    const typed = form.getFieldsValue(true) as InvoiceFormValues
    if (checkInvoiceValues(typed).length > 0) return
    const patch = planInvoicePatch(invoice, typed)
    if (Object.keys(patch).length === 0) {
      onCancel()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = await updateInvoice(invoice.id, patch)
      onUnsavedChange(false)
      onSaved(saved)
    } catch (caught) {
      const serverList = problemsOf(caught).filter(isInvoiceProblem)
      if (serverList.length > 0) setServerProblems(serverList)
      else setError(failureMessage(t, describePaymentsFailure(caught)))
      if (isStaleInvoice(caught) || (caught instanceof ApiError && (caught.code === 'invoice_not_draft' || caught.code === 'invoice_not_found'))) {
        message.error(failureMessage(t, describePaymentsFailure(caught)))
        onStale()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Form form={form} layout="vertical" initialValues={initial} requiredMark onValuesChange={sync} className="invoice-edit-form">
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <InvoiceContentFields form={form} values={values} problems={problems} currency={invoice.currency} byHand onProgrammaticChange={sync} />
      <Flex gap={8} justify="end">
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="primary" loading={busy} onClick={submit}>
          {t('common.save')}
        </Button>
      </Flex>
    </Form>
  )
}
