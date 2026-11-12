// A new draft invoice (J-F52 — API-146, D-R60/D-R64; `invoices.manage`). The
// student comes from a class roster (API-057 — the invoice is then tied to
// that enrollment; needs `classes.read` + `enrollments.read`) or from a name
// search (API-012 `role=student` — no enrollment; needs `users.read`). The
// content is a fee plan's copy — an active plan that prices that class, its
// course or nothing in particular (the mirror of `planFits()`; without a class
// any active plan — the server's own rule), whose lines are copied and whose
// shares split the total from today in the academy's zone, server-side — or
// lines and installments typed by hand (the mirrored invoice rules run before
// any request). One optional discount with its reason and an internal note in
// both cases; the currency is the academy's (D-R59). The draft comes back
// without a number. Mounted per session (KI-049); while it holds unsaved work,
// Escape and a mask click no longer close it, «إلغاء»/× ask first and a
// browser back asks the same question.
import { Alert, App, Card, Col, Descriptions, Form, Modal, Radio, Row, Select, Typography } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../academy/useAcademy'
import type { AcademyClass } from '../api/classes'
import { createInvoice } from '../api/invoices'
import type { Invoice } from '../api/invoices'
import { academyZoneOf } from '../assignments/assignments.zone'
import { useAuth } from '../auth/auth-context'
import { StudentPicker } from '../classes/ClassPickers'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { useLocalized } from '../i18n/useLocalized'
import { todayIn } from '../lessons/lessons.format'
import { ClassPicker } from '../timetable/TimetablePickers'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { displayNameOf, localizedLabel } from '../users/users.format'
import { FinanceFailureAlert, FormProblemsAlert } from './FinanceAlerts'
import { InvoiceContentFields } from './InvoiceContentFields'
import { describeFinanceFailure, failureTitle, isFinanceFailure } from './finance.errors'
import type { FinanceFailure } from './finance.errors'
import { formatMoney, sharesSummary } from './finance.format'
import { buildCreateInvoiceInput, createInvoiceFormHasChanges, invoiceFormProblems, newCreateInvoiceForm, planInvoiceProblems, plansForClass } from './invoices.form'
import type { CreateInvoiceFormValues, InvoiceTarget } from './invoices.form'
import type { InvoiceProblem } from './invoices.rules'
import { useClassRoster } from './useClassRoster'
import { useFeePlans } from './useFeePlans'
import { useFinanceUnsavedGuard } from './useFinanceUnsavedGuard'

/** Codes after which the list of plans is read again (a plan deactivated or deleted meanwhile). */
const PLAN_CODES = ['fee_plan_not_found', 'fee_plan_inactive', 'fee_plan_mismatch']

/** The fields of this form a server code can point at. */
const FORM_FIELDS = new Set(['enrollmentId', 'studentId', 'feePlanId'])

interface CreateInvoiceModalProps {
  onClose: () => void
  onCreated: (invoice: Invoice) => void
}

