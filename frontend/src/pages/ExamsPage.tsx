import { PlusOutlined } from '@ant-design/icons'
import { App, Button, Card, Table } from 'antd'
import type { TableProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { mockExams } from '../mock/data'
import type { MockExam } from '../mock/data'

export function ExamsPage() {
  const { t } = useTranslation()
  const { localized } = useLocalized()
  const { message } = App.useApp()

  const columns: TableProps<MockExam>['columns'] = [
    { title: t('exams.title'), dataIndex: 'title', render: (_, row) => localized(row.title) },
    { title: t('common.course'), dataIndex: 'course', render: (_, row) => localized(row.course) },
    { title: t('common.date'), dataIndex: 'date' },
    { title: t('exams.duration'), dataIndex: 'durationMin' },
    { title: t('exams.maxScore'), dataIndex: 'maxScore' },
    { title: t('exams.avgScore'), dataIndex: 'avgScore', render: (avg: MockExam['avgScore']) => (avg === null ? '-' : avg) },
    { title: t('common.status'), dataIndex: 'status', render: (status: MockExam['status']) => <StatusTag value={status} /> },
  ]

  return (
    <>
      <PageHeader
        title={t('exams.title')}
        subtitle={t('exams.subtitle')}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => message.info(t('common.notImplemented'))}
          >
            {t('exams.addExam')}
          </Button>
        }
      />
      <Card>
        <Table<MockExam> rowKey="id" columns={columns} dataSource={mockExams} pagination={false} />
      </Card>
    </>
  )
}
