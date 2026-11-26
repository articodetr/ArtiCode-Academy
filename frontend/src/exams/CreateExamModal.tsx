// Creation of an exam (J-F45) through POST /api/classes/:id/exams (API-115): a
// draft of a planned, open or running class, on the pattern of
// assignments/CreateAssignmentModal.tsx. The body of the modal is mounted per
// session (KI-049), so every exam starts from a clean form; it hands its submit
// to the modal's OK button while mounted (J-F19). The exam's date is typed in
// the zone the server will give the new exam (exams.zone.ts — the chosen
// lesson's, else the academy's), named in the hint when it is not this
// device's. A server error that names a field (closed class, lesson of another
// class, pass score above the maximum, a window that closes before it opens)
// is shown on that field; anything else above the form.
// MOD-09 phase 2: the form starts as a manual exam (NEW_EXAM_FORM_VALUES) and
// may be switched to an online one, whose body then carries `delivery` and its
// settings; a manual exam's body is what it always was (exams.form.ts).
import { Alert, Form, Modal } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createExam } from '../api/exams'
import type { Exam } from '../api/exams'
import { ExamFormFields } from './ExamFormFields'
import { describeExamsFailure, failureMessage } from './exams.errors'
import { NEW_EXAM_FORM_VALUES, buildCreateExamInput } from './exams.form'
import type { ExamFormValues } from './exams.form'
import { useExamFormContext } from './useExamFormContext'

interface CreateExamModalProps {
  open: boolean
  onClose: () => void
  onCreated: (exam: Exam) => void
  /** CH-0374: opened from a class's page — the class is fixed and `place` names it. */
  fixed?: { classId: string; place: string }
}

export function CreateExamModal({ open, onClose, onCreated, fixed }: CreateExamModalProps) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  // The form lives in the body, mounted per open session; the modal only submits it (as CreateLessonModal).
  const [submit, setSubmit] = useState<(() => void) | null>(null)
  const onReady = useCallback((fn: (() => void) | null) => setSubmit(() => fn), [])

  return (
    <Modal
      open={open}
      title={t('exams.create.title')}
      okText={t('exams.create.submit')}
      cancelText={t('common.cancel')}
      confirmLoading={saving}
      okButtonProps={{ disabled: !submit }}
      onOk={() => submit?.()}
      onCancel={() => {
        if (!saving) onClose()
      }}
      width={820}
      destroyOnHidden
    >
      {open ? <CreateExamBody fixed={fixed} onSaving={setSaving} onReady={onReady} onCreated={onCreated} /> : null}
    </Modal>
  )
}

interface CreateExamBodyProps {
  onSaving: (saving: boolean) => void
  /** This session's submit on mount, null on unmount. */
  onReady: (submit: (() => void) | null) => void
  onCreated: (exam: Exam) => void
  fixed?: { classId: string; place: string }
}

function CreateExamBody({ onSaving, onReady, onCreated, fixed }: CreateExamBodyProps) {
  const { t } = useTranslation()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [classId, setClassId] = useState<string | undefined>(fixed?.classId)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const context = useExamFormContext(form, classId)

  useEffect(() => {
    onReady(() => form.submit())
    return () => onReady(null)
  }, [form, onReady])

  const submit = async (values: ExamFormValues) => {
    if (!values.classId) return
    setSaving(true)
    onSaving(true)
    setError(null)
    try {
      onCreated(await createExam(values.classId, buildCreateExamInput(values, context.zone.zone)))
    } catch (caught) {
      const failure = describeExamsFailure(caught)
      const text = failureMessage(t, failure)
      if (failure.field) form.setFields([{ name: failure.field, errors: [text] }])
      else setError(text)
    } finally {
      setSaving(false)
      onSaving(false)
    }
  }

  return (
    <>
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Form form={form} layout="vertical" requiredMark={false} initialValues={fixed ? { ...NEW_EXAM_FORM_VALUES, classId: fixed.classId } : NEW_EXAM_FORM_VALUES} onFinish={(values) => void submit(values as ExamFormValues)} disabled={saving}>
        <ExamFormFields
          fixedPlace={fixed?.place}
          form={form}
          mode="create"
          hasClass={Boolean(classId)}
          context={context}
          onClassChange={(next) => {
            setClassId(next)
            // The lesson belongs to the class: start over when it changes.
            form.setFieldsValue({ lessonId: undefined })
          }}
        />
      </Form>
    </>
  )
}
