// Creation of a course (MOD-04-T05) through POST /api/courses (API-044): the
// course starts as a draft. A server error that names a field (unknown or
// inactive subject, a refused fee plan) is shown on that field; anything else above the form.
// PORTAL-04: the subject picker; no age range.
// The simplified course form: the Arabic texts, the cover, the subject and — for holders of
// `fee_plans.manage`, which the server needs besides `courses.manage` — the course type with
// a general fee plan as its price (CoursePricingFields without a course). No code: the server
// generates one. Without the key the course is created free, as before.
import { Alert, Form, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createCourse } from '../api/courses'
import type { Course } from '../api/courses'
import type { Subject } from '../api/subjects'
import { useAuth } from '../auth/auth-context'
import { CourseFormFields } from './CourseFormFields'
import { CoursePricingFields } from './CoursePricingFields'
import { describeCoursesFailure, failureMessage } from './courses.errors'
import { buildCreateCourseInput, courseFormField } from './courses.form'
import type { CourseFormValues } from './courses.form'

interface CreateCourseModalProps {
  open: boolean
  /** PORTAL-04 */
  subjects: Subject[]
  onClose: () => void
  onCreated: (course: Course) => void
}

/** A new course is free until the manager says otherwise. */
const INITIAL_VALUES: Partial<CourseFormValues> = { pricing: 'free' }

export function CreateCourseModal({ open, subjects, onClose, onCreated }: CreateCourseModalProps) {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  // MOD-19 (D-R122): the price needs fee_plans.manage besides courses.manage.
  const canPrice = hasPermission('fee_plans.manage')
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (values: CourseFormValues) => {
    setSaving(true)
    setError(null)
    try {
      const course = await createCourse(buildCreateCourseInput(values))
      form.resetFields()
      onCreated(course)
    } catch (caught) {
      const failure = describeCoursesFailure(caught)
      const text = failureMessage(t, failure)
      const field = courseFormField(failure.field)
      if (field) form.setFields([{ name: field, errors: [text] }])
      else setError(text)
    } finally {
      setSaving(false)
    }
  }

  const close = () => {
    if (saving) return
    setError(null)
    form.resetFields()
    onClose()
  }

  return (
    <Modal
      open={open}
      title={t('courses.create.title')}
      okText={t('courses.create.submit')}
      cancelText={t('common.cancel')}
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={close}
      width={640}
      destroyOnHidden
    >
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={canPrice ? INITIAL_VALUES : undefined}
        onFinish={(values) => void submit(values as CourseFormValues)}
        disabled={saving}
      >
        <CourseFormFields subjects={subjects} />
        {canPrice ? <CoursePricingFields /> : null}
      </Form>
    </Modal>
  )
}
