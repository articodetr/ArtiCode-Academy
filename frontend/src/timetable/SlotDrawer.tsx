// Details of one weekly slot on one date (J-F08), read-only: the course and
// class (with the class status), the date and local time with its zone, the
// teacher, the room and its branch (or the academy's own site), the effective
// period, and — in «my schedule» — why the caller sees it. Editing a class's
// weekly slots belongs to the class screen (API-089), not here. A bottom sheet
// on phones, a side drawer elsewhere. A real lesson (J-F65) shows its title,
// status, delivery mode and link instead of the effective period and the
// «recurring» notice.
import { Alert, Descriptions, Drawer, Typography } from 'antd'
import type { DescriptionsProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { StatusTag } from '../components/StatusTag'
import { lessonLinkOf } from '../dashboard/learner.data'
import type { Language } from '../i18n/language'
import { isHttpsUrl } from '../learn/learn.format'
import { localizedLabel } from '../users/users.format'
import type { CalendarDate } from './timetable.dates'
import { formatDate, formatLongDate, personName, relationLabel, roomLabel, timeRange } from './timetable.format'
import { toneOf } from './timetable.model'
import type { TimetableEntry } from './timetable.model'

interface SlotDrawerProps {
  opened: { entry: TimetableEntry; date: CalendarDate } | null
  onClose: () => void
  language: Language
  academyTimeZone: string
  mobile: boolean
  /** Epoch ms: whether a lesson's link still says «join». */
  now: number
}

export function SlotDrawer({ opened, onClose, language, academyTimeZone, mobile, now }: SlotDrawerProps) {
  const { t } = useTranslation()

  let content = null
  if (opened) {
    const { entry, date } = opened
    const course = localizedLabel(entry.class.course.name, language)
    const { lesson } = entry
    const link = lesson ? lessonLinkOf(lesson, now) : null
    const items: DescriptionsProps['items'] = [
      ...(lesson
        ? [
            { key: 'lesson', label: t('schedule.details.lesson'), children: <bdi>{localizedLabel(lesson.title, language)}</bdi> },
            { key: 'status', label: t('schedule.details.status'), children: <StatusTag value={lesson.status} /> },
            { key: 'delivery', label: t('schedule.details.delivery'), children: <StatusTag value={lesson.deliveryMode} /> },
          ]
        : []),
      {
        key: 'class',
        label: t('schedule.columns.class'),
        children: (
          <span>
            <bdi>{entry.class.code}</bdi> — {localizedLabel(entry.class.name, language)} <StatusTag value={entry.class.status} />
          </span>
        ),
      },
      { key: 'date', label: t('schedule.details.date'), children: formatLongDate(date, language) },
      {
        key: 'time',
        label: t('schedule.columns.time'),
        children: <span dir="ltr">{timeRange(entry.startTime, entry.endTime)}</span>,
      },
      {
        key: 'zone',
        label: t('schedule.details.timeZone'),
        children: (
          <span>
            <span dir="ltr">{entry.timeZone}</span>
            {entry.timeZone === academyTimeZone ? (
              <Typography.Text type="secondary"> ({t('schedule.details.academyZone')})</Typography.Text>
            ) : null}
          </span>
        ),
      },
      { key: 'teacher', label: t('schedule.columns.teacher'), children: entry.teacher ? personName(entry.teacher) : t('schedule.noTeacher') },
      {
        key: 'room',
        label: t('schedule.columns.room'),
        children: entry.room ? <bdi>{roomLabel(entry.room, language)}</bdi> : t('schedule.noRoom'),
      },
      ...(entry.room
        ? [
            {
              key: 'branch',
              label: t('schedule.details.branch'),
              children: entry.room.branch ? (
                <span>
                  <bdi>{entry.room.branch.code}</bdi> — {localizedLabel(entry.room.branch.name, language)}
                </span>
              ) : (
                t('schedule.site')
              ),
            },
          ]
        : []),
      ...(link && isHttpsUrl(link.url)
        ? [
            {
              key: 'link',
              label: t('schedule.details.lessonLink'),
              children: (
                <a href={link.url} target="_blank" rel="noopener noreferrer">
                  {link.action === 'join' ? t('schedule.details.joinLesson') : t('schedule.details.openLink')}
                </a>
              ),
            },
          ]
        : []),
      ...(lesson
        ? []
        : [
            {
              key: 'effective',
              label: t('schedule.columns.effective'),
              children: `${formatDate(entry.effectiveFrom, language)} – ${entry.effectiveTo ? formatDate(entry.effectiveTo, language) : t('schedule.openEnded')}`,
            },
          ]),
      ...(entry.relations.length > 0
        ? [
            {
              key: 'relations',
              label: t('schedule.details.relations'),
              children: (
                <span className="tt-event__relations">
                  {entry.relations.map((relation) => (
                    <span key={`${relation.relation}|${relation.student?.id ?? ''}`} className="tt-chip" style={{ background: 'var(--tt-accent-soft)' }}>
                      {relationLabel(t, relation)}
                    </span>
                  ))}
                </span>
              ),
            },
          ]
        : []),
    ]

    content = (
      <div className="tt">
        <div className={`tt-tone-${toneOf(entry.class.course.id)}`} style={{ background: 'var(--tt-tone-bg)', borderRadius: 14, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ color: 'var(--tt-tone-ink)', fontWeight: 700, fontSize: 17 }}>{course}</div>
          <div style={{ color: 'var(--tt-tone-sub)', fontSize: 13 }}>
            <bdi>{entry.class.course.code}</bdi>
          </div>
        </div>
        <Descriptions column={1} size="small" items={items} />
        {lesson ? null : <Alert type="info" showIcon style={{ marginTop: 16 }} title={t('schedule.details.recurring')} />}
      </div>
    )
  }

  return (
    <Drawer
      open={opened !== null}
      onClose={onClose}
      title={opened?.entry.lesson ? t('schedule.details.lessonTitle') : t('schedule.details.title')}
      placement={mobile ? 'bottom' : 'right'}
      size={mobile ? '85vh' : 'default'}
      destroyOnHidden
    >
      {content}
    </Drawer>
  )
}
