import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { renderWithProviders } from '../test/render'
import { makeMyItem } from '../test/timetable'
import { DayTimeline } from './MobileViews'
import { clockMinutes } from './timetable.dates'
import { formatLongDate } from './timetable.format'
import { entriesOfMine } from './timetable.model'

const DATE = '2026-11-08'

const day = entriesOfMine([
  makeMyItem({ id: 'morning', startTime: '09:00', endTime: '10:00' }),
  makeMyItem({ id: 'evening', startTime: '17:00', endTime: '18:30', teacher: { fullName: 'Emily Carter', displayName: null } }),
])

function renderTimeline(nowMinutes: number | null) {
  renderWithProviders(<DayTimeline date={DATE} entries={day} nowMinutes={nowMinutes} language="ar" academyTimeZone="Asia/Riyadh" onOpen={vi.fn()} empty={<p>empty</p>} />)
  return screen.getByRole('list', { name: formatLongDate(DATE, 'ar') })
}

/** The timeline's rows in order: each slot by its start, the (aria-hidden) marker as `now`. */
function rowsOf(list: HTMLElement): string[] {
  return Array.from(list.children).map((row) => (row.classList.contains('tt-timeline__now') ? 'now' : row.querySelector('.tt-timeline__start')!.textContent!))
}

describe('DayTimeline (phone day view)', () => {
  it('keeps the now marker on screen while the day’s last slot runs (J-F17)', () => {
    const list = renderTimeline(clockMinutes('17:30'))
    expect(rowsOf(list)).toEqual(['09:00', '17:00', 'now'])
    expect(list.querySelector('.tt-timeline__now')).toHaveTextContent(ar.schedule.calendar.now)
  })

  it('puts the marker before the first slot when none has started yet', () => {
    expect(rowsOf(renderTimeline(clockMinutes('08:00')))).toEqual(['now', '09:00', '17:00'])
  })

  it('puts the marker between a finished slot and the next one', () => {
    expect(rowsOf(renderTimeline(clockMinutes('12:00')))).toEqual(['09:00', 'now', '17:00'])
  })

  it('puts the marker after the last slot once the day is over', () => {
    expect(rowsOf(renderTimeline(clockMinutes('20:00')))).toEqual(['09:00', '17:00', 'now'])
  })

  it('shows no marker on a day that is not today', () => {
    expect(rowsOf(renderTimeline(null))).toEqual(['09:00', '17:00'])
  })

  it('shows the class, the teacher, the room and why on a large card — names and codes each in their own <bdi> (J-F17)', () => {
    const list = renderTimeline(null)
    const evening = within(list).getByRole('button', { name: /من 17:00 إلى 18:30/ })
    expect(evening.querySelector('.tt-event__sub bdi')).toHaveTextContent(/^PY-101-A$/)
    // The Latin name sits in its own isolate, never in one run with the Arabic of the line.
    expect(evening.querySelector('.is-teacher bdi')).toHaveTextContent(/^Emily Carter$/)
    // The room's Latin code and Arabic name are two isolates: an ellipsis cuts the name's end, never its start.
    expect(evening.querySelector('.is-room .tt-event__code')).toHaveTextContent(/^LAB-1$/)
    expect(evening.querySelector('.is-room .tt-event__text')).toHaveTextContent(/^مختبر 1$/)
    expect(within(evening).getByText(ar.schedule.relation.self)).toHaveClass('tt-chip')
  })
})
