// «My exams» (MOD-09 — J-F50): GET /api/me/exams (API-121) for a student (the
// exams of their own classes, `relation: self`) and a guardian (those of the
// classes their linked children are enrolled in, `relation: child`, while
// they hold the `guardian` role — the server decides). Ownership, no
// permission key (D-R48): one row per exam × student (two children in one
// class = two rows; the page size counts exams), scheduled and published
// exams only — never a draft — with the date in the exam's own zone (D-R41,
// named when it is not this device's) and its duration, the type, the class
// and course, the status, and that student's own result once the results are
// published (the server sends none before — D-R47): its status, the score out
// of the maximum and the teacher's feedback. The description, the
// informational pass score, the linked lesson and the publication date are in
// the expanded row. The filters are the contract's: student and class (their
// options read «my classes», API-060 — the same ownership), status, a date
// range read in the academy's zone (as on /exams) and the order. Every number
// is the server's. The route opens to the holders of the `student` or
// `guardian` server role key only (nav entry `myExams`, like «my
// assignments»).
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Descriptions, Flex, Select, Space, Table, Tag, Typography } from 'antd'
import type { DescriptionsProps, TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../academy/useAcademy'
import { MY_EXAM_STATUSES } from '../api/myExams'
import type { MyExamItem } from '../api/myExams'
import { formatZonedDateTime, formatZonedDay } from '../assignments/assignments.format'
import { academyZoneOf, differsFromDevice } from '../assignments/assignments.zone'
import { feedbackExcerpt, scoreText } from '../assignments/myAssignments.view'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { useMyClasses } from '../enrollments/useMyClasses'
import { describeExamsFailure, failureMessage, isExamsFailure } from '../exams/exams.errors'
import { RESULT_STATUS_COLORS, examTitle } from '../exams/exams.format'
import { MY_EXAM_PAGE_SIZES, defaultMyExamsFilters, isNarrowed, myExamKey, resultCellOf } from '../exams/myExams.view'
import type { MyExamsFilters } from '../exams/myExams.view'
import { useMyExams } from '../exams/useMyExams'
import { useLocalized } from '../i18n/useLocalized'
import { classOptionsOf, showsStudents, studentOptionsOf } from '../lessons/myLessons.view'
import { isCalendarDate } from '../timetable/timetable.dates'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { displayNameOf, localizedLabel } from '../users/users.format'

/** A control keeps its width on a wide screen and narrows with a phone's (no sideways page scroll). */
function fluid(width: number) {
  return { width, maxWidth: '100%' }
}

function DateFilter({ value, onChange, label }: { value: string | undefined; onChange: (value: string | undefined) => void; label: string }) {
  return (
    <input
      type="date"
      aria-label={label}
      className="ant-input"
      value={value ?? ''}
      onChange={(event) => onChange(isCalendarDate(event.target.value) ? event.target.value : undefined)}
      style={fluid(170)}
    />
  )
}

function WhenCell({ item }: { item: MyExamItem }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  if (!item.scheduledAt) return <Typography.Text type="secondary">{t('exams.drawer.noDate')}</Typography.Text>
  return (
    <span>
      <Typography.Text>{formatZonedDateTime(item.scheduledAt, item.timeZone, language)}</Typography.Text>
      {item.durationMinutes !== null ? (
        <>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('exams.drawer.minutes', { count: item.durationMinutes })}
          </Typography.Text>
        </>
      ) : null}
      {differsFromDevice(item.timeZone) ? (
        <>
          <br />
          <span dir="ltr" style={{ fontSize: 12, opacity: 0.65 }}>
            {item.timeZone}
          </span>
        </>
      ) : null}
    </span>
  )
}

function ResultCell({ item }: { item: MyExamItem }) {
  const { t } = useTranslation()
  const cell = resultCellOf(item)
  if (cell.kind === 'awaiting') return <Typography.Text type="secondary">{t('myExams.result.awaiting')}</Typography.Text>
  if (cell.kind === 'none') return <Typography.Text type="secondary">{t('myExams.result.none')}</Typography.Text>
  const feedback = item.result?.feedback ?? null
  return (
    <span>
      <Space size={4} wrap>
        <Tag color={RESULT_STATUS_COLORS[cell.status]}>{t(`exams.results.status.${cell.status}`)}</Tag>
        {cell.score !== null ? (
          <Typography.Text strong>
            <span dir="ltr">{scoreText(cell.score, item.maxScore)}</span>
          </Typography.Text>
        ) : null}
      </Space>
      {feedback ? (
        <>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }} title={feedback}>
            {feedbackExcerpt(feedback)}
          </Typography.Text>
        </>
      ) : null}
    </span>
  )
}

