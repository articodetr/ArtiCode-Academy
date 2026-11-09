// Detail drawer of one lesson (J-F09): reads GET /api/lessons/:id (API-094)
// and shows the lesson with its class, course, time, place, teacher, syllabus
// item, meeting link and attendance counts. For holders of `lessons.manage`
// (within the class visibility the server enforces): an edit form (smallest
// PATCH — API-096; time, room and teacher only while scheduled) and an
// actions menu built from the mirrored state machine (lessons.status.ts →
// API-097 with an optional reason, and API-098 for a scheduled lesson without
// attendance), each action confirmed in a modal. Holders of `attendance.read`
// get a second tab with the attendance sheet (J-F10 — API-099/100,
// attendance/AttendanceSheetTab.tsx); a saved sheet updates the counts of the
// summary here and of the row in the list. The edit form lives in the details
// tab, so unsaved attendance rows survive an edit of the lesson. Every time it
// shows — the lesson's own, its creation and last change, when its attendance
// was recorded — is in the lesson's `timeZone`, named in its own row beside
// this device's zone when they differ, and the edit form takes the day and
// the times in that zone (D-R41 — J-F28).
import { CheckCircleOutlined, DeleteOutlined, DownOutlined, EditOutlined, LinkOutlined, StopOutlined, UndoOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Descriptions, Drawer, Dropdown, Flex, Form, Input, Modal, Skeleton, Space, Tabs, Tag, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ATTENDANCE_STATUSES } from '../api/attendance'
import type { AttendanceSheet } from '../api/attendance'
import { getClass } from '../api/classes'
import type { AcademyClass } from '../api/classes'
import { LESSON_STATUS_REASON_MAX_LENGTH, changeLessonStatus, deleteLesson, getLesson, updateLesson } from '../api/lessons'
import type { Lesson } from '../api/lessons'
import { AttendanceSheetTab } from '../attendance/AttendanceSheetTab'
import { ATTENDANCE_STATUS_COLORS } from '../attendance/attendance.format'
import { useAuth } from '../auth/auth-context'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { LessonFormFields } from './LessonFormFields'
import { LessonZoneValue } from './LessonZone'
import { describeLessonsFailure, failureMessage } from './lessons.errors'
import { lessonFormValuesOf, planLessonPatch } from './lessons.form'
import type { LessonFormValues } from './lessons.form'
import { durationMinutes, formatLessonDateTime, formatLessonDay, formatLessonTimes, lessonRoomLabel, lessonTitle, syllabusItemLabel } from './lessons.format'
import { availableLessonActions, isClassOpenForLessons, isDangerousLessonAction, lessonEditability } from './lessons.status'
import type { LessonMenuAction } from './lessons.status'

const ICONS: Readonly<Record<LessonMenuAction, ReactNode>> = {
  complete: <CheckCircleOutlined />,
  cancel: <StopOutlined />,
  restore: <UndoOutlined />,
  delete: <DeleteOutlined />,
}

/** Form fields the edit form renders; a server error naming another field is shown as a message instead. */
const EDIT_FIELDS = new Set(['titleAr', 'titleEn', 'descriptionAr', 'descriptionEn', 'deliveryMode', 'date', 'startTime', 'endTime', 'roomId', 'teacherUserId', 'syllabusItemId', 'meetingUrl'])

/** The lesson or its class changed elsewhere (or the lesson is gone): the edit form closes and the drawer re-reads the lesson. */
const STALE_EDIT_CODES = ['lesson_locked', 'class_closed', 'lesson_not_found'].map((code) => `lessons.errors.${code}`)

/** The tabs of the drawer for holders of `attendance.read`; anyone else sees the details alone. */
type DrawerTab = 'details' | 'attendance'

interface LessonDrawerProps {
  lessonId: string | null
  onClose: () => void
  /** The lesson the server returned after an edit or a status change. */
  onUpdated: (lesson: Lesson) => void
  /** A scheduled lesson was deleted. */
  onDeleted: (lessonId: string) => void
}

