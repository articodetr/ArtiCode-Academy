// «Bill a whole class» (API-150, `invoices.manage`): one invoice from an
// active fee plan for every active enrollment of a class — drafts, or issued
// at once with consecutive numbers. The plan must price this class, its
// course or nothing in particular (`fee_plan_mismatch` otherwise); only the
// fitting active plans are offered. The answer is shown as the server gave it:
// the invoices created and the enrollments skipped with their reason
// (`already_invoiced`, `student_deleted`). The server names a skipped
// enrollment by ids only; a holder of `enrollments.read` gets the students'
// names from the class roster (skippedStudentNames), anyone else — or after a
// failed read — the student's id. The body is mounted per session.
import { Alert, Checkbox, Form, Modal, Select, Space, Table, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listFeePlans } from '../api/feePlans'
import type { FeePlan } from '../api/feePlans'
import { issueClassInvoices } from '../api/invoices'
import type { ClassInvoicesResult, InvoiceSummary, SkippedInvoice } from '../api/invoices'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { FinanceClassPicker } from './FinancePickers'
import type { FinanceRef } from './FinancePickers'
import { planFits } from './feePlans.rules'
import { describePaymentsFailure, failureMessage } from './payments.errors'
import { formatMoney, personName } from './payments.format'
import { skippedStudentNames } from './skippedNames'

interface ClassBatchModalProps {
  open: boolean
  onClose: () => void
  /** After a batch the server answered (the list reloads). */
  onDone: (result: ClassInvoicesResult) => void
}

export function ClassBatchModal({ open, ...props }: ClassBatchModalProps) {
  return open ? <ClassBatchBody {...props} /> : null
}

interface BatchValues {
  classId?: string
  feePlanId?: string
  issue?: boolean
}

function ClassBatchBody({ onClose, onDone }: Omit<ClassBatchModalProps, 'open'>) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { hasPermission } = useAuth()
  const canReadRoster = hasPermission('enrollments.read')
  const [form] = Form.useForm()
  const [cls, setCls] = useState<FinanceRef | null>(null)
  const [plans, setPlans] = useState<FeePlan[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ClassInvoicesResult | null>(null)
  /** The class the answer is about (the form is gone once the result shows). */
  const [billedClassId, setBilledClassId] = useState<string | null>(null)
  const [skippedNames, setSkippedNames] = useState<Map<string, string>>(() => new Map())

  useEffect(() => {
    if (!result || !billedClassId || result.skipped.length === 0 || !canReadRoster) return
    const controller = new AbortController()
    skippedStudentNames(
      billedClassId,
      result.skipped.map((skip) => skip.enrollmentId),
      controller.signal,
    )
      .then((names) => {
        if (!controller.signal.aborted) setSkippedNames(names)
      })
      // Without the roster the rows keep the student's id.
      .catch(() => undefined)
    return () => controller.abort()
  }, [result, billedClassId, canReadRoster])

  useEffect(() => {
    const controller = new AbortController()
    listFeePlans({}, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setPlans(list.items)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(t, describePaymentsFailure(caught)))
      })
    return () => controller.abort()
  }, [t])

  const fitting = useMemo(() => (plans ?? []).filter((plan) => plan.isActive && (!cls?.courseId || planFits(plan, { classId: cls.id, courseId: cls.courseId }))), [plans, cls])

  const submit = async () => {
    if (result) {
      onClose()
      return
    }
    let values: BatchValues
    try {
      values = (await form.validateFields()) as BatchValues
    } catch {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const answer = await issueClassInvoices(values.classId!, values.issue ? { feePlanId: values.feePlanId!, issue: true } : { feePlanId: values.feePlanId! })
      setBilledClassId(values.classId!)
      setResult(answer)
      onDone(answer)
    } catch (caught) {
      const failure = describePaymentsFailure(caught)
      const message = failureMessage(t, failure)
      if (failure.field && (failure.field[0] === 'classId' || failure.field[0] === 'feePlanId')) form.setFields([{ name: failure.field, errors: [message] }])
      else setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      width={640}
      title={t('payments.batch.title')}
      okText={result ? t('payments.batch.close') : t('payments.batch.submit')}
      cancelText={t('common.cancel')}
      cancelButtonProps={result ? { style: { display: 'none' } } : undefined}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={busy}
      destroyOnHidden
    >
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      {result ? (
        <Space orientation="vertical" style={{ width: '100%' }} size={12}>
          <Alert
            type={result.created.length > 0 ? 'success' : 'info'}
            showIcon
            title={t('payments.batch.result', { created: result.created.length, skipped: result.skipped.length })}
          />
          {result.created.length > 0 ? (
            <section>
              <Typography.Text strong>{t('payments.batch.created')}</Typography.Text>
              <Table<InvoiceSummary>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={result.created}
                columns={[
                  { title: t('common.student'), key: 'student', render: (_, invoice) => personName(invoice.student) },
                  { title: t('payments.columns.number'), key: 'number', render: (_, invoice) => <bdi dir="ltr">{invoice.number ?? t('payments.drawer.draftTitle')}</bdi> },
                  { title: t('payments.columns.total'), key: 'total', align: 'end', render: (_, invoice) => <bdi dir="ltr">{formatMoney(invoice.total, invoice.currency, language)}</bdi> },
                ]}
              />
            </section>
          ) : null}
          {result.skipped.length > 0 ? (
            <section>
              <Typography.Text strong>{t('payments.batch.skipped')}</Typography.Text>
              <Table<SkippedInvoice>
                rowKey="enrollmentId"
                size="small"
                pagination={false}
                dataSource={result.skipped}
                columns={[
                  {
                    title: skippedNames.size > 0 ? t('common.student') : t('payments.batch.studentId'),
                    key: 'student',
                    render: (_, skip) => skippedNames.get(skip.enrollmentId) ?? <bdi dir="ltr">{skip.studentId}</bdi>,
                  },
                  { title: t('payments.batch.reason'), key: 'reason', render: (_, skip) => t(`payments.batch.reasons.${skip.reason}`) },
                ]}
              />
            </section>
          ) : null}
        </Space>
      ) : (
        <Form form={form} layout="vertical" requiredMark initialValues={{ issue: false }}>
          <Form.Item name="classId" label={t('payments.draft.class')} rules={[{ required: true, message: t('payments.batch.classRequired') }]}>
            <FinanceClassPicker aria-label={t('payments.draft.class')} onChange={(_, item) => setCls(item ?? null)} />
          </Form.Item>
          <Form.Item name="feePlanId" label={t('payments.drawer.feePlan')} rules={[{ required: true, message: t('payments.draft.planRequired') }]} extra={t('payments.batch.planHint')}>
            <Select
              aria-label={t('payments.drawer.feePlan')}
              loading={plans === null && !error}
              notFoundContent={t('payments.draft.noPlans')}
              options={fitting.map((plan) => ({ value: plan.id, label: localizedLabel(plan.name, language) }))}
            />
          </Form.Item>
          <Form.Item name="issue" valuePropName="checked" extra={t('payments.batch.issueHint')}>
            <Checkbox>{t('payments.batch.issue')}</Checkbox>
          </Form.Item>
        </Form>
      )}
    </Modal>
  )
}
