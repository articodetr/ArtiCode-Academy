// «الدروس» of a class's page (CH-0374): the class's lessons (API-093 with `classId`), oldest first, each opening the
// lesson drawer (details, edit, status, attendance); «إضافة درس» adds one straight into this class.
// J-F75 (CH-0382, Jallal's request): each lesson card of an open class carries three buttons, so a teacher works from
// the list — «تعديل» opens the lesson drawer on its edit form (LessonDrawer `startEditing`), «حذف» deletes the lesson
// after a confirmation (API-098), and «إضافة اختبار» opens the exam form with this class fixed and this lesson chosen
// (API-115), then the new exam's drawer. Edit and delete need `lessons.manage`, the exam `exams.manage`; a button the
// lesson's state refuses (the server's rules, mirrored in lessons.status.ts) is greyed out and says why. A click on a
// button never opens the card's lesson drawer.
// J-F78 (CH-0385, Jallal's request): a card shows the lesson's day, its times and its title only — no teacher or room
// line, no zone name, no attendance count and no status tag («مجدول»/«مكتمل»). A lesson reaches the class's students as
// soon as it is saved (API-101 has no draft state), so the card says nothing about publishing. The times stay in the
// lesson's own zone (D-R41); only the zone's name is gone.
import { DeleteOutlined, EditOutlined, FileAddOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Empty, Flex, Skeleton, Tooltip, Typography } from 'antd'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AcademyClass } from '../api/classes'
import { deleteLesson, listLessons } from '../api/lessons'
import type { Lesson } from '../api/lessons'
import { useAuth } from '../auth/auth-context'
import { CreateExamModal } from '../exams/CreateExamModal'
import { ExamDrawer } from '../exams/ExamDrawer'
import { examTitle } from '../exams/exams.format'
import { useLocalized } from '../i18n/useLocalized'
import { CreateLessonModal } from '../lessons/CreateLessonModal'
import { LessonDrawer } from '../lessons/LessonDrawer'
import { describeLessonsFailure, failureMessage } from '../lessons/lessons.errors'
import { formatLessonDay, formatLessonTimes, lessonTitle } from '../lessons/lessons.format'
import { isLessonDeletable } from '../lessons/lessons.status'
import { localizedLabel } from '../users/users.format'

const PAGE = 100
const OPEN_FOR_LESSONS = ['planned', 'open', 'running']

type DeleteBlock = 'classPage.lessons.deleteCompleted' | 'classPage.lessons.deleteCancelled' | 'classPage.lessons.deleteHasAttendance'

/** Why the server would refuse to delete this lesson (only a scheduled lesson without attendance records goes), or null. */
function lessonDeleteBlock(lesson: Pick<Lesson, 'status' | 'attendance'>): DeleteBlock | null {
  if (isLessonDeletable(lesson.status, lesson.attendance.recorded)) return null
  if (lesson.status === 'completed') return 'classPage.lessons.deleteCompleted'
  if (lesson.status === 'cancelled') return 'classPage.lessons.deleteCancelled'
  return 'classPage.lessons.deleteHasAttendance'
}

interface ClassLessonsTabProps {
  cls: AcademyClass
  /** J-F75: an exam was added, changed or deleted from a lesson card — the page's exams tab reads its list again. */
  onExamsChanged?: () => void
}

