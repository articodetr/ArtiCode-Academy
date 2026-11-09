// The lesson fields shared by the creation modal and the edit form of the
// lesson drawer (J-F09). Rendered inside the caller's <Form>; local rules
// mirror the server (CreateLessonDto/UpdateLessonDto, lessons.time.ts) — the
// server decides — and every rule words its own message (J-F19: no antd
// default text). The class is chosen on creation only; the teacher comes from
// the class's teachers and the syllabus item from the class's course. An end
// time earlier than the start rolls the lesson over to the next day: the end
// time then carries NEXT_DAY_MARK and the hint names the end day and the
// length, so a typo such as 13:00 → 01:00 (a 12-hour night) does not pass
// unseen (J-F19). The day and the times are a wall clock in `zone` (D-R41 —
// J-F28): the lesson's own zone when editing, the academy's for a new lesson —
// a line above them names it, with this device's zone when they differ. The
// server decides a lesson's zone from its room's branch, so choosing a room of
// another branch (or of none) adds a note under the room: once saved, the
// lesson may be shown in another zone — the times typed here are still read
// in the zone named above, and the drawer then shows the server's answer.
import { Alert, Col, Form, Input, Row, Select, Typography } from 'antd'
import type { FormInstance } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AcademyClass } from '../api/classes'
import { DELIVERY_MODES, LESSON_TEXT_MAX_LENGTH, MAX_LESSON_HOURS } from '../api/lessons'
import type { Lesson } from '../api/lessons'
import type { Room } from '../api/rooms'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { RoomPicker } from '../timetable/TimetablePickers'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { localizedLabel } from '../users/users.format'
import { LessonClassPicker, LessonTeacherSelect, SyllabusItemSelect } from './LessonPickers'
import { isMeetingUrlValid } from './lessons.form'
import { NEXT_DAY_MARK, differsFromDevice, durationMinutes, formatLessonDay, nextDayRangeOf, rangeOf, rangeProblem } from './lessons.format'
import type { LessonZone } from './lessons.format'

/** The branch of a room; null = the academy's own site (or no room). */
function branchIdOf(room: { branch: { id: string } | null } | null | undefined): string | null {
  return room?.branch?.id ?? null
}

interface LessonFormFieldsProps {
  form: FormInstance
  /** `create` shows the class picker; `edit` keeps the class fixed. */
  mode: 'create' | 'edit'
  /** The zone the day and the times are read in: `{ lesson.timeZone, 'lesson' }` when editing, the academy's (useAcademyZone()) for a new lesson. */
  zone: LessonZone
  /** The class the lesson belongs to — chosen in the picker (create) or loaded (edit); null until known. */
  klass: AcademyClass | null
  /** Edit only: the lesson, so a teacher or syllabus item no longer offered stays selectable. */
  lesson?: Lesson
  /** Edit of a completed lesson: time, room and teacher are read-only (`lesson_locked`). */
  timingLocked?: boolean
  /** Create only: the chosen class changed (the teacher and syllabus fields are reset by the caller). */
  onClassChange?: (klass: AcademyClass | undefined) => void
}

