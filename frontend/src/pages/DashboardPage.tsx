// The home page — three homes, kept apart (J-F59): a student or a guardian with no other role gets the learner home
// (LearnerHome, built from the «my …» reads); a teacher (the UI role `teacher`: no admin or staff role) keeps the
// teacher's dashboard below — the number cards, today's lessons beside the latest notifications, then the open and
// running classes; everyone else — the academy's admins and staff, and custom-role holders — gets the
// admin home (dashboard/admin/AdminDashboardHome.tsx: quick actions, the academy's figures, the coming lessons and the
// latest notifications). On the teacher's dashboard every card reads the server and shows only to a holder of the
// keys its read needs (the server stays the boundary):
//   - the number cards: API-164 GET /api/reports/overview, for any of the three reports.* keys — the active students
//     and today's lessons of its `general` section for everyone of them (not its running classes since 2026-11-26:
//     classes are an internal mechanism, not a section of the interface), `financial` (the money card) only for
//     reports.financial.view;
//   - today's lessons: API-093 GET /api/lessons, for lessons.read (a teacher gets the lessons of their classes);
//   - the classes: API-050 GET /api/classes (running, then open), for classes.read (D-R16: a teacher's own) — a list
//     to read, without a link to the classes page (2026-11-26);
//   - the notifications: API-167 GET /api/me/notifications, by ownership (no key).
// A card that cannot be read is left out, never filled with invented numbers; a failed card says so and offers
// to try again without breaking the others.
import { CalendarOutlined, CreditCardOutlined, UserOutlined } from '@ant-design/icons'
import { Card, Col, Empty, Row, Statistic, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAcademy } from '../academy/useAcademy'
import type { AcademyClass } from '../api/classes'
import type { Lesson } from '../api/lessons'
import { listMyNotifications } from '../api/notifications'
import { REPORT_KEYS, getReportsOverview } from '../api/reports'
import type { ReportsOverview } from '../api/reports'
import { useAuth } from '../auth/auth-context'
import { academyTimeZoneOf } from '../common/timeZone'
import { PageHeader } from '../components/PageHeader'
import { ServerStatusCard } from '../components/ServerStatusCard'
import { StatusTag } from '../components/StatusTag'
import { AdminDashboardHome } from '../dashboard/admin/AdminDashboardHome'
import { CardContent, CardFailure, RECENT_NOTIFICATIONS, RecentNotifications } from '../dashboard/DashboardCards'
import { formatMoney, labelIn } from '../dashboard/dashboard.data'
import { loadActiveClasses, loadLessonsBetween } from '../dashboard/dashboard.load'
import { LearnerHome } from '../dashboard/LearnerHome'
import { isLearnerOnly } from '../dashboard/learner.data'
import { useLoad } from '../dashboard/useLoad'
import type { Reloadable } from '../dashboard/useLoad'
import { useNow } from '../dashboard/useNow'
import { useLocalized } from '../i18n/useLocalized'
import { canAccess, teachesOnly } from '../layout/navigation'
import { formatLessonTimes } from '../lessons/lessons.format'
import { LessonZoneNote } from '../lessons/LessonZone'
import { addDays, calendarDateIn, minutesNowIn } from '../timetable/timetable.dates'
import { deviceTimeZone } from '../timetable/timetable.settings'

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
  if (isLearnerOnly(user?.roles ?? [])) return <LearnerDashboard />
  return user?.role === 'teacher' ? <TeacherDashboard /> : <AdminDashboardHome />
}

/** The teacher's home (the classic staff dashboard, kept by J-F59 — it served every staff member before). */
function TeacherDashboard() {
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
            {/* A teacher-only viewer's «الدورات» is the classes page (J-F72): the card links there for them alone — classes
                management is not part of the admin interface (PORTAL-04-ADMIN-SIMPLIFY). */}
            <Card title={t('dashboard.classes.title')} extra={user && teachesOnly(user) ? linkTo('classes', '/classes', t('nav.classesForTeacher')) : undefined}>
              <CardContent loaded={classes}>{(items) => <ActiveClassesTable classes={items} />}</CardContent>
            </Card>
          </Col>
        </Row>
      ) : null}
    </>
  )
}

/**
 * The number cards of API-164: the active students and today's lessons from its `general` section, and the money still
 * owed — per currency, as the server sums it — only while its `financial` section comes (a holder of
 * reports.financial.view). Two or three cards share the row evenly, so it never ends on an empty slot.
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
  const span = 24 / (showMoney ? 3 : 2)

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} sm={span}>
        <Card>
          <Statistic loading={loading} title={t('dashboard.stats.activeStudents')} value={data?.general.activeStudents ?? 0} prefix={<UserOutlined />} />
        </Card>
      </Col>
      <Col xs={24} sm={span}>
        <Card>
          <Statistic loading={loading} title={t('dashboard.stats.lessonsToday')} value={data?.general.lessonsToday ?? 0} prefix={<CalendarOutlined />} />
        </Card>
      </Col>
      {showMoney ? (
        <Col xs={24} sm={span}>
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
