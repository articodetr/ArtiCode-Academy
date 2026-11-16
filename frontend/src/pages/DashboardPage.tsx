// The home page. A student or a guardian with no other role gets the learner home (LearnerHome, built from the
// «my …» reads); everyone else gets the staff dashboard in the classic layout — the four number cards, today's
// lessons beside the latest notifications, then the open and running classes. Every card reads the server and
// shows only to a holder of the keys its read needs (the server stays the boundary):
//   - the number cards: API-164 GET /api/reports/overview, for any of the three reports.* keys — its `general`
//     section for everyone of them, `financial` (the money card) only for reports.financial.view;
//   - today's lessons: API-093 GET /api/lessons, for lessons.read (a teacher gets the lessons of their classes);
//   - the classes: API-050 GET /api/classes (running, then open), for classes.read (D-R16: a teacher's own);
//   - the notifications: API-167 GET /api/me/notifications, by ownership (no key).
// A card that cannot be read is left out, never filled with invented numbers; a failed card says so and offers
// to try again without breaking the others.
import {
  AppstoreOutlined,
  CalendarOutlined,
  CreditCardOutlined,
  ReloadOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Alert, Badge, Button, Card, Col, Empty, Row, Skeleton, Statistic, Table, Tag, Typography, theme } from 'antd'
import type { TableProps } from 'antd'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAcademy } from '../academy/useAcademy'
import type { AcademyClass } from '../api/classes'
import type { Lesson } from '../api/lessons'
import { listMyNotifications } from '../api/notifications'
import type { MyNotification } from '../api/notifications'
import { REPORT_KEYS, getReportsOverview } from '../api/reports'
import type { ReportsOverview } from '../api/reports'
import { useAuth } from '../auth/auth-context'
import { academyTimeZoneOf } from '../common/timeZone'
import { PageHeader } from '../components/PageHeader'
import { ServerStatusCard } from '../components/ServerStatusCard'
import { StatusTag } from '../components/StatusTag'
import { formatMoney, labelIn } from '../dashboard/dashboard.data'
import { loadActiveClasses, loadLessonsBetween } from '../dashboard/dashboard.load'
import { LearnerHome } from '../dashboard/LearnerHome'
import { isLearnerOnly } from '../dashboard/learner.data'
import { useLoad } from '../dashboard/useLoad'
import type { Reloadable } from '../dashboard/useLoad'
import { useLocalized } from '../i18n/useLocalized'
import { canAccess } from '../layout/navigation'
import { formatLessonDateTime, formatLessonTimes } from '../lessons/lessons.format'
import { LessonZoneNote } from '../lessons/LessonZone'
import { notificationZone } from '../notifications/notifications.view'
import { addDays, calendarDateIn, minutesNowIn } from '../timetable/timetable.dates'
import { deviceTimeZone } from '../timetable/timetable.settings'

/** How many of the latest notifications the card lists. */
const RECENT_NOTIFICATIONS = 4

/** Ticks once a minute so the homes follow the clock (the learner's day, the staff's «today»). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

/** A student or guardian with no other role gets their own home from the «my …» reads (ported from the redesign). */
function LearnerDashboard() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { user } = useAuth()
  const { academy, loading } = useAcademy()
  const now = useNow()
  if (loading) return null
  const zone = academyTimeZoneOf(academy) ?? deviceTimeZone()
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: zone }).format(now))
  const greeting = t(hour < 12 ? 'dashboard.greeting.morning' : 'dashboard.greeting.evening', { name: user?.name ?? '' })
  const dateLine = new Intl.DateTimeFormat(language === 'ar' ? 'ar-u-nu-latn' : language, { weekday: 'long', day: 'numeric', month: 'long', timeZone: zone }).format(now)
  return <LearnerHome day={{ zone, today: calendarDateIn(zone, now), now, nowMinutes: minutesNowIn(zone, now) }} greeting={greeting} dateLine={dateLine} />
}

export function DashboardPage() {
  const { user } = useAuth()
  return isLearnerOnly(user?.roles ?? []) ? <LearnerDashboard /> : <StaffDashboard />
}

/** A card's failure: a short message and a way to ask again. */
function CardFailure({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <Alert
      type="warning"
      showIcon
      title={t('dashboard.cardFailed')}
      action={
        <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
          {t('dashboard.retry')}
        </Button>
      }
    />
  )
}

/**
 * The body of a list card: the failure with a retry, a skeleton while reading (also while the read still waits —
 * today's lessons wait for the academy's zone), or the server's answer.
 */
function CardContent<T>({ loaded, children }: { loaded: Reloadable<T>; children: (data: T) => ReactNode }) {
  if (loaded.error) return <CardFailure onRetry={loaded.retry} />
  if (loaded.loading || loaded.data === null) return <Skeleton active paragraph={{ rows: 3 }} title={false} />
  return <>{children(loaded.data)}</>
}

