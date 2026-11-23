// The admin home (J-F59 — the «Admin Dashboard Modern Redesign» spec of 2026-11-22, after a School Prime reference):
// the home page of the academy's admins and staff (and of custom-role holders); a teacher keeps the teacher's dashboard
// and a learner LearnerHome (pages/DashboardPage.tsx). From the top: a welcome with today's date and a refresh button,
// the quick actions (large icon cards to the existing pages), the academy's figures, then the lessons of today or of
// the week beside the latest notifications. Nothing new on the server: every section reads an existing API and shows
// only to a holder of the key that read needs — a section the viewer cannot read is left out, never filled with
// invented numbers; a failed section says so with a retry and leaves the others alone. The server stays the boundary.
import { ReloadOutlined } from '@ant-design/icons'
import { Button, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../../academy/useAcademy'
import { listEnrollmentRequests } from '../../api/enrollmentRequests'
import type { Lesson } from '../../api/lessons'
import { listMyNotifications } from '../../api/notifications'
import { REPORT_KEYS, getReportsOverview } from '../../api/reports'
import type { ReportsOverview } from '../../api/reports'
import { useAuth } from '../../auth/auth-context'
import { academyTimeZoneOf } from '../../common/timeZone'
import { ServerStatusCard } from '../../components/ServerStatusCard'
import { useLocalized } from '../../i18n/useLocalized'
import { canAccess } from '../../layout/navigation'
import { addDays, calendarDateIn } from '../../timetable/timetable.dates'
import { deviceTimeZone } from '../../timetable/timetable.settings'
import { RECENT_NOTIFICATIONS } from '../DashboardCards'
import { loadLessonsBetween } from '../dashboard.load'
import { useLoad } from '../useLoad'
import { useNow } from '../useNow'
import { quickActionsFor } from './admin.actions'
import { formatDayHeading } from './admin.format'
import { VIEW_DAYS } from './admin.lessons'
import type { ScheduleView } from './admin.lessons'
import { AdminOverviewCards } from './AdminOverviewCards'
import { AdminQuickActions } from './AdminQuickActions'
import { AdminRecentNotifications } from './AdminRecentNotifications'
import { AdminUpcomingLessons } from './AdminUpcomingLessons'
import './admin.css'

export function AdminDashboardHome() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { user, hasPermission } = useAuth()
  const { academy, loading: academyLoading } = useAcademy()
  const now = useNow()
  const [view, setView] = useState<ScheduleView>('day')

  const zone = academyTimeZoneOf(academy) ?? deviceTimeZone()
  const today = calendarDateIn(zone, now)

  const canReadOverview = REPORT_KEYS.some((key) => hasPermission(key))
  const canReadPending = hasPermission('enrollments.manage')
  const canReadLessons = hasPermission('lessons.read')

  const overview = useLoad<ReportsOverview>('overview', canReadOverview, (signal) => getReportsOverview(signal))
  // API-224 answers the academy's pending count with any page; one item is the smallest read.
  const pending = useLoad<number>('pending-requests', canReadPending, (signal) => listEnrollmentRequests({ limit: 1 }, signal).then((page) => page.pendingCount))
  // «Today» and the week are the academy's days, so the lessons wait for API-035 before their first read.
  const lessons = useLoad<Lesson[]>(`admin-lessons:${view}:${today}:${zone}`, canReadLessons && !academyLoading, (signal) =>
    loadLessonsBetween(today, addDays(today, VIEW_DAYS[view]), zone, signal),
  )
  const notifications = useLoad('notifications', true, (signal) => listMyNotifications({ limit: RECENT_NOTIFICATIONS }, signal))

  // The refresh button reads every section this viewer sees again (a read the viewer may not make is never sent).
  const reads: Array<{ loading: boolean; retry: () => void }> = [notifications]
  if (canReadOverview) reads.push(overview)
  if (canReadPending) reads.push(pending)
  if (canReadLessons) reads.push(lessons)
  const refreshing = reads.some((read) => read.loading)
  const refresh = () => reads.forEach((read) => read.retry())

  const actions = user ? quickActionsFor(user, hasPermission) : []

  return (
    <div className="admin-home">
      <section className="admin-welcome">
        <div className="admin-welcome__text">
          <Typography.Title level={1} className="admin-welcome__title">
            {t('dashboard.admin.title')}
          </Typography.Title>
          <Typography.Text className="admin-welcome__date">
            <time dateTime={today}>{formatDayHeading(today, language, true)}</time>
          </Typography.Text>
          <Typography.Paragraph type="secondary" className="admin-welcome__intro">
            {t('dashboard.admin.intro')}
          </Typography.Paragraph>
        </div>
        <Button icon={<ReloadOutlined />} onClick={refresh} loading={refreshing}>
          {t('dashboard.admin.refresh')}
        </Button>
      </section>

      <AdminQuickActions actions={actions} />

      <AdminOverviewCards
        overview={canReadOverview ? overview : null}
        pending={canReadPending ? pending : null}
        expects={{ attendance: hasPermission('reports.attendance.view'), financial: hasPermission('reports.financial.view') }}
      />

      <div className={canReadLessons ? 'admin-bottom' : 'admin-bottom admin-bottom--single'}>
        {canReadLessons ? (
          <AdminUpcomingLessons
            loaded={lessons}
            view={view}
            onViewChange={setView}
            zone={zone}
            today={today}
            now={now}
            canOpenLessons={user !== null && canAccess(user, 'lessons')}
          />
        ) : null}
        <AdminRecentNotifications loaded={notifications} canOpenAll={user !== null && canAccess(user, 'notifications')} />
      </div>

      <ServerStatusCard />
    </div>
  )
}
