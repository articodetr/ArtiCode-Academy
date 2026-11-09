// Creation of an assignment (J-F38) through POST /api/classes/:id/assignments
// (API-104): a draft of a planned, open or running class. The body of the
// modal is mounted per session (KI-049), so every assignment starts from a
// clean form; it hands its submit to the modal's OK button while mounted
// (J-F19). The due date is typed in the zone the server will give the new
// assignment (assignments.zone.ts — the chosen lesson's, else the
// academy's), named in the hint when it is not this device's. A server error
// that names a field (closed class, lesson of another class, late penalty
// without late submissions) is shown on that field; anything else above the
// form.
import { Alert, Form, Modal } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createAssignment } from '../api/assignments'
import type { Assignment } from '../api/assignments'
import { AssignmentFormFields } from './AssignmentFormFields'
import { describeAssignmentsFailure, failureMessage } from './assignments.errors'
import { NEW_ASSIGNMENT_VALUES, buildCreateAssignmentInput } from './assignments.form'
import type { AssignmentFormValues } from './assignments.form'
import { useAssignmentFormContext } from './useAssignmentFormContext'

interface CreateAssignmentModalProps {
  open: boolean
  onClose: () => void
  onCreated: (assignment: Assignment) => void
}

export function CreateAssignmentModal({ open, onClose, onCreated }: CreateAssignmentModalProps) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  // The form lives in the body, mounted per open session; the modal only submits it (as CreateLessonModal).
  const [submit, setSubmit] = useState<(() => void) | null>(null)
  const onReady = useCallback((fn: (() => void) | null) => setSubmit(() => fn), [])

  return (
    <Modal
      open={open}
      title={t('assignments.create.title')}
      okText={t('assignments.create.submit')}
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
      {open ? <CreateAssignmentBody onSaving={setSaving} onReady={onReady} onCreated={onCreated} /> : null}
    </Modal>
  )
}

interface CreateAssignmentBodyProps {
  onSaving: (saving: boolean) => void
  /** This session's submit on mount, null on unmount. */
  onReady: (submit: (() => void) | null) => void
  onCreated: (assignment: Assignment) => void
}

function CreateAssignmentBody({ onSaving, onReady, onCreated }: CreateAssignmentBodyProps) {
  const { t } = useTranslation()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [classId, setClassId] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const context = useAssignmentFormContext(form, classId)

  useEffect(() => {
    onReady(() => form.submit())
    return () => onReady(null)
  }, [form, onReady])

  const submit = async (values: AssignmentFormValues) => {
    if (!values.classId) return
    setSaving(true)
    onSaving(true)
    setError(null)
    try {
      onCreated(await createAssignment(values.classId, buildCreateAssignmentInput(values, context.dueZone.zone)))
    } catch (caught) {
      const failure = describeAssignmentsFailure(caught)
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
      <Form form={form} layout="vertical" requiredMark={false} initialValues={NEW_ASSIGNMENT_VALUES} onFinish={(values) => void submit(values as AssignmentFormValues)} disabled={saving}>
        <AssignmentFormFields
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
