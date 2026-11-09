// Lessons list (MOD-06 — J-F09): GET /api/lessons with class/teacher/status/
// date filters, an order and keyset pagination; a detail drawer and a creation
// modal for holders of `lessons.manage`. Holders of `lessons.read` without
// `classes.manage` (teachers by seed) receive only the lessons of the classes
// they are assigned to (D-R16) — the server decides, the page only hides what
// they cannot use. Students hold `lessons.read` without any assignment: their
// own lessons — and a guardian's children's — are in «my lessons» (/my-lessons,
// API-101 — J-F11), which the hint links to for the holders of those role keys.
import { LinkOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Select, Space, Table, Tooltip, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { LESSON_STATUSES } from '../api/lessons'
import type { Lesson } from '../api/lessons'
import { useAuth } from '../auth/auth-context'
import { TeacherPicker } from '../classes/ClassPickers'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { canAccess } from '../layout/navigation'
import { CreateLessonModal } from '../lessons/CreateLessonModal'
import { LessonDrawer } from '../lessons/LessonDrawer'
import { describeLessonsFailure, failureMessage } from '../lessons/lessons.errors'
import { formatLessonDay, formatLessonTimes, lessonRoomLabel, lessonTitle } from '../lessons/lessons.format'
import { LESSON_PAGE_SIZES, defaultLessonFilters, hasActiveLessonFilters, useLessonsList } from '../lessons/useLessonsList'
import type { LessonsListFilters } from '../lessons/useLessonsList'
import { ClassPicker } from '../timetable/TimetablePickers'
import { isCalendarDate } from '../timetable/timetable.dates'
import { localizedLabel } from '../users/users.format'

function DateFilter({ value, onChange, label }: { value: string | undefined; onChange: (value: string | undefined) => void; label: string }) {
  return <input type="date" aria-label={label} className="ant-input" value={value ?? ''} onChange={(event) => onChange(isCalendarDate(event.target.value) ? event.target.value : undefined)} style={{ width: 170 }} />
}

export function LessonsPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission, user } = useAuth()
  const canManage = hasPermission('lessons.manage')
  const seesEveryClass = hasPermission('classes.manage')
  // «My lessons» opens to the `student`/`guardian` role keys (its nav entry decides — J-F11).
  const seesMyLessons = user ? canAccess(user, 'myLessons') : false
  // GET /api/classes needs classes.read at the controller (classes.manage alone gets 403): the class filter and the
  // class picker of a new lesson follow it.
  const canPickClass = hasPermission('classes.read')
  const canPickTeacher = seesEveryClass && hasPermission('users.read')
  const [defaults] = useState(() => defaultLessonFilters())
  const list = useLessonsList(defaults)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const columns: TableProps<Lesson>['columns'] = [
    {
      title: t('lessons.columns.when'),
      key: 'when',
      render: (_, row) => (
        <span>
          <Typography.Text>{formatLessonDay(row.startsAt, language)}</Typography.Text>
          <br />
          <Typography.Text type="secondary" dir="ltr" style={{ fontSize: 12 }}>
            {formatLessonTimes(row.startsAt, row.endsAt, language)}
          </Typography.Text>
        </span>
      ),
    },
    {
      title: t('lessons.columns.lesson'),
      key: 'lesson',
      render: (_, row) => (
        <span>
          <Typography.Text strong>{lessonTitle(row, language)}</Typography.Text>
          <br />
          <StatusTag value={row.deliveryMode} />
        </span>
      ),
    },
    {
      title: t('lessons.columns.class'),
      key: 'class',
      render: (_, row) => (
        <span>
          <Typography.Text dir="ltr" strong>
            {row.class.code}
          </Typography.Text>
          <br />
          <Typography.Text type="secondary">{localizedLabel(row.class.name, language)}</Typography.Text>
        </span>
      ),
    },
    { title: t('lessons.columns.course'), key: 'course', render: (_, row) => localizedLabel(row.class.course.name, language) },
    {
      title: t('lessons.columns.teacher'),
      key: 'teacher',
      render: (_, row) => row.teacher?.fullName ?? <Typography.Text type="secondary">{t('lessons.drawer.noTeacher')}</Typography.Text>,
    },
    {
      title: t('lessons.columns.place'),
      key: 'place',
      render: (_, row) => (
        <span>
          {row.room ? <Typography.Text dir="ltr">{lessonRoomLabel(row.room, language)}</Typography.Text> : <Typography.Text type="secondary">{t('lessons.drawer.noRoom')}</Typography.Text>}
          {row.meetingUrl ? (
            <>
              <br />
              <Typography.Link href={row.meetingUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} style={{ fontSize: 12 }}>
                <LinkOutlined /> {t('lessons.drawer.openMeeting')}
              </Typography.Link>
            </>
          ) : null}
        </span>
      ),
    },
    { title: t('lessons.columns.status'), key: 'status', render: (_, row) => <StatusTag value={row.status} /> },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          onClick={(event) => {
            event.stopPropagation()
            setSelectedId(row.id)
          }}
          aria-label={`${t('common.view')}: ${lessonTitle(row, language)}`}
        >
          {t('common.view')}
        </Button>
      ),
    },
  ]

  const failure = list.error ? describeLessonsFailure(list.error) : null
  const filtered = hasActiveLessonFilters(list.filters, defaults)
  const emptyText = filtered ? t('lessons.emptyFiltered') : seesEveryClass ? t('lessons.empty') : t('lessons.emptyAssigned')

  return (
    <>
      <PageHeader
        title={t('lessons.title')}
        subtitle={t('lessons.subtitle')}
        extra={
          canManage ? (
            // A disabled button swallows the pointer events, so the hint sits on a wrapper.
            <Tooltip title={canPickClass ? undefined : t('lessons.hints.needsClassesRead')}>
              <span style={{ display: 'inline-block' }}>
                <Button type="primary" icon={<PlusOutlined />} disabled={!canPickClass} onClick={() => setCreating(true)}>
                  {t('lessons.addLesson')}
                </Button>
              </span>
            </Tooltip>
          ) : null
        }
      />

      {!seesEveryClass ? (
        <Alert
          type="info"
          showIcon
          title={canPickClass ? t('lessons.readOnlyHint') : t('lessons.learnerHint')}
          description={seesMyLessons ? <Link to="/my-lessons">{t('lessons.myLessonsLink')}</Link> : undefined}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Card>
        <Flex gap={12} wrap style={{ marginBottom: 16 }}>
          {canPickClass ? (
            <ClassPicker
              allowClear
              placeholder={t('lessons.filters.allClasses')}
              aria-label={t('lessons.columns.class')}
              value={list.filters.classId}
              onChange={(value) => list.setFilters({ classId: value })}
              style={{ minWidth: 240 }}
            />
          ) : null}
          {canPickTeacher ? (
            <TeacherPicker
              allowClear
              placeholder={t('lessons.filters.allTeachers')}
              aria-label={t('lessons.columns.teacher')}
              value={list.filters.teacherId}
              onChange={(value) => list.setFilters({ teacherId: value })}
              style={{ minWidth: 200 }}
            />
          ) : null}
          <Select<LessonsListFilters['status']>
            allowClear
            placeholder={t('lessons.filters.allStatuses')}
            aria-label={t('lessons.columns.status')}
            value={list.filters.status}
            onChange={(value) => list.setFilters({ status: value })}
            options={LESSON_STATUSES.filter((status) => status !== 'in_progress').map((status) => ({ value: status, label: t(`labels.${status}`) }))}
            style={{ minWidth: 150 }}
          />
          <DateFilter label={t('lessons.filters.from')} value={list.filters.from} onChange={(value) => list.setFilters({ from: value })} />
          <DateFilter label={t('lessons.filters.to')} value={list.filters.to} onChange={(value) => list.setFilters({ to: value })} />
          <Select<LessonsListFilters['order']>
            value={list.filters.order}
            aria-label={t('lessons.filters.order')}
            onChange={(value) => list.setFilters({ order: value })}
            options={[
              { value: 'asc', label: t('lessons.filters.orderAsc') },
              { value: 'desc', label: t('lessons.filters.orderDesc') },
            ]}
            style={{ minWidth: 150 }}
          />
          <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('lessons.refresh')} />
        </Flex>

        {failure ? (
          <Alert
            type="error"
            showIcon
            title={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={() => (failure.key.endsWith('cursor_invalid') ? list.setFilters({}) : list.reload())}>
                {t('lessons.refresh')}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<Lesson>
          rowKey="id"
          columns={columns}
          dataSource={list.items}
          loading={list.loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText }}
          onRow={(row) => ({ onClick: () => setSelectedId(row.id), style: { cursor: 'pointer' } })}
        />

        <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
          <Space>
            <Typography.Text type="secondary">{t('lessons.pagination.page', { page: list.pageNumber })}</Typography.Text>
            <Select<LessonsListFilters['limit']>
              size="small"
              value={list.filters.limit}
              aria-label={t('lessons.pagination.pageSizeLabel')}
              onChange={(value) => list.setFilters({ limit: value })}
              options={LESSON_PAGE_SIZES.map((size) => ({ value: size, label: t('lessons.pagination.pageSize', { count: size }) }))}
            />
          </Space>
          <Space>
            <Button onClick={list.back} disabled={!list.canGoBack || list.loading}>
              {t('lessons.pagination.previous')}
            </Button>
            <Button onClick={list.next} disabled={!list.nextCursor || list.loading}>
              {t('lessons.pagination.next')}
            </Button>
          </Space>
        </Flex>
      </Card>

      <LessonDrawer lessonId={selectedId} onClose={() => setSelectedId(null)} onUpdated={list.replaceItem} onDeleted={list.removeItem} />

      <CreateLessonModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false)
          list.reload()
          setSelectedId(created.id)
          message.success(t('lessons.create.created', { title: lessonTitle(created, language) }))
        }}
      />
    </>
  )
}
