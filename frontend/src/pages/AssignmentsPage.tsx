import { PlusOutlined } from '@ant-design/icons'
import { App, Button, Card, Table } from 'antd'
import type { TableProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { mockAssignments } from '../mock/data'
import type { MockAssignment } from '../mock/data'

export function AssignmentsPage() {
  const { t } = useTranslation()
  const { localized } = useLocalized()
  const { message } = App.useApp()

  const columns: TableProps<MockAssignment>['columns'] = [
    { title: t('assignments.title'), dataIndex: 'title', render: (_, row) => localized(row.title) },
    { title: t('common.course'), dataIndex: 'course', render: (_, row) => localized(row.course) },
    { title: t('assignments.dueDate'), dataIndex: 'dueDate' },
    { title: t('assignments.submissions'), key: 'submissions', render: (_, row) => `${row.submitted} / ${row.total}` },
    { title: t('common.status'), dataIndex: 'status', render: (status: MockAssignment['status']) => <StatusTag value={status} /> },
  ]

  return (
    <>
      <PageHeader
        title={t('assignments.title')}
        subtitle={t('assignments.subtitle')}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => message.info(t('common.notImplemented'))}
          >
            {t('assignments.addAssignment')}
          </Button>
        }
      />
      <Card>
        <Table<MockAssignment> rowKey="id" columns={columns} dataSource={mockAssignments} pagination={false} />
      </Card>
    </>
  )
}
