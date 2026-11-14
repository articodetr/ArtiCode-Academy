// «My assignments» (MOD-08 — J-F42): GET /api/me/assignments (API-112) for a
// student (the assignments of their own classes, `relation: self`) and a
// guardian (those of the classes their linked children are enrolled in,
// `relation: child`, while they hold the `guardian` role — the server
// decides). Ownership, no permission key (D-R40): one row per assignment ×
// student (two children in one class = two rows; the page size counts
// assignments), never a draft, with the due date in the assignment's own zone
// (D-R41), the class and course, the class's lead teacher by name (from «my
// classes», API-060 — API-112 names no teacher), the assignment's status, and
// the student's own latest attempt: its review, the server's late mark, the
// attempts used out of those allowed, the score once graded and the teacher's
// feedback. The instructions and grading rules are in the expanded row
// (learners never read API-103). The student sends an attempt from a `self`
// row (SubmitAttemptModal — API-109, `assignments.submit`) and reads their
// latest attempt — and, through its history, any other — in
// MySubmissionDrawer (API-110); a guardian reads their children's and never
// submits. Both answers update the row without another read. Whether a row
// takes an attempt now, and whether it would be late, is the server's verdict
// on the row (MOD-08-T07, D-R49 — `submitBlocker`/`submitsLate`, computed at
// its clock when the page is read, never at this device's); an answer
// re-applies it (followSubmitState()). The student and class filters, and the
// class teacher's name, read «my classes» (the same ownership). The route
// opens to the holders of the `student` or `guardian` server role key only
// (nav entry `myAssignments`, like «my lessons»).
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Descriptions, Empty, Flex, Segmented, Select, Skeleton, Space, Tag, Typography } from 'antd'
import type { DescriptionsProps } from 'antd'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../academy/useAcademy'
import type { MyAssignmentItem, MySubmission } from '../api/myAssignments'
import { assignmentTitle, formatZonedDateTime, formatZonedDay } from '../assignments/assignments.format'
import { academyZoneOf, differsFromDevice } from '../assignments/assignments.zone'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { useMyClasses } from '../enrollments/useMyClasses'
import { useLocalized } from '../i18n/useLocalized'
import { MySubmissionDrawer } from '../assignments/MySubmissionDrawer'
import { SubmitAttemptModal } from '../assignments/SubmitAttemptModal'
import { describeMyAssignmentsFailure, failureMessage, isMyAssignmentsFailure } from '../assignments/myAssignments.errors'
import {
  MY_ASSIGNMENT_PAGE_SIZES,
  MY_ASSIGNMENT_VIEWS,
  MY_SUBMISSION_COLORS,
  applySubmission,
  defaultMyAssignmentsFilters,
  enrollmentIndexOf,
  feedbackExcerpt,
  gradedScoreOf,
  isNarrowed,
  leadTeacherOf,
  myAssignmentKey,
  offersSubmit,
  scoreText,
  submissionCellOf,
} from '../assignments/myAssignments.view'
import type { EnrollmentIndex, MyAssignmentView, MyAssignmentsFilters } from '../assignments/myAssignments.view'
import { useMyAssignments } from '../assignments/useMyAssignments'
import { classOptionsOf, showsStudents, studentOptionsOf } from '../lessons/myLessons.view'
import { isCalendarDate } from '../timetable/timetable.dates'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { displayNameOf, localizedLabel } from '../users/users.format'
import './MyAssignmentsPage.css'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** Rows updated by a submission answer, bound to the page they were applied to: a new page from the server drops them. */
interface FollowedRows {
  page: readonly MyAssignmentItem[] | null
  rows: ReadonlyMap<string, MyAssignmentItem>
}

function DateFilter({ value, onChange, label }: { value: string | undefined; onChange: (value: string | undefined) => void; label: string }) {
  return <input type="date" aria-label={label} className="ant-input" value={value ?? ''} onChange={(event) => onChange(isCalendarDate(event.target.value) ? event.target.value : undefined)} style={{ width: 170 }} />
}

