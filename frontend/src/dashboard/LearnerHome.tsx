// The home of a student or a guardian (redesign 2026-11-14; reorganised around what a student does next in J-F63):
// the lessons with «join», the exams with «start the exam», the course's books and files, then what is waiting, the
// latest results and the classes — all from the «my …» reads (API-060/101/112/121/129/155/229..231), which the server
// scopes by ownership. The staff dashboard reads /api/lessons, which shows a learner nothing (D-R16). A guardian
// narrows the page to one child with the switch at the top (`?student=`); every read then sends that `studentId`.
import { Alert, Segmented, Skeleton } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import type { MyClassItem } from '../api/enrollments'
import { listMyClasses } from '../api/enrollments'
import type { MyInvoice } from '../api/invoices'
import { listMyInvoices } from '../api/invoices'
import { getMyLearning } from '../api/learning'
import type { MyLearningCourse } from '../api/learning'
import { listMyAssignments } from '../api/myAssignments'
import type { MyAssignmentItem } from '../api/myAssignments'
import { listMyExams } from '../api/myExams'
import type { MyExamItem } from '../api/myExams'
import { MY_GRADES_PERMISSIONS, listMyGrades } from '../api/myGrades'
import type { MyGradeItem } from '../api/myGrades'
import { listMyLessons } from '../api/myLessons'
import type { MyLessonItem } from '../api/myLessons'
import { useAuth } from '../auth/auth-context'
import { dayStartIn } from '../common/timeZone'
import { useLocalized } from '../i18n/useLocalized'
import { formatClock } from '../lessons/lessons.format'
import { classLessonsPath, hasClassLessons } from '../lessons/myLessons.view'
import { useUnreadCount } from '../notifications/useUnreadCount'
import { markArrival, monotonicNow } from '../takeExam/takeExam.clock'
import { addDays } from '../timetable/timetable.dates'
import { formatMoney, labelIn, wallDate } from './dashboard.data'
import { formatScore, learnersOf, nextLessonOf, resultsOf, todoOf } from './learner.data'
import type { ResultRow, TodoItem } from './learner.data'
import { ExamsPanel } from './LearnerExams'
import { LessonsPanel } from './LearnerLessons'
import { MaterialsPanel } from './LearnerMaterials'
import { Loading, Panel } from './LearnerPanel'
import type { DayContext, StudentName } from './LearnerPanel'
import type { Loaded } from './useLoad'
import { useLoad } from './useLoad'
import './learner.css'

export type { DayContext } from './LearnerPanel'

const DAYS_AHEAD = 7

/** Every page of a «my …» keyset read, up to `pages` pages. */
async function allPages<T>(read: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>, pages = 3): Promise<T[]> {
  const items: T[] = []
  let cursor: string | undefined
  for (let page = 0; page < pages; page += 1) {
    const answer = await read(cursor)
    items.push(...answer.items)
    if (!answer.nextCursor) break
    cursor = answer.nextCursor
  }
  return items
}

