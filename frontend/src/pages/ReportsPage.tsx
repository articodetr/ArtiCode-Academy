import { BarChartOutlined } from '@ant-design/icons'
import { App, Button, Card, Col, Row, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { mockReports } from '../mock/data'

export function ReportsPage() {
  const { t } = useTranslation()
  const { localized } = useLocalized()
  const { message } = App.useApp()

  return (
    <>
      <PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />
      <Row gutter={[16, 16]}>
        {mockReports.map((report) => (
          <Col key={report.id} xs={24} md={12} xl={8}>
            <Card
              title={localized(report.name)}
              extra={<StatusTag value={report.category} />}
              actions={[
                <Button
                  key="generate"
                  type="link"
                  icon={<BarChartOutlined />}
                  onClick={() => message.info(t('common.notImplemented'))}
                >
                  {t('reports.generate')}
                </Button>,
              ]}
            >
              <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                {localized(report.description)}
              </Typography.Paragraph>
            </Card>
          </Col>
        ))}
      </Row>
    </>
  )
}
