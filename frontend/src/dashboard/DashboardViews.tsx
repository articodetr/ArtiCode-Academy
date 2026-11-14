// The views of the dashboard (redesign, 2026-11-14). Each one reads only what its job needs, and only what the
// caller may read (useLoad's `enabled` mirrors the key the server checks); a section the caller may not read is
// left out rather than shown empty. Numbers come from the server as they are — nothing is estimated here.
import { Alert, Empty, Skeleton } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { AcademyClass } from '../api/classes'
import type { Lesson } from '../api/lessons'
import type { ReportsOverview } from '../api/reports'
import type { LocalizedLabel } from '../api/users'
import { getAttendanceByClass, getCollections, getReceivables } from '../api/reports'
import { listRooms } from '../api/rooms'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { formatClock } from '../lessons/lessons.format'
import { addDays, weekDatesOf } from '../timetable/timetable.dates'
import type { AttentionItem } from './dashboard.data'
import { busyMinutes, classesWithoutTeacher, dayWindow, formatMoney, labelIn, lanesByRoom, lanesByTeacher, lessonState, monthsBack, packRows, wallDate } from './dashboard.data'
import { loadLessonsBetween } from './dashboard.load'
import { DayTimeline } from './DayTimeline'
import type { Loaded } from './useLoad'
import { useLoad } from './useLoad'

export interface DayContext {
  zone: string
  today: string
  now: number
  nowMinutes: number
}

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

function LoadState<T>({ loaded, children }: { loaded: Loaded<T>; children: (data: T) => ReactNode }) {
  const { t } = useTranslation()
  if (loaded.loading) return <Skeleton active paragraph={{ rows: 3 }} title={false} />
  if (loaded.error || loaded.data === null) return <Alert type="warning" showIcon title={t('dashboard.loadFailed')} />
  return <>{children(loaded.data)}</>
}

/* ------------------------------------------------------------------ Today */

