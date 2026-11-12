// The landing page of every signed-in user (J-F53, MOD-13-T06 — instead of the
// prototype's demo counters): a holder of any report key sees the overview of
// API-164 — the general section and one card per section their keys open, with
// links into /reports (ReportsOverviewCards); anyone else (students, guardians,
// a teacher without a report key) sends no API-164 request and gets a welcome
// with links to the pages their navigation offers. No figure here is made up.
import { Card, Col, Flex, Row, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { ServerStatusCard } from '../components/ServerStatusCard'
import { navFor } from '../layout/navigation'
import { ReportsOverviewCards } from '../reports/ReportsOverviewCards'
import { holdsReportKey } from '../reports/reports.catalog'

function Shortcuts() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const items = user ? navFor(user).filter((item) => item.key !== 'dashboard') : []
  return (
    <Card title={t('dashboard.shortcuts')}>
      {items.length === 0 ? (
        <Typography.Text type="secondary">{t('dashboard.noShortcuts')}</Typography.Text>
      ) : (
        <Row gutter={[12, 12]}>
          {items.map((item) => (
            <Col key={item.key} xs={24} sm={12} lg={8} xl={6}>
              <Link to={item.path} aria-label={t(item.labelKey)}>
                <Card size="small" hoverable>
                  <Flex gap={8} align="center">
                    {item.icon}
                    <Typography.Text>{t(item.labelKey)}</Typography.Text>
                  </Flex>
                </Card>
              </Link>
            </Col>
          ))}
        </Row>
      )}
    </Card>
  )
}

export function DashboardPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const showsOverview = holdsReportKey(user?.permissions ?? [])

  return (
    <>
      <PageHeader title={t('dashboard.welcome', { name: user?.name ?? '' })} subtitle={t(showsOverview ? 'dashboard.subtitle' : 'dashboard.shortcutsSubtitle')} />
      <ServerStatusCard />
      {showsOverview ? <ReportsOverviewCards /> : <Shortcuts />}
    </>
  )
}
