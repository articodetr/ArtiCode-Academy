// Read-only weekly view of a class's slots (J-F07 on API-088): one section per
// weekday that has slots, in the academy's week order (`weekStartsOn`), each
// slot with its time range, room (and branch), teacher and effective range.
// A list of small cards rather than a table, so it reads on a phone too.
import { List, Space, Tag, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ScheduleSlot } from '../api/schedule'
import { useLocalized } from '../i18n/useLocalized'
import { formatDay } from '../users/users.format'
import { roomLabel, timeRange } from './schedule.format'
import { groupByWeekday, orderedWeekdays } from './schedule.model'

interface ScheduleWeekViewProps {
  slots: readonly ScheduleSlot[]
  weekStartsOn: number | null
}

export function ScheduleWeekView({ slots, weekStartsOn }: ScheduleWeekViewProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const groups = groupByWeekday(slots, orderedWeekdays(weekStartsOn))

  return (
    <div data-testid="schedule-week">
      {groups.map((group) => (
        <section key={group.weekday} style={{ marginBottom: 16 }} aria-label={t(`classSchedule.weekdays.${group.weekday}`)}>
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            {t(`classSchedule.weekdays.${group.weekday}`)}
          </Typography.Title>
          <List
            size="small"
            dataSource={group.slots}
            rowKey="id"
            renderItem={(slot) => (
              <List.Item>
                <List.Item.Meta
                  title={
                    <Space wrap>
                      <Typography.Text strong dir="ltr">
                        {timeRange(slot.startTime, slot.endTime)}
                      </Typography.Text>
                      {slot.room ? <Tag>{roomLabel(slot.room, language)}</Tag> : <Tag color="default">{t('classSchedule.noRoom')}</Tag>}
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={0}>
                      <span>
                        {t('common.teacher')}: {slot.teacher ? slot.teacher.fullName : t('classSchedule.defaultTeacher')}
                      </span>
                      <span>
                        {slot.effectiveTo
                          ? t('classSchedule.effectiveRange', { from: formatDay(slot.effectiveFrom, language), to: formatDay(slot.effectiveTo, language) })
                          : t('classSchedule.effectiveFrom', { from: formatDay(slot.effectiveFrom, language) })}
                      </span>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        </section>
      ))}
    </div>
  )
}
