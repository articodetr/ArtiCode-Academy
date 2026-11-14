// Create or edit a fee plan (API-141/142, `fee_plans.manage`): a localized
// name, what it prices (any class, a course or one class), 1..50 lines and
// 1..24 installment shares summing to 100 with non-decreasing day offsets.
// The rules of fee-plans.rules.ts run locally on every edit and show on their
// fields before any request; a server refusal `fee_plan_invalid { problems }`
// lands on the same fields. An edit sends the smallest PATCH (nothing when
// nothing changed). The body is mounted per session (KI-049); Escape and a
// mask click keep typed work.
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, Button, Flex, Form, Input, InputNumber, Modal, Radio, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DUE_OFFSET_DAYS_MAX, FEE_PLAN_INSTALLMENTS_MAX, createFeePlan, updateFeePlan } from '../api/feePlans'
import type { FeePlan } from '../api/feePlans'
import { useLocalized } from '../i18n/useLocalized'
import { LinesField } from './FinanceFormFields'
import { FinanceClassPicker, FinanceCoursePicker } from './FinancePickers'
import {
  buildCreateFeePlanInput,
  checkPlanValues,
  evenShares,
  feePlanFormValues,
  firstDescendingOffset,
  linesTotal,
  planFeePlanPatch,
  sharesTotal,
} from './feePlans.rules'
import type { FeePlanFormValues, FeePlanProblem } from './feePlans.rules'
import { describePaymentsFailure, failureMessage, problemsOf } from './payments.errors'
import { formatMoney, isTwoDecimalAmount } from './payments.format'

interface FeePlanModalProps {
  /** `null` = closed, `'new'` = create, a plan = edit it. */
  plan: FeePlan | 'new' | null
  currency: string
  onClose: () => void
  onSaved: (plan: FeePlan) => void
}

export function FeePlanModal({ plan, currency, onClose, onSaved }: FeePlanModalProps) {
  if (plan === null) return null
  return <FeePlanBody key={plan === 'new' ? 'new' : `${plan.id}:${plan.updatedAt}`} plan={plan === 'new' ? null : plan} currency={currency} onClose={onClose} onSaved={onSaved} />
}

