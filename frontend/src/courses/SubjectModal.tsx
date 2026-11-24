// Create / edit one school subject (PORTAL-04), a mirror of LevelModal without a description: POST /api/subjects for a
// new subject (appended at the end of the order), PATCH /api/subjects/:id with the smallest body for an existing one (no
// request when nothing changed). A taken code lands on the code field; any other refusal shows inside the modal. The
// parent mounts it per session (a form instance kept across sessions would bring back an earlier subject's values).
import { Alert, App, Col, Form, Input, Modal, Row, Switch } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createSubject, updateSubject } from '../api/subjects'
import type { Subject } from '../api/subjects'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { COURSE_TEXT_MAX_LENGTH, normaliseCourseCode } from './courses.form'
import { describeCoursesFailure, failureMessage } from './courses.errors'
import { EMPTY_SUBJECT_FORM, SUBJECT_CODE_MAX_LENGTH, SUBJECT_CODE_PATTERN, buildCreateSubjectInput, planSubjectPatch, subjectFormValuesOf } from './subjects.form'
import type { SubjectFormValues } from './subjects.form'

interface SubjectModalProps {
  open: boolean
  /** The subject to edit; null creates a new one. */
  subject: Subject | null
  onClose: () => void
  /** The subject as the server returned it; `created` tells a new subject from an edit. */
  onSaved: (subject: Subject, created: boolean) => void
}

export function SubjectModal({ open, subject, onClose, onSaved }: SubjectModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const maxLength = { max: COURSE_TEXT_MAX_LENGTH, message: t('courses.validation.maxLength', { max: COURSE_TEXT_MAX_LENGTH }) }

  const close = () => {
    setError(null)
    onClose()
  }

  const submit = async (values: SubjectFormValues) => {
    setError(null)
    const patch = subject ? planSubjectPatch(subject, values) : null
    if (subject && !patch) {
      message.info(t('courses.subjects.nothingChanged'))
      close()
      return
    }
    setSaving(true)
    try {
      const saved = subject && patch ? await updateSubject(subject.id, patch) : await createSubject(buildCreateSubjectInput(values))
      onSaved(saved, subject === null)
    } catch (caught) {
      const failure = describeCoursesFailure(caught)
      const text = failureMessage(t, failure)
      if (failure.field?.[0] === 'code') form.setFields([{ name: 'code', errors: [text] }])
      else setError(text)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={subject ? t('courses.subjects.editTitle', { name: localizedLabel(subject.name, language) }) : t('courses.subjects.createTitle')}
      okText={subject ? t('common.save') : t('courses.subjects.create')}
      cancelText={t('common.cancel')}
      onOk={() => form.submit()}
      onCancel={close}
      confirmLoading={saving}
      destroyOnHidden
      width={640}
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      <Form
        key={subject ? `${subject.id}:${subject.updatedAt}` : 'new'}
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={subject ? subjectFormValuesOf(subject) : EMPTY_SUBJECT_FORM}
        onFinish={(values) => void submit(values as SubjectFormValues)}
        disabled={saving}
      >
        <Form.Item
          name="code"
          label={t('courses.subjects.fields.code')}
          extra={t('courses.subjects.hints.code')}
          normalize={(value: string | undefined) => (value ?? '').toUpperCase()}
          rules={[
            { required: true, whitespace: true, message: t('courses.subjects.validation.codeRequired') },
            {
              validator: (_, value: string | undefined) =>
                !value?.trim() || SUBJECT_CODE_PATTERN.test(normaliseCourseCode(value))
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('courses.subjects.validation.codeFormat'))),
            },
          ]}
        >
          <Input dir="ltr" maxLength={SUBJECT_CODE_MAX_LENGTH} placeholder="MATH" style={{ maxWidth: 200 }} />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item
              name="nameAr"
              label={t('courses.subjects.fields.nameAr')}
              rules={[{ required: true, whitespace: true, message: t('courses.subjects.validation.nameArRequired') }, maxLength]}
            >
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="nameEn" label={t('courses.subjects.fields.nameEn')} rules={[maxLength]}>
              <Input dir="ltr" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="isActive" label={t('courses.subjects.fields.isActive')} valuePropName="checked" extra={t('courses.subjects.hints.isActive')}>
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  )
}
