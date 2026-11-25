// Creation of a course (MOD-04-T05) through POST /api/courses (API-044): the
// course starts as a draft. A server error that names a field (taken code,
// unknown level or subject) is shown on that field; anything else above the form.
// PORTAL-04: the subject picker; no age range.
import { Alert, Form, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createCourse } from '../api/courses'
import type { Course } from '../api/courses'
import type { Level } from '../api/levels'
import type { Subject } from '../api/subjects'
import { CourseFormFields } from './CourseFormFields'
import { describeCoursesFailure, failureMessage } from './courses.errors'
import { buildCreateCourseInput } from './courses.form'
import type { CourseFormValues } from './courses.form'

interface CreateCourseModalProps {
  open: boolean
  levels: Level[]
  /** PORTAL-04 */
  subjects: Subject[]
  onClose: () => void
  onCreated: (course: Course) => void
}

export function CreateCourseModal({ open, levels, subjects, onClose, onCreated }: CreateCourseModalProps) {
  const { t } = useTranslation()
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
      if (failure.field) form.setFields([{ name: failure.field, errors: [text] }])
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
      width={760}
      destroyOnHidden
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void submit(values as CourseFormValues)} disabled={saving}>
        <CourseFormFields form={form} levels={levels} subjects={subjects} />
      </Form>
    </Modal>
  )
}