export function LearnerHome({ day, greeting, dateLine }: { day: DayContext; greeting: string; dateLine: string }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { user, hasPermission } = useAuth()
  const [params, setParams] = useSearchParams()
  const { unread } = useUnreadCount()
  const localized = (text: Parameters<typeof labelIn>[0]) => labelIn(text, language)

  const classes = useLoad<MyClassItem[]>('learner:classes', true, (signal) => listMyClasses({}, signal).then((answer) => answer.items))
  const learners = learnersOf(classes.data ?? [])
  const asked = params.get('student')
  const studentId = asked && learners.some((learner) => learner.id === asked) ? asked : undefined
  const many = learners.length > 1
  const scope = studentId ?? 'all'

  const from = dayStartIn(day.today, day.zone)
  const to = dayStartIn(addDays(day.today, DAYS_AHEAD), day.zone)
  const lessons = useLoad<MyLessonItem[]>(`learner:lessons:${scope}:${day.today}`, true, (signal) =>
    allPages((cursor) => listMyLessons({ studentId, from, to: to ? new Date(Date.parse(to) - 1).toISOString() : undefined, order: 'asc', limit: 100, cursor }, signal)),
  )
  const pending = useLoad<MyAssignmentItem[]>(`learner:pending:${scope}`, true, (signal) => allPages((cursor) => listMyAssignments({ studentId, pending: true, order: 'asc', limit: 50, cursor }, signal)))
  const assignments = useLoad<MyAssignmentItem[]>(`learner:assignments:${scope}`, true, (signal) => allPages((cursor) => listMyAssignments({ studentId, order: 'desc', limit: 50, cursor }, signal), 2))
  const exams = useLoad<MyExamItem[]>(`learner:exams:${scope}`, true, (signal) =>
    allPages(async (cursor) => {
      const page = await listMyExams({ studentId, order: 'desc', limit: 50, cursor }, signal)
      // The countdown of an attempt in progress runs from the moment its answer arrived (takeExam.clock.ts).
      const arrivedAt = monotonicNow()
      for (const item of page.items) if (item.online?.inProgress) markArrival(item.online.inProgress, arrivedAt)
      return page
    }, 2),
  )
  const canInvoices = hasPermission('invoices.read_own') || hasPermission('invoices.read_linked')
  const invoices = useLoad<MyInvoice[]>(`learner:invoices:${scope}`, canInvoices, (signal) => listMyInvoices({ studentId, status: 'issued' }, signal).then((answer) => answer.items))
  const canGrades = MY_GRADES_PERMISSIONS.some((key) => hasPermission(key))
  const grades = useLoad<MyGradeItem[]>(`learner:grades:${scope}`, canGrades, (signal) => listMyGrades({ studentId }, signal).then((answer) => answer.items))
  // API-229 lists a guardian's children too, but only a student studies: a guardian has no content panel to fill.
  const isStudent = user?.roles.includes('student') ?? false
  const learning = useLoad<MyLearningCourse[]>('learner:learning', isStudent, (signal) => getMyLearning(signal).then((answer) => answer.items))

  const next = lessons.data ? nextLessonOf(lessons.data, day.now) : null
  const dayName = (iso: string, zone: string) =>
    new Intl.DateTimeFormat(language === 'ar' ? 'ar-u-nu-latn' : language, { weekday: 'long', day: 'numeric', month: 'long', timeZone: zone }).format(new Date(iso))
  const summary = (() => {
    if (!lessons.data) return ''
    if (!next) return t('dashboard.learner.noUpcoming')
    if (next.status === 'scheduled' && Date.parse(next.startsAt) <= day.now) return t('dashboard.learner.liveLine', { title: localized(next.class.name), time: formatClock(next.endsAt, language, next.timeZone) })
    const when = wallDate(next.startsAt, day.zone) === day.today ? t('dashboard.learner.today') : dayName(next.startsAt, next.timeZone)
    return t('dashboard.learner.nextLine', { title: localized(next.class.name), day: when, time: formatClock(next.startsAt, language, next.timeZone) })
  })()

  const showStudent = many && !studentId
  const studentName: StudentName = (student) => student.displayName || student.fullName.split(' ')[0]!

  return (
    <div className="db lh">
      <header className="db-head lh-head">
        <span className="db-head__date">{dateLine}</span>
        <h1>{greeting}</h1>
        {/* A non-breaking space keeps the line's height while the lessons load (no shift when it fills). */}
        <p>{summary || ' '}</p>
      </header>

      {classes.loading && user?.roles.includes('guardian') ? (
        // The switch appears once «my classes» answers; a guardian most likely gets one, so its place is kept
        // meanwhile instead of pushing the page down when it arrives (a 0.58 layout shift on a phone).
        <div className="lh-switch lh-switch--pending" aria-hidden="true" />
      ) : many ? (
        <div className="lh-switch-scroll">
          <Segmented
            className="lh-switch"
            value={scope}
            onChange={(value) => {
              const nextParams = new URLSearchParams(params)
              if (value === 'all') nextParams.delete('student')
              else nextParams.set('student', String(value))
              setParams(nextParams, { replace: true })
            }}
            options={[{ value: 'all', label: t('dashboard.learner.everyone') }, ...learners.map((learner) => ({ value: learner.id, label: learner.relation === 'self' ? t('dashboard.learner.me') : learner.fullName }))]}
          />
        </div>
      ) : null}

      <div className="lh-main">
        <LessonsPanel lessons={lessons} day={day} showStudent={showStudent} studentName={studentName} />
        <div className="lh-column">
          <ExamsPanel exams={exams} day={day} showStudent={showStudent} studentName={studentName} />
          <Panel title={t('dashboard.learner.waiting')}>
            <TodoList pending={pending} invoices={invoices} day={day} showStudent={showStudent} studentName={studentName} unread={unread} />
          </Panel>
        </div>
      </div>

      {isStudent ? <MaterialsPanel learning={learning} studentId={studentId} ready={!lessons.loading && !exams.loading} /> : null}

      <div className="lh-side">
        <Panel title={t('dashboard.learner.results')} extra={canGrades ? <Link to="/my-grades">{t('dashboard.learner.allGrades')}</Link> : null}>
          {assignments.loading || exams.loading || grades.loading ? (
            <Skeleton active paragraph={{ rows: 3 }} title={false} />
          ) : (
            <ResultsList rows={resultsOf({ assignments: assignments.data ?? [], exams: exams.data ?? [], grades: grades.data ?? [] }, 4)} showStudent={showStudent} studentName={studentName} />
          )}
        </Panel>

        <Panel title={t('dashboard.learner.classes')} extra={<Link to="/my-classes">{t('dashboard.learner.allClasses')}</Link>}>
          <Loading loaded={classes}>
            {(items) => {
              const shown = items.filter((item) => item.enrollmentStatus === 'active' && (!studentId || item.student.id === studentId))
              if (!shown.length) return <p className="db-muted">{t('dashboard.learner.classesEmpty')}</p>
              return (
                <ul className="db-todo">
                  {shown.map((item) => (
                    <li key={item.enrollmentId}>
                      <span className="db-todo__text">
                        {hasClassLessons(item.enrollmentStatus) ? <Link to={classLessonsPath(item, items)}>{localized(item.class.name)}</Link> : localized(item.class.name)}
                        <small>
                          {[localized(item.class.course.name), item.class.leadTeacher ? t('dashboard.learner.teacher', { name: item.class.leadTeacher.fullName }) : null, showStudent ? studentName(item.student) : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
              )
            }}
          </Loading>
        </Panel>
      </div>
    </div>
  )
}

function TodoList({ pending, invoices, day, showStudent, studentName, unread }: {
  pending: Loaded<MyAssignmentItem[]>
  invoices: Loaded<MyInvoice[]>
  day: DayContext
  showStudent: boolean
  studentName: StudentName
  unread: number | null
}) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const localized = (text: Parameters<typeof labelIn>[0]) => labelIn(text, language)
  if (pending.loading || invoices.loading) return <Skeleton active paragraph={{ rows: 3 }} title={false} />
  // A failed read never reads as «nothing is waiting».
  if (pending.error || invoices.error) return <Alert type="warning" showIcon title={t('dashboard.loadFailed')} />
  const items = todoOf({ assignments: pending.data ?? [], invoices: invoices.data ?? [], zone: day.zone, today: day.today })
  const shortDay = (iso: string, zone: string) => new Intl.DateTimeFormat(language === 'ar' ? 'ar-u-nu-latn' : language, { weekday: 'long', day: 'numeric', month: 'long', timeZone: zone }).format(new Date(iso))
  const whenText = (days: number | null, iso: string | null, zone: string) => {
    if (days === null || iso === null) return t('dashboard.learner.noDue')
    if (days < 0) return t('dashboard.learner.overdueLate')
    if (days === 0) return t('dashboard.learner.dueToday', { time: formatClock(iso, language, zone) })
    if (days === 1) return t('dashboard.learner.dueTomorrow', { time: formatClock(iso, language, zone) })
    return t('dashboard.learner.dueOn', { day: shortDay(iso, zone) })
  }
  const who = (student: { fullName: string; displayName: string | null }) => (showStudent ? ` · ${studentName(student)}` : '')

  const row = (todo: TodoItem): ReactNode => {
    if (todo.kind === 'assignment') {
      const item = todo.item
      const urgent = todo.dueDays !== null && todo.dueDays <= 1
      const returned = item.latest?.status === 'returned'
      return (
        <li key={todo.key} className={urgent ? 'lh-todo--urgent' : undefined}>
          <span className="lh-kind">{t('dashboard.learner.kind.assignment')}</span>
          <span className="db-todo__text">
            {localized(item.title)}
            <small>
              {returned ? `${t('dashboard.learner.returned')} · ` : ''}
              {whenText(todo.dueDays, item.dueAt, item.timeZone)} · {localized(item.class.name)}
              {who(item.student)}
            </small>
          </span>
          <Link to="/my-assignments">{item.relation === 'self' ? t('dashboard.learner.submit') : t('dashboard.learner.open')}</Link>
        </li>
      )
    }
    const item = todo.item
    return (
      <li key={todo.key} className={item.overdue ? 'lh-todo--urgent' : undefined}>
        <span className="lh-kind">{t('dashboard.learner.kind.invoice')}</span>
        <span className="db-todo__text">
          <span className="tabular-nums">{t('dashboard.learner.balance', { amount: formatMoney(item.balance, item.currency, language) })}</span>
          <small className="tabular-nums">
            {item.overdue ? <span className="db-bad">{t('dashboard.learner.overdue')}</span> : item.nextDue ? t('dashboard.learner.nextDue', { day: shortDay(`${item.nextDue.dueOn}T12:00:00Z`, 'UTC') }) : null}
            {item.number ? ` · ${item.number}` : ''}
            {showStudent ? ` · ${studentName(item.student)}` : ''}
          </small>
        </span>
        <Link to="/payments">{t('dashboard.learner.details')}</Link>
      </li>
    )
  }

  if (!items.length && !unread) return <p className="db-clear">{t('dashboard.learner.nothingWaiting')}</p>
  const shown = items.slice(0, 6)
  return (
    <ul className="db-todo lh-todo">
      {shown.map(row)}
      {items.length > shown.length ? <li className="lh-more db-muted">{t('dashboard.learner.more', { count: items.length - shown.length })}</li> : null}
      {unread ? (
        <li>
          <span className="lh-kind">{t('dashboard.learner.kind.notifications')}</span>
          <span className="db-todo__text">{t('dashboard.learner.unread', { count: unread })}</span>
          <Link to="/notifications">{t('dashboard.learner.read')}</Link>
        </li>
      ) : null}
    </ul>
  )
}

function ResultsList({ rows, showStudent, studentName }: { rows: ResultRow[]; showStudent: boolean; studentName: StudentName }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const localized = (text: Parameters<typeof labelIn>[0]) => labelIn(text, language)
  if (!rows.length) return <p className="db-muted">{t('dashboard.learner.resultsEmpty')}</p>
  return (
    <ul className="db-todo">
      {rows.map((row) => (
        <li key={row.key}>
          <span className="lh-kind">{t(`dashboard.learner.kind.${row.kind}`)}</span>
          <span className="db-todo__text">
            {localized(row.title)}
            <small>
              {row.kind === 'final' ? localized(row.band ?? row.className) : localized(row.className)}
              {showStudent ? ` · ${studentName(row.student)}` : ''}
            </small>
          </span>
          <span className={row.isPass === false ? 'lh-score lh-score--low tabular-nums' : 'lh-score tabular-nums'} dir="ltr">
            {row.status === 'absent' || row.status === 'excused'
              ? t(`exams.results.status.${row.status}`)
              : row.percent !== null
                ? `${formatScore(row.percent)}%`
                : `${formatScore(row.score ?? 0)} / ${formatScore(row.max ?? 0)}`}
          </span>
        </li>
      ))}
    </ul>
  )
}
