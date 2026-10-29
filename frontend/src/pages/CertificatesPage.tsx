import { Card, Table } from 'antd'
import type { TableProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { useLocalized } from '../i18n/useLocalized'
import { mockCertificates } from '../mock/data'
import type { MockCertificate } from '../mock/data'

export function CertificatesPage() {
  const { t } = useTranslation()
  const { localized } = useLocalized()

  const columns: TableProps<MockCertificate>['columns'] = [
    { title: t('certificates.serial'), dataIndex: 'serial' },
    { title: t('common.student'), dataIndex: 'student', render: (_, row) => localized(row.student) },
    { title: t('common.course'), dataIndex: 'course', render: (_, row) => localized(row.course) },
    { title: t('certificates.issuedAt'), dataIndex: 'issuedAt' },
    { title: t('certificates.grade'), dataIndex: 'grade', render: (_, row) => localized(row.grade) },
  ]

  return (
    <>
      <PageHeader title={t('certificates.title')} subtitle={t('certificates.subtitle')} />
      <Card>
        <Table<MockCertificate>
          rowKey="id"
          columns={columns}
          dataSource={mockCertificates}
          pagination={false}
        />
      </Card>
    </>
  )
}
