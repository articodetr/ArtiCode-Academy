// The lesson fields shared by the creation modal and the edit form of the
// lesson drawer (J-F09). Rendered inside the caller's <Form>; local rules
// mirror the server (CreateLessonDto/UpdateLessonDto, lessons.time.ts) — the
// server decides — and every rule words its own message (J-F19: no antd
// default text). The class is chosen on creation only; the teacher comes from
// the class's teachers and the syllabus item from the class's course. An end
// time earlier than the start rolls the lesson over to the next day: the end
// time then carries NEXT_DAY_MARK and the hint names the end day and the
// length, so a typo such as 13:00 → 01:00 (a 12-hour night) does not pass
// unseen (J-F19). The day and the times are a wall clock in `zone` (D-R41): the
// zone the server will give the lesson, which the caller derives from the room
// chosen here (J-F48 — lessonZoneFor() on creation, editZoneOf() in the edit
// form; `onRoomChange` hands it the picker's item, whose RoomDto `timeZone`
// names that zone without another request). A line above the day names the
// zone, with this device's when they differ, and follows the room as it
// changes. On creation the caller may hand over the course's syllabus it read
// itself and a hint under the syllabus item — the next curriculum lesson it
// suggested (LRN-T06, D-R143). `simple` is the teacher's short creation form
// (J-F76): the day and the start time only (the lesson lasts
// TEACHER_LESSON_MINUTES), no teacher, room or syllabus item, and a live or
// recorded delivery mode only, and the join link of a live lesson or the
// video of a recorded one is required (J-F77). Every form offers the lesson's
// attachments (books and links) and the video of a recorded lesson; the edit
// form offers the video for every mode (a live lesson's recording afterwards).
// `inline` is the look of the «درس جديد» window (J-F79, lessonModal.css): the
// same fields in the same order, each named inside itself (a placeholder; the
// label stays for screen readers) with an icon at its start, the two times side
// by side with an arrow between them (the short form shows its computed end
// there, display only), and the delivery modes as chips instead of a select.
import { ArrowLeftOutlined, ArrowRightOutlined, CalendarOutlined, CheckOutlined, ClockCircleOutlined, LinkOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { Alert, Col, Form, Input, Radio, Row, Select, Typography } from 'antd'
import type { FormInstance } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AcademyClass } from '../api/classes'
import { DELIVERY_MODES, LESSON_TEXT_MAX_LENGTH, MAX_LESSON_HOURS } from '../api/lessons'
import type { DeliveryMode, Lesson } from '../api/lessons'
import type { Room } from '../api/rooms'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { RoomPicker } from '../timetable/TimetablePickers'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { localizedLabel } from '../users/users.format'
import { LessonAttachmentsField } from './LessonAttachmentsField'
import { LessonClassPicker, LessonTeacherSelect, SyllabusItemSelect } from './LessonPickers'
import { TEACHER_DELIVERY_MODES, TEACHER_LESSON_MINUTES, isMeetingUrlValid } from './lessons.form'
import { NEXT_DAY_MARK, clockAfter, differsFromDevice, durationMinutes, formatLessonDay, nextDayRangeOf, rangeOf, rangeProblem } from './lessons.format'
import type { LessonZone } from './lessons.format'
import type { SyllabusItems } from './useSyllabusItems'

interface LessonFormFieldsProps {
  form: FormInstance
  /** `create` shows the class picker; `edit` keeps the class fixed. */
  mode: 'create' | 'edit'
  /** The zone the day and the times are read in: the zone the server will give the lesson with the room chosen here (J-F48). */
  zone: LessonZone
  /** The room picker's choice (`roomId` undefined = cleared) with its item — the caller's zone follows it (J-F48). */
  onRoomChange?: (roomId: string | undefined, room: Room | undefined) => void
  /** The class the lesson belongs to — chosen in the picker (create) or loaded (edit); null until known. */
  klass: AcademyClass | null
  /** Edit only: the lesson, so a teacher or syllabus item no longer offered stays selectable. */
  lesson?: Lesson
  /** Edit of a completed lesson: time, room and teacher are read-only (`lesson_locked`). */
  timingLocked?: boolean
  /** CH-0374: a lesson added from its class's page — the class is fixed and its picker read-only. */
  classLocked?: boolean
  /** Create only: the chosen class changed (the teacher and syllabus fields are reset by the caller). */
  onClassChange?: (klass: AcademyClass | undefined) => void
  /** Create only: the course's syllabus the caller read itself (for its suggestion), so the select asks nothing more. */
  syllabus?: SyllabusItems
  /** Create only: a line under the syllabus item — «the next lesson of the curriculum» while the suggestion is chosen (LRN-T06). */
  syllabusHint?: string
  /** J-F76, create only: the teacher's short form — day and start time, a live or recorded delivery mode, the title, link and description. */
  simple?: boolean
  /** J-F79: the «درس جديد» window's look — names inside the fields, icons, the two times side by side, chips for the mode. */
  inline?: boolean
}