/** The expanded row: what a learner may know about the exam beyond the table (learners never read API-114). */
function ExamDetails({ item }: { item: MyExamItem }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const items: DescriptionsProps['items'] = [
    {
      key: 'description',
      label: t('myExams.details.description'),
      children: item.description ? (
        // A plain element: antd Typography's RTL class would override dir="auto".
        <div dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
          {localizedLabel(item.description, language)}
        </div>
      ) : (
        <Typography.Text type="secondary">{t('myExams.details.noDescription')}</Typography.Text>
      ),
    },
    { key: 'maxScore', label: t('myExams.details.maxScore'), children: <span dir="ltr">{item.maxScore}</span> },
    ...(item.passScore !== null ? [{ key: 'passScore', label: t('myExams.details.passScore'), children: <span dir="ltr">{item.passScore}</span> }] : []),
    ...(item.durationMinutes !== null ? [{ key: 'duration', label: t('myExams.details.duration'), children: t('exams.drawer.minutes', { count: item.durationMinutes }) }] : []),
    ...(item.lesson
      ? [{ key: 'lesson', label: t('myExams.details.lesson'), children: `${localizedLabel(item.lesson.title, language)} · ${formatZonedDay(item.lesson.startsAt, item.timeZone, language)}` }]
      : []),
    ...(item.publishedAt ? [{ key: 'publishedAt', label: t('myExams.details.publishedAt'), children: formatZonedDateTime(item.publishedAt, item.timeZone, language) }] : []),
    ...(item.result?.feedback
      ? [
          {
            key: 'feedback',
            label: t('myExams.details.feedback'),
            children: (
              <div dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
                {item.result.feedback}
              </div>
            ),
          },
        ]
      : []),
  ]
  return <Descriptions size="small" column={1} items={items} />
}