export function ClassLessonsTab({ cls, onExamsChanged }: ClassLessonsTabProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message, modal } = App.useApp()
  const { hasPermission } = useAuth()
  const classOpen = OPEN_FOR_LESSONS.includes(cls.status)
  const canManageLessons = hasPermission('lessons.manage')
  const canAddExam = hasPermission('exams.manage')
  const canAdd = canManageLessons && classOpen
  // J-F75: the buttons of a card — in an open class (a closed one takes no change), for whoever holds one of their keys.
  const showActions = classOpen && (canManageLessons || canAddExam)
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState<{ key: number; items: Lesson[]; error: unknown }>({ key: -1, items: [], error: null })
  // The lesson whose drawer is open, and whether it opens on its edit form («تعديل»).
  const [opened, setOpened] = useState<{ id: string; edit: boolean } | null>(null)
  const [creating, setCreating] = useState(false)
  const [examFor, setExamFor] = useState<Lesson | null>(null)
  const [openExamId, setOpenExamId] = useState<string | null>(null)
  const loading = state.key !== reloadTick

  useEffect(() => {
    const controller = new AbortController()
    listLessons({ classId: cls.id, order: 'asc', limit: PAGE }, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setState({ key: reloadTick, items: list.items, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ key: reloadTick, items: [], error })
      })
    return () => controller.abort()
  }, [cls.id, reloadTick])

  const reload = () => setReloadTick((tick) => tick + 1)

  const confirmDelete = (lesson: Lesson) => {
    modal.confirm({
      title: t('classPage.lessons.deleteConfirmTitle', { title: lessonTitle(lesson, language) }),
      content: t('classPage.lessons.deleteConfirmContent'),
      okText: t('classPage.lessons.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await deleteLesson(lesson.id)
          message.success(t('lessons.done.delete'))
        } catch (caught) {
          message.error(failureMessage(t, describeLessonsFailure(caught)))
        }
        // Deleted, or refused because it changed meanwhile (attendance taken, deleted elsewhere): the list as the server holds it.
        reload()
      },
    })
  }

  const actionsOf = (lesson: Lesson) => {
    const deleteBlock = lessonDeleteBlock(lesson)
    return (
      // A click here is for a button only — the card around opens the lesson drawer.
      <Flex gap={6} align="center" wrap onClick={(event) => event.stopPropagation()} data-testid={`class-lesson-actions-${lesson.id}`}>
        {canManageLessons ? (
          <>
            <CardAction
              icon={<EditOutlined />}
              label={t('classPage.lessons.edit')}
              blocked={lesson.status === 'cancelled' ? t('classPage.lessons.editCancelled') : null}
              onClick={() => setOpened({ id: lesson.id, edit: true })}
            />
            <CardAction danger icon={<DeleteOutlined />} label={t('classPage.lessons.delete')} blocked={deleteBlock ? t(deleteBlock) : null} onClick={() => confirmDelete(lesson)} />
          </>
        ) : null}
        {canAddExam ? <CardAction icon={<FileAddOutlined />} label={t('classPage.lessons.addExam')} blocked={null} onClick={() => setExamFor(lesson)} /> : null}
      </Flex>
    )
  }

  return (
    <Flex vertical gap={12}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {t('classPage.lessons.title')}
        </Typography.Title>
        <Flex gap={8}>
          <Button icon={<ReloadOutlined />} onClick={reload} aria-label={t('lessons.refresh')} />
          {canAdd ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              {t('lessons.addLesson')}
            </Button>
          ) : null}
        </Flex>
      </Flex>

      {state.error && !loading ? <Alert type="error" showIcon title={t('classPage.loadError')} /> : null}

      {loading && state.key === -1 ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : state.items.length === 0 && !state.error ? (
        <Empty description={canAdd ? t('classPage.lessons.emptyManage') : t('classPage.lessons.empty')} />
      ) : (
        state.items.map((lesson) => (
          <Card key={lesson.id} hoverable size="small" onClick={() => setOpened({ id: lesson.id, edit: false })} data-testid={`class-lesson-${lesson.id}`}>
            <Flex justify="space-between" align="center" wrap gap={10}>
              <Flex gap={16} align="center" wrap>
                <span data-testid={`class-lesson-when-${lesson.id}`}>
                  <Typography.Text>{formatLessonDay(lesson.startsAt, language, lesson.timeZone)}</Typography.Text>
                  <br />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {/* A plain LTR span: antd Typography's RTL class would reverse `10:00 – 11:30`. */}
                    <span dir="ltr">{formatLessonTimes(lesson.startsAt, lesson.endsAt, language, lesson.timeZone)}</span>
                  </Typography.Text>
                </span>
                <Typography.Text strong>
                  <bdi>{lessonTitle(lesson, language)}</bdi>
                </Typography.Text>
              </Flex>
              {showActions ? actionsOf(lesson) : null}
            </Flex>
          </Card>
        ))
      )}

      <LessonDrawer
        lessonId={opened?.id ?? null}
        startEditing={opened?.edit ?? false}
        onClose={() => setOpened(null)}
        onUpdated={(updated) => setState((current) => ({ ...current, items: current.items.map((item) => (item.id === updated.id ? updated : item)) }))}
        onDeleted={() => {
          setOpened(null)
          reload()
        }}
      />
      <CreateLessonModal
        open={creating}
        initialClass={cls}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false)
          message.success(t('lessons.create.created', { title: lessonTitle(created, language) }))
          reload()
          setOpened({ id: created.id, edit: false })
        }}
      />
      <CreateExamModal
        open={examFor !== null}
        fixed={examFor ? { classId: cls.id, place: t('classPage.forClass', { name: localizedLabel(cls.name, language) }), lesson: examFor } : undefined}
        onClose={() => setExamFor(null)}
        onCreated={(created) => {
          setExamFor(null)
          message.success(t('exams.create.created', { title: examTitle(created, language) }))
          onExamsChanged?.()
          // The new draft opens at once, so the teacher completes it (questions, schedule) without leaving the lessons.
          setOpenExamId(created.id)
        }}
      />
      <ExamDrawer
        examId={openExamId}
        onClose={() => setOpenExamId(null)}
        onUpdated={() => onExamsChanged?.()}
        onDeleted={() => {
          setOpenExamId(null)
          onExamsChanged?.()
        }}
      />
    </Flex>
  )
}

interface CardActionProps {
  icon: ReactNode
  label: string
  /** Why the lesson refuses this action now (the button is greyed out and the tip says why), or null. */
  blocked: string | null
  danger?: boolean
  onClick: () => void
}

function CardAction({ icon, label, blocked, danger = false, onClick }: CardActionProps) {
  const button = (
    <Button size="small" icon={icon} danger={danger} disabled={blocked !== null} onClick={onClick}>
      {label}
    </Button>
  )
  if (blocked === null) return button
  // A disabled button gets no pointer events in every browser: the tip hangs on a wrapper (antd's own advice).
  return (
    <Tooltip title={blocked}>
      <span style={{ display: 'inline-flex', cursor: 'not-allowed' }}>{button}</span>
    </Tooltip>
  )
}