function FeePlanBody({ plan, currency, onClose, onSaved }: { plan: FeePlan | null; currency: string; onClose: () => void; onSaved: (plan: FeePlan) => void }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [form] = Form.useForm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initial] = useState(() => feePlanFormValues(plan))
  const [values, setValues] = useState<FeePlanFormValues>(initial)
  const [serverProblems, setServerProblems] = useState<FeePlanProblem[]>([])
  const [shown, setShown] = useState(false)

  const local = checkPlanValues(values)
  const problems = [...new Set([...(shown ? local : []), ...serverProblems])]
  const problemText = (problem: FeePlanProblem) => t(`payments.feePlans.problems.${problem}`, { sum: sharesTotal(values.installments ?? []) })
  const shareErrors = problems.filter((problem) => problem !== 'course_and_class').map(problemText)
  const descending = shown ? firstDescendingOffset(values.installments ?? []) : -1

  const submit = async () => {
    setShown(true)
    let typed: FeePlanFormValues
    try {
      typed = (await form.validateFields()) as FeePlanFormValues
    } catch {
      return
    }
    const merged = { ...values, ...typed }
    if (checkPlanValues(merged).length > 0) return
    setError(null)
    if (plan) {
      const patch = planFeePlanPatch(plan, merged)
      if (Object.keys(patch).length === 0) {
        onClose()
        return
      }
    }
    setBusy(true)
    try {
      const saved = plan ? await updateFeePlan(plan.id, planFeePlanPatch(plan, merged)) : await createFeePlan(buildCreateFeePlanInput(merged))
      onSaved(saved)
    } catch (caught) {
      const failure = describePaymentsFailure(caught)
      const serverList = problemsOf(caught).filter((problem): problem is FeePlanProblem => ['course_and_class', 'percent_sum', 'offsets_not_ascending'].includes(problem))
      if (serverList.length > 0) setServerProblems(serverList)
      else if (failure.field && (failure.field[0] === 'courseId' || failure.field[0] === 'classId')) form.setFields([{ name: failure.field, errors: [failureMessage(t, failure)] }])
      else setError(failureMessage(t, failure))
    } finally {
      setBusy(false)
    }
  }

  const scope = values.scope ?? 'any'

  return (
    <Modal
      open
      width={760}
      title={plan ? t('payments.feePlans.editTitle') : t('payments.feePlans.createTitle')}
      okText={plan ? t('common.save') : t('payments.feePlans.create')}
      cancelText={t('common.cancel')}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={busy}
      keyboard={false}
      mask={{ closable: false }}
      destroyOnHidden
    >
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Form
        form={form}
        layout="vertical"
        initialValues={initial}
        requiredMark
        onValuesChange={(_, all) => {
          setValues(all as FeePlanFormValues)
          setServerProblems([])
        }}
      >
        <Flex gap={12} wrap>
          <Form.Item
            name="nameAr"
            label={t('payments.feePlans.nameAr')}
            rules={[
              { required: true, whitespace: true, message: t('payments.feePlans.nameRequired') },
              { max: 200, message: t('payments.record.tooLong', { max: 200 }) },
            ]}
            style={{ flex: '1 1 220px' }}
          >
            <Input dir="auto" />
          </Form.Item>
          <Form.Item name="nameEn" label={t('payments.feePlans.nameEn')} rules={[{ max: 200, message: t('payments.record.tooLong', { max: 200 }) }]} style={{ flex: '1 1 220px' }}>
            <Input dir="auto" />
          </Form.Item>
        </Flex>

        <Form.Item
          name="scope"
          label={t('payments.feePlans.scope')}
          validateStatus={problems.includes('course_and_class') ? 'error' : undefined}
          help={problems.includes('course_and_class') ? problemText('course_and_class') : undefined}
        >
          <Radio.Group
            name="fee-plan-scope"
            options={(['any', 'course', 'class'] as const).map((value) => ({ value, label: t(`payments.feePlans.scopes.${value}`) }))}
          />
        </Form.Item>
        {scope === 'course' ? (
          <Form.Item name="courseId" label={t('payments.feePlans.course')} rules={[{ required: true, message: t('payments.feePlans.courseRequired') }]}>
            <FinanceCoursePicker initial={plan?.course ?? null} aria-label={t('payments.feePlans.course')} />
          </Form.Item>
        ) : null}
        {scope === 'class' ? (
          <Form.Item name="classId" label={t('payments.feePlans.class')} rules={[{ required: true, message: t('payments.feePlans.classRequired') }]}>
            <FinanceClassPicker initial={plan?.class ?? null} aria-label={t('payments.feePlans.class')} />
          </Form.Item>
        ) : null}

        <LinesField currency={currency} />
        <Typography.Paragraph type="secondary" style={{ marginTop: 4 }}>
          {t('payments.feePlans.totalHint', { total: formatMoney(linesTotal(values.lines ?? []), currency, language) })}
        </Typography.Paragraph>

        <Form.List name="installments">
          {(fields, { add, remove }) => (
            <Flex vertical gap={4}>
              <Flex justify="space-between" align="center" wrap gap={8}>
                <Typography.Text strong>{t('payments.feePlans.shares')}</Typography.Text>
                <Button
                  size="small"
                  onClick={() => {
                    const current = (form.getFieldValue('installments') as FeePlanFormValues['installments']) ?? []
                    const percents = evenShares(current.length)
                    const next = current.map((share, index) => ({ ...share, percent: percents[index] }))
                    form.setFieldValue('installments', next)
                    setValues({ ...values, ...(form.getFieldsValue(true) as FeePlanFormValues), installments: next })
                  }}
                >
                  {t('payments.feePlans.evenShares')}
                </Button>
              </Flex>
              {fields.map((field, index) => (
                <Flex key={field.key} gap={8} align="start" wrap className="finance-form-row">
                  <Typography.Text type="secondary" style={{ minWidth: 20, paddingTop: 5 }}>
                    {index + 1}
                  </Typography.Text>
                  <Form.Item
                    name={[field.name, 'percent']}
                    rules={[
                      { required: true, message: t('payments.feePlans.percentRequired') },
                      {
                        validator: (_, value: unknown) =>
                          value === null || value === undefined || (isTwoDecimalAmount(value) && value >= 0.01 && value <= 100)
                            ? Promise.resolve()
                            : Promise.reject(new Error(t('payments.feePlans.percentInvalid'))),
                      },
                    ]}
                    style={{ flex: '1 1 120px', marginBottom: 8 }}
                  >
                    <InputNumber<number> style={{ width: '100%' }} step={0.01} precision={2} dir="ltr" suffix="%" aria-label={`${t('payments.feePlans.percent')} ${index + 1}`} />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, 'dueOffsetDays']}
                    rules={[
                      { required: true, message: t('payments.feePlans.offsetRequired') },
                      {
                        validator: (_, value: unknown) =>
                          value === null || value === undefined || (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= DUE_OFFSET_DAYS_MAX)
                            ? Promise.resolve()
                            : Promise.reject(new Error(t('payments.feePlans.offsetInvalid', { max: DUE_OFFSET_DAYS_MAX }))),
                      },
                    ]}
                    validateStatus={index === descending ? 'error' : undefined}
                    style={{ flex: '1 1 160px', marginBottom: 8 }}
                  >
                    <InputNumber<number>
                      style={{ width: '100%' }}
                      step={1}
                      precision={0}
                      dir="ltr"
                      suffix={t('payments.feePlans.days')}
                      aria-label={`${t('payments.feePlans.offset')} ${index + 1}`}
                    />
                  </Form.Item>
                  <Button type="text" icon={<DeleteOutlined />} aria-label={t('payments.form.removeInstallment')} disabled={fields.length <= 1} onClick={() => remove(field.name)} />
                </Flex>
              ))}
              <Typography.Text type="secondary">{t('payments.feePlans.sharesHint', { sum: sharesTotal(values.installments ?? []) })}</Typography.Text>
              <Form.ErrorList errors={shareErrors} />
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ dueOffsetDays: 0 })} disabled={fields.length >= FEE_PLAN_INSTALLMENTS_MAX} style={{ alignSelf: 'start' }}>
                {t('payments.form.addInstallment')}
              </Button>
            </Flex>
          )}
        </Form.List>
      </Form>
    </Modal>
  )
}
