// Create / edit one fee plan (J-F52 — API-141, API-142 with the smallest PATCH;
// owner decision D-R60). The form holds the localized name (a Turkish text the
// form does not show is kept), what the plan prices — nothing in particular, a
// course (API-042 — `courses.read`) or a class (API-050 — `classes.read`), never
// both — its lines (1..50, amounts in the academy currency) and its installment
// shares (1..24 — percents summing to exactly 100, due offsets in days from the
// day an invoice is created from it, never decreasing). The plan rules of the
// server are mirrored (feePlans.rules.ts — keep in sync) and checked before any
// request; a refusal names every problem. Invoices created from a plan keep
// their copy, so an edit changes none of them. Mounted per session (KI-049);
// while it holds unsaved work, Escape and a mask click no longer close it,
// «إلغاء»/× ask first and a browser back asks the same question.
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Col, Flex, Form, Input, InputNumber, Modal, Radio, Row, Space, Tag, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DUE_OFFSET_DAYS_MAX, FEE_PLAN_INSTALLMENTS_MAX, FEE_PLAN_LINES_MAX, FINANCE_TEXT_MAX_LENGTH, createFeePlan, updateFeePlan } from '../api/feePlans'
import type { FeePlan, FeePlanRef } from '../api/feePlans'
import { CoursePicker } from '../classes/ClassPickers'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { useLocalized } from '../i18n/useLocalized'
import { ClassPicker } from '../timetable/TimetablePickers'
import { localizedLabel } from '../users/users.format'
import { FinanceFailureAlert } from './FinanceAlerts'
import { describeFinanceFailure, failureTitle, isFinanceFailure } from './finance.errors'
import type { FinanceFailure } from './finance.errors'
import { formatMoney } from './finance.format'
import { fromCents, isPositiveAmount, isSharePercent, isWholeDays } from './finance.money'
import {
  buildCreateFeePlanInput,
  emptyPlanLine,
  evenShares,
  feePlanFormHasChanges,
  feePlanFormProblems,
  feePlanFormValuesOf,
  newFeePlanForm,
  planFeePlanPatch,
  planLinesTotalCents,
} from './feePlans.form'
import type { FeePlanFormValues, PlanShareFormValues } from './feePlans.form'
import { percentSum } from './feePlans.rules'
import { useFinanceUnsavedGuard } from './useFinanceUnsavedGuard'

/** The fields a server code can point at in this form. */
const FORM_FIELDS = new Set(['courseId', 'classId'])

interface ScopeTargetFieldProps {
  kind: 'course' | 'class'
  /** What the plan prices now (its saved course or class), shown by name until another one is chosen. */
  current: FeePlanRef | null
  value?: string
  onChange?: (value: string | undefined) => void
  id?: string
}

/**
 * The course or class of a plan: the saved one by its code and name (never its
 * id), with «change» to open the search; a search shows nothing chosen until
 * a new course or class is picked, so the saved one stays unless replaced.
 */
function ScopeTargetField({ kind, current, value, onChange, id }: ScopeTargetFieldProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [changing, setChanging] = useState(false)
  const label = t(kind === 'course' ? 'feePlans.fields.course' : 'feePlans.fields.class')
  if (current && value === current.id && !changing) {
    return (
      <Space wrap>
        <Tag data-testid="fee-plan-target">
          <bdi dir="ltr">{current.code}</bdi> — {localizedLabel(current.name, language)}
        </Tag>
        <Button size="small" onClick={() => setChanging(true)}>
          {t('feePlans.hints.change')}
        </Button>
      </Space>
    )
  }
  const shown = current && value === current.id ? undefined : value
  return kind === 'course' ? (
    <CoursePicker id={id} aria-label={label} placeholder={label} value={shown} onChange={(next) => onChange?.(next ?? current?.id)} />
  ) : (
    <ClassPicker id={id} aria-label={label} placeholder={label} value={shown} onChange={(next) => onChange?.(next ?? current?.id)} />
  )
}

interface FeePlanModalProps {
  /** The plan to edit; null creates a new one. */
  plan: FeePlan | null
  /** The academy currency of the amounts (API-035), or null while unknown. */
  currency: string | null
  onClose: () => void
  /** The plan as the server returned it; `created` tells a new plan from an edit. */
  onSaved: (plan: FeePlan, created: boolean) => void
  /** The plan is gone (404): the list is re-read. */
  onStale: () => void
}

