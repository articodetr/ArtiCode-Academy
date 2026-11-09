// The phone layout of the calendar (J-F08) — an intentional layout, not the
// desktop grid shrunk: a strip of the week's seven dates to switch days
// (a dot marks a day with slots), the day view as a timeline of large cards
// with a "now" marker, and the week view as an agenda (one section per shown
// day, a note for a free day).
import { useId } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Language } from '../i18n/language'
import { EventCard } from './EventCard'
import { weekdayOf } from './timetable.dates'
import type { CalendarDate } from './timetable.dates'
import { formatDayMonth, formatLongDate, weekdayKey } from './timetable.format'
import { nowMarkerIndex } from './timetable.layout'
import type { TimetableEntry } from './timetable.model'
import type { GridDay } from './WeekGrid'

function classNames(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ')
}

interface WeekStripProps {
  dates: CalendarDate[]
  selected: CalendarDate
  today: CalendarDate
  /** Dates that hold at least one slot. */
  busy: ReadonlySet<CalendarDate>
  /** The academy's working days; null = every day. */
  workingDays: readonly number[] | null
  language: Language
  onSelect: (date: CalendarDate) => void
}

export function WeekStrip({ dates, selected, today, busy, workingDays, language, onSelect }: WeekStripProps) {
  const { t } = useTranslation()
  return (
    <div className="tt-strip" role="group" aria-label={t('schedule.calendar.weekStrip')}>
      {dates.map((date) => {
        const off = workingDays !== null && !workingDays.includes(weekdayOf(date))
        return (
          <button
            key={date}
            type="button"
            className={classNames('tt-strip__day', date === selected && 'is-selected', date === today && 'is-today', off && 'is-off')}
            aria-pressed={date === selected}
            aria-current={date === today ? 'date' : undefined}
            aria-label={formatLongDate(date, language)}
            onClick={() => onSelect(date)}
          >
            <span className="tt-strip__name">{t(`schedule.calendar.weekdaysShort.${weekdayKey(weekdayOf(date))}`)}</span>
            <span className="tt-strip__num">{Number(date.slice(8, 10))}</span>
            <span className="tt-strip__dot" aria-hidden="true" style={{ visibility: busy.has(date) ? 'visible' : 'hidden' }} />
          </button>
        )
      })}
    </div>
  )
}

interface DayTimelineProps {
  date: CalendarDate
  entries: TimetableEntry[]
  /** Minutes since midnight (academy zone) when `date` is today, else null. */
  nowMinutes: number | null
  language: Language
  academyTimeZone: string
  onOpen: (entry: TimetableEntry, date: CalendarDate) => void
  /** Shown instead of the list when the day holds no slot. */
  empty: ReactNode
}

export function DayTimeline({ date, entries, nowMinutes, language, academyTimeZone, onOpen, empty }: DayTimelineProps) {
  const { t } = useTranslation()
  if (entries.length === 0) return <>{empty}</>
  // The "now" marker sits before the first slot that has not started yet, else after the last one.
  const nowIndex = nowMarkerIndex(entries, nowMinutes)
  const items: ReactNode[] = []
  entries.forEach((entry, index) => {
    if (index === nowIndex) items.push(<NowMarker key="now" label={t('schedule.calendar.now')} />)
    items.push(
      <li key={entry.id} className="tt-timeline__item">
        <div className="tt-timeline__time" aria-hidden="true">
          <span className="tt-timeline__start">{entry.startTime}</span>
          <span className="tt-timeline__end">{entry.endTime}</span>
        </div>
        <EventCard entry={entry} date={date} language={language} density="card" academyTimeZone={academyTimeZone} onOpen={onOpen} />
      </li>,
    )
  })
  if (nowIndex === entries.length) items.push(<NowMarker key="now" label={t('schedule.calendar.now')} />)
  return (
    <ol className="tt-timeline" aria-label={formatLongDate(date, language)}>
      {items}
    </ol>
  )
}

function NowMarker({ label }: { label: string }) {
  return (
    <li className="tt-timeline__now" aria-hidden="true">
      {label}
    </li>
  )
}

interface WeekAgendaProps {
  days: GridDay[]
  language: Language
  academyTimeZone: string
  onOpen: (entry: TimetableEntry, date: CalendarDate) => void
}

export function WeekAgenda({ days, language, academyTimeZone, onOpen }: WeekAgendaProps) {
  return (
    <div className="tt-agenda">
      {days.map((day) => (
        <AgendaDay key={day.date} day={day} language={language} academyTimeZone={academyTimeZone} onOpen={onOpen} />
      ))}
    </div>
  )
}

function AgendaDay({ day, language, academyTimeZone, onOpen }: { day: GridDay } & Omit<WeekAgendaProps, 'days'>) {
  const { t } = useTranslation()
  const headingId = useId()
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className={classNames('tt-agenda__head', day.isToday && 'is-today')}>
        <span>
          {t(`days.${weekdayKey(day.weekday)}`)} {formatDayMonth(day.date, language)}
        </span>
        <span className="tt-agenda__count">{t('schedule.calendar.slotCount', { count: day.entries.length })}</span>
      </h3>
      {day.entries.length > 0 ? (
        <ul className="tt-agenda__list">
          {day.entries.map((entry) => (
            <li key={entry.id}>
              <EventCard entry={entry} date={day.date} language={language} density="card" academyTimeZone={academyTimeZone} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="tt-agenda__none">{t('schedule.calendar.emptyDay')}</p>
      )}
    </section>
  )
}
