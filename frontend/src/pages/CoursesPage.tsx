import { PlusOutlined } from '@ant-design/icons'
import { App, Button, Card, Table } from 'antd'
import type { TableProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { mockCourses } from '../mock/data'
import type { MockCourse } from '../mock/data'

export function CoursesPage() {
  const { t } = useTranslation()
  const { localized } = useLocalized()
  const { message } = App.useApp()

  const columns: TableProps<MockCourse>['columns'] = [
    { title: t('courses.code'), dataIndex: 'code' },
    { title: t('common.name'), dataIndex: 'name', render: (_, row) => localized(row.name) },
    { title: t('courses.level'), dataIndex: 'level', render: (_, row) => localized(row.level) },
    { title: t('common.teacher'), dataIndex: 'teacher', render: (_, row) => localized(row.teacher) },
    { title: t('courses.students'), dataIndex: 'students' },
    { title: t('common.status'), dataIndex: 'status', render: (status: MockCourse['status']) => <StatusTag value={status} /> },
  ]

  return (
    <>
      <PageHeader
        title={t('courses.title')}
        subtitle={t('courses.subtitle')}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => message.info(t('common.notImplemented'))}
          >
            {t('courses.addCourse')}
          </Button>
        }
      />
      <Card>
        <Table<MockCourse> rowKey="id" columns={columns} dataSource={mockCourses} pagination={false} />
      </Card>
    </>
  )
}
