// The compact month calendar beside the week (J-F08): the shown month with
// previous/next buttons, weekdays from the academy's first day of the week,
// the selected date as a filled purple circle, today as a ring, and the shown
// week as a lavender band. Clicking a date selects it (the week and the day
// view follow). Keyboard: one date is tabbable (roving tabindex); arrows move
// a day (mirrored in RTL) or a week, Home/End go to the week's ends,
// PageUp/PageDown change the month, Enter/Space select.
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { directionOf } from '../i18n/language'
import type { Language } from '../i18n/language'
import { addDays, addMonths, firstOfMonth, monthOf, monthRows, normaliseWeekday, sameMonth, weekdayOf } from './timetable.dates'
import type { CalendarDate, CalendarMonth } from './timetable.dates'
import { formatLongDate, formatMonthTitle, weekdayKey, weekdayOrder } from './timetable.format'

interface MiniMonthProps {
  month: CalendarMonth
  onMonthChange: (month: CalendarMonth) => void
  selected: CalendarDate
  today: CalendarDate
  weekStartsOn: number
  /** The shown week (first and last shown dates), drawn as a band. */
  band: { from: CalendarDate; to: CalendarDate } | null
  onSelect: (date: CalendarDate) => void
  language: Language
}

function classNames(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ')
}

export function MiniMonth({ month, onMonthChange, selected, today, weekStartsOn, band, onSelect, language }: MiniMonthProps) {
  const { t } = useTranslation()
  const rtl = directionOf(language) === 'rtl'
  const [cursor, setCursor] = useState<CalendarDate | null>(null)
  const focusAfterRender = useRef(false)
  const grid = useRef<HTMLTableElement>(null)
  // The tabbable date: the moved cursor while it is in this month, else the selection, else the 1st.
  const active = cursor && sameMonth(cursor, month) ? cursor : sameMonth(selected, month) ? selected : firstOfMonth(month)

  useEffect(() => {
    if (!focusAfterRender.current) return
    focusAfterRender.current = false
    grid.current?.querySelector<HTMLButtonElement>(`button[data-date="${active}"]`)?.focus()
  }, [active])

  const moveTo = (date: CalendarDate) => {
    setCursor(date)
    focusAfterRender.current = true
    if (!sameMonth(date, month)) onMonthChange(monthOf(date))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const offset = normaliseWeekday(weekdayOf(active) - weekStartsOn)
    const moves: Record<string, () => CalendarDate> = {
      ArrowRight: () => addDays(active, rtl ? -1 : 1),
      ArrowLeft: () => addDays(active, rtl ? 1 : -1),
      ArrowDown: () => addDays(active, 7),
      ArrowUp: () => addDays(active, -7),
      Home: () => addDays(active, -offset),
      End: () => addDays(active, 6 - offset),
      PageUp: () => shiftMonth(active, -1),
      PageDown: () => shiftMonth(active, 1),
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    moveTo(move())
  }

  const previous = <Button type="text" size="small" shape="circle" icon={rtl ? <RightOutlined /> : <LeftOutlined />} aria-label={t('schedule.month.previous')} onClick={() => onMonthChange(addMonths(month, -1))} />
  const next = <Button type="text" size="small" shape="circle" icon={rtl ? <LeftOutlined /> : <RightOutlined />} aria-label={t('schedule.month.next')} onClick={() => onMonthChange(addMonths(month, 1))} />
  const title = formatMonthTitle(month, language)

  return (
    <section className="tt-month" aria-label={t('schedule.month.label')}>
      <div className="tt-month__head">
        <h3 className="tt-month__title" aria-live="polite">
          {title}
        </h3>
        <span>
          {previous}
          {next}
        </span>
      </div>
      <table className="tt-month__grid" aria-label={title} ref={grid} onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {weekdayOrder(weekStartsOn).map((weekday) => (
              <th key={weekday} scope="col" abbr={t(`days.${weekdayKey(weekday)}`)}>
                {t(`schedule.calendar.weekdaysShort.${weekdayKey(weekday)}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthRows(month, weekStartsOn).map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((date, cellIndex) => {
                if (!date) return <td key={`empty-${cellIndex}`} className="tt-month__cell" />
                const inBandAt = (index: number) => {
                  const other = row[index]
                  return band !== null && typeof other === 'string' && other >= band.from && other <= band.to
                }
                const inBand = inBandAt(cellIndex)
                return (
                  <td
                    key={date}
                    className={classNames(
                      'tt-month__cell',
                      inBand && 'in-band',
                      inBand && !inBandAt(cellIndex - 1) && 'band-start',
                      inBand && !inBandAt(cellIndex + 1) && 'band-end',
                    )}
                  >
                    <button
                      type="button"
                      data-date={date}
                      className={classNames('tt-month__day', date === selected && 'is-selected', date === today && 'is-today')}
                      tabIndex={date === active ? 0 : -1}
                      aria-label={formatLongDate(date, language)}
                      aria-pressed={date === selected}
                      aria-current={date === today ? 'date' : undefined}
                      onClick={() => {
                        setCursor(date)
                        onSelect(date)
                      }}
                    >
                      {Number(date.slice(8, 10))}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** The same day of the month in the month before/after (clamped to its last day). */
function shiftMonth(date: CalendarDate, delta: number): CalendarDate {
  const target = addMonths(monthOf(date), delta)
  const day = Number(date.slice(8, 10))
  const last = new Date(Date.UTC(target.year, target.month, 0)).getUTCDate()
  return addDays(firstOfMonth(target), Math.min(day, last) - 1)
}
