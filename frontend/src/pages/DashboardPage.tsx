import {
  BookOutlined,
  CreditCardOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Alert, Badge, Card, Col, List, Row, Statistic, Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../academy/useAcademy'
import { academyTimeZoneOf } from '../common/timeZone'
import { LearnerHome } from '../dashboard/LearnerHome'
import { isLearnerOnly } from '../dashboard/learner.data'
import { calendarDateIn, minutesNowIn } from '../timetable/timetable.dates'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { ServerStatusCard } from '../components/ServerStatusCard'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import {
  mockAcademySettings,
  mockCourses,
  mockLessons,
  mockNotifications,
  mockPayments,
  mockUsers,
} from '../mock/data'
import type { MockLesson } from '../mock/data'

/** Ticks once a minute so the learner home follows the clock. */
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

function StaffDashboard() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { localized } = useLocalized()

  const students = mockUsers.filter((u) => u.role === 'student').length
  const teachers = mockUsers.filter((u) => u.role === 'teacher').length
  const publishedCourses = mockCourses.filter((c) => c.status === 'published').length
  const pendingAmount = mockPayments
    .filter((p) => p.status !== 'paid')
    .reduce((sum, p) => sum + p.amount, 0)
  const upcoming = mockLessons.filter((l) => l.status === 'scheduled')
  const recent = mockNotifications.slice(0, 4)

  const lessonColumns: TableProps<MockLesson>['columns'] = [
    { title: t('lessons.title'), dataIndex: 'title', render: (_, row) => localized(row.title) },
    { title: t('common.course'), dataIndex: 'course', render: (_, row) => localized(row.course) },
    { title: t('common.date'), dataIndex: 'date' },
    { title: t('lessons.type'), dataIndex: 'type', render: (type: MockLesson['type']) => <StatusTag value={type} /> },
  ]

  return (
    <>
      <PageHeader
        title={t('dashboard.welcome', { name: user?.name ?? '' })}
        subtitle={t('dashboard.subtitle')}
      />

      <ServerStatusCard />

      <Alert type="info" showIcon message={t('common.demoBanner')} style={{ marginBottom: 24 }} />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic title={t('dashboard.students')} value={students} prefix={<UserOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic title={t('dashboard.teachersCount')} value={teachers} prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic title={t('dashboard.courses')} value={publishedCourses} prefix={<BookOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              title={t('dashboard.pendingPayments')}
              value={pendingAmount}
              suffix={mockAcademySettings.currency}
              prefix={<CreditCardOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={14}>
          <Card title={t('dashboard.upcomingLessons')}>
            <Table<MockLesson>
              size="small"
              rowKey="id"
              columns={lessonColumns}
              dataSource={upcoming}
              pagination={false}
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title={t('dashboard.recentNotifications')}>
            <List
              dataSource={recent}
              renderItem={(item) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={<Badge dot={!item.read} />}
                    title={localized(item.title)}
                    description={
                      <>
                        <Typography.Text type="secondary">{localized(item.body)}</Typography.Text>
                        <br />
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {item.sentAt}
                        </Typography.Text>
                      </>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </>
  )
}
