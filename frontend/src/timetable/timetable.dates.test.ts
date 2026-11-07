import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  calendarDateIn,
  clockMinutes,
  clockOfMinutes,
  datesFrom,
  daysInMonth,
  firstOfMonth,
  isCalendarDate,
  isTimeZone,
  minutesNowIn,
  monthOf,
  monthRows,
  sameMonth,
  startOfWeek,
  weekDatesOf,
  weekdayOf,
  zonedInstant,
} from './timetable.dates'

describe('calendar dates', () => {
  it('adds days across months, years and DST changes without shifting a day', () => {
    expect(addDays('2026-11-07', 1)).toBe('2026-11-08')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
    // Europe leaves DST on 2026-10-25 and the US on 2026-11-01: still exactly seven days.
    expect(addDays('2026-10-25', 7)).toBe('2026-11-01')
    expect(datesFrom('2026-11-30', 3)).toEqual(['2026-11-30', '2026-12-01', '2026-12-02'])
    expect(isCalendarDate('2028-02-29')).toBe(true)
    expect(isCalendarDate('2026-02-29')).toBe(false)
    expect(isCalendarDate('2026-11-7')).toBe(false)
    expect(isCalendarDate(20261107)).toBe(false)
  })

  it('numbers weekdays as the server does (0 = Sunday) and starts the week on any day', () => {
    expect(weekdayOf('2026-11-08')).toBe(0)
    expect(weekdayOf('2026-11-07')).toBe(6)
    expect(startOfWeek('2026-11-06', 0)).toBe('2026-11-01')
    expect(startOfWeek('2026-11-06', 6)).toBe('2026-10-31')
    expect(startOfWeek('2026-11-07', 6)).toBe('2026-11-07')
    expect(startOfWeek('2026-11-06', 1)).toBe('2026-11-02')
    expect(weekDatesOf('2026-11-06', 6)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'])
  })

  it('lays a month out in rows from the first day of the week, padding with null', () => {
    // November 2026 starts on a Sunday and has 30 days.
    const fromSunday = monthRows({ year: 2026, month: 11 }, 0)
    expect(fromSunday).toHaveLength(5)
    expect(fromSunday[0]).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'])
    expect(fromSunday[4]).toEqual(['2026-11-29', '2026-11-30', null, null, null, null, null])
    const fromSaturday = monthRows({ year: 2026, month: 11 }, 6)
    expect(fromSaturday[0]![0]).toBeNull()
    expect(fromSaturday[0]![1]).toBe('2026-11-01')
    expect(fromSaturday.flat().filter(Boolean)).toHaveLength(30)
    expect(daysInMonth({ year: 2028, month: 2 })).toBe(29)
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 })
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 })
    expect(addMonths({ year: 2026, month: 11 }, -23)).toEqual({ year: 2024, month: 12 })
    expect(monthOf('2026-11-06')).toEqual({ year: 2026, month: 11 })
    expect(firstOfMonth({ year: 2026, month: 3 })).toBe('2026-03-01')
    expect(sameMonth('2026-11-30', { year: 2026, month: 11 })).toBe(true)
    expect(sameMonth('2026-12-01', { year: 2026, month: 11 })).toBe(false)
  })

  it('reads and writes HH:MM clock times', () => {
    expect(clockMinutes('09:30')).toBe(570)
    expect(clockMinutes('00:00')).toBe(0)
    expect(clockOfMinutes(570)).toBe('09:30')
    expect(clockOfMinutes(24 * 60)).toBe('24:00')
    expect(() => clockMinutes('9:30')).toThrow(RangeError)
  })
})

describe('time zones', () => {
  it('computes today and now in the academy zone (the server default `on`), an unknown zone as UTC', () => {
    const instant = Date.UTC(2026, 10, 7, 22, 30) // 2026-11-07T22:30Z
    expect(calendarDateIn('UTC', instant)).toBe('2026-11-07')
    expect(calendarDateIn('Asia/Riyadh', instant)).toBe('2026-11-08')
    expect(calendarDateIn('America/New_York', instant)).toBe('2026-11-07')
    expect(minutesNowIn('Asia/Riyadh', instant)).toBe(90)
    expect(minutesNowIn('UTC', instant)).toBe(22 * 60 + 30)
    expect(calendarDateIn('Mars/Base', instant)).toBe('2026-11-07')
    expect(isTimeZone('Europe/Istanbul')).toBe(true)
    expect(isTimeZone('Mars/Base')).toBe(false)
    expect(isTimeZone('')).toBe(false)
  })

  it('turns a local time on a date into the instant of that zone, across DST changes', () => {
    expect(zonedInstant('2026-11-08', '10:00', 'Asia/Riyadh')).toBe(Date.UTC(2026, 10, 8, 7, 0))
    expect(zonedInstant('2026-11-08', '10:00', 'UTC')).toBe(Date.UTC(2026, 10, 8, 10, 0))
    // New York: EDT (UTC−4) until 2026-11-01 02:00, then EST (UTC−5).
    expect(zonedInstant('2026-10-31', '10:00', 'America/New_York')).toBe(Date.UTC(2026, 9, 31, 14, 0))
    expect(zonedInstant('2026-11-02', '10:00', 'America/New_York')).toBe(Date.UTC(2026, 10, 2, 15, 0))
    // 01:30 happens twice that night: the first occurrence (still EDT).
    expect(zonedInstant('2026-11-01', '01:30', 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 5, 30))
  })
})