function latePolicyText(t: Translate, item: MyAssignmentItem): string {
  if (!item.allowLate) return t('myAssignments.details.lateNotAllowed')
  if (item.latePenaltyPercent !== null && item.latePenaltyPercent > 0) return t('myAssignments.details.lateAllowedWithPenalty', { percent: item.latePenaltyPercent })
  return t('myAssignments.details.lateAllowed')
}

function SubmissionCell({ item }: { item: MyAssignmentItem }) {
  const { t } = useTranslation()
  const cell = submissionCellOf(item)
  if (cell.kind === 'none') {
    return (
      <span>
        <Typography.Text type="secondary">{t('myAssignments.submission.none')}</Typography.Text>
        {/* The server's verdict: an attempt now is taken and marked late (never this device's clock). */}
        {item.submitsLate ? (
          <>
            <br />
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              {t('myAssignments.submission.lateOpen')}
            </Typography.Text>
          </>
        ) : null}
      </span>
    )
  }
  if (cell.kind === 'missed') return <Tag color="red">{t('myAssignments.submission.missed')}</Tag>
  return (
    <Space size={4} wrap>
      <Tag color={MY_SUBMISSION_COLORS[cell.kind]}>{t(`myAssignments.submission.${cell.kind}`)}</Tag>
      {cell.late ? <Tag color="volcano">{t('myAssignments.submission.late')}</Tag> : null}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('myAssignments.submission.attempt', { number: cell.attemptNo })}
      </Typography.Text>
    </Space>
  )
}

function ScoreCell({ item }: { item: MyAssignmentItem }) {
  const { t } = useTranslation()
  const score = gradedScoreOf(item)
  const feedback = item.latest?.feedback ?? null
  if (score === null && !feedback) return <Typography.Text type="secondary">{item.latest ? t('myAssignments.notGraded') : '—'}</Typography.Text>
  return (
    <span>
      {score !== null ? (
        <Typography.Text strong>
          <span dir="ltr">{scoreText(score, item.maxScore)}</span>
        </Typography.Text>
      ) : null}
      {score !== null && feedback ? <br /> : null}
      {feedback ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }} title={feedback}>
          {feedbackExcerpt(feedback)}
        </Typography.Text>
      ) : null}
    </span>
  )
}

function TeacherCell({ item, enrollments }: { item: MyAssignmentItem; enrollments: EnrollmentIndex }) {
  const { t } = useTranslation()
  const teacher = leadTeacherOf(enrollments, item)
  if (teacher.kind === 'teacher') return <span>{displayNameOf(teacher.teacher)}</span>
  return <Typography.Text type="secondary">{teacher.kind === 'none' ? t('myAssignments.noLeadTeacher') : '—'}</Typography.Text>
}

/** The expanded row: what a learner needs before answering (learners never read API-103 — D-R40). */
function AssignmentDetails({ item }: { item: MyAssignmentItem }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const items: DescriptionsProps['items'] = [
    {
      key: 'instructions',
      label: t('myAssignments.details.instructions'),
      children: item.instructions ? (
        // A plain element: antd Typography's RTL class would override dir="auto".
        <div dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
          {localizedLabel(item.instructions, language)}
        </div>
      ) : (
        <Typography.Text type="secondary">{t('myAssignments.details.noInstructions')}</Typography.Text>
      ),
    },
    { key: 'maxScore', label: t('myAssignments.details.maxScore'), children: <span dir="ltr">{item.maxScore}</span> },
    { key: 'late', label: t('myAssignments.details.latePolicy'), children: latePolicyText(t, item) },
    { key: 'attempts', label: t('myAssignments.details.maxAttempts'), children: t('myAssignments.details.maxAttemptsValue', { count: item.maxAttempts }) },
    ...(item.lesson
      ? [{ key: 'lesson', label: t('myAssignments.details.lesson'), children: `${localizedLabel(item.lesson.title, language)} · ${formatZonedDay(item.lesson.startsAt, item.timeZone, language)}` }]
      : []),
  ]
  return <Descriptions size="small" column={1} items={items} />
}