export function LessonDrawer({ lessonId, onClose, onUpdated, onDeleted }: LessonDrawerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { hasPermission } = useAuth()
  const canManage = hasPermission('lessons.manage')
  const canReadAttendance = hasPermission('attendance.read')
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState<LessonMenuAction | null>(null)
  const [tab, setTab] = useState<DrawerTab>('details')

  useEffect(() => {
    if (!lessonId) return
    const controller = new AbortController()
    getLesson(lessonId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setLesson(loaded)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const failure = describeLessonsFailure(error)
        // A lesson that is gone (or out of reach) no longer shows its last known details.
        if (failure.key === 'lessons.errors.lesson_not_found') {
          setLesson(null)
          setEditing(false)
        }
        setLoadError(failureMessage(t, failure))
      })
    return () => controller.abort()
  }, [lessonId, reloadTick, t])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  const close = () => {
    setLesson(null)
    setLoadError(null)
    setEditing(false)
    setPending(null)
    setTab('details')
    onClose()
  }

  const applyUpdate = (updated: Lesson) => {
    setLesson(updated)
    onUpdated(updated)
  }

  /** The counts and the first-recording stamp the server answered with the saved sheet (no optimistic counts). */
  const applyAttendance = (sheet: AttendanceSheet) => {
    if (lesson && lesson.id === sheet.lessonId) applyUpdate({ ...lesson, attendance: sheet.counts, attendanceTakenAt: sheet.attendanceTakenAt })
  }

  const editability = lesson ? lessonEditability(lesson, canManage) : { editable: false, timingLocked: true }
  const actions = lesson && !editing ? availableLessonActions(lesson, canManage) : []
  const menu: MenuProps['items'] = actions.map((action) => ({
    key: action,
    label: t(`lessons.actions.${action}`),
    icon: ICONS[action],
    danger: isDangerousLessonAction(action),
  }))

  const title = lesson ? lessonTitle(lesson, language) : t('lessons.drawer.title')

  /** The details of the lesson, or its edit form while editing. */
  const detailsPane = (current: Lesson) =>
    editing ? (
      <LessonEditForm
        // Remount per server version so the form starts from what the server holds (KI-049).
        key={`${current.id}:${current.updatedAt}`}
        lesson={current}
        timingLocked={editability.timingLocked}
        onSaved={(updated) => {
          applyUpdate(updated)
          setEditing(false)
        }}
        onStale={() => {
          setEditing(false)
          reload()
        }}
        onCancel={() => setEditing(false)}
      />
    ) : (
      <LessonDetails lesson={current} onOpenAttendance={canReadAttendance ? () => setTab('attendance') : undefined} />
    )

  return (
    <Drawer
      open={lessonId !== null}
      onClose={close}
      title={
        lesson ? (
          <Space wrap>
            <span>{title}</span>
            <StatusTag value={lesson.status} />
          </Space>
        ) : (
          title
        )
      }
      // antd 6: `size` takes a CSS length; the panel never exceeds a phone viewport.
      size="min(760px, 100vw)"
      destroyOnHidden
      extra={
        lesson && !editing && (editability.editable || menu.length > 0) ? (
          <Space>
            {editability.editable ? (
              <Button
                icon={<EditOutlined />}
                onClick={() => {
                  setEditing(true)
                  setTab('details')
                }}
              >
                {t('common.edit')}
              </Button>
            ) : null}
            {menu.length > 0 ? (
              <Dropdown trigger={['click']} destroyOnHidden menu={{ items: menu, onClick: ({ key }) => setPending(key as LessonMenuAction) }}>
                <Button icon={<DownOutlined />} iconPlacement="end">
                  {t('lessons.actions.menu')}
                </Button>
              </Dropdown>
            ) : null}
          </Space>
        ) : null
      }
    >
      {loadError ? (
        <Alert
          type="error"
          showIcon
          title={loadError}
          action={
            <Button size="small" onClick={reload}>
              {t('lessons.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {!lesson && !loadError ? <Skeleton active paragraph={{ rows: 8 }} data-testid="lesson-loading" /> : null}

      {lesson && canManage && !isClassOpenForLessons(lesson.class.status) ? <Alert type="warning" showIcon title={t('lessons.drawer.classClosed')} style={{ marginBottom: 16 }} /> : null}

      {lesson ? (
        canReadAttendance ? (
          <Tabs
            activeKey={tab}
            onChange={(key) => setTab(key as DrawerTab)}
            items={[
              { key: 'details', label: t('attendance.drawerTabs.details'), children: detailsPane(lesson) },
              {
                key: 'attendance',
                label: t('attendance.drawerTabs.sheet'),
                // Re-read when the lesson is cancelled or restored here (that decides whether it accepts attendance);
                // completing it keeps the sheet and its unsaved rows.
                children: <AttendanceSheetTab key={`${lesson.id}:${lesson.status === 'cancelled'}`} lesson={lesson} onSaved={applyAttendance} onLessonStale={reload} />,
              },
            ]}
          />
        ) : (
          detailsPane(lesson)
        )
      ) : null}

      {lesson && pending ? (
        <LessonActionModal
          // Mounted per action, so the reason never carries over to the next one.
          lesson={lesson}
          action={pending}
          onDone={(updated) => {
            setPending(null)
            if (updated) applyUpdate(updated)
            else {
              onDeleted(lesson.id)
              close()
            }
          }}
          onStale={reload}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </Drawer>
  )
}

function LessonDetails({ lesson, onOpenAttendance }: { lesson: Lesson; onOpenAttendance?: () => void }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const dash = '—'

  return (
    <>
      <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
        <Descriptions.Item label={t('lessons.fields.class')}>
          <Space wrap>
            <Typography.Text dir="ltr" strong>
              {lesson.class.code}
            </Typography.Text>
            <span>{localizedLabel(lesson.class.name, language)}</span>
            {!isClassOpenForLessons(lesson.class.status) ? <StatusTag value={lesson.class.status} /> : null}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t('lessons.columns.course')}>
          {localizedLabel(lesson.class.course.name, language)} (<span dir="ltr">{lesson.class.course.code}</span>)
        </Descriptions.Item>
        <Descriptions.Item label={t('lessons.fields.date')}>{formatLessonDay(lesson.startsAt, language, lesson.timeZone)}</Descriptions.Item>
        <Descriptions.Item label={t('common.time')}>
          <Space wrap>
            {/* A plain span: antd Typography's RTL class would override dir and reverse the range. */}
            <span dir="ltr">{formatLessonTimes(lesson.startsAt, lesson.endsAt, language, lesson.timeZone)}</span>
            <Typography.Text type="secondary">{t('lessons.drawer.minutes', { count: durationMinutes(lesson.startsAt, lesson.endsAt) })}</Typography.Text>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t('lessons.fields.timeZone')}>
          <LessonZoneValue timeZone={lesson.timeZone} />
        </Descriptions.Item>
        <Descriptions.Item label={t('lessons.fields.deliveryMode')}>
          <StatusTag value={lesson.deliveryMode} />
        </Descriptions.Item>
        <Descriptions.Item label={t('lessons.fields.room')}>
          {lesson.room ? (
            <Space wrap>
              <Typography.Text dir="ltr">{lessonRoomLabel(lesson.room, language)}</Typography.Text>
              <Typography.Text type="secondary">{lesson.room.branch ? lesson.room.branch.code : t('lessons.drawer.site')}</Typography.Text>
            </Space>
          ) : (
            <Typography.Text type="secondary">{t('lessons.drawer.noRoom')}</Typography.Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('lessons.fields.meetingUrl')}>
          {lesson.meetingUrl ? (
            <Typography.Link href={lesson.meetingUrl} target="_blank" rel="noopener noreferrer" dir="ltr">
              <LinkOutlined /> {lesson.meetingUrl}
            </Typography.Link>
          ) : (
            dash
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('lessons.fields.teacher')}>{lesson.teacher?.fullName ?? <Typography.Text type="secondary">{t('lessons.drawer.noTeacher')}</Typography.Text>}</Descriptions.Item>
        <Descriptions.Item label={t('lessons.fields.syllabusItem')}>
          {lesson.syllabusItem ? syllabusItemLabel(lesson.syllabusItem, language) : <Typography.Text type="secondary">{t('lessons.drawer.noSyllabusItem')}</Typography.Text>}
        </Descriptions.Item>
        <Descriptions.Item label={t('lessons.fields.descriptionAr')}>
          <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{lesson.description?.ar || dash}</Typography.Paragraph>
        </Descriptions.Item>
        {lesson.description?.en ? (
          <Descriptions.Item label={t('lessons.fields.descriptionEn')}>
            <Typography.Paragraph dir="ltr" style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
              {lesson.description.en}
            </Typography.Paragraph>
          </Descriptions.Item>
        ) : null}
        {lesson.status === 'cancelled' ? <Descriptions.Item label={t('lessons.fields.cancellationReason')}>{lesson.cancellationReason || dash}</Descriptions.Item> : null}
        <Descriptions.Item label={t('lessons.fields.origin')}>
          <Tag>{lesson.scheduleId ? t('lessons.drawer.generated') : t('lessons.drawer.manual')}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label={t('lessons.fields.createdAt')}>{formatLessonDateTime(lesson.createdAt, language, lesson.timeZone)}</Descriptions.Item>
        <Descriptions.Item label={t('lessons.fields.updatedAt')}>{formatLessonDateTime(lesson.updatedAt, language, lesson.timeZone)}</Descriptions.Item>
      </Descriptions>
      <LessonAttendanceSummary lesson={lesson} onOpenSheet={onOpenAttendance} />
    </>
  )
}

/** The attendance counts the server computes; the sheet (J-F10) records them — `onOpenSheet` switches to its tab. */
export function LessonAttendanceSummary({ lesson, onOpenSheet }: { lesson: Pick<Lesson, 'attendance' | 'attendanceTakenAt' | 'timeZone'>; onOpenSheet?: () => void }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { attendance } = lesson
  return (
    <Card size="small" title={t('lessons.attendance.title')} data-testid="lesson-attendance">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        {lesson.attendanceTakenAt
          ? t('lessons.attendance.takenAt', { date: formatLessonDateTime(lesson.attendanceTakenAt, language, lesson.timeZone) })
          : t('lessons.attendance.notTaken')}
      </Typography.Paragraph>
      <Space wrap>
        <Tag>{`${t('lessons.attendance.recorded')}: ${attendance.recorded}`}</Tag>
        {ATTENDANCE_STATUSES.map((status) => (
          <Tag key={status} color={ATTENDANCE_STATUS_COLORS[status]}>{`${t(`lessons.attendance.${status}`)}: ${attendance[status]}`}</Tag>
        ))}
      </Space>
      {onOpenSheet ? (
        <Button type="link" size="small" onClick={onOpenSheet} style={{ paddingInline: 0, marginTop: 8 }}>
          {t('attendance.openSheet')}
        </Button>
      ) : null}
    </Card>
  )
}

interface LessonActionModalProps {
  lesson: Lesson
  action: LessonMenuAction
  /** The lesson after a status change, or null after a deletion. */
  onDone: (lesson: Lesson | null) => void
  /** The lesson changed elsewhere meanwhile: re-read it. */
  onStale: () => void
  onCancel: () => void
}

function LessonActionModal({ lesson, action, onDone, onStale, onCancel }: LessonActionModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = lessonTitle(lesson, language)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      if (action === 'delete') {
        await deleteLesson(lesson.id)
        message.success(t('lessons.done.delete'))
        onDone(null)
        return
      }
      const trimmed = reason.trim()
      const updated = await changeLessonStatus(lesson.id, trimmed ? { action, reason: trimmed } : { action })
      message.success(t(`lessons.done.${action}`))
      onDone(updated)
    } catch (caught) {
      const failure = describeLessonsFailure(caught)
      setError(failureMessage(t, failure))
      if (['invalid_transition', 'lesson_not_deletable', 'lesson_not_started', 'class_closed'].some((code) => failure.key.endsWith(code))) onStale()
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={t('lessons.confirm.title', { action: t(`lessons.actions.${action}`), name })}
      okText={t(`lessons.actions.${action}`)}
      okButtonProps={{ danger: isDangerousLessonAction(action) }}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      onOk={() => void confirm()}
      onCancel={() => {
        if (!busy) onCancel()
      }}
    >
      <Typography.Paragraph>{t(`lessons.confirm.${action}`)}</Typography.Paragraph>
      {action !== 'delete' ? (
        <Form layout="vertical">
          <Form.Item label={t('lessons.confirm.reason')} extra={action === 'cancel' ? t('lessons.confirm.reasonStored') : t('lessons.confirm.reasonAudit')} htmlFor="lesson-status-reason">
            <Input.TextArea id="lesson-status-reason" rows={2} maxLength={LESSON_STATUS_REASON_MAX_LENGTH} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} />
          </Form.Item>
        </Form>
      ) : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Modal>
  )
}

interface LessonEditFormProps {
  lesson: Lesson
  timingLocked: boolean
  onSaved: (lesson: Lesson) => void
  /** The server refused the save because the lesson changed elsewhere: close the form and re-read the lesson. */
  onStale: () => void
  onCancel: () => void
}

/**
 * The edit form of one edit session. It owns its form so every session starts
 * from the lesson as the server holds it (KI-049), and reads the class once
 * for the teacher options (a teacher who lost the assignment stays selectable
 * as the current value) — only with `classes.read`, which GET /api/classes/:id
 * requires; without it the select offers the current teacher and «no teacher».
 * The day and the times are read in the lesson's zone as loaded (D-R41), even
 * when the room changes: the server may then answer with another zone (the
 * room's branch), and the drawer shows that answer — no request of its own.
 */
function LessonEditForm({ lesson, timingLocked, onSaved, onStale, onCancel }: LessonEditFormProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const canReadClass = useAuth().hasPermission('classes.read')
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [klass, setKlass] = useState<AcademyClass | null>(null)

  useEffect(() => {
    if (!canReadClass) return
    const controller = new AbortController()
    getClass(lesson.class.id, controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) setKlass(loaded)
      })
      .catch(() => {
        // Without the class the teacher select offers the current teacher only.
      })
    return () => controller.abort()
  }, [canReadClass, lesson.class.id])

  const save = async (values: LessonFormValues) => {
    const body = planLessonPatch(lesson, values)
    if (!body) {
      message.info(t('lessons.drawer.nothingChanged'))
      onCancel()
      return
    }
    setSaving(true)
    try {
      const updated = await updateLesson(lesson.id, body)
      message.success(t('lessons.drawer.saved'))
      onSaved(updated)
    } catch (caught) {
      const failure = describeLessonsFailure(caught)
      const text = failureMessage(t, failure)
      if (STALE_EDIT_CODES.includes(failure.key)) {
        message.error(text)
        onStale()
        return
      }
      if (failure.field && EDIT_FIELDS.has(failure.field[0] ?? '')) form.setFields([{ name: failure.field, errors: [text] }])
      else message.error(text)
      setSaving(false)
    }
  }

  return (
    <Form form={form} layout="vertical" requiredMark={false} initialValues={lessonFormValuesOf(lesson)} onFinish={(values) => void save(values as LessonFormValues)} disabled={saving}>
      <LessonFormFields form={form} mode="edit" zone={{ timeZone: lesson.timeZone, source: 'lesson' }} klass={klass} lesson={lesson} timingLocked={timingLocked} />
      <Flex gap={8} justify="flex-end">
        <Button onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="primary" htmlType="submit" loading={saving}>
          {t('common.save')}
        </Button>
      </Flex>
    </Form>
  )
}