export function MyExamsPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { user } = useAuth()
  const roleKeys = user?.roles ?? []
  const { academy } = useAcademy()
  // The date filter reads its days in the academy's zone, this device's until it is known (as /exams).
  const filterZone = academyZoneOf(academy) ?? deviceTimeZone()
  const [defaults] = useState(() => defaultMyExamsFilters(filterZone))
  const list = useMyExams(defaults)
  const myClasses = useMyClasses()
  const { filters } = list
  const students = studentOptionsOf(myClasses.items)
  const classes = classOptionsOf(myClasses.items, filters.studentId)
  const showStudent = showsStudents(roleKeys, list.items)
  // The student filter helps whoever owns exams through more than one student (a guardian, or a student who is also one).
  const canPickStudent = students.length > 1 || students.some((student) => student.relation === 'child')

  const columns: TableProps<MyExamItem>['columns'] = [
    { title: t('myExams.columns.when'), key: 'when', render: (_, row) => <WhenCell item={row} /> },
    {
      title: t('myExams.columns.exam'),
      key: 'exam',
      render: (_, row) => (
        <span>
          <Typography.Text strong>{examTitle(row, language)}</Typography.Text>
          <br />
          <Tag style={{ marginTop: 4 }}>{t(`exams.types.${row.type}`)}</Tag>
          {row.lesson ? (
            <>
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {localizedLabel(row.lesson.title, language)}
              </Typography.Text>
            </>
          ) : null}
        </span>
      ),
    },
    {
      title: t('myExams.columns.class'),
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
    { title: t('myExams.columns.status'), key: 'status', render: (_, row) => <StatusTag value={row.status} /> },
    { title: t('myExams.columns.result'), key: 'result', render: (_, row) => <ResultCell item={row} /> },
  ]
  if (showStudent) {
    columns.splice(1, 0, {
      title: t('myExams.columns.student'),
      key: 'student',
      render: (_, row) => (
        <Space size={4} wrap>
          <span>{displayNameOf(row.student)}</span>
          <Tag color={row.relation === 'self' ? 'green' : 'blue'}>{t(`myClasses.relation.${row.relation}`)}</Tag>
        </Space>
      ),
    })
  }

  const failure = list.error ? describeExamsFailure(list.error) : null
  const noEnrollment = !myClasses.loading && !myClasses.error && myClasses.items.length === 0
  const emptyText = isNarrowed(filters) ? t('myExams.empty.filtered') : noEnrollment ? t('myExams.empty.noEnrollment') : t('myExams.empty.all')

  const selectStudent = (studentId: string | undefined) => {
    // A class the newly chosen student is not enrolled in would match nothing: drop it.
    const stillOwned = !filters.classId || classOptionsOf(myClasses.items, studentId).some((option) => option.id === filters.classId)
    list.setFilters({ studentId, classId: stillOwned ? filters.classId : undefined })
  }

  return (
    <>
      <PageHeader title={t('myExams.title')} subtitle={t('myExams.subtitle')} />

      <Card>
        <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
          {canPickStudent ? (
            <Select<string | undefined>
              allowClear
              placeholder={t('myExams.filters.allStudents')}
              aria-label={t('myExams.filters.student')}
              value={filters.studentId}
              onChange={(value) => selectStudent(value)}
              options={students.map((student) => ({
                value: student.id,
                label: student.relation === 'self' ? `${displayNameOf(student)} (${t('myClasses.relation.self')})` : displayNameOf(student),
              }))}
              style={fluid(200)}
            />
          ) : null}
          <Select<string | undefined>
            allowClear
            placeholder={t('myExams.filters.allClasses')}
            aria-label={t('myExams.filters.class')}
            value={filters.classId}
            onChange={(value) => list.setFilters({ classId: value })}
            options={classes.map((option) => ({ value: option.id, label: `${option.code} — ${localizedLabel(option.name, language)}` }))}
            style={fluid(220)}
          />
          <Select<MyExamsFilters['status']>
            allowClear
            placeholder={t('exams.filters.allStatuses')}
            aria-label={t('myExams.filters.status')}
            value={filters.status}
            onChange={(value) => list.setFilters({ status: value })}
            options={MY_EXAM_STATUSES.map((status) => ({ value: status, label: t(`labels.${status}`) }))}
            style={fluid(150)}
          />
          <DateFilter label={t('exams.filters.from')} value={filters.from} onChange={(value) => list.setFilters({ from: value, timeZone: filterZone })} />
          <DateFilter label={t('exams.filters.to')} value={filters.to} onChange={(value) => list.setFilters({ to: value, timeZone: filterZone })} />
          <Select<MyExamsFilters['order']>
            value={filters.order}
            aria-label={t('exams.filters.order')}
            onChange={(value) => list.setFilters({ order: value })}
            options={[
              { value: 'asc', label: t('exams.filters.orderAsc') },
              { value: 'desc', label: t('exams.filters.orderDesc') },
            ]}
            style={fluid(170)}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              list.reload()
              myClasses.reload()
            }}
            aria-label={t('myExams.refresh')}
          />
          {differsFromDevice(filterZone) ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }} data-testid="my-exams-filter-zone">
              {t('exams.filters.zone')} (<span dir="ltr">{filterZone}</span>)
            </Typography.Text>
          ) : null}
        </Flex>
        {filters.from || filters.to ? (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -8 }}>
            {t('exams.filters.undatedHint')}
          </Typography.Paragraph>
        ) : null}

        {myClasses.error ? <Alert type="warning" showIcon title={t('myExams.optionsFailed')} style={{ marginBottom: 16 }} /> : null}

        {failure ? (
          <Alert
            type="error"
            showIcon
            title={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={() => (isExamsFailure(failure, 'cursor_invalid') ? list.setFilters({}) : list.reload())}>
                {t('myExams.refresh')}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<MyExamItem>
          rowKey={myExamKey}
          columns={columns}
          dataSource={list.items}
          loading={list.loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText }}
          expandable={{ expandedRowRender: (row) => <ExamDetails item={row} /> }}
        />

        <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
          <Space wrap>
            <Typography.Text type="secondary">{t('exams.pagination.page', { page: list.pageNumber })}</Typography.Text>
            <Select<MyExamsFilters['limit']>
              size="small"
              value={filters.limit}
              aria-label={t('exams.pagination.pageSizeLabel')}
              onChange={(value) => list.setFilters({ limit: value })}
              options={MY_EXAM_PAGE_SIZES.map((size) => ({ value: size, label: t('exams.pagination.pageSize', { count: size }) }))}
            />
            {showStudent ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('myExams.limitNote')}
              </Typography.Text>
            ) : null}
          </Space>
          <Space>
            <Button onClick={list.back} disabled={!list.canGoBack || list.loading}>
              {t('exams.pagination.previous')}
            </Button>
            <Button onClick={list.next} disabled={!list.nextCursor || list.loading}>
              {t('exams.pagination.next')}
            </Button>
          </Space>
        </Flex>
      </Card>
    </>
  )
}
