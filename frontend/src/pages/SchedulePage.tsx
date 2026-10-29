import { Card, Table, Tag } from 'antd'
import type { TableProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { useLocalized } from '../i18n/useLocalized'
import { DAY_ORDER, mockSchedule } from '../mock/data'
import type { MockScheduleEntry } from '../mock/data'

const sortedSchedule = [...mockSchedule].sort(
  (a, b) =>
    DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) ||
    a.start.localeCompare(b.start),
)

export function SchedulePage() {
  const { t } = useTranslation()
  const { localized } = useLocalized()

  const columns: TableProps<MockScheduleEntry>['columns'] = [
    { title: t('schedule.day'), dataIndex: 'day', render: (day: MockScheduleEntry['day']) => <Tag>{t(`days.${day}`)}</Tag> },
    { title: t('common.time'), key: 'time', render: (_, row) => `${row.start} - ${row.end}` },
    { title: t('schedule.class'), dataIndex: 'className', render: (_, row) => localized(row.className) },
    { title: t('common.teacher'), dataIndex: 'teacher', render: (_, row) => localized(row.teacher) },
    { title: t('common.room'), dataIndex: 'room' },
  ]

  return (
    <>
      <PageHeader title={t('schedule.title')} subtitle={t('schedule.subtitle')} />
      <Card>
        <Table<MockScheduleEntry>
          rowKey="id"
          columns={columns}
          dataSource={sortedSchedule}
          pagination={false}
        />
      </Card>
    </>
  )
}
