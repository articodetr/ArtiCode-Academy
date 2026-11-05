// «My classes» (MOD-05 — J-F04): GET /api/me/classes (API-060) for a student
// (their own enrollments, `relation: self`) and a guardian (the enrollments of
// the students linked to them, `relation: child`, while they hold the
// `guardian` role — the server decides). Ownership, no permission key: the
// page shows exactly what the server returns — the class, its course and its
// lead teacher by name — and never contact fields, rosters or other students.
// `active` and `completed` enrollments by default; the status filter asks the
// server for one status (withdrawn or cancelled ones included).
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Flex, Select, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { ENROLLMENT_STATUSES } from '../api/enrollments'
import type { EnrollmentStatus, MyClassItem } from '../api/enrollments'
import { useAuth } from '../auth/auth-context'
import { describeClassesFailure, failureMessage } from '../classes/classes.errors'
import { PageHeader } from '../components/PageHeader'
import { StatusTag } from '../components/StatusTag'
import { useMyClasses } from '../enrollments/useMyClasses'
import { useLocalized } from '../i18n/useLocalized'
import { displayNameOf, formatDateTime, formatDay, localizedLabel } from '../users/users.format'

const DASH = '—'

export function MyClassesPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { user } = useAuth()
  const my = useMyClasses()
  // The student column matters only to a guardian (or whenever the server returned a child's enrollment).
  const showStudent = (user?.roles.includes('guardian') ?? false) || my.items.some((item) => item.relation === 'child')

  const columns: TableProps<MyClassItem>['columns'] = [
    {
      title: t('myClasses.columns.class'),
      key: 'class',
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{localizedLabel(row.class.name, language)}</Typography.Text>
          <Typography.Text type="secondary" dir="ltr" style={{ fontSize: 12 }}>
            {row.class.code}
          </Typography.Text>
        </Space>
      ),
    },
    { title: t('common.course'), key: 'course', render: (_, row) => localizedLabel(row.class.course.name, language) },
    {
      title: t('common.teacher'),
      key: 'teacher',
      render: (_, row) => (row.class.leadTeacher ? displayNameOf(row.class.leadTeacher) : <Typography.Text type="secondary">{t('classes.noTeacher')}</Typography.Text>),
    },
    {
      title: t('myClasses.columns.period'),
      key: 'period',
      render: (_, row) => (row.class.startsOn || row.class.endsOn ? `${formatDay(row.class.startsOn, language)} – ${formatDay(row.class.endsOn, language)}` : DASH),
    },
    { title: t('myClasses.columns.classStatus'), key: 'classStatus', render: (_, row) => <StatusTag value={row.class.status} /> },
    {
      title: t('myClasses.columns.enrollmentStatus'),
      key: 'enrollmentStatus',
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <StatusTag value={row.enrollmentStatus} />
          {row.enrollmentStatus === 'completed' && row.completedAt ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {formatDateTime(row.completedAt, language)}
            </Typography.Text>
          ) : null}
          {row.enrollmentStatus === 'withdrawn' && row.withdrawnAt ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {formatDateTime(row.withdrawnAt, language)}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    { title: t('myClasses.columns.enrolledAt'), key: 'enrolledAt', render: (_, row) => formatDateTime(row.enrolledAt, language) },
  ]
  if (showStudent) {
    columns.splice(1, 0, {
      title: t('myClasses.columns.student'),
      key: 'student',
      render: (_, row) => (
        <Space size={4} wrap>
          <span>{displayNameOf(row.student)}</span>
          <Tag color={row.relation === 'self' ? 'green' : 'blue'}>{t(`myClasses.relation.${row.relation}`)}</Tag>
        </Space>
      ),
    })
  }

  const failure = my.error ? describeClassesFailure(my.error) : null

  return (
    <>
      <PageHeader title={t('myClasses.title')} subtitle={t('myClasses.subtitle')} />

      <Card>
        <Flex gap={12} wrap style={{ marginBottom: 16 }}>
          <Select<EnrollmentStatus | undefined>
            allowClear
            placeholder={t('myClasses.defaultStatuses')}
            aria-label={t('myClasses.filterLabel')}
            value={my.status}
            onChange={(value) => my.setStatus(value)}
            options={ENROLLMENT_STATUSES.map((status) => ({ value: status, label: t(`labels.${status}`) }))}
            style={{ minWidth: 200 }}
          />
          <Button icon={<ReloadOutlined />} onClick={my.reload} aria-label={t('myClasses.refresh')} />
        </Flex>

        {failure ? (
          <Alert
            type="error"
            showIcon
            message={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={my.reload}>
                {t('myClasses.refresh')}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<MyClassItem>
          rowKey="enrollmentId"
          columns={columns}
          dataSource={my.items}
          loading={my.loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: my.status ? t('myClasses.emptyFiltered') : t('myClasses.empty') }}
        />
      </Card>
    </>
  )
}
