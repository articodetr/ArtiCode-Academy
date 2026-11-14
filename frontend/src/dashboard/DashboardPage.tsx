// The dashboard (redesign, 2026-11-14): a greeting with one sentence about the day, then views as tabs —
// Today (the default: the day timeline, what needs the user, the numbers), Week, Classes, Teachers, Rooms and
// Finance. Each view shows only to a holder of the keys the server checks for its data; the chosen view lives in
// the address (`?view=`), so a reload or a shared link opens it again.
import { Tabs } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { useAcademy } from '../academy/useAcademy'
import type { Lesson } from '../api/lessons'
import { REPORT_KEYS, getReportsOverview } from '../api/reports'
import { useAuth } from '../auth/auth-context'
import { academyTimeZoneOf } from '../common/timeZone'
import { useLocalized } from '../i18n/useLocalized'
import { formatClock } from '../lessons/lessons.format'
import { addDays, calendarDateIn, minutesNowIn } from '../timetable/timetable.dates'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { attentionItems, labelIn, lessonState, visibleViews } from './dashboard.data'
import type { DashboardView } from './dashboard.data'
import { loadAllClasses, loadLessonsBetween } from './dashboard.load'
import { ClassesView, FinanceView, RoomsView, TeachersView, TodayView, WeekView } from './DashboardViews'
import type { DayContext } from './DashboardViews'
import { isLearnerOnly } from './learner.data'
import { LearnerHome } from './LearnerHome'
import { useLoad } from './useLoad'
import './dashboard.css'

/** Ticks once a minute so the "now" line and the lesson states follow the clock. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export function DashboardPage() {
  const { user } = useAuth()
  // A student or guardian with no other role gets their own home (redesign): the staff reads below show them nothing.
  return isLearnerOnly(user?.roles ?? []) ? <LearnerDashboard /> : <StaffDashboard />
}

/** The greeting, the date line and the day context shared by both homes. */
function useHomeHeader() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { user } = useAuth()
  const { academy, loading } = useAcademy()
  const now = useNow()
  const zone = academyTimeZoneOf(academy) ?? deviceTimeZone()
  const day: DayContext = { zone, today: calendarDateIn(zone, now), now, nowMinutes: minutesNowIn(zone, now) }
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: zone }).format(now))
  const greeting = t(hour < 12 ? 'dashboard.greeting.morning' : 'dashboard.greeting.evening', { name: user?.name ?? '' })
  const dateLine = new Intl.DateTimeFormat(language === 'ar' ? 'ar-u-nu-latn' : language, { weekday: 'long', day: 'numeric', month: 'long', timeZone: zone }).format(now)
  return { day, greeting, dateLine, academyLoading: loading }
}

function LearnerDashboard() {
  const { day, greeting, dateLine, academyLoading } = useHomeHeader()
  if (academyLoading) return null
  return <LearnerHome day={day} greeting={greeting} dateLine={dateLine} />
}

function StaffDashboard() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { user, hasPermission } = useAuth()
  const { academy, loading: academyLoading } = useAcademy()
  const [params, setParams] = useSearchParams()
  const now = useNow()

  const zone = academyTimeZoneOf(academy) ?? deviceTimeZone()
  const today = calendarDateIn(zone, now)
  const day: DayContext = { zone, today, now, nowMinutes: minutesNowIn(zone, now) }
  const weekStartsOn = academy?.settings?.scheduling?.weekStartsOn ?? 6

  // The reads of the Today view, shared with the views that use the same data (no second request).
  const ready = !academyLoading
  const todayLessons = useLoad<Lesson[]>(`today:${today}:${zone}`, ready && hasPermission('lessons.read'), (signal) => loadLessonsBetween(today, addDays(today, 1), zone, signal))
  const overview = useLoad(`overview`, REPORT_KEYS.some((key) => hasPermission(key)), (signal) => getReportsOverview(signal))
  const classes = useLoad('classes', hasPermission('classes.read'), loadAllClasses)

  const attention = useMemo(
    () => attentionItems({ todayLessons: todayLessons.data, overview: overview.data, classes: classes.data, now }),
    [todayLessons.data, overview.data, classes.data, now],
  )

  const views = visibleViews(hasPermission)
  const asked = params.get('view') as DashboardView | null
  const view: DashboardView = asked && views.includes(asked) ? asked : 'today'

  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: zone }).format(now))
  const greeting = t(hour < 12 ? 'dashboard.greeting.morning' : 'dashboard.greeting.evening', { name: user?.name ?? '' })
  const dateLine = new Intl.DateTimeFormat(language === 'ar' ? 'ar-u-nu-latn' : language, { weekday: 'long', day: 'numeric', month: 'long', timeZone: zone }).format(now)

  const lessons = todayLessons.data
  const next = lessons?.find((lesson) => lessonState(lesson, now) === 'upcoming')
  const summary = lessons
    ? [
        t('dashboard.summary.count', { count: lessons.filter((lesson) => lesson.status !== 'cancelled').length }),
        next ? t('dashboard.summary.next', { title: labelIn(next.class.name, language), time: formatClock(next.startsAt, language, zone) }) : '',
      ].join(' ')
    : t('dashboard.subtitle')

  const badge = (count: number) => (count > 0 ? <span className="db-badge tabular-nums">{count}</span> : null)
  const attentionTotal = attention.reduce((sum, item) => sum + (item.kind === 'overdue' ? 1 : item.count), 0)
  const overdueStudents = attention.filter((item) => item.kind === 'overdue').reduce((sum, item) => sum + item.count, 0)
  const bareClasses = attention.find((item) => item.kind === 'noTeacher')?.count ?? 0

  const content: Record<DashboardView, ReactNode> = {
    today: <TodayView day={day} todayLessons={todayLessons} overview={overview} classes={classes} attention={attention} />,
    week: <WeekView day={day} weekStartsOn={weekStartsOn} />,
    classes: <ClassesView classes={classes} />,
    teachers: <TeachersView day={day} todayLessons={todayLessons} />,
    rooms: <RoomsView day={day} todayLessons={todayLessons} />,
    finance: <FinanceView day={day} overview={overview} />,
  }
  const badges: Partial<Record<DashboardView, ReactNode>> = {
    today: badge(attentionTotal),
    classes: badge(bareClasses),
    finance: badge(overdueStudents),
  }

  return (
    <div className="db">
      <header className="db-head">
        <span className="db-head__date">{dateLine}</span>
        <h1>{greeting}</h1>
        <p>{summary}</p>
      </header>

      {views.length > 1 ? (
        <Tabs
          className="db-tabs"
          activeKey={view}
          onChange={(key) => {
            const next = new URLSearchParams(params)
            if (key === 'today') next.delete('view')
            else next.set('view', key)
            setParams(next, { replace: true })
          }}
          items={views.map((key) => ({
            key,
            label: (
              <span className="db-tab">
                {t(`dashboard.views.${key}`)}
                {badges[key]}
              </span>
            ),
          }))}
        />
      ) : null}

      <div className="db-view">{content[view]}</div>
    </div>
  )
}
