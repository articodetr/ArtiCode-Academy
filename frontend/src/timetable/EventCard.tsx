// One weekly slot on the calendar (J-F08): a pastel card (one tone per course)
// with the course, the time range and — as its space allows — the class code,
// why the caller sees it («my schedule»), the room and the teacher. In the grid
// those secondary lines are all rendered and timetable.css shows each one
// whole or not at all, by the card's real height AND width (J-F17): a wide
// card puts them on one line beside the course and the time. The whole card is
// a button that opens the details; its accessible name says everything the
// abridged text may leave out. Times sit in a `dir="ltr"` span so Arabic never
// reverses `09:00 – 10:30`; names and codes sit in `<bdi>` so a Latin name
// never scrambles an Arabic line (or the reverse).
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
  const roomName = entry.room?.name ? localizedLabel(entry.room.name, language) : null
  const relations = entry.relations.map((relation) => relationLabel(t, relation))
  const otherZone = entry.timeZone !== academyTimeZone ? entry.timeZone : null
  // A one-line card and a card beside overlapping slots show the course and the time only.
  const showExtras = density === 'card' || (!narrow && density !== 'tiny')
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
      {showExtras ? (
        // In DOM order = the order the lines give way in a short card (the last first).
        <span className="tt-event__extras">
          <span className="tt-event__info">
            <span className="tt-event__sub">
              <bdi>{entry.class.code}</bdi>
            </span>
            {relations.length > 0 ? (
              <span className="tt-event__relations">
                {relations.map((text) => (
                  <span key={text} className="tt-chip">
                    {text}
                  </span>
                ))}
              </span>
            ) : null}
            {entry.room ? (
              <span className="tt-event__meta is-room">
                <EnvironmentOutlined aria-hidden="true" />
                {/* The grid shows the room's code; a free-standing card its code and name. Each is
                    its own isolate: one ellipsis over a Latin code and an Arabic name cuts the name's
                    first letters instead of its end. */}
                <bdi className="tt-event__code">{entry.room.code}</bdi>
                {density === 'card' && roomName ? (
                  <>
                    <span aria-hidden="true">—</span>
                    <bdi className="tt-event__text">{roomName}</bdi>
                  </>
                ) : null}
              </span>
            ) : null}
            <span className="tt-event__meta is-teacher">
              <UserOutlined aria-hidden="true" />
              <bdi className="tt-event__text">{teacher}</bdi>
            </span>
          </span>
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
