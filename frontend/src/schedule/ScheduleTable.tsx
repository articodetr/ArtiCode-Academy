// The weekly table of both schedule views (J-F05): rows grouped by day (the
// day label shows once per group), local times in the slot's zone, the class
// with its course, the room with its branch, the teacher, and — for «my
// schedule» — the relation and the student.
import { Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { useLocalized } from '../i18n/useLocalized'
import { formatDay } from '../users/users.format'
import { orderRows, roomLabel, timeRange, weekdayKey } from './schedule.format'
import type { ScheduleRow } from './schedule.format'

export type ScheduleView = 'academy' | 'mine'

interface ScheduleTableProps {
  rows: ScheduleRow[]
  view: ScheduleView
  loading: boolean
  emptyText: string
  /** 0 = Sunday (the default) … 6; the academy's `weekStartsOn` when known. */
  weekStartsOn?: number
}

const RELATION_COLORS: Record<string, string> = { self: 'blue', child: 'purple', teacher: 'green' }

export function ScheduleTable({ rows, view, loading, emptyText, weekStartsOn = 0 }: ScheduleTableProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const ordered = orderRows(rows, weekStartsOn)
  type Row = (typeof ordered)[number]

  const columns: TableProps<Row>['columns'] = [
    {
      title: t('schedule.columns.day'),
      key: 'day',
      render: (_, row) => (row.firstOfDay ? <Tag>{t(`days.${weekdayKey(row.weekday)}`)}</Tag> : null),
    },
    {
      title: t('schedule.columns.time'),
      key: 'time',
      render: (_, row) => (
        <span>
          <Typography.Text dir="ltr">{timeRange(row.startTime, row.endTime)}</Typography.Text>
          <br />
          <Typography.Text type="secondary" dir="ltr" style={{ fontSize: 12 }}>
            {row.timeZone}
          </Typography.Text>
        </span>
      ),
    },
    {
      title: t('schedule.columns.class'),
      key: 'class',
      render: (_, row) => (
        <span>
          <Typography.Text dir="ltr" strong>
            {row.classCode}
          </Typography.Text>
          <br />
          <Typography.Text type="secondary">{row.className}</Typography.Text>
        </span>
      ),
    },
    { title: t('schedule.columns.course'), key: 'course', render: (_, row) => row.courseName },
    {
      title: t('schedule.columns.room'),
      key: 'room',
      render: (_, row) =>
        row.room ? (
          <span>
            <Typography.Text dir="ltr">{roomLabel(row.room, language)}</Typography.Text>
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {row.room.branch ? row.room.branch.code : t('schedule.site')}
            </Typography.Text>
          </span>
        ) : (
          <Typography.Text type="secondary">{t('schedule.noRoom')}</Typography.Text>
        ),
    },
    {
      title: t('schedule.columns.teacher'),
      key: 'teacher',
      render: (_, row) => row.teacherName ?? <Typography.Text type="secondary">{t('schedule.noTeacher')}</Typography.Text>,
    },
  ]

  if (view === 'mine') {
    columns.push({
      title: t('schedule.columns.relation'),
      key: 'relation',
      render: (_, row) =>
        row.relation ? (
          <span>
            <Tag color={RELATION_COLORS[row.relation]}>{t(`schedule.relation.${row.relation}`)}</Tag>
            {row.relation === 'child' && row.studentName ? <Typography.Text>{row.studentName}</Typography.Text> : null}
          </span>
        ) : null,
    })
  } else {
    columns.push({
      title: t('schedule.columns.effective'),
      key: 'effective',
      render: (_, row) => `${formatDay(row.effectiveFrom, language)} – ${row.effectiveTo ? formatDay(row.effectiveTo, language) : t('schedule.openEnded')}`,
    })
  }

  return <Table<Row> rowKey="key" columns={columns} dataSource={ordered} loading={loading} pagination={false} scroll={{ x: 'max-content' }} locale={{ emptyText }} />
}
