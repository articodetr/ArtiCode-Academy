import { PlusOutlined } from '@ant-design/icons'
import { App, Button, Card, Table } from 'antd'
import type { TableProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { mockUsers } from '../mock/data'
import type { MockUser } from '../mock/data'

export function UsersPage() {
  const { t } = useTranslation()
  const { localized } = useLocalized()
  const { message } = App.useApp()

  const columns: TableProps<MockUser>['columns'] = [
    { title: t('common.name'), dataIndex: 'name', render: (_, row) => localized(row.name) },
    { title: t('common.email'), dataIndex: 'email' },
    { title: t('users.role'), dataIndex: 'role', render: (role: MockUser['role']) => t(`roles.${role}`) },
    { title: t('common.status'), dataIndex: 'status', render: (status: MockUser['status']) => <StatusTag value={status} /> },
    { title: t('users.joinedAt'), dataIndex: 'joinedAt' },
  ]

  return (
    <>
      <PageHeader
        title={t('users.title')}
        subtitle={t('users.subtitle')}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => message.info(t('common.notImplemented'))}
          >
            {t('users.addUser')}
          </Button>
        }
      />
      <Card>
        <Table<MockUser> rowKey="id" columns={columns} dataSource={mockUsers} pagination={false} />
      </Card>
    </>
  )
}
