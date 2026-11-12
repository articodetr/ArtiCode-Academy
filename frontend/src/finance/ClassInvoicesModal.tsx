// «فوترة فصل» (J-F52 — API-150, D-R60; `invoices.manage`): one invoice from an
// active fee plan for every `active` enrollment of a class that has no
// non-cancelled invoice from the same plan — drafts, or issued at once with
// consecutive numbers. The plan must price this class, its course or nothing in
// particular (the mirror of `planFits()`; the server answers
// `422 fee_plan_mismatch` itself). The result is reported as the server returned
// it: the invoices created (drafts or issued) and the enrollments skipped with
// their reason (`already_invoiced`, `student_deleted`). Mounted per session.
import { Alert, App, Button, Form, Modal, Select, Space, Switch, Typography } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../academy/useAcademy'
import type { AcademyClass } from '../api/classes'
import { issueClassInvoices } from '../api/invoices'
import type { ClassInvoicesResult } from '../api/invoices'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { useLocalized } from '../i18n/useLocalized'
import { ClassPicker } from '../timetable/TimetablePickers'
import { localizedLabel } from '../users/users.format'
import { FinanceFailureAlert } from './FinanceAlerts'
import { describeFinanceFailure, isFinanceFailure } from './finance.errors'
import type { FinanceFailure } from './finance.errors'
import { formatMoney } from './finance.format'
import { plansForClass } from './invoices.form'
import { useFeePlans } from './useFeePlans'
import { useFinanceUnsavedGuard } from './useFinanceUnsavedGuard'

const PLAN_CODES = ['fee_plan_not_found', 'fee_plan_inactive', 'fee_plan_mismatch']

interface ClassInvoicesValues {
  classId?: string
  feePlanId?: string
  issue?: boolean
}

interface ClassInvoicesModalProps {
  onClose: () => void
  /** Invoices were created: the list re-reads (they are the newest). */
  onCreated: () => void
}

export function ClassInvoicesModal({ onClose, onCreated }: ClassInvoicesModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { academy } = useAcademy()
  const currency = academy?.currency ?? null
  const [form] = Form.useForm<ClassInvoicesValues>()
  const [klass, setKlass] = useState<AcademyClass | null>(null)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<FinanceFailure | null>(null)
  const [result, setResult] = useState<ClassInvoicesResult | null>(null)
  const [dirty, setDirty] = useState(false)
  const feePlans = useFeePlans()
  const options = useMemo(() => (klass ? plansForClass(feePlans.plans, klass) : []), [feePlans.plans, klass])
  // Nothing typed is lost once the batch is done (the result is the server's).
  const unsaved = dirty && result === null
  const { requestClose, holdNavigation } = useFinanceUnsavedGuard(unsaved, onClose)

  const submit = async (values: ClassInvoicesValues) => {
    if (!values.classId || !values.feePlanId) return
    setFailure(null)
    setSaving(true)
    try {
      const answer = await issueClassInvoices(values.classId, { feePlanId: values.feePlanId, issue: values.issue === true })
      setResult(answer)
      if (answer.created.length > 0) {
        message.success(t('invoices.batch.created', { count: answer.created.length }))
        onCreated()
      }
    } catch (caught) {
      const described = describeFinanceFailure(caught, (amount) => formatMoney(amount, currency, language))
      if (PLAN_CODES.some((code) => isFinanceFailure(described, code))) feePlans.reload()
      setFailure(described)
    } finally {
      setSaving(false)
    }
  }

  if (result) {
    const issued = result.created.filter((invoice) => invoice.status === 'issued').length
    const drafts = result.created.length - issued
    const already = result.skipped.filter((entry) => entry.reason === 'already_invoiced').length
    const deleted = result.skipped.filter((entry) => entry.reason === 'student_deleted').length
    return (
      <Modal
        open
        title={t('invoices.batch.title')}
        onCancel={onClose}
        footer={
          <Button type="primary" onClick={onClose}>
            {t('invoices.batch.close')}
          </Button>
        }
        destroyOnHidden
      >
        <div data-testid="class-invoices-result">
          {result.created.length > 0 ? (
            <Alert
              type="success"
              showIcon
              title={t('invoices.batch.created', { count: result.created.length })}
              description={
                <Space orientation="vertical" size={0}>
                  {drafts > 0 ? <span>{t('invoices.batch.createdDrafts', { count: drafts })}</span> : null}
                  {issued > 0 ? <span>{t('invoices.batch.createdIssued', { count: issued })}</span> : null}
                </Space>
              }
              style={{ marginBottom: 12 }}
            />
          ) : (
            <Alert type="info" showIcon title={t('invoices.batch.nothing')} style={{ marginBottom: 12 }} />
          )}
          {result.skipped.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              title={t('invoices.batch.skipped', { count: result.skipped.length })}
              description={
                <Space orientation="vertical" size={0}>
                  {already > 0 ? <span>{t('invoices.batch.skippedAlready', { count: already })}</span> : null}
                  {deleted > 0 ? <span>{t('invoices.batch.skippedDeleted', { count: deleted })}</span> : null}
                </Space>
              }
            />
          ) : null}
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open
      title={t('invoices.batch.title')}
      okText={t('invoices.batch.ok')}
      cancelText={t('common.cancel')}
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={() => {
        if (!saving) requestClose()
      }}
      keyboard={!unsaved}
      mask={{ closable: !unsaved }}
      destroyOnHidden
    >
      <NavigationBlocker when={unsaved} onBlocked={holdNavigation} />
      <Typography.Paragraph type="secondary">{t('invoices.batch.hint')}</Typography.Paragraph>
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ issue: false }}
        disabled={saving}
        onFinish={(values) => void submit(values)}
        onValuesChange={(changed: ClassInvoicesValues, all: ClassInvoicesValues) => {
          if ('classId' in changed) form.setFieldsValue({ feePlanId: undefined })
          setDirty(Boolean(all.classId || all.feePlanId || all.issue))
        }}
      >
        <Form.Item name="classId" label={t('invoices.batch.class')} rules={[{ required: true, message: t('finance.validation.classRequired') }]}>
          <ClassPicker aria-label={t('invoices.batch.class')} placeholder={t('invoices.batch.class')} onChange={(_, item) => setKlass(item ?? null)} />
        </Form.Item>
        <Form.Item name="feePlanId" label={t('invoices.batch.plan')} rules={[{ required: true, message: t('finance.validation.planRequired') }]}>
          <Select
            aria-label={t('invoices.batch.plan')}
            disabled={!klass}
            loading={feePlans.loading}
            notFoundContent={<Typography.Text type="secondary">{feePlans.error ? t('invoices.create.plansFailed') : t('invoices.create.noPlans')}</Typography.Text>}
            options={options.map((plan) => ({ value: plan.id, label: `${localizedLabel(plan.name, language)} — ${formatMoney(plan.total, currency, language)}` }))}
          />
        </Form.Item>
        <Form.Item name="issue" label={t('invoices.batch.issue')} extra={t('invoices.batch.issueHint')} valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
      {failure ? <FinanceFailureAlert failure={failure} /> : null}
    </Modal>
  )
}
