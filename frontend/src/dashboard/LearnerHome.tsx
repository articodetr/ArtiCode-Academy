// The home of a student or a guardian (redesign, 2026-11-14). The staff dashboard reads /api/lessons, which shows
// a learner nothing (D-R16), so a learner-only account lands here instead: the week's lessons with the student's
// own attendance, what is waiting (work to hand in, exams, money), the latest results and the classes — all from
// the «my …» reads (API-060/101/112/121/129/155), which the server scopes by ownership. A guardian narrows the page
// to one child with the switch at the top (`?student=`); every read then sends that `studentId`.
import { Alert, Segmented, Skeleton, Tag } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import type { MyClassItem } from '../api/enrollments'
import { listMyClasses } from '../api/enrollments'
import type { MyInvoice } from '../api/invoices'
import { listMyInvoices } from '../api/invoices'
import { listMyAssignments } from '../api/myAssignments'
import type { MyAssignmentItem } from '../api/myAssignments'
import { listMyExams } from '../api/myExams'
import type { MyExamItem } from '../api/myExams'
import { MY_GRADES_PERMISSIONS, listMyGrades } from '../api/myGrades'
import type { MyGradeItem } from '../api/myGrades'
import { listMyLessons } from '../api/myLessons'
import type { MyLessonItem } from '../api/myLessons'
import { ATTENDANCE_STATUS_COLORS } from '../attendance/attendance.format'
import { useAuth } from '../auth/auth-context'
import { dayStartIn } from '../common/timeZone'
import { useLocalized } from '../i18n/useLocalized'
import { formatClock, formatLessonTimes } from '../lessons/lessons.format'
import { useUnreadCount } from '../notifications/useUnreadCount'
import { addDays } from '../timetable/timetable.dates'
import type { DayContext } from './DashboardViews'
import { formatMoney, labelIn, wallDate } from './dashboard.data'
import { agendaOf, daysUntil, formatScore, learnersOf, nextLessonOf, resultsOf, todoOf } from './learner.data'
import type { ResultRow, TodoItem } from './learner.data'
import type { Loaded } from './useLoad'
import { useLoad } from './useLoad'

const DAYS_AHEAD = 7
/** The agenda shows the first days with lessons; the rest are one click away on «my lessons». */
const AGENDA_DAYS = 3

function Panel({ title, extra, children, className }: { title: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className ? `db-panel ${className}` : 'db-panel'}>
      <header className="db-panel__head">
        <h2>{title}</h2>
        {extra}
      </header>
      {children}
    </section>
  )
}

