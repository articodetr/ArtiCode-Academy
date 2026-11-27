// The list of «my lessons» (J-F11, API-101), shared since J-F62 (CH-0238) by /my-lessons and by one class's page
// /my-classes/:classId. One row per lesson × student (two children in one class = two rows; the page size counts
// lessons), with the lesson's status — cancelled lessons included — the teacher by name only, the room and meeting
// link, and that student's own attendance and lateness (never the teacher's note: the DTO does not carry it). Each row
// shows its times in the lesson's own `timeZone`, and «today» and the range days are the academy's days (D-R41 — J-F28).
// With a `classId` the class column and filter go away, the student filter offers that class's students only and the
// list opens on all of the class's lessons.
import { LinkOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Flex, Segmented, Select, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { LESSON_STATUSES } from '../api/lessons'
import type { MyLessonItem } from '../api/myLessons'
import { ATTENDANCE_STATUS_COLORS } from '../attendance/attendance.format'
import { useAuth } from '../auth/auth-context'
import { StatusTag } from '../components/StatusTag'
import type { useMyClasses } from '../enrollments/useMyClasses'
import { useLocalized } from '../i18n/useLocalized'
import { displayNameOf, localizedLabel } from '../users/users.format'
import { DateFilter } from './DateFilter'
import { LessonWhen, LessonZoneNote } from './LessonZone'
import { describeLessonsFailure, failureMessage } from './lessons.errors'
import { formatLessonDateTime, lessonRoomLabel, lessonTitle, syllabusItemLabel } from './lessons.format'
import {
  CLASS_LESSON_VIEWS,
  MY_LESSON_PAGE_SIZES,
  MY_LESSON_VIEWS,
  attendanceCellOf,
  classLessonsFilters,
  classOptionsOf,
  isNarrowed,
  myLessonKey,
  showsStudents,
  studentOptionsOf,
} from './myLessons.view'
import type { MyLessonView, MyLessonsFilters } from './myLessons.view'
import { useMyLessons } from './useMyLessons'
import { LessonAttachmentLinks } from './LessonAttachmentLinks'

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

interface MyLessonsListProps {
  /** The zone of «today» and the range days: the academy's, or this device's when the academy could not be read. */
  dayZone: string
  /** «My classes» (API-060), read by the page: the filter options, and the class's header on a class's page. */
  myClasses: ReturnType<typeof useMyClasses>
  /** One class's page (J-F62). */
  classId?: string
  /** The student whose row opened the class's page; read once, like every initial filter. */
  initialStudentId?: string
}

export function MyLessonsList({ dayZone, myClasses, classId, initialStudentId }: MyLessonsListProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { user } = useAuth()
  const roleKeys = user?.roles ?? []
  const list = useMyLessons(dayZone, classId ? classLessonsFilters(classId, initialStudentId) : undefined)
  const { filters } = list
  const owned = classId ? myClasses.items.filter((item) => item.class.id === classId) : myClasses.items
  const students = studentOptionsOf(owned)
  const classes = classOptionsOf(myClasses.items, filters.studentId)
  const showStudent = showsStudents(roleKeys, list.items)
  // The student filter helps whoever owns lessons through more than one student (a guardian, or a student who is also
  // one). Inside one class a single owner has nothing to choose between.
  const canPickStudent = students.length > 1 || (!classId && students.some((student) => student.relation === 'child'))
  const views = classId ? CLASS_LESSON_VIEWS : MY_LESSON_VIEWS

  const allColumns: NonNullable<TableProps<MyLessonItem>['columns']> = [
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
          <Typography.Text strong>
            <bdi dir="ltr">{row.class.code}</bdi>
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
          {row.room ? <Typography.Text><bdi dir="ltr">{lessonRoomLabel(row.room, language)}</bdi></Typography.Text> : <Typography.Text type="secondary">{t('lessons.drawer.noRoom')}</Typography.Text>}
          {row.meetingUrl && row.status !== 'cancelled' ? (
            <>
              <br />
              <Typography.Link href={row.meetingUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>
                <LinkOutlined /> {t('lessons.drawer.openMeeting')}
              </Typography.Link>
            </>
          ) : null}
          {/* J-F77: the video and the books and links of the lesson. */}
          {row.status !== 'cancelled' && (row.recordingUrl || row.attachments.length > 0) ? (
            <div style={{ fontSize: 12 }}>
              <LessonAttachmentLinks recordingUrl={row.recordingUrl} attachments={row.attachments} />
            </div>
          ) : null}
        </span>
      ),
    },
    { title: t('myLessons.columns.lessonStatus'), key: 'status', render: (_, row) => <StatusTag value={row.status} /> },
    { title: t('myLessons.columns.attendance'), key: 'attendance', render: (_, row) => <AttendanceCell item={row} /> },
  ]
  // A class's page names its class in the header: the column would repeat it on every row.
  const columns = classId ? allColumns.filter((column) => column.key !== 'class') : allColumns
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
  // On a class's page the class is the page, not a filter the user could clear.
  const emptyText = isNarrowed(classId ? { ...filters, classId: undefined } : filters)
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
    <Card>
      <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
        {/* On a phone the views scroll in their own box: wider than the card, they would push the whole page sideways. */}
        <div style={{ maxWidth: '100%', overflowX: 'auto' }} data-testid="my-lesson-views">
          <Segmented<MyLessonView>
            aria-label={t('myLessons.views.label')}
            value={filters.view}
            onChange={(view) => list.setFilters({ view })}
            options={views.map((view) => ({ value: view, label: t(`myLessons.views.${view}`) }))}
          />
        </div>
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
            style={{ minWidth: 'min(200px, 100%)' }}
          />
        ) : null}
        {classId ? null : (
          <Select<string | undefined>
            allowClear
            placeholder={t('myLessons.filters.allClasses')}
            aria-label={t('myLessons.filters.class')}
            value={filters.classId}
            onChange={(value) => list.setFilters({ classId: value })}
            options={classes.map((option) => ({ value: option.id, label: `${option.code} — ${localizedLabel(option.name, language)}` }))}
            style={{ minWidth: 'min(220px, 100%)' }}
          />
        )}
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
        // `true`, not 'max-content' (KI-120, the users and roster tables — KI-094/KI-116): the table keeps its card's width
        // wherever its columns can wrap to fit, so the attendance column is in view at 1366 px — 'max-content' sized the
        // table to its one-line content and started that column off-screen — and scrolls in its own box only when it
        // cannot fit (a phone).
        scroll={{ x: true }}
        locale={{ emptyText }}
        expandable={{
          rowExpandable: (row) => row.description !== null,
          expandedRowRender: (row) =>
            row.description ? (
              // A box of no width of its own that grows to the cell's: a long description wraps at the table's width
              // instead of widening the table to its one-line length (the «my assignments» fix, QA 2026-11-17).
              <div style={{ width: 0, minWidth: '100%' }} data-testid="my-lesson-description">
                <Typography.Paragraph style={{ margin: 0 }}>{localizedLabel(row.description, language)}</Typography.Paragraph>
              </div>
            ) : null,
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
  )
}