export function LessonFormFields({ form, mode, zone, klass, lesson, timingLocked = false, onClassChange }: LessonFormFieldsProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  // GET /api/classes(/:id) needs classes.read at the controller: without it the class list and the class's teachers stay unknown.
  const canReadClasses = useAuth().hasPermission('classes.read')
  const courseId = klass?.course.id ?? lesson?.class.course.id
  // The day and the two times as typed, for the next-day mark beside the end time.
  const watchedDate = Form.useWatch('date', form) as string | undefined
  const watchedStart = Form.useWatch('startTime', form) as string | undefined
  const watchedEnd = Form.useWatch('endTime', form) as string | undefined
  const nextDay = nextDayRangeOf(watchedDate, watchedStart, watchedEnd, zone.timeZone)
  // The room as last chosen in the picker — its branch is known only from there, without a request; null = untouched.
  const [roomChoice, setRoomChoice] = useState<{ id: string | undefined; room: Room | undefined } | null>(null)
  // The server takes the lesson's zone from its room's branch (D-R41): a room of another branch (or none) may change it.
  const followsRoom =
    roomChoice !== null && roomChoice.id !== (mode === 'edit' ? lesson?.room?.id : undefined) && branchIdOf(roomChoice.room) !== (mode === 'edit' ? branchIdOf(lesson?.room) : null)
  const device = deviceTimeZone()

  /** The length rule of every text field, worded by the lessons dictionary. */
  const maxLength = { max: LESSON_TEXT_MAX_LENGTH, message: t('lessons.validation.maxLength', { max: LESSON_TEXT_MAX_LENGTH }) }

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
    const range = rangeOf(date, startTime, endTime, zone.timeZone)
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
            rules={[{ required: true, whitespace: true, message: t('lessons.validation.titleArRequired') }, maxLength]}
          >
            <Input maxLength={LESSON_TEXT_MAX_LENGTH} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="titleEn" label={t('lessons.fields.titleEn')} dependencies={['titleAr']} rules={[maxLength, arabicFirst('titleAr')]}>
            <Input dir="ltr" maxLength={LESSON_TEXT_MAX_LENGTH} />
          </Form.Item>
        </Col>
      </Row>
      {timingLocked ? <Alert type="info" showIcon title={t('lessons.hints.timingLocked')} style={{ marginBottom: 16 }} /> : null}
      <Typography.Paragraph type="secondary" data-testid="lesson-zone-hint" style={{ marginBottom: 8 }}>
        {t(`lessons.zone.${zone.source}Input`, { zone: zone.timeZone })}
        {differsFromDevice(zone.timeZone, device) ? ` — ${t('lessons.zone.device', { zone: device })}` : ''}
      </Typography.Paragraph>
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
            extra={
              <>
                {t('lessons.hints.time')}
                {nextDay ? (
                  <Typography.Text type="warning" style={{ display: 'block' }}>
                    {t('lessons.hints.endsNextDay', { date: formatLessonDay(nextDay.endsAt, language, zone.timeZone), minutes: durationMinutes(nextDay.startsAt, nextDay.endsAt) })}
                  </Typography.Text>
                ) : null}
              </>
            }
            rules={[{ required: true, message: t('lessons.validation.endRequired') }, { validator: validateEnd }]}
          >
            {/* The suffix stays mounted (empty on the same day): adding or removing an antd suffix remounts the input and drops its focus. */}
            <Input type="time" dir="ltr" disabled={timingLocked} suffix={<span data-testid="lesson-end-mark">{nextDay ? NEXT_DAY_MARK : ''}</span>} />
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
          <Form.Item name="roomId" label={t('lessons.fields.room')} extra={followsRoom ? t('lessons.zone.followsRoom') : undefined}>
            <RoomPicker allowClear placeholder={t('lessons.drawer.noRoom')} disabled={timingLocked} onChange={(value, room) => setRoomChoice({ id: value || undefined, room })} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name="deliveryMode" label={t('lessons.fields.deliveryMode')} rules={[{ required: true, message: t('lessons.validation.deliveryModeRequired') }]}>
            {/* The same `labels.*` words as the StatusTag of the list and the drawer. */}
            <Select options={DELIVERY_MODES.map((mode) => ({ value: mode, label: t(`labels.${mode}`) }))} />
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
          <Form.Item name="descriptionAr" label={t('lessons.fields.descriptionAr')} rules={[maxLength]}>
            <Input.TextArea rows={2} maxLength={LESSON_TEXT_MAX_LENGTH} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="descriptionEn"
            label={t('lessons.fields.descriptionEn')}
            dependencies={['descriptionAr']}
            rules={[maxLength, arabicFirst('descriptionAr')]}
          >
            <Input.TextArea rows={2} dir="ltr" maxLength={LESSON_TEXT_MAX_LENGTH} />
          </Form.Item>
        </Col>
      </Row>
    </>
  )
}
