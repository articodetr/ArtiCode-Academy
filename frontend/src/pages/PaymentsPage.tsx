import { PlusOutlined } from '@ant-design/icons'
import { App, Button, Card, Col, Row, Statistic, Table } from 'antd'
import type { TableProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { mockAcademySettings, mockPayments } from '../mock/data'
import type { MockPayment } from '../mock/data'

export function PaymentsPage() {
  const { t } = useTranslation()
  const { localized } = useLocalized()
  const { message } = App.useApp()
  const currency = mockAcademySettings.currency

  const collected = mockPayments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
  const outstanding = mockPayments.filter((p) => p.status !== 'paid').reduce((s, p) => s + p.amount, 0)

  const columns: TableProps<MockPayment>['columns'] = [
    { title: t('payments.invoice'), dataIndex: 'invoice' },
    { title: t('common.student'), dataIndex: 'student', render: (_, row) => localized(row.student) },
    { title: t('payments.amount'), key: 'amount', render: (_, row) => `${row.amount.toLocaleString()} ${row.currency}` },
    { title: t('payments.dueDate'), dataIndex: 'dueDate' },
    { title: t('payments.method'), dataIndex: 'method', render: (_, row) => (row.method ? localized(row.method) : '-') },
    { title: t('common.status'), dataIndex: 'status', render: (status: MockPayment['status']) => <StatusTag value={status} /> },
  ]

  return (
    <>
      <PageHeader
        title={t('payments.title')}
        subtitle={t('payments.subtitle')}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => message.info(t('common.notImplemented'))}
          >
            {t('payments.addPayment')}
          </Button>
        }
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12}>
          <Card>
            <Statistic title={t('payments.collected')} value={collected} suffix={currency} />
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card>
            <Statistic title={t('payments.outstanding')} value={outstanding} suffix={currency} />
          </Card>
        </Col>
      </Row>

      <Card>
        <Table<MockPayment> rowKey="id" columns={columns} dataSource={mockPayments} pagination={false} />
      </Card>
    </>
  )
}
