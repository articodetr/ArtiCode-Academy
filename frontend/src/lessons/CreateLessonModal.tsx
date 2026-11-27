// Creation of a lesson (J-F09) through POST /api/classes/:id/lessons
// (API-095): a scheduled lesson of a planned, open or running class. The body
// of the modal is mounted per session (KI-049), so every lesson starts from a
// clean form. A server error that names a field (teacher not assigned, room
// inactive, syllabus item of another course, time range, conflict) is shown
// on that field; anything else above the form. `initialClass` lets a class
// screen open the modal for one class (the picker is then pre-filled). The day
// and the times are read in the zone the server will give the lesson (D-R41 —
// J-F48, the owner's review of #105): the chosen room's `timeZone` (RoomDto
// since CH-0189 — its branch's, else the academy's — straight from the room
// picker's item, no request of its own), else, without a room, the academy's
// from the shared API-035 store, else this device's, which the form says. The
// typed wall clock stays when the room changes and is read in the new zone at
// submit, so 10:00 typed for a Berlin room is 10:00 in Berlin — the instant a
// weekly slot at 10:00 in that room generates. Once a class is chosen (or
// given), its course's curriculum lessons (API-048) and the curriculum lessons
// its sessions cover (API-093) are read, and the first lesson of the curriculum
// no non-cancelled session covers yet is preselected as the syllabus item,
// with the hint «اقتراح: الدرس التالي في المنهج» (LRN-T06, D-R143) — once per
// class, never over a choice the user made, and the user may change or clear it.
// A teacher-only viewer (teachesOnly() — J-F76) gets the short form: the day
// and the start time only (the lesson lasts TEACHER_LESSON_MINUTES), a live
// (default) or recorded delivery mode, no room (the academy's zone), no
// syllabus item (nothing is suggested or read) and no teacher field — the
// lesson is the caller's when they teach the class, else the server's default
// (the lead teacher).
// J-F79 (Jallal's request): the window has the look of a calendar's «new
// event» window — a scoped theme (lessonModal.theme.ts: taller, rounder fields
// and buttons), the fields named inside themselves with an icon, the two times
// side by side, the delivery modes as chips, a grey «إلغاء» beside «حفظ»
// (LessonFormFields `inline`, lessonModal.css under the root class
// `lesson-modal`). The fields, their order, their rules and the data are
// unchanged; the teacher's short form is narrower than the full one.
import { Alert, ConfigProvider, Form, Modal } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AcademyClass } from '../api/classes'
import { createLesson } from '../api/lessons'
import type { Lesson } from '../api/lessons'
import type { Room } from '../api/rooms'
import { useAuth } from '../auth/auth-context'
import { teachesOnly } from '../layout/navigation'
import { LessonFormFields } from './LessonFormFields'
import { describeLessonsFailure, failureMessage } from './lessons.errors'
import { TEACHER_DELIVERY_MODES, buildCreateLessonInput } from './lessons.form'
import type { LessonFormValues } from './lessons.form'
import { lessonZoneFor } from './lessons.format'
import { nextCurriculumItem } from './lessons.suggestion'
import { useCoveredSyllabusItems } from './useCoveredSyllabusItems'
import { useSyllabusItems } from './useSyllabusItems'
import { useAcademyZone } from './useAcademyZone'
import { LESSON_MODAL_THEME } from './lessonModal.theme'
import './lessonModal.css'

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
  // The teacher's short form (J-F76) fits a narrower window (J-F79).
  const { user } = useAuth()
  const simple = user ? teachesOnly(user) : false

  return (
    <ConfigProvider theme={LESSON_MODAL_THEME}>
      <Modal
        rootClassName="lesson-modal"
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
        width={simple ? 560 : 760}
        destroyOnHidden
      >
        {open ? <CreateLessonBody initialClass={initialClass} onSaving={setSaving} onReady={onReady} onCreated={onCreated} /> : null}
      </Modal>
    </ConfigProvider>
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
  // The room picked in the form (null = none): its zone is the lesson's (J-F48).
  const [room, setRoom] = useState<Room | null>(null)
  // The academy's zone, or this device's when the academy could not be read — the zone of a lesson without a room.
  const academy = useAcademyZone()
  const zone = lessonZoneFor(room, { timeZone: academy.timeZone, source: academy.source })

  const { user, hasPermission } = useAuth()
  // J-F76: a teacher-only viewer adds a lesson through the short form (no syllabus item, so nothing below is read).
  const simple = user ? teachesOnly(user) : false
  // The next curriculum lesson of the class (LRN-T06, D-R143): the syllabus is read here once and handed to the select.
  const classId = klass?.id
  const syllabus = useSyllabusItems(simple ? undefined : klass?.course.id)
  const covered = useCoveredSyllabusItems(classId, !simple && hasPermission('lessons.read'))
  const suggestion = useMemo(
    () => (covered && !syllabus.loading && !syllabus.error ? nextCurriculumItem(syllabus.items, covered) : null),
    [covered, syllabus.items, syllabus.loading, syllabus.error],
  )
  // The class whose syllabus item is settled: the suggestion was applied, or the user chose (or cleared) one first.
  const settledFor = useRef<string | null>(null)
  const watchedItem = Form.useWatch('syllabusItemId', form) as string | undefined

  useEffect(() => {
    if (!classId || !suggestion || settledFor.current === classId) return
    settledFor.current = classId
    if (!form.getFieldValue('syllabusItemId')) form.setFieldsValue({ syllabusItemId: suggestion.id })
  }, [classId, suggestion, form])

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
    // J-F76: the short form has no teacher field — the lesson is the caller's when they teach the class.
    const own = simple && user && klass?.id === classId && klass.teachers.some((teacher) => teacher.userId === user.id)
    try {
      // The instants are built now, in the zone of the room chosen last (J-F48).
      const created = await createLesson(classId, buildCreateLessonInput(own ? { ...values, teacherUserId: user.id } : values, zone.timeZone))
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
        initialValues={{ classId: initialClass?.id, deliveryMode: simple ? TEACHER_DELIVERY_MODES[0] : 'in_person', attachments: [] }}
        onFinish={(values) => void submit(values as LessonFormValues)}
        // A syllabus item the user picks or clears is theirs: the suggestion never replaces it.
        onValuesChange={(changed: Record<string, unknown>) => {
          if ('syllabusItemId' in changed && classId) settledFor.current = classId
        }}
        disabled={saving}
      >
        <LessonFormFields
          form={form}
          mode="create"
          simple={simple}
          inline
          zone={zone}
          classLocked={initialClass !== undefined}
          onRoomChange={(_roomId, next) => setRoom(next ?? null)}
          klass={klass}
          onClassChange={(next) => {
            setKlass(next ?? null)
            // The teacher and the syllabus item belong to the class: start over when it changes (a new suggestion too).
            form.setFieldsValue({ teacherUserId: undefined, syllabusItemId: undefined })
            settledFor.current = null
          }}
          syllabus={syllabus}
          syllabusHint={suggestion && watchedItem === suggestion.id ? t('lessons.syllabus.suggested') : undefined}
        />
      </Form>
    </>
  )
}