export function MyAssignmentsPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { user, hasPermission } = useAuth()
  const roleKeys = user?.roles ?? []
  const holdsSubmitKey = hasPermission('assignments.submit')
  const { academy } = useAcademy()
  // The due-day filter reads its days in the academy's zone, this device's until it is known (as /assignments).
  const filterZone = academyZoneOf(academy) ?? deviceTimeZone()
  const [defaults] = useState(() => defaultMyAssignmentsFilters(filterZone))
  const list = useMyAssignments(defaults)
  const myClasses = useMyClasses()
  const { filters } = list
  const students = studentOptionsOf(myClasses.items)
  const classes = classOptionsOf(myClasses.items, filters.studentId)
  const enrollments = useMemo(() => enrollmentIndexOf(myClasses.items), [myClasses.items])
  const [followed, setFollowed] = useState<FollowedRows>({ page: null, rows: new Map() })
  const rows = useMemo(
    () => (followed.page === list.items ? list.items.map((item) => followed.rows.get(myAssignmentKey(item)) ?? item) : list.items),
    [followed, list.items],
  )
  const [submitFor, setSubmitFor] = useState<MyAssignmentItem | null>(null)
  const [viewFor, setViewFor] = useState<MyAssignmentItem | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const showStudent = showsStudents(roleKeys, rows)
  // The student filter helps whoever owns assignments through more than one student (a guardian, or a student who is also one).
  const canPickStudent = students.length > 1 || students.some((student) => student.relation === 'child')

  /** The row of this assignment × student follows the server's answer (API-109 / API-110) — no other read. */
  const follow = useCallback(
    (submission: MySubmission) => {
      setFollowed((current) => {
        const kept = current.page === list.items ? current.rows : new Map<string, MyAssignmentItem>()
        const next = new Map(kept)
        let changed = false
        for (const item of list.items) {
          const key = myAssignmentKey(item)
          const shown = next.get(key) ?? item
          const updated = applySubmission(shown, submission)
          if (updated !== shown) {
            next.set(key, updated)
            changed = true
          }
        }
        return changed ? { page: list.items, rows: next } : current
      })
    },
    [list.items],
  )

  // Redesign (2026-11-14): one card per assignment × student instead of a nine-column table that scrolled sideways
  // and hid the hand-in button off the edge. The card reads top to bottom — what and for which class, when it is
  // due, where the student stands, the score — with the actions always in view and the rules behind «details».
  const actionsOf = (row: MyAssignmentItem) => {
    const offered = offersSubmit(row, holdsSubmitKey)
    // The server's verdict when the page was read (MOD-08-T07): the button and its reason never follow this device's clock.
    const takesAttempt = offered && row.submitBlocker === null
    // A closed assignment says so in its status tag; the other reasons are not visible elsewhere.
    const blocker = offered && row.submitBlocker !== null && row.submitBlocker !== 'closed' ? row.submitBlocker : null
    return (
      <div className="my-assignment__actions">
        {takesAttempt ? (
          <Button type="primary" onClick={() => setSubmitFor(row)}>
            {t(row.attempts > 0 ? 'myAssignments.actions.submitAgain' : 'myAssignments.actions.submit')}
          </Button>
        ) : null}
        {row.latest ? (
          <Button icon={<EyeOutlined />} onClick={() => setViewFor(row)}>
            {t(row.relation === 'self' ? 'myAssignments.actions.viewMine' : 'myAssignments.actions.viewChild')}
          </Button>
        ) : null}
        {blocker ? <Typography.Text type="secondary" className="my-assignment__note">{t(`myAssignments.blocked.${blocker}`)}</Typography.Text> : null}
        {row.relation === 'self' && !holdsSubmitKey && row.status === 'open' ? (
          <Typography.Text type="secondary" className="my-assignment__note">{t('myAssignments.blocked.noPermission')}</Typography.Text>
        ) : null}
      </div>
    )
  }

  const renderCard = (row: MyAssignmentItem) => {
    const key = myAssignmentKey(row)
    const open = expanded.has(key)
    return (
      <li key={key} className="my-assignment" data-my-assignment={key}>
        <div className="my-assignment__main">
          <div className="my-assignment__what">
            <div className="my-assignment__title">
              <Typography.Text strong>{assignmentTitle(row, language)}</Typography.Text>
              <StatusTag value={row.status} />
              {showStudent ? (
                <Tag color={row.relation === 'self' ? 'green' : 'blue'} className="my-assignment__student">
                  <span>{displayNameOf(row.student)}</span>
                  {' · '}
                  <span>{t(`myClasses.relation.${row.relation}`)}</span>
                </Tag>
              ) : null}
            </div>
            <Typography.Text type="secondary" className="my-assignment__class">
              <bdi dir="ltr">{row.class.code}</bdi>
              {' · '}
              <span>{`${localizedLabel(row.class.name, language)} · ${localizedLabel(row.class.course.name, language)}`}</span>
              {' · '}
              <TeacherCell item={row} enrollments={enrollments} />
              {row.lesson ? ` · ${localizedLabel(row.lesson.title, language)}` : ''}
            </Typography.Text>
          </div>
          {actionsOf(row)}
        </div>

        <dl className="my-assignment__facts">
          <div>
            <dt>{t('myAssignments.columns.due')}</dt>
            <dd>
              {row.dueAt ? (
                <>
                  {formatZonedDateTime(row.dueAt, row.timeZone, language)}
                  {differsFromDevice(row.timeZone) ? <span dir="ltr" className="my-assignment__zone">{` ${row.timeZone}`}</span> : null}
                </>
              ) : (
                <Typography.Text type="secondary">{t('myAssignments.noDue')}</Typography.Text>
              )}
            </dd>
          </div>
          <div>
            <dt>{t('myAssignments.columns.submission')}</dt>
            <dd>
              <SubmissionCell item={row} />
            </dd>
          </div>
          <div>
            <dt>{t('myAssignments.columns.attempts')}</dt>
            <dd>
              <span dir="ltr" title={t('myAssignments.attemptsTitle')} className="tabular-nums">
                {`${row.attempts} / ${row.attemptsAllowed}`}
              </span>
            </dd>
          </div>
          <div>
            <dt>{t('myAssignments.columns.score')}</dt>
            <dd>
              <ScoreCell item={row} />
            </dd>
          </div>
        </dl>

        <Button
          type="link"
          size="small"
          className="my-assignment__toggle"
          aria-expanded={open}
          onClick={() =>
            setExpanded((current) => {
              const next = new Set(current)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              return next
            })
          }
        >
          {t(open ? 'myAssignments.hideDetails' : 'myAssignments.showDetails')}
        </Button>
        {open ? (
          <div className="my-assignment__details">
            <AssignmentDetails item={row} />
          </div>
        ) : null}
      </li>
    )
  }

  const failure = list.error ? describeMyAssignmentsFailure(list.error) : null
  const noEnrollment = !myClasses.loading && !myClasses.error && myClasses.items.length === 0
  const emptyText = isNarrowed(filters) ? t('myAssignments.empty.filtered') : noEnrollment ? t('myAssignments.empty.noEnrollment') : t(`myAssignments.empty.${filters.view}`)

  const selectStudent = (studentId: string | undefined) => {
    // A class the newly chosen student is not enrolled in would match nothing: drop it.
    const stillOwned = !filters.classId || classOptionsOf(myClasses.items, studentId).some((option) => option.id === filters.classId)
    list.setFilters({ studentId, classId: stillOwned ? filters.classId : undefined })
  }

  return (
    <>
      <PageHeader title={t('myAssignments.title')} subtitle={t('myAssignments.subtitle')} />

      <Card>
        <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
          <Segmented<MyAssignmentView>
            aria-label={t('myAssignments.views.label')}
            value={filters.view}
            onChange={(view) => list.setFilters({ view })}
            options={MY_ASSIGNMENT_VIEWS.map((view) => ({ value: view, label: t(`myAssignments.views.${view}`) }))}
          />
          {canPickStudent ? (
            <Select<string | undefined>
              allowClear
              placeholder={t('myAssignments.filters.allStudents')}
              aria-label={t('myAssignments.filters.student')}
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
            placeholder={t('myAssignments.filters.allClasses')}
            aria-label={t('myAssignments.filters.class')}
            value={filters.classId}
            onChange={(value) => list.setFilters({ classId: value })}
            options={classes.map((option) => ({ value: option.id, label: `${option.code} — ${localizedLabel(option.name, language)}` }))}
            style={{ minWidth: 220 }}
          />
          {filters.view === 'all' ? (
            <>
              <DateFilter label={t('assignments.filters.dueFrom')} value={filters.dueFrom} onChange={(value) => list.setFilters({ dueFrom: value, timeZone: filterZone })} />
              <DateFilter label={t('assignments.filters.dueTo')} value={filters.dueTo} onChange={(value) => list.setFilters({ dueTo: value, timeZone: filterZone })} />
              <Select<MyAssignmentsFilters['order']>
                value={filters.order}
                aria-label={t('assignments.filters.order')}
                onChange={(value) => list.setFilters({ order: value })}
                options={[
                  { value: 'asc', label: t('assignments.filters.orderAsc') },
                  { value: 'desc', label: t('assignments.filters.orderDesc') },
                ]}
                style={{ minWidth: 170 }}
              />
              {differsFromDevice(filterZone) ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }} data-testid="my-assignments-filter-zone">
                  {t('assignments.filters.zone')} (<span dir="ltr">{filterZone}</span>)
                </Typography.Text>
              ) : null}
            </>
          ) : null}
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              list.reload()
              myClasses.reload()
            }}
            aria-label={t('myAssignments.refresh')}
          />
        </Flex>

        {filters.view === 'pending' ? (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -8 }}>
            {t('myAssignments.views.pendingHint')}
          </Typography.Paragraph>
        ) : null}

        {myClasses.error ? <Alert type="warning" showIcon title={t('myAssignments.optionsFailed')} style={{ marginBottom: 16 }} /> : null}

        {failure ? (
          <Alert
            type="error"
            showIcon
            title={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={() => (isMyAssignmentsFailure(failure, 'cursor_invalid') ? list.setFilters({}) : list.reload())}>
                {t('myAssignments.refresh')}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        {list.loading && rows.length === 0 ? <Skeleton active paragraph={{ rows: 4 }} title={false} /> : null}
        {rows.length ? (
          <ul className={list.loading ? 'my-assignments my-assignments--loading' : 'my-assignments'}>{rows.map(renderCard)}</ul>
        ) : !list.loading ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
        ) : null}

        <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
          <Space wrap>
            <Typography.Text type="secondary">{t('assignments.pagination.page', { page: list.pageNumber })}</Typography.Text>
            <Select<MyAssignmentsFilters['limit']>
              size="small"
              value={filters.limit}
              aria-label={t('assignments.pagination.pageSizeLabel')}
              onChange={(value) => list.setFilters({ limit: value })}
              options={MY_ASSIGNMENT_PAGE_SIZES.map((size) => ({ value: size, label: t('assignments.pagination.pageSize', { count: size }) }))}
            />
            {showStudent ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('myAssignments.limitNote')}
              </Typography.Text>
            ) : null}
          </Space>
          <Space>
            <Button onClick={list.back} disabled={!list.canGoBack || list.loading}>
              {t('assignments.pagination.previous')}
            </Button>
            <Button onClick={list.next} disabled={!list.nextCursor || list.loading}>
              {t('assignments.pagination.next')}
            </Button>
          </Space>
        </Flex>
      </Card>

      <SubmitAttemptModal
        item={submitFor}
        onClose={() => setSubmitFor(null)}
        onSubmitted={(submission) => {
          follow(submission)
          setSubmitFor(null)
          message.success(t('myAssignments.submit.done', { number: submission.attemptNo, title: localizedLabel(submission.assignment.title, language) }))
        }}
        onStale={() => {
          // The refusal says the assignment, the attempts or the enrollment moved on (or the attempt was already received):
          // the rows (their submit state) and «my classes» (a withdrawn enrollment leaves the filters) may both be stale.
          list.reload()
          myClasses.reload()
        }}
      />

      <MySubmissionDrawer item={viewFor} onClose={() => setViewFor(null)} onLoaded={follow} />
    </>
  )
}
