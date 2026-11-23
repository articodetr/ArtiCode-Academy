// The academy's figures on the admin home (J-F59), smaller horizontal tiles under the quick actions. Every number is
// the server's — none is computed or invented here:
//   - API-164 GET /api/reports/overview (any reports.* key): active students, running classes, open classes and
//     today's lessons from its `general` section; the attendance rate of the last 30 days from `attendance` (only for
//     reports.attendance.view); the money still owed from `financial` (only for reports.financial.view), one line per
//     currency as the server sums it — amounts in different currencies are never added together;
//   - API-224 GET /api/enrollment-requests (enrollments.manage): `pendingCount`, the academy's pending requests.
// A figure the viewer cannot read is left out; a failed read says so with a retry and leaves the other tiles alone.
import { AppstoreAddOutlined, AppstoreOutlined, CalendarOutlined, CheckCircleOutlined, SolutionOutlined, TeamOutlined, WalletOutlined } from '@ant-design/icons'
import { Skeleton, Typography } from 'antd'
import { useId } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAcademy } from '../../academy/useAcademy'
import type { ReportsOverview } from '../../api/reports'
import { useLocalized } from '../../i18n/useLocalized'
import { CardFailure } from '../DashboardCards'
import { formatMoney } from '../dashboard.data'
import type { Reloadable } from '../useLoad'
import { formatCount, formatRate } from './admin.format'

type Tone = 'blue' | 'gold' | 'green' | 'violet'

interface StatTileProps {
  icon: ReactNode
  label: string
  tone: Tone
  loading: boolean
  value: ReactNode
  hint?: ReactNode
  testId: string
}

function StatTile({ icon, label, tone, loading, value, hint, testId }: StatTileProps) {
  return (
    <li className="admin-stat" data-testid={testId}>
      <span className={`admin-stat__icon admin-stat__icon--${tone}`} aria-hidden>
        {icon}
      </span>
      <div className="admin-stat__body">
        <div className="admin-stat__label">{label}</div>
        {loading ? <Skeleton.Input active size="small" style={{ width: 72, minWidth: 72 }} /> : <div className="admin-stat__value tabular-nums">{value}</div>}
        {hint ? <div className="admin-stat__hint">{hint}</div> : null}
      </div>
    </li>
  )
}

interface AdminOverviewCardsProps {
  /** API-164 — null when the viewer holds no reports.* key (no request, no tile). */
  overview: Reloadable<ReportsOverview> | null
  /** API-224's pendingCount — null without enrollments.manage. */
  pending: Reloadable<number> | null
  /** Whether the sections behind a key will come (while the overview is still being read). */
  expects: { attendance: boolean; financial: boolean }
}

export function AdminOverviewCards({ overview, pending, expects }: AdminOverviewCardsProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { academy } = useAcademy()
  const headingId = useId()
  if (!overview && !pending) return null

  const data = overview?.data ?? null
  const overviewLoading = overview !== null && data === null && !overview.error
  const tiles: ReactNode[] = []

  if (overview && !overview.error) {
    const general = data?.general
    tiles.push(
      <StatTile key="activeStudents" testId="stat-activeStudents" icon={<TeamOutlined />} tone="blue" loading={overviewLoading} label={t('dashboard.admin.stats.activeStudents')} value={formatCount(general?.activeStudents ?? 0, language)} />,
      <StatTile key="runningClasses" testId="stat-runningClasses" icon={<AppstoreOutlined />} tone="violet" loading={overviewLoading} label={t('dashboard.admin.stats.runningClasses')} value={formatCount(general?.runningClasses ?? 0, language)} />,
      <StatTile key="openClasses" testId="stat-openClasses" icon={<AppstoreAddOutlined />} tone="green" loading={overviewLoading} label={t('dashboard.admin.stats.openClasses')} value={formatCount(general?.openClasses ?? 0, language)} />,
      <StatTile key="lessonsToday" testId="stat-lessonsToday" icon={<CalendarOutlined />} tone="gold" loading={overviewLoading} label={t('dashboard.admin.stats.lessonsToday')} value={formatCount(general?.lessonsToday ?? 0, language)} />,
    )
    const attendance = data ? data.attendance : null
    if (data ? attendance !== null : expects.attendance) {
      const rate = attendance?.attendanceRate ?? null
      tiles.push(
        <StatTile
          key="attendanceRate"
          testId="stat-attendanceRate"
          icon={<CheckCircleOutlined />}
          tone="green"
          loading={overviewLoading}
          label={t('dashboard.admin.stats.attendanceRate')}
          // No record in the period: the server sends null — shown as a dash, never as 0 %.
          value={rate === null ? '—' : <bdi dir="ltr">{formatRate(rate, language)}</bdi>}
          hint={t('dashboard.admin.stats.attendancePeriod')}
        />,
      )
    }
    const financial = data ? data.financial : null
    if (data ? financial !== null : expects.financial) {
      const owed = financial?.outstanding ?? []
      const lines = owed.length
        ? owed.map((row) => ({ key: row.currency, text: formatMoney(row.balance, row.currency, language) }))
        : [{ key: 'none', text: academy?.currency ? formatMoney(0, academy.currency, language) : formatCount(0, language) }]
      tiles.push(
        <StatTile
          key="outstanding"
          testId="stat-outstanding"
          icon={<WalletOutlined />}
          tone="gold"
          loading={overviewLoading}
          label={t('dashboard.admin.stats.outstanding')}
          value={
            <span className="admin-stat__money">
              {lines.map((line) => (
                <bdi key={line.key} dir="ltr">
                  {line.text}
                </bdi>
              ))}
            </span>
          }
        />,
      )
    }
  }

  if (pending && !pending.error) {
    tiles.push(
      <StatTile
        key="pendingRequests"
        testId="stat-pendingRequests"
        icon={<SolutionOutlined />}
        tone="violet"
        loading={pending.data === null}
        label={t('dashboard.admin.stats.pendingRequests')}
        value={formatCount(pending.data ?? 0, language)}
        hint={<Link to="/enrollment-requests">{t('dashboard.admin.stats.review')}</Link>}
      />,
    )
  }

  return (
    <section className="admin-stats" aria-labelledby={headingId}>
      <Typography.Title level={2} id={headingId} className="admin-section__title">
        {t('dashboard.admin.statistics')}
      </Typography.Title>
      {overview?.error ? (
        <div className="admin-stats__failure" data-testid="stats-failure">
          <CardFailure onRetry={overview.retry} />
        </div>
      ) : null}
      {pending?.error ? (
        <div className="admin-stats__failure" data-testid="pending-failure">
          <CardFailure onRetry={pending.retry} />
        </div>
      ) : null}
      {tiles.length ? <ul className="admin-stats__grid">{tiles}</ul> : null}
    </section>
  )
}
