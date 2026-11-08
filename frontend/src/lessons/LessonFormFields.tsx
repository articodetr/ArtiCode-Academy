// The lesson fields shared by the creation modal and the edit form of the
// lesson drawer (J-F09). Rendered inside the caller's <Form>; local rules
// mirror the server (CreateLessonDto/UpdateLessonDto, lessons.time.ts) — the
// server decides. The class is chosen on creation only; the teacher comes from
// the class's teachers and the syllabus item from the class's course.
import { Alert, Col, Form, Input, Row, Select } from 'antd'
import type { FormInstance } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AcademyClass } from '../api/classes'
import { DELIVERY_MODES, LESSON_TEXT_MAX_LENGTH, MAX_LESSON_HOURS } from '../api/lessons'
import type { Lesson } from '../api/lessons'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { RoomPicker } from '../timetable/TimetablePickers'
import { localizedLabel } from '../users/users.format'
import { LessonClassPicker, LessonTeacherSelect, SyllabusItemSelect } from './LessonPickers'
import { isMeetingUrlValid } from './lessons.form'
import { rangeOf, rangeProblem } from './lessons.format'

interface LessonFormFieldsProps {
  form: FormInstance
  /** `create` shows the class picker; `edit` keeps the class fixed. */
  mode: 'create' | 'edit'
  /** The class the lesson belongs to — chosen in the picker (create) or loaded (edit); null until known. */
  klass: AcademyClass | null
  /** Edit only: the lesson, so a teacher or syllabus item no longer offered stays selectable. */
  lesson?: Lesson
  /** Edit of a completed lesson: time, room and teacher are read-only (`lesson_locked`). */
  timingLocked?: boolean
  /** Create only: the chosen class changed (the teacher and syllabus fields are reset by the caller). */
  onClassChange?: (klass: AcademyClass | undefined) => void
}

