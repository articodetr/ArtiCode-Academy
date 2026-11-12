// The index of the /reports page (J-F53, MOD-13-T06): the reports the caller's
// keys open (D-R68), by family, each a link to `/reports?report=<key>` — the
// same address a dashboard tile or a bookmark opens.
import { BarChartOutlined } from '@ant-design/icons'
import { Card, Col, Flex, Row, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { StatusTag } from '../components/StatusTag'
import { REPORT_FAMILIES } from './reports.catalog'
import type { ReportDefinition } from './reports.catalog'

export function ReportsIndex({ reports }: { reports: readonly ReportDefinition[] }) {
  const { t } = useTranslation()
  return (
    <Flex vertical gap={24}>
      {REPORT_FAMILIES.map((family) => {
        const items = reports.filter((report) => report.family === family)
        if (items.length === 0) return null
        return (
          <section key={family} aria-label={t(`reports.families.${family}`)}>
            <Typography.Title level={5}>{t(`reports.families.${family}`)}</Typography.Title>
            <Row gutter={[16, 16]}>
              {items.map((report) => (
                <Col key={report.key} xs={24} md={12} xl={8}>
                  <Card
                    title={t(`reports.catalog.${report.i18nId}.name`)}
                    extra={<StatusTag value={report.family} />}
                    actions={[
                      <Link key="open" to={`/reports?report=${report.key}`}>
                        <BarChartOutlined /> {t('reports.open')}
                      </Link>,
                    ]}
                    style={{ height: '100%' }}
                  >
                    <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                      {t(`reports.catalog.${report.i18nId}.description`)}
                    </Typography.Paragraph>
                  </Card>
                </Col>
              ))}
            </Row>
          </section>
        )
      })}
    </Flex>
  )
}
