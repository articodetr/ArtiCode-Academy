// Creation of a class (J-F01) through POST /api/classes (API-052): the class
// starts `planned`, for a published course. A server error that names a field
// (taken code, course not published, date range) is shown on that field;
// anything else above the form.
import { Alert, Form, Modal } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CLASS_CODE_PREFIX, LONG_CODE_BODY, generateUniqueCode } from '../common/codeGenerator'
import { createClass } from '../api/classes'
import type { AcademyClass } from '../api/classes'
import { ClassFormFields } from './ClassFormFields'
import { describeClassesFailure, failureMessage } from './classes.errors'
import { buildCreateClassInput } from './classes.form'
import type { ClassFormValues } from './classes.form'

interface CreateClassModalProps {
  open: boolean
  onClose: () => void
  onCreated: (cls: AcademyClass) => void
}

export function CreateClassModal({ open, onClose, onCreated }: CreateClassModalProps) {
  const { t } = useTranslation()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  // CH-0373: every opening starts with a new generated code; the user may type their own or press «توليد رمز».
  // The class list loads page by page, so the code is long enough that a clash with an unseen one is negligible.
  useEffect(() => {
    if (open) form.setFieldsValue({ code: generateUniqueCode(CLASS_CODE_PREFIX, [], undefined, LONG_CODE_BODY) })
  }, [open, form])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (values: ClassFormValues) => {
    setSaving(true)
    setError(null)
    try {
      const created = await createClass(buildCreateClassInput(values))
      form.resetFields()
      onCreated(created)
    } catch (caught) {
      const failure = describeClassesFailure(caught)
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
      title={t('classes.create.title')}
      okText={t('classes.create.submit')}
      cancelText={t('common.cancel')}
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={close}
      width={760}
      destroyOnHidden
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void submit(values as ClassFormValues)} disabled={saving}>
        <ClassFormFields form={form} mode="create" />
      </Form>
    </Modal>
  )
}
