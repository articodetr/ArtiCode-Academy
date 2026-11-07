// The time grid of the calendar (J-F08): the shown days as columns under a
// header of day buttons (the selected day as a purple pill), the hours along
// the inline-start edge, and every slot as a card placed at its start time
// with a height equal to its duration; overlapping slots share their column
// side by side. Today's column carries a "now" line (academy time). Arrow
// keys move between cards: up/down inside a day, left/right to the
// neighbouring day (mirrored in RTL). One column = the day view.
import { Spin } from 'antd'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { directionOf } from '../i18n/language'
import type { Language } from '../i18n/language'
import { EventCard } from './EventCard'
import { clockOfMinutes } from './timetable.dates'
import type { CalendarDate } from './timetable.dates'
import { dayNumber, formatLongDate, weekdayKey } from './timetable.format'
import { densityOf, hourHeightOf, hourRangeOf, hoursOf, layoutDay, verticalBox } from './timetable.layout'
import type { TimetableEntry } from './timetable.model'

export interface GridDay {
  date: CalendarDate
  weekday: number
  /** The day's slots, in display order. */
  entries: TimetableEntry[]
  isToday: boolean
  isSelected: boolean
  /** Outside the academy's working days (shown only because it holds a slot or is selected). */
  isOff: boolean
}

interface WeekGridProps {
  days: GridDay[]
  language: Language
  academyTimeZone: string
  /** Minutes since midnight in the academy's zone — the "now" line on today's column. */
  nowMinutes: number
  /** Accessible name of the grid region. */
  label: string
  loading: boolean
  /** Shown over the grid when the shown days hold no slot. */
  empty: ReactNode | null
  onSelectDate: (date: CalendarDate) => void
  onOpen: (entry: TimetableEntry, date: CalendarDate) => void
}

function classNames(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ')
}

export function WeekGrid({ days, language, academyTimeZone, nowMinutes, label, loading, empty, onSelectDate, onOpen }: WeekGridProps) {
  const { t } = useTranslation()
  const range = hourRangeOf(days.flatMap((day) => day.entries))
  const hourHeight = hourHeightOf(range)
  const height = (range.endHour - range.startHour) * hourHeight
  const origin = range.startHour * 60
  const nowInRange = nowMinutes >= origin && nowMinutes <= range.endHour * 60
  const rtl = directionOf(language) === 'rtl'
  const style = { '--tt-days': days.length, '--tt-hour': `${hourHeight}px` } as CSSProperties

  // Up/down: the previous/next card of the same day; left/right: the card of the
  // neighbouring day that starts closest to the current one (mirrored in RTL).
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = event.target
    if (!(current instanceof HTMLButtonElement) || !current.classList.contains('tt-event')) return
    const cards = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button.tt-event'))
    const dayOf = (card: HTMLButtonElement) => Number(card.dataset.day)
    const day = dayOf(current)
    const sameDay = cards.filter((card) => dayOf(card) === day)
    let next: HTMLButtonElement | undefined
    if (event.key === 'ArrowDown') next = sameDay[sameDay.indexOf(current) + 1]
    else if (event.key === 'ArrowUp') next = sameDay[sameDay.indexOf(current) - 1]
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const step = (event.key === 'ArrowRight') !== rtl ? 1 : -1
      const start = Number(current.dataset.start)
      for (let other = day + step; other >= 0 && other < days.length && !next; other += step) {
        const candidates = cards.filter((card) => dayOf(card) === other)
        next = candidates.sort((a, b) => Math.abs(Number(a.dataset.start) - start) - Math.abs(Number(b.dataset.start) - start))[0]
      }
    }
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  return (
    <div className={days.length === 1 ? 'tt-grid is-single' : 'tt-grid'} style={style} role="region" aria-label={label} aria-busy={loading} onKeyDown={moveFocus}>
      <div className="tt-grid__inner" style={{ paddingBottom: 10 }}>
        <div className="tt-grid__head">
          <div className="tt-grid__corner" aria-hidden="true" />
          {days.map((day) => (
            <button
              key={day.date}
              type="button"
              className={classNames('tt-dayhead', day.isSelected && 'is-selected', day.isToday && 'is-today', day.isOff && 'is-off')}
              aria-pressed={day.isSelected}
              aria-current={day.isToday ? 'date' : undefined}
              aria-label={day.isOff ? `${formatLongDate(day.date, language)} (${t('schedule.calendar.nonWorkingDay')})` : formatLongDate(day.date, language)}
              title={day.isOff ? t('schedule.calendar.nonWorkingDay') : undefined}
              onClick={() => onSelectDate(day.date)}
            >
              <span className="tt-dayhead__num">{dayNumber(day.date)}</span>
              <span className="tt-dayhead__name">{language === 'en' ? t(`schedule.calendar.weekdaysShort.${weekdayKey(day.weekday)}`) : t(`days.${weekdayKey(day.weekday)}`)}</span>
            </button>
          ))}
        </div>
        <div className="tt-grid__body" style={{ height }}>
          <div className="tt-axis" aria-hidden="true">
            {hoursOf(range).map((hour) => (
              <span key={hour} className="tt-axis__hour" style={{ top: (hour - range.startHour) * hourHeight }}>
                {clockOfMinutes(hour * 60)}
              </span>
            ))}
          </div>
          {days.map((day, dayIndex) => (
            <section
              key={day.date}
              className={classNames('tt-col', day.isSelected && 'is-selected', day.isOff && 'is-off')}
              aria-label={t('schedule.calendar.dayColumn', { date: formatLongDate(day.date, language), count: day.entries.length })}
            >
              <ul className="tt-col__list">
                {layoutDay(day.entries).map(({ item, column, columns }) => {
                  const box = verticalBox(item.startMinutes, item.endMinutes, range, hourHeight)
                  return (
                    <li
                      key={item.id}
                      className="tt-slot"
                      style={{ top: box.top, height: box.height, insetInlineStart: `${(column / columns) * 100}%`, width: `${100 / columns}%` }}
                    >
                      <EventCard
                        entry={item}
                        date={day.date}
                        language={language}
                        density={densityOf(box.height)}
                        academyTimeZone={academyTimeZone}
                        onOpen={onOpen}
                        navDay={dayIndex}
                        narrow={columns > 1 && days.length > 1}
                      />
                    </li>
                  )
                })}
              </ul>
              {day.isToday && nowInRange ? (
                <div className="tt-now" style={{ top: ((nowMinutes - origin) / 60) * hourHeight }} title={t('schedule.calendar.now')} aria-hidden="true" />
              ) : null}
            </section>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="tt-grid__overlay">
          <Spin aria-label={t('schedule.calendar.loading')} />
        </div>
      ) : empty ? (
        <div className="tt-grid__overlay">{empty}</div>
      ) : null}
    </div>
  )
}
