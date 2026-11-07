import { fireEvent, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { renderWithProviders } from '../test/render'
import { MiniMonth } from './MiniMonth'
import { formatLongDate } from './timetable.format'

function renderMonth(overrides: Partial<ComponentProps<typeof MiniMonth>> = {}) {
  const onSelect = vi.fn()
  const onMonthChange = vi.fn()
  renderWithProviders(
    <MiniMonth
      month={{ year: 2026, month: 11 }}
      onMonthChange={onMonthChange}
      selected="2026-11-10"
      today="2026-11-08"
      weekStartsOn={6}
      band={{ from: '2026-11-08', to: '2026-11-12' }}
      onSelect={onSelect}
      language="ar"
      {...overrides}
    />,
  )
  return { onSelect, onMonthChange }
}

const day = (date: string) => screen.getByRole('button', { name: formatLongDate(date, 'ar') })

describe('MiniMonth', () => {
  it('starts on the academy’s first day and marks the selected date, today and the shown week', () => {
    renderMonth()
    const month = screen.getByRole('region', { name: ar.schedule.month.label })
    expect(within(month).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['سبت', 'أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'])
    expect(within(month).getByRole('heading')).toHaveTextContent('نوفمبر')
    expect(day('2026-11-10')).toHaveAttribute('aria-pressed', 'true')
    expect(day('2026-11-10')).toHaveAttribute('tabindex', '0')
    expect(day('2026-11-11')).toHaveAttribute('tabindex', '-1')
    expect(day('2026-11-08')).toHaveAttribute('aria-current', 'date')
    expect(day('2026-11-08').closest('td')).toHaveClass('in-band', 'band-start')
    expect(day('2026-11-12').closest('td')).toHaveClass('in-band', 'band-end')
    expect(day('2026-11-13').closest('td')).not.toHaveClass('in-band')
    // November 2026 starts on a Sunday: one empty cell before it in a week that starts on Saturday.
    expect(day('2026-11-01').closest('td')!.previousElementSibling).toBeEmptyDOMElement()
  })

  it('selects a clicked date and changes the month with its buttons', () => {
    const { onSelect, onMonthChange } = renderMonth()
    fireEvent.click(day('2026-11-20'))
    expect(onSelect).toHaveBeenCalledWith('2026-11-20')
    fireEvent.click(screen.getByRole('button', { name: ar.schedule.month.next }))
    expect(onMonthChange).toHaveBeenLastCalledWith({ year: 2026, month: 12 })
    fireEvent.click(screen.getByRole('button', { name: ar.schedule.month.previous }))
    expect(onMonthChange).toHaveBeenLastCalledWith({ year: 2026, month: 10 })
  })

  it('moves the focus with the keyboard — arrows mirrored in RTL — and changes the month past its edge', () => {
    const { onMonthChange } = renderMonth()
    day('2026-11-10').focus()
    fireEvent.keyDown(day('2026-11-10'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(day('2026-11-11'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(day('2026-11-18'))
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(document.activeElement).toBe(day('2026-11-14'))
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement).toBe(day('2026-11-20'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(day('2026-11-19'))
    fireEvent.keyDown(document.activeElement!, { key: 'PageDown' })
    expect(onMonthChange).toHaveBeenCalledWith({ year: 2026, month: 12 })
  })
})
