// Creation of a lesson (J-F09) through POST /api/classes/:id/lessons
// (API-095): a scheduled lesson of a planned, open or running class. The body
// of the modal is mounted per session (KI-049), so every lesson starts from a
// clean form. A server error that names a field (teacher not assigned, room
// inactive, syllabus item of another course, time range, conflict) is shown
// on that field; anything else above the form. `initialClass` lets a class
// screen open the modal for one class (the picker is then pre-filled). The day
// and the times are read in the academy's zone (D-R41 — J-F28): the server
// gives a lesson its zone from its room only once it exists, and a branch's
// zone is not known here without a request, so the academy's — already in the
// shared API-035 store — is the one rule; the form names it, and the drawer
// that opens on the created lesson shows the server's `timeZone`.
import { Alert, Form, Modal } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AcademyClass } from '../api/classes'
import { createLesson } from '../api/lessons'
import type { Lesson } from '../api/lessons'
import { LessonFormFields } from './LessonFormFields'
import { describeLessonsFailure, failureMessage } from './lessons.errors'
import { buildCreateLessonInput } from './lessons.form'
import type { LessonFormValues } from './lessons.form'
import { useAcademyZone } from './useAcademyZone'

interface CreateLessonModalProps {
  open: boolean
  onClose: () => void
  onCreated: (lesson: Lesson) => void
  /** Pre-selected class (a class screen opening the modal for itself). */
  initialClass?: AcademyClass
}

export function CreateLessonModal({ open, onClose, onCreated, initialClass }: CreateLessonModalProps) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  // The form lives in the body, mounted per open session; the modal only submits it. The body hands its submit over
  // when it mounts and takes it back when it unmounts, so a reopened modal never holds the previous session's form
  // (until the new body is ready the OK button is disabled — J-F19).
  const [submit, setSubmit] = useState<(() => void) | null>(null)
  const onReady = useCallback((fn: (() => void) | null) => setSubmit(() => fn), [])

  return (
    <Modal
      open={open}
      title={t('lessons.create.title')}
      okText={t('lessons.create.submit')}
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
      {open ? <CreateLessonBody initialClass={initialClass} onSaving={setSaving} onReady={onReady} onCreated={onCreated} /> : null}
    </Modal>
  )
}

interface CreateLessonBodyProps {
  initialClass?: AcademyClass
  onSaving: (saving: boolean) => void
  /** This session's submit on mount, null on unmount. */
  onReady: (submit: (() => void) | null) => void
  onCreated: (lesson: Lesson) => void
}

function CreateLessonBody({ initialClass, onSaving, onReady, onCreated }: CreateLessonBodyProps) {
  const { t } = useTranslation()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [klass, setKlass] = useState<AcademyClass | null>(initialClass ?? null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // The academy's zone, or this device's when the academy could not be read — the form says which.
  const { timeZone, source } = useAcademyZone()

  // Hands the modal's OK button this session's form (onReady is stable; the form instance too), and takes it back
  // when the session ends — the next session's first frame then shows a disabled OK, never a stale one.
  useEffect(() => {
    onReady(() => form.submit())
    return () => onReady(null)
  }, [form, onReady])

  const submit = async (values: LessonFormValues) => {
    const classId = values.classId ?? initialClass?.id
    if (!classId) return
    setSaving(true)
    onSaving(true)
    setError(null)
    try {
      const created = await createLesson(classId, buildCreateLessonInput(values, timeZone))
      onCreated(created)
    } catch (caught) {
      const failure = describeLessonsFailure(caught)
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
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ classId: initialClass?.id, deliveryMode: 'in_person' }}
        onFinish={(values) => void submit(values as LessonFormValues)}
        disabled={saving}
      >
        <LessonFormFields
          form={form}
          mode="create"
          zone={{ timeZone, source }}
          klass={klass}
          onClassChange={(next) => {
            setKlass(next ?? null)
            // The teacher and the syllabus item belong to the class: start over when it changes.
            form.setFieldsValue({ teacherUserId: undefined, syllabusItemId: undefined })
          }}
        />
      </Form>
    </>
  )
}
