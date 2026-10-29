import {
  BookOutlined,
  CreditCardOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Alert, Badge, Card, Col, List, Row, Statistic, Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useTranslation } from 'react-i18next'
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

export function DashboardPage() {
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
            <Statistic title={t('dashboard.teachers')} value={teachers} prefix={<TeamOutlined />} />
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
