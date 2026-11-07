// "Upcoming" beside the calendar (J-F08): the next occurrences of the weekly
// slots over the next seven days, from the same readings as the week (no
// invented events, pictures or attendees). Each row shows a date tile in the
// course's tone, the course, the class and time, the room and teacher, and a
// "now" badge while the slot is running; a click opens the details. These are
// projections of the weekly schedule, not confirmed lessons — the hint says so.
import { CalendarOutlined } from '@ant-design/icons'
import { Skeleton } from 'antd'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'
import { weekdayOf } from './timetable.dates'
import type { CalendarDate } from './timetable.dates'
import { personName, relationLabel, roomLabel, slotLabel, timeRange, weekdayKey } from './timetable.format'
import { toneOf } from './timetable.model'
import type { Occurrence, TimetableEntry } from './timetable.model'

interface UpcomingPanelProps {
  occurrences: Occurrence[]
  /** Epoch ms — a slot that started and has not ended is "now". */
  now: number
  loading: boolean
  failed: boolean
  language: Language
  onOpen: (entry: TimetableEntry, date: CalendarDate) => void
}

export function UpcomingPanel({ occurrences, now, loading, failed, language, onOpen }: UpcomingPanelProps) {
  const { t } = useTranslation()
  const headingId = useId()

  let body
  if (loading) body = <Skeleton active title={false} paragraph={{ rows: 4 }} style={{ marginTop: 12 }} />
  else if (failed) body = <p className="tt-agenda__none" style={{ marginTop: 12 }}>{t('schedule.upcoming.failed')}</p>
  else if (occurrences.length === 0)
    body = (
      <div className="tt-mobile-empty" style={{ marginTop: 12 }}>
        <CalendarOutlined className="tt-empty__icon" aria-hidden="true" />
        <p className="tt-empty__hint" style={{ marginTop: 6 }}>
          {t('schedule.upcoming.empty')}
        </p>
      </div>
    )
  else
    body = (
      <ul className="tt-upcoming__list">
        {occurrences.map(({ entry, date, startsAt }) => {
          const course = localizedLabel(entry.class.course.name, language)
          const teacher = entry.teacher ? personName(entry.teacher) : t('schedule.noTeacher')
          const room = entry.room ? roomLabel(entry.room, language) : null
          const live = startsAt <= now
          const label = slotLabel(t, language, {
            courseName: course,
            classCode: entry.class.code,
            date,
            startTime: entry.startTime,
            endTime: entry.endTime,
            room,
            teacher: entry.teacher ? teacher : null,
            relations: [...entry.relations.map((relation) => relationLabel(t, relation)), ...(live ? [t('schedule.upcoming.inProgress')] : [])],
          })
          return (
            <li key={`${entry.id}|${date}`} className="tt-upcoming__item">
              <button type="button" className="tt-upcoming__button" aria-label={label} onClick={() => onOpen(entry, date)}>
                <span className={`tt-tile tt-tone-${toneOf(entry.class.course.id)}`} aria-hidden="true">
                  <span className="tt-tile__day">{t(`schedule.calendar.weekdaysShort.${weekdayKey(weekdayOf(date))}`)}</span>
                  <span className="tt-tile__num">{Number(date.slice(8, 10))}</span>
                </span>
                <span className="tt-upcoming__body">
                  <span className="tt-upcoming__name">{course}</span>
                  <span className="tt-upcoming__meta">
                    <bdi>{entry.class.code}</bdi>
                    {' · '}
                    <span dir="ltr">{timeRange(entry.startTime, entry.endTime)}</span>
                  </span>
                  <span className="tt-upcoming__meta">
                    {/* The room's code keeps the line short; the full name is in the details. */}
                    {entry.room ? <bdi>{entry.room.code}</bdi> : t('schedule.noRoom')}
                    {' · '}
                    <bdi>{teacher}</bdi>
                  </span>
                  {live ? <span className="tt-live">{t('schedule.upcoming.inProgress')}</span> : null}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    )

  return (
    <section className="tt-upcoming" aria-labelledby={headingId}>
      <h3 id={headingId} className="tt-upcoming__title">
        {t('schedule.upcoming.title')}
      </h3>
      <p className="tt-upcoming__hint">{t('schedule.upcoming.hint')}</p>
      {body}
    </section>
  )
}
