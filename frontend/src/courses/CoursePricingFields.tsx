// The price of a course in its edit form (MOD-19, D-R122): free, or paid with
// the fee plan that prices a request. Rendered inside the caller's <Form> for
// holders of `fee_plans.manage` only (the server needs it besides
// `courses.manage`); it reads the plans through API-140 and offers the active
// plans that fit the course — a plan of this course or a general plan
// (plansFittingCourse(), a mirror of the server's rule). The plan the course
// holds now stays selectable even when it no longer fits or was deactivated,
// so the form never shows a raw id. The server decides (422 fee_plan_mismatch,
// fee_plan_inactive, 404 fee_plan_not_found).
import { Alert, Form, Radio, Select, Tag } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Course } from '../api/courses'
import { listFeePlans } from '../api/feePlans'
import type { FeePlan } from '../api/feePlans'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { plansFittingCourse } from './courses.form'

interface CoursePricingFieldsProps {
  course: Course
}

// `classPlans`: the active plans of ONE class — never a course fee (the server answers 422 fee_plan_mismatch); named
// when nothing fits, so a plan made for the class instead of the course is recognised (PORTAL-04).
type PlansState = { status: 'loading' } | { status: 'ready'; plans: FeePlan[]; classPlans: FeePlan[] } | { status: 'failed' }

export function CoursePricingFields({ course }: CoursePricingFieldsProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [state, setState] = useState<PlansState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    listFeePlans({}, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setState({ status: 'ready', plans: plansFittingCourse(result.items, course.id), classPlans: result.items.filter((plan) => plan.isActive && plan.class !== null) })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'failed' })
      })
    return () => controller.abort()
  }, [course.id])

  const plans = state.status === 'ready' ? state.plans : []
  const current = course.enrollmentFeePlan
  const options = plans.map((plan) => ({
    value: plan.id,
    label: (
      <>
        {t('courses.pricing.planSummary', { name: localizedLabel(plan.name, language), total: plan.total.toFixed(2) })}
        {plan.course === null ? <Tag style={{ marginInlineStart: 8 }}>{t('courses.pricing.general')}</Tag> : null}
      </>
    ),
  }))
  // The course's own plan, when the list does not offer it (deactivated, or no longer fitting).
  if (current && !plans.some((plan) => plan.id === current.id)) {
    options.unshift({
      value: current.id,
      label: (
        <>
          {t('courses.pricing.planSummary', { name: localizedLabel(current.name, language), total: current.total.toFixed(2) })}
          {current.isActive ? null : <Tag style={{ marginInlineStart: 8 }}>{t('labels.inactive')}</Tag>}
        </>
      ),
    })
  }

  return (
    <>
      <Form.Item name="pricing" label={t('courses.fields.pricing')}>
        <Radio.Group
          name="course-pricing"
          optionType="button"
          options={[
            { value: 'free', label: t('courses.pricing.free') },
            { value: 'paid', label: t('courses.pricing.paid') },
          ]}
        />
      </Form.Item>
      <Form.Item noStyle shouldUpdate={(before: { pricing?: string }, after: { pricing?: string }) => before.pricing !== after.pricing}>
        {({ getFieldValue }) =>
          getFieldValue('pricing') === 'paid' ? (
            <>
              {state.status === 'failed' ? <Alert type="error" showIcon title={t('courses.hints.feePlansFailed')} style={{ marginBottom: 12 }} /> : null}
              {state.status === 'ready' && options.length === 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  data-testid="course-no-fee-plans"
                  title={t('courses.hints.noFeePlans')}
                  description={
                    state.classPlans.length > 0
                      ? t('courses.hints.classPlans', {
                          plans: state.classPlans.map((plan) => `«${localizedLabel(plan.name, language)}» (${plan.class!.code})`).join('، '),
                        })
                      : undefined
                  }
                  style={{ marginBottom: 12 }}
                />
              ) : null}
              <Form.Item
                name="enrollmentFeePlanId"
                label={t('courses.fields.feePlan')}
                extra={t('courses.hints.feePlan')}
                rules={[{ required: true, message: t('courses.validation.feePlanRequired') }]}
              >
                <Select
                  aria-label={t('courses.fields.feePlan')}
                  loading={state.status === 'loading'}
                  options={options}
                  placeholder={t('courses.fields.feePlan')}
                  style={{ maxWidth: 420 }}
                />
              </Form.Item>
            </>
          ) : null
        }
      </Form.Item>
    </>
  )
}
