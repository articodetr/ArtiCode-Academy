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

    // The full 24-hour frame starts at 00:00, 24 px per hour in jsdom, and lists 00:00 through 24:00.
    const axisLabels = Array.from(grid.querySelectorAll('.tt-axis__hour')).map((el) => el.textContent)
    expect(axisLabels).toHaveLength(25)
    expect(axisLabels[0]).toBe('00:00')
    expect(axisLabels[24]).toBe('24:00')
    const slot = card('09:00', '11:00').closest('li')!
    expect(slot.style.top).toBe('216px')
    expect(slot.style.height).toBe('48px')
    expect(slot.style.width).toBe('100%')
    expect(card('09:00', '11:00')).toHaveTextContent('أساسيات بايثون')
    expect(card('09:00', '11:00')).toHaveTextContent('PY-101-A')
    expect(card('09:00', '11:00')).toHaveTextContent('09:00–11:00')
    fireEvent.click(card('09:00', '11:00'))
    expect(onOpen).toHaveBeenCalledWith(nine, '2026-11-08')
    // "now" (10:00 academy time) sits on today's column only.
    expect(grid.querySelectorAll('.tt-now')).toHaveLength(1)
    expect(grid.querySelector('.tt-now')).toHaveStyle({ top: '240px' })
    expect(within(grid).getByRole('region', { name: `${formatLongDate('2026-11-09', 'ar')} — عدد الحصص: 0` })).toBeInTheDocument()
  })

  it('scales the 24-hour grid height to fit the viewport without scrolling down', () => {
    const originalInnerHeight = window.innerHeight
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 702 })
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 268,
      bottom: 844,
      left: 0,
      right: 780,
      width: 780,
      height: 576,
      x: 0,
      y: 268,
      toJSON: () => ({}),
    })
    try {
      renderGrid([gridDay('2026-11-08', [at('nine', '09:00', '10:00')], { isSelected: true, isToday: true })])
      const body = document.querySelector<HTMLElement>('.tt-grid__body')!
      // (702 - 268 - 42) = 392 px available -> floor(392 / 24) = 16 px/hour -> 384 px total height, inside the viewport.
      expect(body.style.height).toBe('384px')
      expect(card('09:00', '10:00').closest('li')!.style.top).toBe('144px')
      expect(card('09:00', '10:00').closest('li')!.style.height).toBe('16px')
    } finally {
      rectSpy.mockRestore()
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
    }
  })

  it('puts overlapping slots side by side, each with its own width', () => {
    renderGrid([gridDay('2026-11-08', [at('long', '10:00', '12:00'), at('short', '10:30', '11:30')]), gridDay('2026-11-09', [])])
    expect(card('10:00', '12:00').closest('li')!.style.width).toBe('50%')
    expect(card('10:30', '11:30').closest('li')!.style.width).toBe('50%')
    expect(card('10:30', '11:30')).toHaveClass('is-narrow')
    // Beside another slot a card keeps the course and the time only.
    expect(card('10:30', '11:30').querySelector('.tt-event__extras')).toBeNull()
  })

  it('cascades three overlapping slots of a week column: three focusable cards in start order, each wider than a third of the column (KI-119)', () => {
    const three = [at('third', '10:30', '11:30'), at('first', '09:30', '11:00'), at('second', '10:00', '12:00')]
    renderGrid([gridDay('2026-11-08', three), gridDay('2026-11-09', [])])
    const cards = [card('09:30', '11:00'), card('10:00', '12:00'), card('10:30', '11:30')]
    // DOM order — the tab order and the paint order — is start order: the card that starts last lies on top.
    const column = cards[0]!.closest('section')!
    expect(Array.from(column.querySelectorAll('button.tt-event'))).toEqual(cards)
    const slots = cards.map((button) => button.closest('li')!)
    expect(slots.map((slot) => slot.style.width)).toEqual(['60%', '60%', '60%'])
    for (const slot of slots) {
      expect(parseFloat(slot.style.width)).toBeGreaterThan(100 / 3)
      expect(slot).toHaveClass('is-cascade')
    }
    // Each lane a step further from the inline-start edge (logical: mirrored in Arabic, no left/right).
    expect(slots.map((slot) => slot.style.insetInlineStart)).toEqual(['0%', '20%', '40%'])
    for (const slot of slots) {
      expect(slot.style.left).toBe('')
      expect(slot.style.right).toBe('')
    }
    // Each card is a button that takes the focus; beside the others it shows the course and the start time.
    for (const button of cards) {
      button.focus()
      expect(document.activeElement).toBe(button)
      expect(button).toHaveClass('is-narrow')
      expect(button).toHaveTextContent('أساسيات بايثون')
    }
    expect(cards[2]).toHaveTextContent('10:30')
    // Arrow down walks the cascade in start order.
    cards[0]!.focus()
    fireEvent.keyDown(cards[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cards[1])
    fireEvent.keyDown(cards[1]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cards[2])
  })

  it('lays the same cascade out in English, and three overlapping slots side by side in the day view (KI-119)', () => {
    const three = () => [at('a', '09:00', '10:00'), at('b', '09:00', '10:00'), at('c', '09:00', '10:00')]
    const first = renderWithProviders(
      <WeekGrid days={[gridDay('2026-11-08', three()), gridDay('2026-11-09', [])]} language="en" academyTimeZone="Asia/Riyadh" nowMinutes={600} label="grid" loading={false} empty={null} onSelectDate={vi.fn()} onOpen={vi.fn()} />,
    )
    const englishSlots = Array.from(first.container.querySelectorAll<HTMLLIElement>('li.tt-slot'))
    expect(englishSlots.map((slot) => [slot.style.insetInlineStart, slot.style.width])).toEqual([
      ['0%', '60%'],
      ['20%', '60%'],
      ['40%', '60%'],
    ])
    first.unmount()

    // The day view's column is wide: thirds, side by side, with the room for every line.
    renderGrid([gridDay('2026-11-08', three())])
    const daySlots = Array.from(document.querySelectorAll<HTMLLIElement>('li.tt-slot'))
    expect(daySlots).toHaveLength(3)
    for (const slot of daySlots) {
      expect(slot).not.toHaveClass('is-cascade')
      expect(parseFloat(slot.style.width)).toBeCloseTo(100 / 3)
    }
  })

  it('renders the secondary lines in the order they give way — class, room, teacher — each name and code in its own <bdi> (J-F17)', () => {
    const latin = entryOfSlot(makeSlot({ id: 'latin', startTime: '09:00', endTime: '10:30', teacher: { userId: '0193b000-0000-7000-8000-00000000f002', fullName: 'Mehmet Yılmaz' } }))
    renderGrid([gridDay('2026-11-08', [latin, at('short', '13:00', '13:30')]), gridDay('2026-11-09', [])])
    // A 90-minute card renders every line; timetable.css shows the ones its real size holds, each whole.
    const lines = Array.from(card('09:00', '10:30').querySelectorAll('.tt-event__info > *'))
    expect(lines.map((line) => line.className)).toEqual(['tt-event__sub', 'tt-event__meta is-room', 'tt-event__meta is-teacher'])
    expect(lines[0].querySelector('bdi')).toHaveTextContent(/^PY-101-A$/)
    // The room and the teacher are two items, never one run of mixed text cut by one ellipsis.
    expect(lines[1].querySelector('bdi')).toHaveTextContent(/^LAB-1$/)
    expect(lines[1].querySelectorAll('bdi')).toHaveLength(1)
    expect(lines[2].querySelector('bdi')).toHaveTextContent(/^Mehmet Yılmaz$/)
    // A one-line (30-minute) card shows the course and the time only.
    expect(card('13:00', '13:30')).toHaveClass('is-tiny')
    expect(card('13:00', '13:30').querySelector('.tt-event__extras')).toBeNull()
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
