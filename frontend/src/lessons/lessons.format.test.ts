import { describe, expect, it } from 'vitest'
import { normalizeSpaces } from '../test/text'
import { withTimeZone } from '../test/time-zone'
import {
  NEXT_DAY_MARK,
  dayEndInstant,
  dayStartInstant,
  durationMinutes,
  formatClock,
  formatLessonTimes,
  lessonRoomLabel,
  localPartsOf,
  nextDayRangeOf,
  rangeOf,
  rangeProblem,
  syllabusItemLabel,
  toInstant,
} from './lessons.format'

describe('lessons.format', () => {
  it('turns an instant into local date/time parts and back without drift', () => {
    const iso = new Date(2026, 10, 10, 10, 30).toISOString() // 10 Nov 2026 10:30 local
    expect(localPartsOf(iso)).toEqual({ date: '2026-11-10', time: '10:30' })
    expect(toInstant('2026-11-10', '10:30')).toBe(iso)
    expect(localPartsOf('garbage')).toEqual({ date: '', time: '' })
    expect(toInstant('2026-11-10', undefined)).toBeUndefined()
    expect(toInstant('10/11/2026', '10:30')).toBeUndefined()
    expect(toInstant('2026-11-10', '10')).toBeUndefined()
  })

  it('builds the range from one day and two clock times, rolling an earlier end time to the next day', () => {
    const same = rangeOf('2026-11-10', '10:00', '11:30')!
    expect(durationMinutes(same.startsAt, same.endsAt)).toBe(90)
    expect(same.nextDay).toBe(false)
    const overnight = rangeOf('2026-11-10', '22:00', '01:00')!
    expect(durationMinutes(overnight.startsAt, overnight.endsAt)).toBe(180)
    expect(localPartsOf(overnight.endsAt)).toEqual({ date: '2026-11-11', time: '01:00' })
    expect(overnight.nextDay).toBe(true)
    expect(rangeOf('2026-11-10', '10:00', undefined)).toBeUndefined()
    expect(rangeOf(undefined, '10:00', '11:00')).toBeUndefined()
  })

  it('marks only a real next-day end for the form: not a same-day end, not an end equal to the start, not a missing part (J-F19)', () => {
    // The typo the owner described: 13:00 → 01:00 is a 12-hour lesson that ends on the next day.
    const typo = nextDayRangeOf('2026-11-12', '13:00', '01:00')!
    expect(localPartsOf(typo.endsAt)).toEqual({ date: '2026-11-13', time: '01:00' })
    expect(durationMinutes(typo.startsAt, typo.endsAt)).toBe(720)
    expect(rangeProblem(typo.startsAt, typo.endsAt)).toBeNull()
    expect(nextDayRangeOf('2026-11-12', '13:00', '14:00')).toBeUndefined()
    // Equal times are refused as an empty range, never shown as a 24-hour lesson.
    expect(nextDayRangeOf('2026-11-12', '13:00', '13:00')).toBeUndefined()
    expect(nextDayRangeOf(undefined, '13:00', '01:00')).toBeUndefined()
    expect(nextDayRangeOf('2026-11-12', '13:00', undefined)).toBeUndefined()
    expect(NEXT_DAY_MARK).toBe('(+1)')
  })

  it('keeps the typed end time of an overnight lesson on a night the clock changes (DST): the next day’s wall clock, not 24 hours later (J-F19)', () => {
    withTimeZone('Europe/Berlin', () => {
      // The switch took effect (CEST in July): otherwise this test would pass without any DST night.
      expect(new Date('2026-07-01T12:00:00Z').getTimezoneOffset()).toBe(-120)
      // 2026-10-25: the clocks go back at 03:00 (24 hours after the same-day 01:00 is 00:00 — 120 minutes).
      const back = rangeOf('2026-10-25', '22:00', '01:00')!
      expect(localPartsOf(back.endsAt)).toEqual({ date: '2026-10-26', time: '01:00' })
      expect(durationMinutes(back.startsAt, back.endsAt)).toBe(180)
      // 2026-03-29: the clocks go forward at 02:00 (24 hours later is 02:00 — 240 minutes).
      const forward = rangeOf('2026-03-29', '22:00', '01:00')!
      expect(localPartsOf(forward.endsAt)).toEqual({ date: '2026-03-30', time: '01:00' })
      expect(durationMinutes(forward.startsAt, forward.endsAt)).toBe(180)
    })
    // The end of a month and of a year roll over like any other day.
    expect(localPartsOf(rangeOf('2026-12-31', '23:00', '00:30')!.endsAt)).toEqual({ date: '2027-01-01', time: '00:30' })
  })

  it('mirrors the server range rule: empty, longer than 12 hours, or fine', () => {
    expect(rangeProblem('2026-11-10T10:00:00.000Z', '2026-11-10T10:00:00.000Z')).toBe('empty')
    expect(rangeProblem('2026-11-10T10:00:00.000Z', '2026-11-10T09:00:00.000Z')).toBe('empty')
    expect(rangeProblem('2026-11-10T10:00:00.000Z', '2026-11-10T22:00:00.000Z')).toBeNull()
    expect(rangeProblem('2026-11-10T10:00:00.000Z', '2026-11-10T22:00:01.000Z')).toBe('too_long')
    expect(rangeProblem('x', '2026-11-10T22:00:00.000Z')).toBe('empty')
    expect(durationMinutes('x', 'y')).toBe(0)
  })

  it('turns the day filters into the first and last millisecond of the local day', () => {
    expect(dayStartInstant('2026-11-10')).toBe(new Date(2026, 10, 10, 0, 0).toISOString())
    expect(dayEndInstant('2026-11-10')).toBe(new Date(new Date(2026, 10, 11, 0, 0).getTime() - 1).toISOString())
    expect(dayStartInstant(undefined)).toBeUndefined()
    expect(dayEndInstant('')).toBeUndefined()
  })

  it('formats times with Latin digits and a 24-hour clock in both languages, marking a next-day end', () => {
    const start = new Date(2026, 10, 10, 9, 5).toISOString()
    const end = new Date(2026, 10, 10, 11, 30).toISOString()
    expect(formatClock(start, 'ar')).toBe('09:05')
    expect(formatClock(end, 'en')).toBe('11:30')
    expect(normalizeSpaces(formatLessonTimes(start, end, 'ar'))).toBe('09:05 – 11:30')
    const nextDay = new Date(2026, 10, 11, 1, 0).toISOString()
    expect(normalizeSpaces(formatLessonTimes(new Date(2026, 10, 10, 22, 0).toISOString(), nextDay, 'en'))).toBe('22:00 – 01:00 (+1)')
    expect(formatClock('garbage', 'ar')).toBe('garbage')
  })

  it('labels rooms and syllabus items like the schedule and syllabus screens', () => {
    expect(lessonRoomLabel({ code: 'LAB-1', name: { ar: 'مختبر 1', en: 'Lab 1' } }, 'ar')).toBe('LAB-1 — مختبر 1')
    expect(lessonRoomLabel({ code: 'LAB-1', name: { ar: 'مختبر 1', en: 'Lab 1' } }, 'en')).toBe('LAB-1 — Lab 1')
    expect(lessonRoomLabel({ code: 'HALL', name: null }, 'ar')).toBe('HALL')
    expect(syllabusItemLabel({ sortOrder: 2, title: { ar: 'الحلقات', en: 'Loops' } }, 'en')).toBe('3. Loops')
    expect(syllabusItemLabel({ sortOrder: 0, title: { ar: 'المتغيرات' } }, 'en')).toBe('1. المتغيرات')
  })
})