function StaffDashboard() {
  const { t } = useTranslation()
  const { user, hasPermission } = useAuth()
  const { academy, loading: academyLoading } = useAcademy()
  const now = useNow()

  const zone = academyTimeZoneOf(academy) ?? deviceTimeZone()
  const today = calendarDateIn(zone, now)

  const canReadOverview = REPORT_KEYS.some((key) => hasPermission(key))
  const canReadLessons = hasPermission('lessons.read')
  const canReadClasses = hasPermission('classes.read')
  // A card links to its page only when the menu would open it for this viewer.
  const linkTo = (navKey: string, path: string, label: string) => (user && canAccess(user, navKey) ? <Link to={path}>{label}</Link> : undefined)

  const overview = useLoad<ReportsOverview>('overview', canReadOverview, (signal) => getReportsOverview(signal))
  // «Today» is the academy's day, so the lessons wait for API-035 before their first read.
  const lessons = useLoad<Lesson[]>(`lessons:${today}:${zone}`, canReadLessons && !academyLoading, (signal) => loadLessonsBetween(today, addDays(today, 1), zone, signal))
  const classes = useLoad<AcademyClass[]>('classes', canReadClasses, loadActiveClasses)
  const notifications = useLoad('notifications', true, (signal) => listMyNotifications({ limit: RECENT_NOTIFICATIONS }, signal))

  return (
    <>
      <PageHeader
        title={t('dashboard.welcome', { name: user?.name ?? '' })}
        subtitle={t('dashboard.subtitle')}
      />

      <ServerStatusCard />

      {canReadOverview ? <OverviewCards overview={overview} withMoney={hasPermission('reports.financial.view')} /> : null}

      <Row gutter={[16, 16]} style={{ marginTop: canReadOverview ? 16 : 0 }}>
        {canReadLessons ? (
          <Col xs={24} xl={14}>
            <Card title={t('dashboard.todayLessons')} extra={linkTo('lessons', '/lessons', t('nav.lessons'))}>
              <CardContent loaded={lessons}>{(items) => <TodayLessonsTable lessons={items} dayZone={zone} />}</CardContent>
            </Card>
          </Col>
        ) : null}
        <Col xs={24} xl={canReadLessons ? 10 : 24}>
          <Card title={t('dashboard.recentNotifications')} extra={linkTo('notifications', '/notifications', t('dashboard.allNotifications'))}>
            <CardContent loaded={notifications}>{(page) => <RecentNotifications items={page.items} />}</CardContent>
          </Card>
        </Col>
      </Row>

      {canReadClasses ? (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24}>
            <Card title={t('dashboard.classes.title')} extra={linkTo('classes', '/classes', t('dashboard.classes.all'))}>
              <CardContent loaded={classes}>{(items) => <ActiveClassesTable classes={items} />}</CardContent>
            </Card>
          </Col>
        </Row>
      ) : null}
    </>
  )
}

/**
 * The four number cards of API-164: three from its `general` section, and the money still owed — per currency,
 * as the server sums it — only while its `financial` section comes (a holder of reports.financial.view).
 */
function OverviewCards({ overview, withMoney }: { overview: Reloadable<ReportsOverview>; withMoney: boolean }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { academy } = useAcademy()

  if (overview.error) {
    return (
      <Row gutter={[16, 16]}>
        <Col xs={24}>
          <Card>
            <CardFailure onRetry={overview.retry} />
          </Card>
        </Col>
      </Row>
    )
  }

  const data = overview.data
  const loading = data === null
  const financial = data?.financial ?? null
  const showMoney = data ? financial !== null : withMoney
  const owed = financial?.outstanding ?? []
  const moneyLines = owed.length
    ? owed.map((row) => ({ key: row.currency, text: formatMoney(row.balance, row.currency, language) }))
    : [{ key: 'none', text: academy?.currency ? formatMoney(0, academy.currency, language) : '0' }]

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} sm={12} xl={6}>
        <Card>
          <Statistic loading={loading} title={t('dashboard.stats.activeStudents')} value={data?.general.activeStudents ?? 0} prefix={<UserOutlined />} />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card>
          <Statistic loading={loading} title={t('dashboard.stats.runningClasses')} value={data?.general.runningClasses ?? 0} prefix={<AppstoreOutlined />} />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card>
          <Statistic loading={loading} title={t('dashboard.stats.lessonsToday')} value={data?.general.lessonsToday ?? 0} prefix={<CalendarOutlined />} />
        </Card>
      </Col>
      {showMoney ? (
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              loading={loading}
              title={t('dashboard.stats.outstanding')}
              value={moneyLines[0].text}
              prefix={<CreditCardOutlined />}
              valueRender={() => (
                <span className="tabular-nums" data-testid="dashboard-outstanding">
                  {moneyLines.map((line, index) => (
                    <span key={line.key}>
                      {index > 0 ? <br /> : null}
                      <bdi dir="ltr">{line.text}</bdi>
                    </span>
                  ))}
                </span>
              )}
            />
          </Card>
        </Col>
      ) : null}
    </Row>
  )
}

