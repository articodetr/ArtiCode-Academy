import { PlusOutlined } from '@ant-design/icons'
import { App, Button, Card, Table } from 'antd'
import type { TableProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { mockLessons } from '../mock/data'
import type { MockLesson } from '../mock/data'

export function LessonsPage() {
  const { t } = useTranslation()
  const { localized } = useLocalized()
  const { message } = App.useApp()

  const columns: TableProps<MockLesson>['columns'] = [
    { title: t('lessons.title'), dataIndex: 'title', render: (_, row) => localized(row.title) },
    { title: t('common.course'), dataIndex: 'course', render: (_, row) => localized(row.course) },
    { title: t('lessons.type'), dataIndex: 'type', render: (type: MockLesson['type']) => <StatusTag value={type} /> },
    { title: t('common.date'), dataIndex: 'date' },
    { title: t('lessons.duration'), dataIndex: 'durationMin' },
    { title: t('common.status'), dataIndex: 'status', render: (status: MockLesson['status']) => <StatusTag value={status} /> },
  ]

  return (
    <>
      <PageHeader
        title={t('lessons.title')}
        subtitle={t('lessons.subtitle')}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => message.info(t('common.notImplemented'))}
          >
            {t('lessons.addLesson')}
          </Button>
        }
      />
      <Card>
        <Table<MockLesson> rowKey="id" columns={columns} dataSource={mockLessons} pagination={false} />
      </Card>
    </>
  )
}
