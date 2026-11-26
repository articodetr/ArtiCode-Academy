// «الدروس» of a class's page (CH-0374): the class's lessons (API-093 with `classId`), oldest first, each opening the
// lesson drawer (details, edit, status, attendance); «إضافة درس» adds one straight into this class.
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Empty, Flex, Skeleton, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AcademyClass } from '../api/classes'
import { listLessons } from '../api/lessons'
import type { Lesson } from '../api/lessons'
import { useAuth } from '../auth/auth-context'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { CreateLessonModal } from '../lessons/CreateLessonModal'
import { LessonDrawer } from '../lessons/LessonDrawer'
import { LessonWhen } from '../lessons/LessonZone'
import { lessonRoomLabel, lessonTitle } from '../lessons/lessons.format'

const PAGE = 100
const OPEN_FOR_LESSONS = ['planned', 'open', 'running']

export function ClassLessonsTab({ cls }: { cls: AcademyClass }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const canAdd = hasPermission('lessons.manage') && OPEN_FOR_LESSONS.includes(cls.status)
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState<{ key: number; items: Lesson[]; error: unknown }>({ key: -1, items: [], error: null })
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
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
          <Card key={lesson.id} hoverable size="small" onClick={() => setOpenId(lesson.id)} data-testid={`class-lesson-${lesson.id}`}>
            <Flex justify="space-between" align="center" wrap gap={10}>
              <Flex gap={16} align="center" wrap>
                <LessonWhen startsAt={lesson.startsAt} endsAt={lesson.endsAt} timeZone={lesson.timeZone} />
                <Flex vertical gap={2}>
                  <Typography.Text strong>
                    <bdi>{lessonTitle(lesson, language)}</bdi>
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    {lesson.teacher?.fullName ?? t('lessons.drawer.noTeacher')}
                    {' · '}
                    {lesson.room ? <bdi dir="ltr">{lessonRoomLabel(lesson.room, language)}</bdi> : t('lessons.drawer.noRoom')}
                  </Typography.Text>
                </Flex>
              </Flex>
              <Flex gap={10} align="center" wrap>
                <Typography.Text style={{ fontSize: 13 }}>{t('classPage.lessons.attendance', { count: lesson.attendance.recorded })}</Typography.Text>
                <StatusTag value={lesson.status} />
              </Flex>
            </Flex>
          </Card>
        ))
      )}

      <LessonDrawer
        lessonId={openId}
        onClose={() => setOpenId(null)}
        onUpdated={(updated) => setState((current) => ({ ...current, items: current.items.map((item) => (item.id === updated.id ? updated : item)) }))}
        onDeleted={() => {
          setOpenId(null)
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
          setOpenId(created.id)
        }}
      />
    </Flex>
  )
}
