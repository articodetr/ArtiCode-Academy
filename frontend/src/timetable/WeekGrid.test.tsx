import { fireEvent, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { renderWithProviders } from '../test/render'
import { makeSlot } from '../test/timetable'
import { weekdayOf } from './timetable.dates'
import { formatLongDate } from './timetable.format'
import { entryOfSlot } from './timetable.model'
import type { TimetableEntry } from './timetable.model'
import { WeekGrid } from './WeekGrid'
import type { GridDay } from './WeekGrid'

function gridDay(date: string, entries: TimetableEntry[], extra: Partial<GridDay> = {}): GridDay {
  return { date, weekday: weekdayOf(date), entries, isToday: false, isSelected: false, isOff: false, ...extra }
}

function renderGrid(days: GridDay[], overrides: Partial<ComponentProps<typeof WeekGrid>> = {}) {
  const onSelectDate = vi.fn()
  const onOpen = vi.fn()
  renderWithProviders(
    <WeekGrid days={days} language="ar" academyTimeZone="Asia/Riyadh" nowMinutes={600} label="grid" loading={false} empty={null} onSelectDate={onSelectDate} onOpen={onOpen} {...overrides} />,
  )
  return { onSelectDate, onOpen }
}

const at = (id: string, start: string, end: string, weekday = 0) => entryOfSlot(makeSlot({ id, startTime: start, endTime: end, weekday }))
const card = (start: string, end: string) => screen.getByRole('button', { name: new RegExp(`من ${start} إلى ${end}`) })

describe('WeekGrid', () => {
  it('shows the days as headers — the selected one pressed, today current — and places each card by its start and duration', () => {
    const nine = at('nine', '09:00', '11:00')
    const { onSelectDate, onOpen } = renderGrid([gridDay('2026-11-08', [nine], { isSelected: true, isToday: true }), gridDay('2026-11-09', [])])
    const grid = screen.getByRole('region', { name: 'grid' })
    const sunday = within(grid).getByRole('button', { name: formatLongDate('2026-11-08', 'ar') })
    expect(sunday).toHaveAttribute('aria-pressed', 'true')
    expect(sunday).toHaveAttribute('aria-current', 'date')
    expect(sunday).toHaveTextContent('08')
    expect(sunday).toHaveTextContent(ar.days.sun)
    fireEvent.click(within(grid).getByRole('button', { name: formatLongDate('2026-11-09', 'ar') }))
    expect(onSelectDate).toHaveBeenCalledWith('2026-11-09')

    // The frame starts at 08:00, 64 px per hour.
    const slot = card('09:00', '11:00').closest('li')!
    expect(slot.style.top).toBe('64px')
    expect(slot.style.height).toBe('128px')
    expect(slot.style.width).toBe('100%')
    expect(card('09:00', '11:00')).toHaveTextContent('أساسيات بايثون')
    expect(card('09:00', '11:00')).toHaveTextContent('PY-101-A')
    expect(card('09:00', '11:00')).toHaveTextContent('09:00–11:00')
    fireEvent.click(card('09:00', '11:00'))
    expect(onOpen).toHaveBeenCalledWith(nine, '2026-11-08')
    // "now" (10:00 academy time) sits on today's column only.
    expect(grid.querySelectorAll('.tt-now')).toHaveLength(1)
    expect(grid.querySelector('.tt-now')).toHaveStyle({ top: '128px' })
    expect(within(grid).getByRole('region', { name: `${formatLongDate('2026-11-09', 'ar')} — عدد الحصص: 0` })).toBeInTheDocument()
  })

  it('puts overlapping slots side by side, each with its own width', () => {
    renderGrid([gridDay('2026-11-08', [at('long', '10:00', '12:00'), at('short', '10:30', '11:30')]), gridDay('2026-11-09', [])])
    expect(card('10:00', '12:00').closest('li')!.style.width).toBe('50%')
    expect(card('10:30', '11:30').closest('li')!.style.width).toBe('50%')
    expect(card('10:30', '11:30')).toHaveClass('is-narrow')
  })

  it('shows the empty card or the loading state over the grid', () => {
    const { onOpen } = renderGrid([gridDay('2026-11-08', [])], { empty: <p>{ar.schedule.calendar.emptyWeek}</p> })
    expect(screen.getByText(ar.schedule.calendar.emptyWeek)).toBeInTheDocument()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('moves between cards with the arrow keys: up/down in a day, left/right across days (mirrored in RTL)', () => {
    renderGrid([gridDay('2026-11-08', [at('a', '09:00', '10:00'), at('b', '13:00', '14:00')]), gridDay('2026-11-09', [at('c', '10:00', '11:00', 1)])])
    card('09:00', '10:00').focus()
    fireEvent.keyDown(card('09:00', '10:00'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(card('13:00', '14:00'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(card('09:00', '10:00'))
    // RTL: the next day is to the left.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(card('10:00', '11:00'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(card('09:00', '10:00'))
  })
})