export function LessonFormFields({ form, mode, zone, onRoomChange, klass, lesson, timingLocked = false, classLocked = false, onClassChange, syllabus, syllabusHint, simple = false, inline = false }: LessonFormFieldsProps) {
  const { t, i18n } = useTranslation()
  /** The field's name as its placeholder in the window's look; nothing in the drawer's form, whose labels show. */
  const named = (key: string) => (inline ? t(key) : undefined)
  const icon = (node: ReactNode) => (inline ? node : undefined)
  const { language } = useLocalized()
  // GET /api/classes(/:id) needs classes.read at the controller: without it the class list and the class's teachers stay unknown.
  const canReadClasses = useAuth().hasPermission('classes.read')
  const courseId = klass?.course.id ?? lesson?.class.course.id
  // The day and the two times as typed, for the next-day mark beside the end time.
  const watchedDate = Form.useWatch('date', form) as string | undefined
  const watchedStart = Form.useWatch('startTime', form) as string | undefined
  const watchedEnd = Form.useWatch('endTime', form) as string | undefined
  // J-F77: the link fields follow the delivery mode.
  const watchedMode = Form.useWatch('deliveryMode', form) as DeliveryMode | undefined
  const nextDay = nextDayRangeOf(watchedDate, watchedStart, watchedEnd, zone.timeZone)
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

  const dateItem = (
    <Form.Item name="date" label={t('lessons.fields.date')} rules={[{ required: true, message: t('lessons.validation.dateRequired') }]}>
      <Input type="date" dir="ltr" disabled={timingLocked} prefix={icon(<CalendarOutlined />)} />
    </Form.Item>
  )
  const startItem = (
    <Form.Item
      name="startTime"
      label={t('lessons.fields.startTime')}
      extra={simple ? t('lessons.hints.teacherDuration', { minutes: TEACHER_LESSON_MINUTES }) : undefined}
      rules={[{ required: true, message: t('lessons.validation.startRequired') }]}
    >
      <Input type="time" dir="ltr" disabled={timingLocked} prefix={icon(<ClockCircleOutlined />)} />
    </Form.Item>
  )
  const endItem = simple ? null : (
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
      {/* The suffix stays mounted (empty on the same day): adding or removing an antd suffix remounts the input and drops its focus.
          The mark is LTR on its own span: the affix wrapper stays RTL in the Arabic UI, where «(+1)» read «(1+)» (CH-0297). */}
      <Input
        type="time"
        dir="ltr"
        disabled={timingLocked}
        prefix={icon(<ClockCircleOutlined />)}
        suffix={
          <span data-testid="lesson-end-mark" dir="ltr">
            {nextDay ? NEXT_DAY_MARK : ''}
          </span>
        }
      />
    </Form.Item>
  )

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
            <LessonClassPicker disabled={classLocked} placeholder={t('lessons.pickers.classPlaceholder')} onChange={(_value, item) => onClassChange?.(item)} style={inline ? undefined : { maxWidth: 480 }} />
          ) : (
            <Select
              disabled
              placeholder={t('lessons.pickers.classPlaceholder')}
              options={klass ? [{ value: klass.id, label: `${klass.code} — ${localizedLabel(klass.name, language)}` }] : []}
              style={inline ? undefined : { maxWidth: 480 }}
            />
          )}
        </Form.Item>
      ) : null}
      <Row gutter={12}>
        <Col xs={24}>
          <Form.Item
            name="titleAr"
            label={t('lessons.fields.titleAr')}
            rules={[{ required: true, whitespace: true, message: t('lessons.validation.titleArRequired') }, maxLength]}
          >
            <Input maxLength={LESSON_TEXT_MAX_LENGTH} placeholder={named('lessons.fields.titleAr')} />
          </Form.Item>
        </Col>
        <Col span={0}>
          <Form.Item name="titleEn" label={t('lessons.fields.titleEn')} dependencies={['titleAr']} rules={[maxLength, arabicFirst('titleAr')]}>
            <Input dir="ltr" maxLength={LESSON_TEXT_MAX_LENGTH} />
          </Form.Item>
        </Col>
      </Row>
      {timingLocked ? <Alert type="info" showIcon title={t('lessons.hints.timingLocked')} style={{ marginBottom: 16 }} /> : null}
      {/* It changes with the room (J-F48): a polite live region, so a screen reader hears the new zone too. */}
      <Typography.Paragraph type="secondary" data-testid="lesson-zone-hint" aria-live="polite" style={{ marginBottom: 8 }}>
        {t(`lessons.zone.${zone.source}Input`, { zone: zone.timeZone })}
        {differsFromDevice(zone.timeZone, device) ? ` — ${t('lessons.zone.device', { zone: device })}` : ''}
      </Typography.Paragraph>
      {inline ? (
        <>
          {dateItem}
          <div className="lesson-modal__times">
            {startItem}
            <span className="lesson-modal__arrow" aria-hidden>
              {i18n.dir() === 'rtl' ? <ArrowLeftOutlined /> : <ArrowRightOutlined />}
            </span>
            {endItem ?? (
              // The short form has no end field: the end it computes (TEACHER_LESSON_MINUTES after the start), shown only —
              // the hint under the start says the same to a screen reader.
              <div className="lesson-modal__end" aria-hidden data-testid="lesson-simple-end">
                <ClockCircleOutlined />
                <span dir="ltr">{clockAfter(watchedStart, TEACHER_LESSON_MINUTES) ?? '--:--'}</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <Row gutter={12}>
          <Col xs={24} md={simple ? 12 : 8}>
            {dateItem}
          </Col>
          <Col xs={simple ? 24 : 12} md={simple ? 12 : 8}>
            {startItem}
          </Col>
          {endItem ? (
            <Col xs={12} md={8}>
              {endItem}
            </Col>
          ) : null}
        </Row>
      )}
      {simple ? null : (
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
            <RoomPicker allowClear placeholder={inline ? t('lessons.fields.room') : t('lessons.drawer.noRoom')} disabled={timingLocked} onChange={(value, room) => onRoomChange?.(value || undefined, room)} />
          </Form.Item>
        </Col>
      </Row>
      )}
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name="deliveryMode" label={t('lessons.fields.deliveryMode')} rules={[{ required: true, message: t('lessons.validation.deliveryModeRequired') }]}>
            {/* The same `labels.*` words as the StatusTag of the list and the drawer. */}
            {inline ? (
              // The window's look: a coloured square, ticked when chosen, and the mode's name (lessonModal.css).
              <Radio.Group
                className="lesson-modal__chips"
                optionType="button"
                aria-label={t('lessons.fields.deliveryMode')}
                options={(simple ? TEACHER_DELIVERY_MODES : DELIVERY_MODES).map((mode) => ({
                  value: mode,
                  label: (
                    <span className={`lesson-chip lesson-chip--${mode}`}>
                      <span className="lesson-chip__box">
                        <CheckOutlined />
                      </span>
                      {t(`labels.${mode}`)}
                    </span>
                  ),
                }))}
              />
            ) : (
              <Select options={(simple ? TEACHER_DELIVERY_MODES : DELIVERY_MODES).map((mode) => ({ value: mode, label: t(`labels.${mode}`) }))} />
            )}
          </Form.Item>
        </Col>
        {simple ? null : (
          <Col xs={24} md={12}>
            <Form.Item name="syllabusItemId" label={t('lessons.fields.syllabusItem')} extra={syllabusHint}>
              <SyllabusItemSelect courseId={courseId} current={lesson?.syllabusItem} syllabus={syllabus} emptyLabel={named('lessons.fields.syllabusItem')} />
            </Form.Item>
          </Col>
        )}
      </Row>
      {/* J-F77: a recorded lesson has no join link — its video instead; the teacher's form requires the one its mode needs. */}
      {watchedMode !== 'recorded' ? (
        <Form.Item
          name="meetingUrl"
          label={t(simple ? 'lessons.fields.joinUrl' : 'lessons.fields.meetingUrl')}
          extra={t('lessons.hints.meetingUrl')}
          rules={[
            ...(simple ? [{ required: true, whitespace: true, message: t('lessons.validation.joinUrlRequired') }] : []),
            { validator: (_: unknown, value: string | undefined) => (isMeetingUrlValid(value) ? Promise.resolve() : Promise.reject(new Error(t('lessons.validation.meetingUrl')))) },
          ]}
        >
          <Input dir="ltr" placeholder={inline ? t(simple ? 'lessons.fields.joinUrl' : 'lessons.fields.meetingUrl') : 'https://meet.example.com/…'} prefix={icon(<LinkOutlined />)} />
        </Form.Item>
      ) : null}
      {/* The video: a recorded lesson's, or — in the edit form — a live lesson's recording added afterwards. */}
      {watchedMode === 'recorded' || mode === 'edit' ? (
        <Form.Item
          name="recordingUrl"
          label={t('lessons.fields.recordingUrl')}
          extra={t('lessons.hints.recordingUrl')}
          rules={[
            ...(simple && watchedMode === 'recorded' ? [{ required: true, whitespace: true, message: t('lessons.validation.recordingUrlRequired') }] : []),
            { validator: (_: unknown, value: string | undefined) => (isMeetingUrlValid(value) ? Promise.resolve() : Promise.reject(new Error(t('lessons.validation.meetingUrl')))) },
          ]}
        >
          <Input dir="ltr" placeholder={inline ? t('lessons.fields.recordingUrl') : 'https://www.youtube.com/watch?v=…'} prefix={icon(<VideoCameraOutlined />)} />
        </Form.Item>
      ) : null}
      <LessonAttachmentsField />
      <Row gutter={12}>
        <Col xs={24}>
          <Form.Item name="descriptionAr" label={t('lessons.fields.descriptionAr')} rules={[maxLength]}>
            <Input.TextArea rows={2} maxLength={LESSON_TEXT_MAX_LENGTH} placeholder={named('lessons.fields.descriptionAr')} />
          </Form.Item>
        </Col>
        <Col span={0}>
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