function Loading<T>({ loaded, children }: { loaded: Loaded<T>; children: (data: T) => ReactNode }) {
  const { t } = useTranslation()
  if (loaded.loading) return <Skeleton active paragraph={{ rows: 3 }} title={false} />
  if (loaded.error || loaded.data === null) return <Alert type="warning" showIcon title={t('dashboard.loadFailed')} />
  return <>{children(loaded.data)}</>
}

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
  const exams = useLoad<MyExamItem[]>(`learner:exams:${scope}`, true, (signal) => allPages((cursor) => listMyExams({ studentId, order: 'desc', limit: 50, cursor }, signal), 2))
  const canInvoices = hasPermission('invoices.read_own') || hasPermission('invoices.read_linked')
  const invoices = useLoad<MyInvoice[]>(`learner:invoices:${scope}`, canInvoices, (signal) => listMyInvoices({ studentId, status: 'issued' }, signal).then((answer) => answer.items))
  const canGrades = MY_GRADES_PERMISSIONS.some((key) => hasPermission(key))
  const grades = useLoad<MyGradeItem[]>(`learner:grades:${scope}`, canGrades, (signal) => listMyGrades({ studentId }, signal).then((answer) => answer.items))

  const next = lessons.data ? nextLessonOf(lessons.data, day.now) : null
  const dayName = (iso: string, zone: string) =>
    new Intl.DateTimeFormat(language === 'ar' ? 'ar-u-nu-latn' : language, { weekday: 'long', day: 'numeric', month: 'long', timeZone: zone }).format(new Date(iso))
  const summary = (() => {
    if (!lessons.data) return ''
    if (!next) return t('dashboard.learner.noUpcoming')
    const when = wallDate(next.startsAt, day.zone) === day.today ? t('dashboard.learner.today') : dayName(next.startsAt, next.timeZone)
    return t('dashboard.learner.nextLine', { title: localized(next.class.name), day: when, time: formatClock(next.startsAt, language, next.timeZone) })
  })()

  const showStudent = many && !studentId
  const studentName = (student: { fullName: string; displayName: string | null }) => student.displayName || student.fullName.split(' ')[0]

  return (
    <div className="db lh">
      <header className="db-head">
        <span className="db-head__date">{dateLine}</span>
        <h1>{greeting}</h1>
        {/* A non-breaking space keeps the line's height while the lessons load (no shift when it fills). */}
        <p>{summary || '\u00a0'}</p>
      </header>

      {classes.loading && user?.roles.includes('guardian') ? (
        // The switch appears once «my classes» answers; a guardian most likely gets one, so its place is kept
        // meanwhile instead of pushing the page down when it arrives (a 0.58 layout shift on a phone).
        <div className="lh-switch lh-switch--pending" aria-hidden="true" />
      ) : many ? (
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
      ) : null}

      <div className="db-split lh-top">
        <Panel title={t('dashboard.learner.week')} extra={<Link to="/my-lessons">{t('dashboard.learner.allLessons')}</Link>}>
          <Loading loaded={lessons}>
            {(items) => {
              const agenda = agendaOf(items, day.zone).slice(0, AGENDA_DAYS)
              if (!agenda.length) return <p className="db-muted">{t('dashboard.learner.weekEmpty')}</p>
              return (
                <ol className="lh-agenda">
                  {agenda.map(({ date, lessons: ofDay }) => (
                    <li key={date}>
                      <h3 className={date === day.today ? 'lh-day lh-day--today' : 'lh-day'}>
                        {date === day.today ? t('dashboard.learner.today') : daysUntil(date, day.today) === 1 ? t('dashboard.learner.tomorrow') : dayName(`${date}T12:00:00Z`, 'UTC')}
                      </h3>
                      <ul>
                        {ofDay.map((lesson) => {
                          const isNext = next !== null && lesson.id === next.id && lesson.student.id === next.student.id
                          const started = Date.parse(lesson.startsAt) <= day.now
                          const live = started && Date.parse(lesson.endsAt) > day.now && lesson.status === 'scheduled'
                          const where = lesson.room ? (lesson.room.name ? localized(lesson.room.name) : lesson.room.code) : t('dashboard.online')
                          const classes = ['lh-lesson']
                          if (isNext) classes.push('lh-lesson--next')
                          if (lesson.status === 'cancelled') classes.push('lh-lesson--cancelled')
                          else if (Date.parse(lesson.endsAt) <= day.now) classes.push('lh-lesson--past')
                          return (
                            <li key={`${lesson.id}:${lesson.student.id}`} className={classes.join(' ')}>
                              <span className="lh-lesson__time tabular-nums" dir="ltr">
                                {formatLessonTimes(lesson.startsAt, lesson.endsAt, language, lesson.timeZone)}
                              </span>
                              <span className="lh-lesson__body">
                                <b>{localized(lesson.class.name)}</b>
                                <small>
                                  {[where, lesson.teacher?.fullName, showStudent ? studentName(lesson.student) : null].filter(Boolean).join(' · ')}
                                </small>
                              </span>
                              <span className="lh-lesson__state">
                                {lesson.status === 'cancelled' ? (
                                  <Tag>{t('dashboard.state.cancelled')}</Tag>
                                ) : lesson.attendance ? (
                                  <Tag color={ATTENDANCE_STATUS_COLORS[lesson.attendance.status]}>{t(`lessons.attendance.${lesson.attendance.status}`)}</Tag>
                                ) : live ? (
                                  <span className="lh-pill lh-pill--live">{t('dashboard.learner.now')}</span>
                                ) : isNext ? (
                                  <span className="lh-pill">{t('dashboard.learner.next')}</span>
                                ) : null}
                                {lesson.meetingUrl && !started && lesson.status !== 'cancelled' ? (
                                  <a href={lesson.meetingUrl} target="_blank" rel="noreferrer">
                                    {t('dashboard.learner.join')}
                                  </a>
                                ) : null}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </li>
                  ))}
                </ol>
              )
            }}
          </Loading>
        </Panel>

        <Panel title={t('dashboard.learner.waiting')}>
          <TodoList pending={pending} exams={exams} invoices={invoices} day={day} showStudent={showStudent} studentName={studentName} unread={unread} />
        </Panel>
      </div>

      <div className="db-split">
        <Panel title={t('dashboard.learner.results')} extra={canGrades ? <Link to="/my-grades">{t('dashboard.learner.allGrades')}</Link> : null}>
          {assignments.loading || exams.loading || grades.loading ? (
            <Skeleton active paragraph={{ rows: 3 }} title={false} />
          ) : (
            <ResultsList rows={resultsOf({ assignments: assignments.data ?? [], exams: exams.data ?? [], grades: grades.data ?? [] })} showStudent={showStudent} studentName={studentName} />
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
                        {localized(item.class.name)}
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

function TodoList({ pending, exams, invoices, day, showStudent, studentName, unread }: {
  pending: Loaded<MyAssignmentItem[]>
  exams: Loaded<MyExamItem[]>
  invoices: Loaded<MyInvoice[]>
  day: DayContext
  showStudent: boolean
  studentName: (student: { fullName: string; displayName: string | null }) => string
  unread: number | null
}) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const localized = (text: Parameters<typeof labelIn>[0]) => labelIn(text, language)
  if (pending.loading || exams.loading || invoices.loading) return <Skeleton active paragraph={{ rows: 3 }} title={false} />
  if (pending.error && exams.error) return <Alert type="warning" showIcon title={t('dashboard.loadFailed')} />
  const items = todoOf({ assignments: pending.data ?? [], exams: exams.data ?? [], invoices: invoices.data ?? [], zone: day.zone, today: day.today })
  const shortDay = (iso: string, zone: string) => new Intl.DateTimeFormat(language === 'ar' ? 'ar-u-nu-latn' : language, { weekday: 'long', day: 'numeric', month: 'long', timeZone: zone }).format(new Date(iso))
  const whenText = (days: number | null, iso: string | null, zone: string, prefix: 'due' | 'exam') => {
    if (days === null || iso === null) return t('dashboard.learner.noDue')
    if (days < 0) return t('dashboard.learner.overdueLate')
    if (days === 0) return t(`dashboard.learner.${prefix}Today`, { time: formatClock(iso, language, zone) })
    if (days === 1) return t(`dashboard.learner.${prefix}Tomorrow`, { time: formatClock(iso, language, zone) })
    return t(`dashboard.learner.${prefix}On`, { day: shortDay(iso, zone) })
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
              {whenText(todo.dueDays, item.dueAt, item.timeZone, 'due')} · {localized(item.class.name)}
              {who(item.student)}
            </small>
          </span>
          <Link to="/my-assignments">{item.relation === 'self' ? t('dashboard.learner.submit') : t('dashboard.learner.open')}</Link>
        </li>
      )
    }
    if (todo.kind === 'exam') {
      const item = todo.item
      return (
        <li key={todo.key} className={todo.inDays <= 1 ? 'lh-todo--urgent' : undefined}>
          <span className="lh-kind">{t('dashboard.learner.kind.exam')}</span>
          <span className="db-todo__text">
            {localized(item.title)}
            <small>
              {whenText(todo.inDays, item.scheduledAt, item.timeZone, 'exam')} · {localized(item.class.name)}
              {who(item.student)}
            </small>
          </span>
          <Link to="/my-exams">{t('dashboard.learner.open')}</Link>
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

function ResultsList({ rows, showStudent, studentName }: { rows: ResultRow[]; showStudent: boolean; studentName: (student: { fullName: string; displayName: string | null }) => string }) {
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