export function TodayView({ day, todayLessons, overview, classes, attention }: {
  day: DayContext
  todayLessons: Loaded<Lesson[]>
  overview: Loaded<ReportsOverview>
  classes: Loaded<AcademyClass[]>
  attention: AttentionItem[]
}) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { hasPermission } = useAuth()
  const canSeeLessons = hasPermission('lessons.read')

  return (
    <div className="db-stack">
      <Panel title={t('dashboard.todayLessons')}>
        {canSeeLessons ? (
          <LoadState loaded={todayLessons}>
            {(lessons) =>
              lessons.length ? (
                <DayTimeline
                  lanes={packRows(lessons).map((row, index) => ({ key: String(index), lessons: row }))}
                  window={dayWindow(lessons, day.zone)}
                  zone={day.zone}
                  now={day.now}
                  nowMinutes={day.nowMinutes}
                  showNow
                  detail="roomAndTeacher"
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dashboard.noLessonsToday')} />
              )
            }
          </LoadState>
        ) : (
          <p className="db-muted">
            {t('dashboard.noLessonsAccess')} <Link to="/my-lessons">{t('nav.myLessons')}</Link>
          </p>
        )}
      </Panel>

      <div className="db-split">
        <Panel title={t('dashboard.needsYou')}>
          {todayLessons.loading || overview.loading || classes.loading ? (
            <Skeleton active paragraph={{ rows: 3 }} title={false} />
          ) : attention.length ? (
            <ul className="db-todo">
              {attention.map((item) => (
                <li key={`${item.kind}:${item.detail?.currency ?? ''}`}>
                  <span className="db-count tabular-nums">{item.count}</span>
                  <span className="db-todo__text">
                    {t(`dashboard.attention.${item.kind}`)}
                    {item.kind === 'overdue' && item.detail ? (
                      <small className="tabular-nums">{t('dashboard.attention.overdueDetail', { amount: formatMoney(Number(item.detail.amount), String(item.detail.currency), language) })}</small>
                    ) : null}
                  </span>
                  <Link to={item.path}>{t(`dashboard.attentionAction.${item.kind}`)}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="db-clear">{t('dashboard.allClear')}</p>
          )}
        </Panel>

        <Panel title={t('dashboard.numbers')}>
          <NumbersList overview={overview} todayCount={todayLessons.data?.length ?? null} />
        </Panel>
      </div>
    </div>
  )
}

function NumbersList({ overview, todayCount }: { overview: Loaded<ReportsOverview>; todayCount: number | null }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const rows: Array<[string, string]> = []
  const data = overview.data
  if (data) {
    rows.push([t('dashboard.stats.activeStudents'), String(data.general.activeStudents)])
    rows.push([t('dashboard.stats.runningClasses'), String(data.general.runningClasses)])
    if (data.attendance?.attendanceRate !== null && data.attendance?.attendanceRate !== undefined) {
      rows.push([t('dashboard.stats.attendanceRate'), `${Math.round(data.attendance.attendanceRate)}%`])
    }
    for (const row of data.financial?.collected ?? []) rows.push([t('dashboard.stats.collected'), formatMoney(row.amount, row.currency, language)])
  } else if (todayCount !== null) {
    rows.push([t('dashboard.stats.lessonsToday'), String(todayCount)])
  }
  if (overview.loading) return <Skeleton active paragraph={{ rows: 3 }} title={false} />
  if (!rows.length) return <p className="db-muted">{t('dashboard.noNumbers')}</p>
  return (
    <dl className="db-numbers tabular-nums">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/* ------------------------------------------------------------------- Week */

export function WeekView({ day, weekStartsOn }: { day: DayContext; weekStartsOn: number }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const localized = (text: LocalizedLabel) => labelIn(text, language)
  const dates = weekDatesOf(day.today, weekStartsOn)
  const from = dates[0]
  const lessons = useLoad(`week:${from}:${day.zone}`, true, (signal) => loadLessonsBetween(from, addDays(from, 7), day.zone, signal))
  const dayName = new Intl.DateTimeFormat(language === 'ar' ? 'ar-u-nu-latn' : language, { weekday: 'long', timeZone: 'UTC' })

  return (
    <Panel title={t('dashboard.week.title')}>
      <LoadState loaded={lessons}>
        {(items) => (
          <div className="db-week">
            {dates.map((date) => {
              const ofDay = items.filter((lesson) => wallDate(lesson.startsAt, day.zone) === date).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
              const isToday = date === day.today
              return (
                <div key={date} className={isToday ? 'db-day db-day--today' : 'db-day'}>
                  <h3>
                    {dayName.format(new Date(`${date}T12:00:00Z`))}
                    <span className="tabular-nums">{Number(date.slice(8))}</span>
                  </h3>
                  {isToday ? <span className="db-day__today">{t('dashboard.week.today')}</span> : null}
                  {ofDay.length ? (
                    ofDay.map((lesson) => {
                      const state = lessonState(lesson, day.now)
                      return (
                        <Link key={lesson.id} to="/lessons" className={`db-chip db-chip--${state}`}>
                          <b>{localized(lesson.class.name)}</b>
                          <span className="tabular-nums">
                            {formatClock(lesson.startsAt, language, day.zone)} · {state === 'needsAttendance' || state === 'cancelled' ? t(`dashboard.state.${state}`) : lesson.room?.code ?? t('dashboard.online')}
                          </span>
                        </Link>
                      )
                    })
                  ) : (
                    <p className="db-day__empty">{t('dashboard.week.empty')}</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </LoadState>
    </Panel>
  )
}

/* ---------------------------------------------------------------- Classes */

export function ClassesView({ classes }: { classes: Loaded<AcademyClass[]> }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const localized = (text: LocalizedLabel) => labelIn(text, language)
  const { hasPermission } = useAuth()
  const rates = useLoad('classes:attendance', hasPermission('reports.attendance.view'), (signal) => getAttendanceByClass(undefined, signal))
  const rateOf = new Map((rates.data?.rows ?? []).map((row) => [row.class.id, row.attendanceRate]))

  return (
    <Panel title={t('dashboard.classes.title')} extra={<Link to="/classes">{t('dashboard.classes.all')}</Link>}>
      <LoadState loaded={classes}>
        {(items) => {
          const running = items.filter((klass) => klass.status === 'running' || klass.status === 'open')
          const bare = new Set(classesWithoutTeacher(items).map((klass) => klass.id))
          if (!running.length && !bare.size) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dashboard.classes.empty')} />
          const shown = [...running, ...items.filter((klass) => bare.has(klass.id) && !running.includes(klass))]
          return (
            <div className="db-tiles">
              {shown.map((klass) => {
                const lead = klass.teachers.find((teacher) => teacher.role === 'lead') ?? klass.teachers[0]
                const rate = rateOf.get(klass.id)
                const full = klass.enrolledCount >= klass.capacity
                const alert = bare.has(klass.id) || (rate !== undefined && rate !== null && rate < 75)
                return (
                  <Link key={klass.id} to="/classes" className={alert ? 'db-tile db-tile--alert' : 'db-tile'}>
                    <div className="db-tile__top">
                      <div>
                        <b>{localized(klass.name)}</b>
                        <small>{localized(klass.course.name)}</small>
                      </div>
                      {rate !== undefined ? (
                        <span className={rate !== null && rate < 75 ? 'db-ring db-ring--low' : 'db-ring'} style={{ ['--p' as string]: rate ?? 0 }} title={t('dashboard.classes.attendance')}>
                          <span className="tabular-nums">{rate === null ? '—' : `${Math.round(rate)}%`}</span>
                        </span>
                      ) : null}
                    </div>
                    <div className="db-tile__who">{lead ? lead.fullName : <span className="db-flag">{t('dashboard.noTeacher')}</span>}</div>
                    <div className="db-seats">
                      <span className="tabular-nums">{t('dashboard.classes.seats', { enrolled: klass.enrolledCount, capacity: klass.capacity })}</span>
                      <span className={full ? 'db-bar db-bar--full' : 'db-bar'}>
                        <i style={{ width: `${Math.min(100, (klass.enrolledCount / Math.max(1, klass.capacity)) * 100)}%` }} />
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )
        }}
      </LoadState>
    </Panel>
  )
}

/* ------------------------------------------------------- Teachers / Rooms */

export function TeachersView({ day, todayLessons }: { day: DayContext; todayLessons: Loaded<Lesson[]> }) {
  const { t } = useTranslation()
  return (
    <Panel title={t('dashboard.teachers.title')}>
      <LoadState loaded={todayLessons}>
        {(lessons) => {
          const lanes = lanesByTeacher(lessons)
          if (!lanes.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dashboard.teachers.empty')} />
          return (
            <DayTimeline
              lanes={lanes.map((lane) => ({
                key: lane.key,
                lessons: lane.lessons,
                label: (
                  <span className="db-lane-label">
                    <b>{lane.key === 'none' ? t('dashboard.noTeacher') : lane.lessons[0].teacher?.fullName}</b>
                    <small className="tabular-nums">{t('dashboard.teachers.hours', { hours: (busyMinutes(lane.lessons) / 60).toFixed(1).replace(/\.0$/, '') })}</small>
                  </span>
                ),
              }))}
              window={dayWindow(lessons, day.zone)}
              zone={day.zone}
              now={day.now}
              nowMinutes={day.nowMinutes}
              showNow
              detail="room"
            />
          )
        }}
      </LoadState>
    </Panel>
  )
}

export function RoomsView({ day, todayLessons }: { day: DayContext; todayLessons: Loaded<Lesson[]> }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const localized = (text: LocalizedLabel) => labelIn(text, language)
  const rooms = useLoad('rooms', true, (signal) => listRooms({}, signal))
  return (
    <div className="db-stack">
      <Panel title={t('dashboard.rooms.title')}>
        <LoadState loaded={todayLessons}>
          {(lessons) => {
            const used = lanesByRoom(lessons)
            const usedIds = new Set(used.map((lane) => lane.key))
            const idle = (rooms.data?.items ?? []).filter((room) => !usedIds.has(room.id))
            const lanes = [
              ...used.map((lane) => ({
                key: lane.key,
                lessons: lane.lessons,
                label: <b>{lane.key === 'none' ? t('dashboard.online') : lane.lessons[0].room?.code}</b>,
              })),
              ...idle.map((room) => ({ key: room.id, lessons: [], label: <b className="db-muted">{room.code}</b> })),
            ]
            if (!lanes.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dashboard.rooms.empty')} />
            return <DayTimeline lanes={lanes} window={dayWindow(lessons, day.zone)} zone={day.zone} now={day.now} nowMinutes={day.nowMinutes} showNow detail="teacher" />
          }}
        </LoadState>
      </Panel>
      <Panel title={t('dashboard.rooms.freeNow')}>
        <LoadState loaded={rooms}>
          {(list) => {
            const busy = new Set(
              (todayLessons.data ?? [])
                .filter((lesson) => lesson.room && lesson.status !== 'cancelled' && Date.parse(lesson.startsAt) <= day.now && Date.parse(lesson.endsAt) > day.now)
                .map((lesson) => lesson.room!.id),
            )
            const free = list.items.filter((room) => !busy.has(room.id))
            return free.length ? (
              <div className="db-tags">
                {free.map((room) => (
                  <span key={room.id} className="db-tag">
                    {room.code}
                    {room.name ? ` · ${localized(room.name)}` : ''}
                  </span>
                ))}
              </div>
            ) : (
              <p className="db-muted">{list.items.length ? t('dashboard.rooms.noneFree') : t('dashboard.rooms.empty')}</p>
            )
          }}
        </LoadState>
      </Panel>
    </div>
  )
}

/* ---------------------------------------------------------------- Finance */

export function FinanceView({ day, overview }: { day: DayContext; overview: Loaded<ReportsOverview> }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const months = monthsBack(day.today.slice(0, 7), 6)
  const collections = useLoad(`collections:${months[0]}`, true, (signal) => getCollections({ from: `${months[0]}-01`, to: day.today }, signal))
  const receivables = useLoad('receivables', true, (signal) => getReceivables(true, signal))
  const monthName = new Intl.DateTimeFormat(language === 'ar' ? 'ar-u-nu-latn' : language, { month: 'short', timeZone: 'UTC' })

  return (
    <div className="db-stack">
      <LoadState loaded={overview}>
        {(data) => {
          const financial = data.financial
          if (!financial) return null
          const cells: Array<{ label: string; value: string; tone?: 'bad' }> = []
          for (const row of financial.collected) cells.push({ label: t('dashboard.finance.collected'), value: formatMoney(row.amount, row.currency, language) })
          for (const row of financial.outstanding) {
            cells.push({ label: t('dashboard.finance.outstanding'), value: formatMoney(row.balance, row.currency, language) })
            cells.push({ label: t('dashboard.finance.overdue'), value: formatMoney(row.overdue, row.currency, language), tone: row.overdue > 0 ? 'bad' : undefined })
            cells.push({ label: t('dashboard.finance.studentsOverdue'), value: String(row.studentsOverdue) })
          }
          if (!cells.length) cells.push({ label: t('dashboard.finance.collected'), value: '0' })
          return (
            <div className="db-kpis tabular-nums">
              {cells.map((cell, index) => (
                <div key={index}>
                  <b className={cell.tone === 'bad' ? 'db-bad' : undefined}>{cell.value}</b>
                  <small>{cell.label}</small>
                </div>
              ))}
            </div>
          )
        }}
      </LoadState>

      <div className="db-split">
        <Panel title={t('dashboard.finance.chart')}>
          <LoadState loaded={collections}>
            {(report) => {
              const currency = report.totals[0]?.currency ?? report.rows[0]?.currency
              const sums = months.map((month) => report.rows.filter((row) => row.month === month && row.currency === currency).reduce((sum, row) => sum + row.amount, 0))
              const top = Math.max(1, ...sums)
              return currency ? (
                <div className="db-chart tabular-nums">
                  {months.map((month, index) => (
                    <div key={month} className={index === months.length - 1 ? 'db-chart__col db-chart__col--now' : 'db-chart__col'}>
                      <small>{formatMoney(sums[index], currency, language)}</small>
                      <i style={{ height: `${Math.max(2, (sums[index] / top) * 100)}%` }} />
                      <span>{monthName.format(new Date(`${month}-15T12:00:00Z`))}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dashboard.finance.noPayments')} />
              )
            }}
          </LoadState>
        </Panel>

        <Panel title={t('dashboard.finance.aging')}>
          <LoadState loaded={receivables}>
            {(report) => {
              const totals = report.totals[0]
              if (!totals || totals.overdue <= 0) return <p className="db-clear">{t('dashboard.finance.none')}</p>
              const parts = [
                ['aging1', totals.aging.days1To30, 'db-age1'],
                ['aging2', totals.aging.days31To60, 'db-age2'],
                ['aging3', totals.aging.days61To90, 'db-age3'],
                ['aging4', totals.aging.days91Plus, 'db-age4'],
              ] as const
              return (
                <>
                  <div className="db-aging" aria-hidden="true">
                    {parts.map(([key, amount, tone]) => (amount > 0 ? <i key={key} className={tone} style={{ flexGrow: amount }} /> : null))}
                  </div>
                  <ul className="db-legend tabular-nums">
                    {parts.map(([key, amount, tone]) => (
                      <li key={key}>
                        <i className={tone} />
                        {t(`dashboard.finance.${key}`)}: {formatMoney(amount, totals.currency, language)}
                      </li>
                    ))}
                  </ul>
                </>
              )
            }}
          </LoadState>
        </Panel>
      </div>

      <Panel title={t('dashboard.finance.overdueList')} extra={<Link to="/payments">{t('dashboard.finance.open')}</Link>}>
        <LoadState loaded={receivables}>
          {(report) => {
            const rows = report.rows.filter((row) => row.overdue > 0).sort((a, b) => b.overdue - a.overdue).slice(0, 8)
            if (!rows.length) return <p className="db-clear">{t('dashboard.finance.none')}</p>
            return (
              <table className="db-table tabular-nums">
                <thead>
                  <tr>
                    <th>{t('dashboard.finance.student')}</th>
                    <th>{t('dashboard.finance.amount')}</th>
                    <th>{t('dashboard.finance.since')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.student.id}:${row.currency}`}>
                      <td>{row.student.displayName ?? row.student.fullName}</td>
                      <td className="db-bad">{formatMoney(row.overdue, row.currency, language)}</td>
                      <td>
                        <span className={(row.daysOverdue ?? 0) > 60 ? 'db-pill db-pill--bad' : 'db-pill'}>{t('dashboard.finance.days', { days: row.daysOverdue ?? 0 })}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }}
        </LoadState>
      </Panel>
    </div>
  )
}
