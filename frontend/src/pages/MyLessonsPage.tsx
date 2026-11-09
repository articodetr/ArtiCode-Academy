// «My lessons» (MOD-06 — J-F11): GET /api/me/lessons (API-101) for a student
// (the lessons of their own classes, `relation: self`) and a guardian (those of
// the classes their linked children are enrolled in, `relation: child`, while
// they hold the `guardian` role — the server decides). Ownership, no permission
// key: one row per lesson × student (two children in one class = two rows; the
// page size counts lessons), with the lesson's status — cancelled lessons
// included — the teacher by name only, the room and meeting link, and that
// student's own attendance status and lateness (never the teacher's note: the
// DTO does not carry it). The student and class filters read «my classes»
// (API-060 — the same ownership). The route opens to the holders of the
// `student` or `guardian` server role key only (nav entry `myLessons`, like
// «my classes»); a learner without an owned enrollment gets an empty list, and
// the page says why. Each row shows its times in the lesson's own `timeZone`,
// and «today» and the range days are the academy's days (D-R41 — J-F28); a
// note says so when a zone differs from this device's. The list waits for the
// academy's zone (the shared API-035 reading), as /lessons does.
import { LinkOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Flex, Segmented, Select, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { LESSON_STATUSES } from '../api/lessons'
import type { MyLessonItem } from '../api/myLessons'
import { ATTENDANCE_STATUS_COLORS } from '../attendance/attendance.format'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { useMyClasses } from '../enrollments/useMyClasses'
import { useLocalized } from '../i18n/useLocalized'
import { DateFilter } from '../lessons/DateFilter'
import { LessonWhen, LessonZoneNote } from '../lessons/LessonZone'
import { describeLessonsFailure, failureMessage } from '../lessons/lessons.errors'
import { formatLessonDateTime, lessonRoomLabel, lessonTitle, syllabusItemLabel } from '../lessons/lessons.format'
import {
  MY_LESSON_PAGE_SIZES,
  MY_LESSON_VIEWS,
  attendanceCellOf,
  classOptionsOf,
  isNarrowed,
  myLessonKey,
  showsStudents,
  studentOptionsOf,
} from '../lessons/myLessons.view'
import type { MyLessonView, MyLessonsFilters } from '../lessons/myLessons.view'
import { useAcademyZone } from '../lessons/useAcademyZone'
import { useMyLessons } from '../lessons/useMyLessons'
import { displayNameOf, localizedLabel } from '../users/users.format'

function AttendanceCell({ item }: { item: MyLessonItem }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const cell = attendanceCellOf(item)
  if (cell.kind === 'recorded') {
    const label = t(`lessons.attendance.${cell.status}`)
    return (
      <Tag
        color={ATTENDANCE_STATUS_COLORS[cell.status]}
        title={item.attendance ? t('myLessons.attendance.recordedAt', { date: formatLessonDateTime(item.attendance.recordedAt, language, item.timeZone) }) : undefined}
      >
        {cell.minutesLate !== null ? `${label} · ${t('myLessons.attendance.minutes', { count: cell.minutesLate })}` : label}
      </Tag>
    )
  }
  if (cell.kind === 'cancelled') return <Typography.Text type="secondary" title={t('myLessons.attendance.cancelled')}>—</Typography.Text>
  return <Typography.Text type="secondary">{t(cell.kind === 'not_started' ? 'myLessons.attendance.notStarted' : 'myLessons.attendance.notRecorded')}</Typography.Text>
}

export function MyLessonsPage() {
  const { t } = useTranslation()
  const zone = useAcademyZone()
  // Keyed by the zone, so «today» is always the academy's day of the reading on screen.
  if (zone.settled) return <MyLessonsScreen key={zone.timeZone} dayZone={zone.timeZone} />
  return (
    <>
      <PageHeader title={t('myLessons.title')} subtitle={t('myLessons.subtitle')} />
      <Card loading />
    </>
  )
}

/** The page once the zone of its days is known: the academy's, or this device's when the academy could not be read. */
function MyLessonsScreen({ dayZone }: { dayZone: string }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { user } = useAuth()
  const roleKeys = user?.roles ?? []
  const list = useMyLessons(dayZone)
  const myClasses = useMyClasses()
  const { filters } = list
  const students = studentOptionsOf(myClasses.items)
  const classes = classOptionsOf(myClasses.items, filters.studentId)
  const showStudent = showsStudents(roleKeys, list.items)
  // The student filter helps whoever owns lessons through more than one student (a guardian, or a student who is also one).
  const canPickStudent = students.length > 1 || students.some((student) => student.relation === 'child')

  const columns: TableProps<MyLessonItem>['columns'] = [
    {
      title: t('lessons.columns.when'),
      key: 'when',
      render: (_, row) => <LessonWhen startsAt={row.startsAt} endsAt={row.endsAt} timeZone={row.timeZone} />,
    },
    {
      title: t('lessons.columns.lesson'),
      key: 'lesson',
      render: (_, row) => (
        <span>
          <Typography.Text strong delete={row.status === 'cancelled'}>
            {lessonTitle(row, language)}
          </Typography.Text>
          {row.syllabusItem ? (
            <>
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {syllabusItemLabel(row.syllabusItem, language)}
              </Typography.Text>
            </>
          ) : null}
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
          <Typography.Text type="secondary">{`${localizedLabel(row.class.name, language)} · ${localizedLabel(row.class.course.name, language)}`}</Typography.Text>
        </span>
      ),
    },
    {
      title: t('lessons.columns.teacher'),
      key: 'teacher',
      render: (_, row) => (row.teacher ? displayNameOf(row.teacher) : <Typography.Text type="secondary">{t('lessons.drawer.noTeacher')}</Typography.Text>),
    },
    {
      title: t('lessons.columns.place'),
      key: 'place',
      render: (_, row) => (
        <span>
          {row.room ? <Typography.Text dir="ltr">{lessonRoomLabel(row.room, language)}</Typography.Text> : <Typography.Text type="secondary">{t('lessons.drawer.noRoom')}</Typography.Text>}
          {row.meetingUrl && row.status !== 'cancelled' ? (
            <>
              <br />
              <Typography.Link href={row.meetingUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>
                <LinkOutlined /> {t('lessons.drawer.openMeeting')}
              </Typography.Link>
            </>
          ) : null}
        </span>
      ),
    },
    { title: t('myLessons.columns.lessonStatus'), key: 'status', render: (_, row) => <StatusTag value={row.status} /> },
    { title: t('myLessons.columns.attendance'), key: 'attendance', render: (_, row) => <AttendanceCell item={row} /> },
  ]
  if (showStudent) {
    columns.splice(1, 0, {
      title: t('myLessons.columns.student'),
      key: 'student',
      render: (_, row) => (
        <Space size={4} wrap>
          <span>{displayNameOf(row.student)}</span>
          <Tag color={row.relation === 'self' ? 'green' : 'blue'}>{t(`myClasses.relation.${row.relation}`)}</Tag>
        </Space>
      ),
    })
  }

  const failure = list.error ? describeLessonsFailure(list.error) : null
  const noEnrollment = !myClasses.loading && !myClasses.error && myClasses.items.length === 0
  const emptyText = isNarrowed(filters)
    ? t('myLessons.empty.filtered')
    : noEnrollment
      ? t('myLessons.empty.noEnrollment')
      : filters.view === 'range'
        ? t('myLessons.empty.all')
        : t(`myLessons.empty.${filters.view}`)

  const selectStudent = (studentId: string | undefined) => {
    // A class the newly chosen student is not enrolled in would match nothing: drop it.
    const stillOwned = !filters.classId || classOptionsOf(myClasses.items, studentId).some((option) => option.id === filters.classId)
    list.setFilters({ studentId, classId: stillOwned ? filters.classId : undefined })
  }

  return (
    <>
      <PageHeader title={t('myLessons.title')} subtitle={t('myLessons.subtitle')} />

      <Card>
        <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
          <Segmented<MyLessonView>
            aria-label={t('myLessons.views.label')}
            value={filters.view}
            onChange={(view) => list.setFilters({ view })}
            options={MY_LESSON_VIEWS.map((view) => ({ value: view, label: t(`myLessons.views.${view}`) }))}
          />
          {canPickStudent ? (
            <Select<string | undefined>
              allowClear
              placeholder={t('myLessons.filters.allStudents')}
              aria-label={t('myLessons.filters.student')}
              value={filters.studentId}
              onChange={(value) => selectStudent(value)}
              options={students.map((student) => ({
                value: student.id,
                label: student.relation === 'self' ? `${displayNameOf(student)} (${t('myClasses.relation.self')})` : displayNameOf(student),
              }))}
              style={{ minWidth: 200 }}
            />
          ) : null}
          <Select<string | undefined>
            allowClear
            placeholder={t('myLessons.filters.allClasses')}
            aria-label={t('myLessons.filters.class')}
            value={filters.classId}
            onChange={(value) => list.setFilters({ classId: value })}
            options={classes.map((option) => ({ value: option.id, label: `${option.code} — ${localizedLabel(option.name, language)}` }))}
            style={{ minWidth: 220 }}
          />
          <Select<MyLessonsFilters['status']>
            allowClear
            placeholder={t('lessons.filters.allStatuses')}
            aria-label={t('myLessons.filters.status')}
            value={filters.status}
            onChange={(value) => list.setFilters({ status: value })}
            options={LESSON_STATUSES.filter((status) => status !== 'in_progress').map((status) => ({ value: status, label: t(`labels.${status}`) }))}
            style={{ minWidth: 150 }}
          />
          {filters.view === 'range' ? (
            <>
              <DateFilter label={t('lessons.filters.from')} value={filters.from} onChange={(value) => list.setFilters({ from: value })} />
              <DateFilter label={t('lessons.filters.to')} value={filters.to} onChange={(value) => list.setFilters({ to: value })} />
              <Select<MyLessonsFilters['order']>
                value={filters.order}
                aria-label={t('lessons.filters.order')}
                onChange={(value) => list.setFilters({ order: value })}
                options={[
                  { value: 'asc', label: t('lessons.filters.orderAsc') },
                  { value: 'desc', label: t('lessons.filters.orderDesc') },
                ]}
                style={{ minWidth: 150 }}
              />
            </>
          ) : null}
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              list.reload()
              myClasses.reload()
            }}
            aria-label={t('myLessons.refresh')}
          />
        </Flex>

        <LessonZoneNote timeZones={list.items.map((row) => row.timeZone)} dayZone={dayZone} />

        {myClasses.error ? <Alert type="warning" showIcon title={t('myLessons.optionsFailed')} style={{ marginBottom: 16 }} /> : null}

        {failure ? (
          <Alert
            type="error"
            showIcon
            title={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={() => (failure.key.endsWith('cursor_invalid') ? list.setFilters({}) : list.reload())}>
                {t('myLessons.refresh')}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<MyLessonItem>
          rowKey={myLessonKey}
          columns={columns}
          dataSource={list.items}
          loading={list.loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText }}
          expandable={{
            rowExpandable: (row) => row.description !== null,
            expandedRowRender: (row) => (row.description ? <Typography.Paragraph style={{ margin: 0 }}>{localizedLabel(row.description, language)}</Typography.Paragraph> : null),
          }}
        />

        <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
          <Space wrap>
            <Typography.Text type="secondary">{t('lessons.pagination.page', { page: list.pageNumber })}</Typography.Text>
            <Select<MyLessonsFilters['limit']>
              size="small"
              value={filters.limit}
              aria-label={t('lessons.pagination.pageSizeLabel')}
              onChange={(value) => list.setFilters({ limit: value })}
              options={MY_LESSON_PAGE_SIZES.map((size) => ({ value: size, label: t('lessons.pagination.pageSize', { count: size }) }))}
            />
            {showStudent ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('myLessons.limitNote')}
              </Typography.Text>
            ) : null}
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
    </>
  )
}