/** Today's lessons the caller may read, in start order; every time in the lesson's own zone (D-R41). */
function TodayLessonsTable({ lessons, dayZone }: { lessons: Lesson[]; dayZone: string }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  if (lessons.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dashboard.noLessonsToday')} />

  const columns: TableProps<Lesson>['columns'] = [
    {
      title: t('dashboard.lessonColumns.time'),
      key: 'time',
      render: (_, row) => <span dir="ltr">{formatLessonTimes(row.startsAt, row.endsAt, language, row.timeZone)}</span>,
    },
    { title: t('dashboard.lessonColumns.lesson'), key: 'lesson', render: (_, row) => labelIn(row.title, language) },
    {
      title: t('dashboard.lessonColumns.class'),
      key: 'class',
      render: (_, row) => (
        <>
          {labelIn(row.class.name, language)}
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {labelIn(row.class.course.name, language)}
          </Typography.Text>
        </>
      ),
    },
    { title: t('dashboard.lessonColumns.room'), key: 'room', render: (_, row) => (row.room ? <bdi dir="ltr">{row.room.code}</bdi> : '—') },
    { title: t('dashboard.lessonColumns.status'), key: 'status', render: (_, row) => <StatusTag value={row.status} /> },
  ]

  return (
    <>
      <LessonZoneNote timeZones={lessons.map((lesson) => lesson.timeZone)} dayZone={dayZone} />
      <Table<Lesson>
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={lessons}
        pagination={{ pageSize: 8, hideOnSinglePage: true, showSizeChanger: false }}
        scroll={{ x: 'max-content' }}
      />
    </>
  )
}

/** The latest notifications of the caller, newest first, as the server worded them. */
function RecentNotifications({ items }: { items: MyNotification[] }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { academy } = useAcademy()
  const { token } = theme.useToken()
  if (items.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dashboard.noNotifications')} />
  const zone = notificationZone(academy)
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((item, index) => (
        <li
          key={item.id}
          style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '12px 0', borderTop: index > 0 ? `1px solid ${token.colorSplit}` : undefined }}
        >
          <Badge dot={item.readAt === null} />
          <div style={{ minWidth: 0 }}>
            <Typography.Text strong>
              <bdi dir="auto">{item.title}</bdi>
            </Typography.Text>
            {item.body ? (
              <>
                <br />
                <Typography.Text type="secondary">
                  <bdi dir="auto">{item.body}</bdi>
                </Typography.Text>
              </>
            ) : null}
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <time dateTime={item.createdAt}>{formatLessonDateTime(item.createdAt, language, zone)}</time>
            </Typography.Text>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** The running, then open, classes the caller may read, with their lead teacher and their seats. */
function ActiveClassesTable({ classes }: { classes: AcademyClass[] }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  if (classes.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dashboard.classes.empty')} />

  const columns: TableProps<AcademyClass>['columns'] = [
    {
      title: t('dashboard.classes.columns.class'),
      key: 'class',
      render: (_, row) => (
        <>
          {labelIn(row.name, language)}
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <bdi dir="ltr">{row.code}</bdi>
          </Typography.Text>
        </>
      ),
    },
    { title: t('dashboard.classes.columns.course'), key: 'course', render: (_, row) => labelIn(row.course.name, language) },
    {
      title: t('dashboard.classes.columns.teacher'),
      key: 'teacher',
      render: (_, row) => {
        const lead = row.teachers.find((teacher) => teacher.role === 'lead') ?? row.teachers[0]
        return lead ? lead.fullName : <Tag color="orange">{t('dashboard.noTeacher')}</Tag>
      },
    },
    {
      title: t('dashboard.classes.columns.seats'),
      key: 'seats',
      render: (_, row) => <span className="tabular-nums">{t('dashboard.classes.seats', { enrolled: row.enrolledCount, capacity: row.capacity })}</span>,
    },
    { title: t('dashboard.classes.columns.status'), key: 'status', render: (_, row) => <StatusTag value={row.status} /> },
  ]

  return (
    <Table<AcademyClass>
      size="small"
      rowKey="id"
      columns={columns}
      dataSource={classes}
      pagination={{ pageSize: 8, hideOnSinglePage: true, showSizeChanger: false }}
      scroll={{ x: 'max-content' }}
    />
  )
}