export function CreateInvoiceModal({ onClose, onCreated }: CreateInvoiceModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const { academy } = useAcademy()
  const canPickFromClass = hasPermission('classes.read') && hasPermission('enrollments.read')
  const canPickByName = hasPermission('users.read')
  const currency = academy?.currency ?? null
  const today = todayIn(academyZoneOf(academy) ?? deviceTimeZone())
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [initialValues] = useState<CreateInvoiceFormValues>(() => newCreateInvoiceForm(canPickFromClass ? 'class' : 'student', today))
  const [klass, setKlass] = useState<AcademyClass | null>(null)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<FinanceFailure | null>(null)
  const [problems, setProblems] = useState<InvoiceProblem[]>([])
  const [dirty, setDirty] = useState(false)
  const target = (Form.useWatch('target', form) as InvoiceTarget | undefined) ?? initialValues.target
  const source = (Form.useWatch('source', form) as CreateInvoiceFormValues['source']) ?? initialValues.source
  const classId = Form.useWatch('classId', form) as string | undefined
  const feePlanId = Form.useWatch('feePlanId', form) as string | undefined
  const roster = useClassRoster(target === 'class' ? classId : undefined)
  const feePlans = useFeePlans()
  const options = useMemo(() => plansForClass(feePlans.plans, target === 'class' ? klass : null), [feePlans.plans, target, klass])
  const chosenPlan = options.find((plan) => plan.id === feePlanId) ?? null
  const { requestClose, holdNavigation } = useFinanceUnsavedGuard(dirty, onClose)

  const submit = async (values: CreateInvoiceFormValues) => {
    setFailure(null)
    const all = form.getFieldsValue(true) as CreateInvoiceFormValues
    const found = all.source === 'manual' ? invoiceFormProblems(all) : chosenPlan ? planInvoiceProblems(chosenPlan.total, all) : []
    setProblems(found)
    if (found.length > 0) return
    const student =
      all.target === 'class'
        ? (() => {
            const entry = roster.items.find((enrollment) => enrollment.id === all.enrollmentId)
            return entry ? { studentId: entry.student.id, enrollmentId: entry.id } : null
          })()
        : all.studentId
          ? { studentId: all.studentId }
          : null
    if (!student) return
    setSaving(true)
    try {
      const created = await createInvoice(buildCreateInvoiceInput({ ...all, ...values }, student))
      message.success(t('invoices.create.created', { name: displayNameOf(created.student) }))
      onCreated(created)
    } catch (caught) {
      const described = describeFinanceFailure(caught, (amount) => formatMoney(amount, currency, language))
      if (PLAN_CODES.some((code) => isFinanceFailure(described, code))) feePlans.reload()
      // A refused student is the roster entry when it came from a class.
      const field = described.field?.[0] === 'studentId' && all.target === 'class' ? ['enrollmentId'] : described.field
      if (field && FORM_FIELDS.has(field[0] ?? '')) form.setFields([{ name: field, errors: [failureTitle(t, described)] }])
      setFailure(described)
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={t('invoices.create.title')}
      okText={t('invoices.create.ok')}
      cancelText={t('common.cancel')}
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={() => {
        if (!saving) requestClose()
      }}
      keyboard={!dirty}
      mask={{ closable: !dirty }}
      destroyOnHidden
      width={920}
    >
      <NavigationBlocker when={dirty} onBlocked={holdNavigation} />
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={initialValues}
        disabled={saving}
        onFinish={(values) => void submit(values as CreateInvoiceFormValues)}
        onValuesChange={(changed: Partial<CreateInvoiceFormValues>) => {
          // Another target or class: the roster entry, the student and the plan chosen for the old one no longer apply.
          if ('target' in changed) {
            form.setFieldsValue({ classId: undefined, enrollmentId: undefined, studentId: undefined, feePlanId: undefined })
            setKlass(null)
          } else if ('classId' in changed) form.setFieldsValue({ enrollmentId: undefined, feePlanId: undefined })
          setProblems([])
          setDirty(createInvoiceFormHasChanges(initialValues, form.getFieldsValue(true) as CreateInvoiceFormValues))
        }}
      >
        <Form.Item name="target" label={t('invoices.create.target')}>
          <Radio.Group name="invoice-target">
            <Radio value="class" disabled={!canPickFromClass}>
              {t('invoices.create.targetClass')}
            </Radio>
            <Radio value="student" disabled={!canPickByName}>
              {t('invoices.create.targetStudent')}
            </Radio>
          </Radio.Group>
        </Form.Item>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -16 }}>
          {t(target === 'class' ? 'invoices.create.targetClassHint' : 'invoices.create.targetStudentHint')}
        </Typography.Paragraph>

        {target === 'class' ? (
          <Row gutter={12}>
            <Col xs={24} md={12}>
            <Form.Item name="classId" label={t('invoices.create.class')} rules={[{ required: true, message: t('finance.validation.classRequired') }]}>
              <ClassPicker aria-label={t('invoices.create.class')} placeholder={t('invoices.create.class')} onChange={(_, item) => setKlass(item ?? null)} />
            </Form.Item>
            </Col>
            <Col xs={24} md={12}>
            <Form.Item name="enrollmentId" label={t('invoices.create.enrollment')} rules={[{ required: true, message: t('finance.validation.studentRequired') }]}>
              <Select
                aria-label={t('invoices.create.enrollment')}
                disabled={!classId}
                loading={roster.loading}
                showSearch={{ optionFilterProp: 'label' }}
                notFoundContent={<Typography.Text type="secondary">{roster.error ? t('invoices.create.rosterFailed') : t('invoices.create.noRoster')}</Typography.Text>}
                options={roster.items.map((enrollment) => ({
                  value: enrollment.id,
                  label: `${displayNameOf(enrollment.student)} — ${t(`labels.${enrollment.status}`)}`,
                }))}
              />
            </Form.Item>
            </Col>
          </Row>
        ) : (
          <Form.Item name="studentId" label={t('invoices.create.student')} rules={[{ required: true, message: t('finance.validation.studentRequired') }]}>
            <StudentPicker aria-label={t('invoices.create.student')} placeholder={t('invoices.create.student')} />
          </Form.Item>
        )}

        <Form.Item name="source" label={t('invoices.create.source')}>
          <Radio.Group name="invoice-source">
            <Radio value="plan">{t('invoices.create.sourcePlan')}</Radio>
            <Radio value="manual">{t('invoices.create.sourceManual')}</Radio>
          </Radio.Group>
        </Form.Item>

        {source === 'plan' ? (
          <>
            <Form.Item name="feePlanId" label={t('invoices.create.plan')} extra={t('invoices.create.planHint')} rules={[{ required: true, message: t('finance.validation.planRequired') }]}>
              <Select
                aria-label={t('invoices.create.plan')}
                loading={feePlans.loading}
                disabled={target === 'class' && !klass}
                notFoundContent={<Typography.Text type="secondary">{feePlans.error ? t('invoices.create.plansFailed') : t('invoices.create.noPlans')}</Typography.Text>}
                options={options.map((plan) => ({ value: plan.id, label: `${localizedLabel(plan.name, language)} — ${formatMoney(plan.total, currency, language)}` }))}
              />
            </Form.Item>
            {chosenPlan ? (
              <Card size="small" style={{ marginBottom: 16 }} data-testid="invoice-plan-preview">
                <Descriptions size="small" column={1}>
                  {chosenPlan.lines.map((line, index) => (
                    <Descriptions.Item key={index} label={localizedLabel(line.description, language)}>
                      <bdi>{formatMoney(line.amount, currency, language)}</bdi>
                    </Descriptions.Item>
                  ))}
                  <Descriptions.Item label={t('finance.fields.total')}>
                    <bdi>{formatMoney(chosenPlan.total, currency, language)}</bdi>
                  </Descriptions.Item>
                  <Descriptions.Item label={t('invoices.create.planShares')}>
                    <bdi dir="ltr">{sharesSummary(chosenPlan.installments)}</bdi>
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            ) : null}
            <InvoiceContentFields form={form} currency={currency} manual={false} today={today} />
          </>
        ) : (
          <InvoiceContentFields form={form} currency={currency} manual today={today} />
        )}
      </Form>
      {!currency ? <Alert type="info" showIcon title={t('invoices.create.currencyHint')} style={{ marginBottom: 16 }} /> : null}
      <FormProblemsAlert problems={problems} style={{ marginBottom: 16 }} />
      {failure ? <FinanceFailureAlert failure={failure} /> : null}
    </Modal>
  )
}