export function LessonFormFields({ form, mode, klass, lesson, timingLocked = false, onClassChange }: LessonFormFieldsProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  // GET /api/classes(/:id) needs classes.read at the controller: without it the class list and the class's teachers stay unknown.
  const canReadClasses = useAuth().hasPermission('classes.read')
  const courseId = klass?.course.id ?? lesson?.class.course.id

  /** An English text needs the Arabic one: the server requires `ar` in every localized object, so an English text alone would be dropped. */
  const arabicFirst = (arField: string) => ({
    validator: (_: unknown, value: string | undefined) =>
      !value?.trim() || (form.getFieldValue(arField) as string | undefined)?.trim() ? Promise.resolve() : Promise.reject(new Error(t('lessons.validation.arabicFirst'))),
  })

  const validateEnd = (_: unknown, endTime: string | undefined) => {
    const date = form.getFieldValue('date') as string | undefined
    const startTime = form.getFieldValue('startTime') as string | undefined
    if (!date || !startTime || !endTime) return Promise.resolve()
    if (endTime === startTime) return Promise.reject(new Error(t('lessons.validation.rangeEmpty')))
    const range = rangeOf(date, startTime, endTime)
    const problem = range ? rangeProblem(range.startsAt, range.endsAt) : null
    if (problem === 'too_long') return Promise.reject(new Error(t('lessons.validation.rangeTooLong', { maxHours: MAX_LESSON_HOURS })))
    if (problem === 'empty') return Promise.reject(new Error(t('lessons.validation.rangeEmpty')))
    return Promise.resolve()
  }

  return (
    <>
      {mode === 'create' ? (
        <Form.Item
          name="classId"
          label={t('lessons.fields.class')}
          extra={canReadClasses ? t('lessons.hints.class') : t('lessons.hints.needsClassesRead')}
          rules={[{ required: true, message: t('lessons.validation.classRequired') }]}
        >
          {canReadClasses ? (
            <LessonClassPicker placeholder={t('lessons.pickers.classPlaceholder')} onChange={(_value, item) => onClassChange?.(item)} style={{ maxWidth: 480 }} />
          ) : (
            <Select
              disabled
              placeholder={t('lessons.pickers.classPlaceholder')}
              options={klass ? [{ value: klass.id, label: `${klass.code} — ${localizedLabel(klass.name, language)}` }] : []}
              style={{ maxWidth: 480 }}
            />
          )}
        </Form.Item>
      ) : null}
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item
            name="titleAr"
            label={t('lessons.fields.titleAr')}
            rules={[{ required: true, whitespace: true, message: t('lessons.validation.titleArRequired') }, { max: LESSON_TEXT_MAX_LENGTH }]}
          >
            <Input maxLength={LESSON_TEXT_MAX_LENGTH} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="titleEn" label={t('lessons.fields.titleEn')} dependencies={['titleAr']} rules={[{ max: LESSON_TEXT_MAX_LENGTH }, arabicFirst('titleAr')]}>
            <Input dir="ltr" maxLength={LESSON_TEXT_MAX_LENGTH} />
          </Form.Item>
        </Col>
      </Row>
      {timingLocked ? <Alert type="info" showIcon title={t('lessons.hints.timingLocked')} style={{ marginBottom: 16 }} /> : null}
      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Form.Item name="date" label={t('lessons.fields.date')} rules={[{ required: true, message: t('lessons.validation.dateRequired') }]}>
            <Input type="date" dir="ltr" disabled={timingLocked} />
          </Form.Item>
        </Col>
        <Col xs={12} md={8}>
          <Form.Item name="startTime" label={t('lessons.fields.startTime')} rules={[{ required: true, message: t('lessons.validation.startRequired') }]}>
            <Input type="time" dir="ltr" disabled={timingLocked} />
          </Form.Item>
        </Col>
        <Col xs={12} md={8}>
          <Form.Item
            name="endTime"
            label={t('lessons.fields.endTime')}
            dependencies={['date', 'startTime']}
            extra={t('lessons.hints.time')}
            rules={[{ required: true, message: t('lessons.validation.endRequired') }, { validator: validateEnd }]}
          >
            <Input type="time" dir="ltr" disabled={timingLocked} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item
            name="teacherUserId"
            label={t('lessons.fields.teacher')}
            extra={mode === 'create' ? t('lessons.hints.teacher') : canReadClasses ? undefined : t('lessons.hints.teacherNeedsClassesRead')}
          >
            <LessonTeacherSelect mode={mode} teachers={klass?.teachers ?? null} current={lesson?.teacher} disabled={timingLocked || (mode === 'create' && !klass)} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="roomId" label={t('lessons.fields.room')}>
            <RoomPicker allowClear placeholder={t('lessons.drawer.noRoom')} disabled={timingLocked} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name="deliveryMode" label={t('lessons.fields.deliveryMode')} rules={[{ required: true }]}>
            <Select options={DELIVERY_MODES.map((mode) => ({ value: mode, label: t(`lessons.deliveryModes.${mode}`) }))} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="syllabusItemId" label={t('lessons.fields.syllabusItem')}>
            <SyllabusItemSelect courseId={courseId} current={lesson?.syllabusItem} />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item
        name="meetingUrl"
        label={t('lessons.fields.meetingUrl')}
        extra={t('lessons.hints.meetingUrl')}
        rules={[{ validator: (_, value: string | undefined) => (isMeetingUrlValid(value) ? Promise.resolve() : Promise.reject(new Error(t('lessons.validation.meetingUrl')))) }]}
      >
        <Input dir="ltr" placeholder="https://meet.example.com/…" />
      </Form.Item>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name="descriptionAr" label={t('lessons.fields.descriptionAr')} rules={[{ max: LESSON_TEXT_MAX_LENGTH }]}>
            <Input.TextArea rows={2} maxLength={LESSON_TEXT_MAX_LENGTH} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="descriptionEn"
            label={t('lessons.fields.descriptionEn')}
            dependencies={['descriptionAr']}
            rules={[{ max: LESSON_TEXT_MAX_LENGTH }, arabicFirst('descriptionAr')]}
          >
            <Input.TextArea rows={2} dir="ltr" maxLength={LESSON_TEXT_MAX_LENGTH} />
          </Form.Item>
        </Col>
      </Row>
    </>
  )
}
