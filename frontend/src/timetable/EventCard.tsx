// One weekly slot on the calendar (J-F08): a pastel card (one tone per course)
// with the course, the class code, the time range and — as its height allows —
// the class name, teacher, room and, in «my schedule», why the caller sees it.
// The whole card is a button that opens the details; its accessible name says
// everything the abridged text may leave out. Times sit in a `dir="ltr"` span
// so Arabic never reverses `09:00 – 10:30`.
import { EnvironmentOutlined, UserOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'
import type { CalendarDate } from './timetable.dates'
import { personName, relationLabel, roomLabel, slotLabel, timeRange } from './timetable.format'
import type { CardDensity } from './timetable.layout'
import { toneOf } from './timetable.model'
import type { TimetableEntry } from './timetable.model'

interface EventCardProps {
  entry: TimetableEntry
  date: CalendarDate
  language: Language
  /** `card` = a free-standing card (mobile lists): everything, natural height. */
  density: CardDensity | 'card'
  /** The academy's zone: a slot in another zone shows its own. */
  academyTimeZone: string
  onOpen: (entry: TimetableEntry, date: CalendarDate) => void
  /** Column index in the week grid (arrow-key navigation). */
  navDay?: number
  /** Shares its column with overlapping slots: only the course and the time fit. */
  narrow?: boolean
}

export function EventCard({ entry, date, language, density, academyTimeZone, onOpen, navDay, narrow = false }: EventCardProps) {
  const { t } = useTranslation()
  const course = localizedLabel(entry.class.course.name, language)
  const teacher = entry.teacher ? personName(entry.teacher) : t('schedule.noTeacher')
  const room = entry.room ? roomLabel(entry.room, language) : null
  const relations = entry.relations.map((relation) => relationLabel(t, relation))
  const otherZone = entry.timeZone !== academyTimeZone ? entry.timeZone : null
  const showSub = !narrow && (density === 'regular' || density === 'full' || density === 'card')
  const label = slotLabel(t, language, {
    courseName: course,
    classCode: entry.class.code,
    date,
    startTime: entry.startTime,
    endTime: entry.endTime,
    room,
    teacher: entry.teacher ? teacher : null,
    relations,
  })
  // In the grid the range is compact (`09:00–10:30`); a free-standing card has room for spaces.
  const range = density === 'card' ? timeRange(entry.startTime, entry.endTime) : `${entry.startTime}–${entry.endTime}`

  return (
    <button
      type="button"
      className={`tt-event tt-tone-${toneOf(entry.class.course.id)} is-${density}${narrow ? ' is-narrow' : ''}`}
      aria-label={label}
      onClick={() => onOpen(entry, date)}
      data-day={navDay}
      data-start={entry.startMinutes}
    >
      <span className="tt-event__title">{course}</span>
      {showSub ? (
        <span className="tt-event__sub">
          <bdi>{entry.class.code}</bdi>
        </span>
      ) : null}
      {density === 'card' ? (
        <>
          <span className="tt-event__meta">
            <UserOutlined aria-hidden="true" />
            <span className="tt-event__text">{teacher}</span>
          </span>
          {room ? (
            <span className="tt-event__meta">
              <EnvironmentOutlined aria-hidden="true" />
              <span className="tt-event__text">
                <bdi>{room}</bdi>
              </span>
            </span>
          ) : null}
        </>
      ) : null}
      {density === 'full' && !narrow ? (
        // One line in the grid: the room's code, then the teacher.
        <span className="tt-event__meta">
          {entry.room ? <EnvironmentOutlined aria-hidden="true" /> : <UserOutlined aria-hidden="true" />}
          <span className="tt-event__text">
            {entry.room ? (
              <>
                <bdi>{entry.room.code}</bdi> · {teacher}
              </>
            ) : (
              teacher
            )}
          </span>
        </span>
      ) : null}
      {relations.length > 0 && !narrow && (density === 'regular' || density === 'full' || density === 'card') ? (
        <span className="tt-event__relations">
          {relations.map((text) => (
            <span key={text} className="tt-chip">
              {text}
            </span>
          ))}
        </span>
      ) : null}
      <span className="tt-event__time">
        {/* A short card beside others shows its start; its height already shows the duration. */}
        <span dir="ltr">{narrow && (density === 'compact' || density === 'tiny') ? entry.startTime : range}</span>
        {otherZone ? (
          <>
            {' · '}
            <span dir="ltr">{otherZone}</span>
          </>
        ) : null}
      </span>
    </button>
  )
}
