// Read-only weekly view of a class's slots (J-F07 on API-088): one section per
// weekday that has slots, in the academy's week order (`weekStartsOn`), each
// slot with its time range, room (and branch), teacher and effective range.
// Stacked rows rather than a table, so it reads on a phone too.
import { Flex, Space, Tag, Typography, theme } from 'antd'
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
  const { token } = theme.useToken()
  const groups = groupByWeekday(slots, orderedWeekdays(weekStartsOn))

  return (
    <div data-testid="schedule-week">
      {groups.map((group) => (
        <section key={group.weekday} style={{ marginBottom: 16 }} aria-label={t(`classSchedule.weekdays.${group.weekday}`)}>
          <Typography.Title level={2} className="section-title" style={{ marginTop: 0 }}>
            {t(`classSchedule.weekdays.${group.weekday}`)}
          </Typography.Title>
          <Flex vertical gap={8}>
            {group.slots.map((slot) => (
              <div key={slot.id} style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadius, padding: '8px 12px' }}>
                <Space wrap>
                  {/* An inner span: antd's RTL class sets `direction: rtl` on Typography itself, which would reverse the range. */}
                  <Typography.Text strong>
                    <span dir="ltr" data-testid="slot-time">
                      {timeRange(slot.startTime, slot.endTime)}
                    </span>
                  </Typography.Text>
                  {slot.room ? <Tag>{roomLabel(slot.room, language)}</Tag> : <Tag color="default">{t('classSchedule.noRoom')}</Tag>}
                </Space>
                <Space orientation="vertical" size={0} style={{ display: 'flex', marginTop: 4 }}>
                  <Typography.Text type="secondary">
                    {t('common.teacher')}: {slot.teacher ? slot.teacher.fullName : t('classSchedule.defaultTeacher')}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    {slot.effectiveTo
                      ? t('classSchedule.effectiveRange', { from: formatDay(slot.effectiveFrom, language), to: formatDay(slot.effectiveTo, language) })
                      : t('classSchedule.effectiveFrom', { from: formatDay(slot.effectiveFrom, language) })}
                  </Typography.Text>
                </Space>
              </div>
            ))}
          </Flex>
        </section>
      ))}
    </div>
  )
}