export function FeePlanModal({ plan, currency, onClose, onSaved, onStale }: FeePlanModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [initialValues] = useState<FeePlanFormValues>(() => (plan ? feePlanFormValuesOf(plan) : newFeePlanForm()))
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<FinanceFailure | null>(null)
  const [dirty, setDirty] = useState(false)
  const values = (Form.useWatch([], form) ?? initialValues) as FeePlanFormValues
  const scope = values.scope ?? 'general'
  const linesTotal = planLinesTotalCents(values)
  const sum = percentSum((values.installments ?? []).map((share) => share.percent))
  const { requestClose, holdNavigation } = useFinanceUnsavedGuard(dirty, onClose)
  const textMax = { max: FINANCE_TEXT_MAX_LENGTH, message: t('finance.validation.textMax', { max: FINANCE_TEXT_MAX_LENGTH }) }
  const blank = (value: unknown) => value === null || value === undefined

  const submit = async (submitted: FeePlanFormValues) => {
    setFailure(null)
    const all = { ...(form.getFieldsValue(true) as FeePlanFormValues), ...submitted }
    const patch = plan ? planFeePlanPatch(plan, all) : null
    if (plan && !patch) {
      message.info(t('feePlans.nothingChanged'))
      onClose()
      return
    }
    setSaving(true)
    try {
      const saved = plan && patch ? await updateFeePlan(plan.id, patch) : await createFeePlan(buildCreateFeePlanInput(all))
      onSaved(saved, plan === null)
    } catch (caught) {
      const described = describeFinanceFailure(caught)
      if (described.field && FORM_FIELDS.has(described.field[0] ?? '')) form.setFields([{ name: described.field, errors: [failureTitle(t, described)] }])
      setFailure(described)
      if (isFinanceFailure(described, 'fee_plan_not_found')) onStale()
      setSaving(false)
    }
  }

  const splitEvenly = () => {
    const shares = (form.getFieldValue('installments') as PlanShareFormValues[] | undefined) ?? []
    if (shares.length === 0) return
    form.setFieldsValue({ installments: evenShares(shares) })
    setDirty(feePlanFormHasChanges(initialValues, form.getFieldsValue(true) as FeePlanFormValues))
    void form.validateFields([['installments']]).catch(() => undefined)
  }

  const usedCount = plan?.invoiceCount ?? 0

  return (
    <Modal
      open
      title={plan ? t('feePlans.editTitle', { name: localizedLabel(plan.name, language) }) : t('feePlans.createTitle')}
      okText={plan ? t('common.save') : t('feePlans.create')}
      cancelText={t('common.cancel')}
      onOk={() => form.submit()}
      onCancel={() => {
        if (!saving) requestClose()
      }}
      confirmLoading={saving}
      keyboard={!dirty}
      mask={{ closable: !dirty }}
      destroyOnHidden
      width={880}
    >
      <NavigationBlocker when={dirty} onBlocked={holdNavigation} />
      {usedCount > 0 ? <Alert type="info" showIcon title={t('feePlans.hints.usedPlan', { count: usedCount })} style={{ marginBottom: 16 }} /> : null}
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={initialValues}
        disabled={saving}
        onFinish={(submitted) => void submit(submitted as FeePlanFormValues)}
        onValuesChange={() => {
          setDirty(feePlanFormHasChanges(initialValues, form.getFieldsValue(true) as FeePlanFormValues))
          // The share rules read every share, so they follow each change (a Form.List rule runs on add/remove only).
          void form.validateFields([['installments']]).catch(() => undefined)
        }}
      >
        <Form.Item name="nameTr" hidden>
          <Input />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="nameAr" label={t('feePlans.fields.nameAr')} rules={[{ required: true, whitespace: true, message: t('finance.validation.nameArRequired') }, textMax]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="nameEn" label={t('feePlans.fields.nameEn')} rules={[textMax]}>
              <Input dir="ltr" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="scope" label={t('feePlans.fields.scope')} extra={t(`feePlans.scopeHint.${scope}`)}>
          <Radio.Group name="fee-plan-scope">
            <Radio value="general">{t('feePlans.scope.general')}</Radio>
            <Radio value="course">{t('feePlans.scope.course')}</Radio>
            <Radio value="class">{t('feePlans.scope.class')}</Radio>
          </Radio.Group>
        </Form.Item>
        {scope === 'course' ? (
          <Form.Item name="courseId" label={t('feePlans.fields.course')} rules={[{ required: true, message: t('finance.validation.courseRequired') }]}>
            <ScopeTargetField kind="course" current={plan?.course ?? null} />
          </Form.Item>
        ) : null}
        {scope === 'class' ? (
          <Form.Item name="classId" label={t('feePlans.fields.class')} rules={[{ required: true, message: t('finance.validation.classRequired') }]}>
            <ScopeTargetField kind="class" current={plan?.class ?? null} />
          </Form.Item>
        ) : null}

        <Flex justify="space-between" align="center" wrap gap={8}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {t('feePlans.fields.lines')}
          </Typography.Title>
          <Typography.Text type="secondary" data-testid="fee-plan-total">
            {t('feePlans.hints.total', { total: linesTotal === null ? '—' : formatMoney(fromCents(linesTotal), currency, language) })}
          </Typography.Text>
        </Flex>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('feePlans.hints.lines')}
        </Typography.Paragraph>
        <Form.List
          name="lines"
          rules={[
            {
              validator: async (_, lines: unknown[] | undefined) => {
                if (!lines || lines.length < 1) throw new Error(t('finance.validation.linesMin'))
                if (lines.length > FEE_PLAN_LINES_MAX) throw new Error(t('finance.validation.linesMax', { max: FEE_PLAN_LINES_MAX }))
              },
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <Flex vertical gap={8} style={{ marginBottom: 16 }}>
              {fields.map((field, index) => (
                <Card key={field.key} size="small" data-testid="fee-plan-line-editor">
                  <Form.Item name={[field.name, 'descriptionTr']} hidden>
                    <Input />
                  </Form.Item>
                  <Row gutter={12} align="top">
                    <Col xs={24} md={9}>
                      <Form.Item
                        name={[field.name, 'descriptionAr']}
                        label={t('finance.editor.lineAr', { number: index + 1 })}
                        rules={[{ required: true, whitespace: true, message: t('finance.validation.descriptionRequired') }, textMax]}
                      >
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={7}>
                      <Form.Item name={[field.name, 'descriptionEn']} label={t('finance.editor.lineEn')} rules={[textMax]}>
                        <Input dir="ltr" />
                      </Form.Item>
                    </Col>
                    <Col xs={18} md={6}>
                      <Form.Item
                        name={[field.name, 'amount']}
                        label={t('finance.editor.amount')}
                        rules={[
                          {
                            validator: (_, value: unknown) =>
                              blank(value)
                                ? Promise.reject(new Error(t('finance.validation.amountRequired')))
                                : isPositiveAmount(value)
                                  ? Promise.resolve()
                                  : Promise.reject(new Error(t('finance.validation.amount'))),
                          },
                        ]}
                      >
                        <InputNumber style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={6} md={2} style={{ paddingTop: 30 }}>
                      <Button size="small" danger icon={<DeleteOutlined />} aria-label={t('finance.editor.removeLine', { number: index + 1 })} disabled={fields.length <= 1} onClick={() => remove(field.name)} />
                    </Col>
                  </Row>
                </Card>
              ))}
              <Form.ErrorList errors={errors} />
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(emptyPlanLine())} disabled={fields.length >= FEE_PLAN_LINES_MAX}>
                {t('finance.editor.addLine')}
              </Button>
            </Flex>
          )}
        </Form.List>

        <Flex justify="space-between" align="center" wrap gap={8}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {t('feePlans.fields.installments')}
          </Typography.Title>
          <Space>
            <Typography.Text type={sum === 100 ? 'success' : 'warning'} data-testid="fee-plan-percent-sum">
              {t('feePlans.hints.percentSum', { sum: sum === null ? '—' : sum })}
            </Typography.Text>
            <Button size="small" onClick={splitEvenly}>
              {t('feePlans.splitEvenly')}
            </Button>
          </Space>
        </Flex>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('feePlans.hints.installments')}
        </Typography.Paragraph>
        <Form.List
          name="installments"
          rules={[
            {
              validator: async (_, shares: PlanShareFormValues[] | undefined) => {
                if (!shares || shares.length < 1) throw new Error(t('finance.validation.installmentsMin'))
                if (shares.length > FEE_PLAN_INSTALLMENTS_MAX) throw new Error(t('finance.validation.installmentsMax', { max: FEE_PLAN_INSTALLMENTS_MAX }))
                // `checkPlan()` once every share is a valid number (else their own fields speak).
                const problems = feePlanFormProblems({ installments: shares })
                if (problems.length > 0) throw new Error(problems.map((problem) => t(`finance.problems.${problem}`)).join(' '))
              },
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <Flex vertical gap={8} style={{ marginBottom: 16 }}>
              {fields.map((field, index) => (
                <Row key={field.key} gutter={12} align="top" data-testid="fee-plan-share-editor">
                  <Col xs={12} md={8}>
                    <Form.Item
                      name={[field.name, 'percent']}
                      label={t('feePlans.fields.percent', { number: index + 1 })}
                      rules={[{ validator: (_, value: unknown) => (isSharePercent(value) ? Promise.resolve() : Promise.reject(new Error(t('finance.validation.percent')))) }]}
                    >
                      <InputNumber style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={8}>
                    <Form.Item
                      name={[field.name, 'dueOffsetDays']}
                      label={t('feePlans.fields.offset', { number: index + 1 })}
                      rules={[
                        {
                          validator: (_, value: unknown) =>
                            isWholeDays(value, DUE_OFFSET_DAYS_MAX) ? Promise.resolve() : Promise.reject(new Error(t('finance.validation.offset', { max: DUE_OFFSET_DAYS_MAX }))),
                        },
                      ]}
                    >
                      <InputNumber style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={2} style={{ paddingTop: 30 }}>
                    <Button size="small" danger icon={<DeleteOutlined />} aria-label={t('feePlans.removeShare', { number: index + 1 })} disabled={fields.length <= 1} onClick={() => remove(field.name)} />
                  </Col>
                </Row>
              ))}
              <Form.ErrorList errors={errors} />
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                disabled={fields.length >= FEE_PLAN_INSTALLMENTS_MAX}
                onClick={() => {
                  const shares = (form.getFieldValue('installments') as PlanShareFormValues[] | undefined) ?? []
                  const last = shares.at(-1)?.dueOffsetDays
                  add({ percent: null, dueOffsetDays: typeof last === 'number' ? last : 0 })
                }}
              >
                {t('feePlans.addShare')}
              </Button>
            </Flex>
          )}
        </Form.List>
      </Form>
      {failure ? <FinanceFailureAlert failure={failure} /> : null}
    </Modal>
  )
}
