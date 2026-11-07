import { describe, expect, it } from 'vitest'
import { dayEndInstant, dayStartInstant, durationMinutes, formatClock, formatLessonTimes, lessonRoomLabel, localPartsOf, rangeOf, rangeProblem, syllabusItemLabel, toInstant } from './lessons.format'

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
    const overnight = rangeOf('2026-11-10', '22:00', '01:00')!
    expect(durationMinutes(overnight.startsAt, overnight.endsAt)).toBe(180)
    expect(localPartsOf(overnight.endsAt)).toEqual({ date: '2026-11-11', time: '01:00' })
    expect(rangeOf('2026-11-10', '10:00', undefined)).toBeUndefined()
    expect(rangeOf(undefined, '10:00', '11:00')).toBeUndefined()
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
    expect(formatLessonTimes(start, end, 'ar')).toBe('09:05 – 11:30')
    const nextDay = new Date(2026, 10, 11, 1, 0).toISOString()
    expect(formatLessonTimes(new Date(2026, 10, 10, 22, 0).toISOString(), nextDay, 'en')).toBe('22:00 – 01:00 (+1)')
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
