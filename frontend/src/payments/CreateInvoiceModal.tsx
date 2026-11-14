// «New invoice» (API-146, `invoices.manage`): a draft for a student, optionally
// tied to their enrollment in a class, either from an active fee plan (its
// lines are copied and its shares split the total from today in the academy
// zone — server side) or with lines and installments typed by hand. One
// optional discount with its reason and an internal note. The currency is the
// academy's (the server sets it). The rules of invoices.calc.ts run locally
// before any request; a server refusal (`invoice_invalid { problems }`,
// `fee_plan_mismatch`, `enrollment_mismatch`, `student_not_found`, …) lands on
// its field. The enrollment is found in the class's roster (API-057), so
// choosing a class needs `classes.read` and a roster read. The body is mounted
// per session (KI-049).
import { Alert, Form, Modal, Radio, Select, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listFeePlans } from '../api/feePlans'
import type { FeePlan } from '../api/feePlans'
import { createInvoice } from '../api/invoices'
import type { Invoice } from '../api/invoices'
import { useAuth } from '../auth/auth-context'
import { StudentPicker } from '../classes/ClassPickers'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { InvoiceContentFields } from './InvoiceContentFields'
import { findEnrollment } from './findEnrollment'
import { FinanceClassPicker } from './FinancePickers'
import type { FinanceRef } from './FinancePickers'
import { planFits } from './feePlans.rules'
import { buildCreateInvoiceInput, checkInvoiceValues, isInvoiceProblem, problemFields } from './invoices.form'
import type { InvoiceFormValues, InvoiceProblem } from './invoices.form'
import { describePaymentsFailure, failureMessage, problemsOf } from './payments.errors'
import { formatMoney } from './payments.format'

const todayLocal = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

interface CreateInvoiceModalProps {
  open: boolean
  currency: string
  onClose: () => void
  onCreated: (invoice: Invoice) => void
}

export function CreateInvoiceModal({ open, ...props }: CreateInvoiceModalProps) {
  return open ? <CreateInvoiceBody {...props} /> : null
}

function CreateInvoiceBody({ currency, onClose, onCreated }: Omit<CreateInvoiceModalProps, 'open'>) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { hasPermission } = useAuth()
  const canPickClass = hasPermission('classes.read')
  const [form] = Form.useForm()
  const [initial] = useState<InvoiceFormValues>(() => ({ source: 'lines', lines: [{}], installments: [{ dueOn: todayLocal() }] }))
  const [values, setValues] = useState<InvoiceFormValues>(initial)
  const [cls, setCls] = useState<FinanceRef | null>(null)
  const [plans, setPlans] = useState<FeePlan[] | null>(null)
  const [plansError, setPlansError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState(false)
  const [serverProblems, setServerProblems] = useState<InvoiceProblem[]>([])

  useEffect(() => {
    const controller = new AbortController()
    listFeePlans({}, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setPlans(list.items)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setPlansError(failureMessage(t, describePaymentsFailure(caught)))
      })
    return () => controller.abort()
  }, [t])

  const fitting = useMemo(
    () => (plans ?? []).filter((plan) => plan.isActive && (!cls?.courseId || planFits(plan, { classId: cls.id, courseId: cls.courseId }))),
    [plans, cls],
  )
  const chosenPlan = fitting.find((plan) => plan.id === values.feePlanId)
  const local = shown ? checkInvoiceValues(values, chosenPlan?.total) : []
  const problems = problemFields([...new Set([...local, ...serverProblems])])
  const byHand = values.source !== 'plan'

  const sync = () => {
    setValues(form.getFieldsValue(true) as InvoiceFormValues)
    setServerProblems([])
  }

  const submit = async () => {
    setShown(true)
    try {
      await form.validateFields()
    } catch {
      return
    }
    const typed = form.getFieldsValue(true) as InvoiceFormValues
    if (checkInvoiceValues(typed, chosenPlan?.total).length > 0) return
    setBusy(true)
    setError(null)
    try {
      let enrollmentId: string | undefined
      if (typed.classId && typed.studentId) {
        const found = await findEnrollment(typed.classId, typed.studentId)
        if (!found) {
          form.setFields([{ name: 'classId', errors: [t('payments.draft.notEnrolled')] }])
          return
        }
        enrollmentId = found
      }
      onCreated(await createInvoice(buildCreateInvoiceInput(typed, enrollmentId)))
    } catch (caught) {
      const failure = describePaymentsFailure(caught)
      const serverList = problemsOf(caught).filter(isInvoiceProblem)
      if (serverList.length > 0) setServerProblems(serverList)
      else if (failure.field) form.setFields([{ name: failure.field, errors: [failureMessage(t, failure)] }])
      else setError(failureMessage(t, failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      width={760}
      title={t('payments.draft.createTitle')}
      okText={t('payments.draft.create')}
      cancelText={t('common.cancel')}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={busy}
      keyboard={false}
      mask={{ closable: false }}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">{t('payments.draft.hint', { currency })}</Typography.Paragraph>
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Form form={form} layout="vertical" initialValues={initial} requiredMark onValuesChange={sync}>
        <Form.Item name="studentId" label={t('common.student')} rules={[{ required: true, message: t('payments.draft.studentRequired') }]}>
          <StudentPicker aria-label={t('common.student')} />
        </Form.Item>
        {canPickClass ? (
          <Form.Item name="classId" label={t('payments.draft.class')} extra={t('payments.draft.classHint')}>
            <FinanceClassPicker
              allowClear
              aria-label={t('payments.draft.class')}
              onChange={(_, item) => setCls(item ?? null)}
            />
          </Form.Item>
        ) : null}
        <Form.Item
          name="source"
          label={t('payments.draft.source')}
          validateStatus={problems.source ? 'error' : undefined}
          help={problems.source ? problems.source.map((problem) => t(`payments.problems.${problem}`)).join(' ') : undefined}
        >
          <Radio.Group name="invoice-source" options={(['lines', 'plan'] as const).map((value) => ({ value, label: t(`payments.draft.sources.${value}`) }))} />
        </Form.Item>
        {!byHand ? (
          <Form.Item
            name="feePlanId"
            label={t('payments.drawer.feePlan')}
            rules={[{ required: true, message: t('payments.draft.planRequired') }]}
            extra={chosenPlan ? t('payments.draft.planHint', { total: formatMoney(chosenPlan.total, currency, language), count: chosenPlan.installments.length }) : undefined}
          >
            <Select
              aria-label={t('payments.drawer.feePlan')}
              loading={plans === null && !plansError}
              notFoundContent={plansError ?? t('payments.draft.noPlans')}
              options={fitting.map((plan) => ({ value: plan.id, label: localizedLabel(plan.name, language) }))}
            />
          </Form.Item>
        ) : null}
        <InvoiceContentFields form={form} values={values} problems={problems} currency={currency} byHand={byHand} onProgrammaticChange={sync} />
      </Form>
    </Modal>
  )
}
