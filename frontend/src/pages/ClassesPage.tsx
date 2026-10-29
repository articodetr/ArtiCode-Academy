import { PlusOutlined } from '@ant-design/icons'
import { App, Button, Card, Progress, Table } from 'antd'
import type { TableProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { useLocalized } from '../i18n/useLocalized'
import { mockClasses } from '../mock/data'
import type { MockClass } from '../mock/data'

export function ClassesPage() {
  const { t } = useTranslation()
  const { localized } = useLocalized()
  const { message } = App.useApp()

  const columns: TableProps<MockClass>['columns'] = [
    { title: t('common.name'), dataIndex: 'name', render: (_, row) => localized(row.name) },
    { title: t('common.course'), dataIndex: 'course', render: (_, row) => localized(row.course) },
    { title: t('common.teacher'), dataIndex: 'teacher', render: (_, row) => localized(row.teacher) },
    { title: t('common.room'), dataIndex: 'room' },
    {
      title: `${t('classes.enrolled')} / ${t('classes.capacity')}`,
      key: 'occupancy',
      render: (_, row) => (
        <Progress
          percent={Math.round((row.enrolled / row.capacity) * 100)}
          size="small"
          format={() => `${row.enrolled} / ${row.capacity}`}
        />
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title={t('classes.title')}
        subtitle={t('classes.subtitle')}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => message.info(t('common.notImplemented'))}
          >
            {t('classes.addClass')}
          </Button>
        }
      />
      <Card>
        <Table<MockClass> rowKey="id" columns={columns} dataSource={mockClasses} pagination={false} />
      </Card>
    </>
  )
}
