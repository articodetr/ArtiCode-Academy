import { describe, expect, it } from 'vitest'
import { todayIso } from './lessons.format'
import { defaultLessonFilters, hasActiveLessonFilters } from './useLessonsList'

describe('defaultLessonFilters / hasActiveLessonFilters', () => {
  const now = new Date(2026, 10, 8, 15, 30)
  const defaults = defaultLessonFilters(now)

  it('starts from today in the browser zone, oldest first, 20 per page', () => {
    expect(defaults).toEqual({ classId: undefined, teacherId: undefined, status: undefined, from: todayIso(now), to: undefined, order: 'asc', limit: 20 })
    expect(todayIso(now)).toBe('2026-11-08')
  })

  it('does not count the default «from today», the order or the page size as a filter', () => {
    expect(hasActiveLessonFilters(defaults, defaults)).toBe(false)
    expect(hasActiveLessonFilters({ ...defaults, order: 'desc', limit: 50 }, defaults)).toBe(false)
  })

  it('counts a class, a teacher, a status, an end day and another or cleared start day', () => {
    expect(hasActiveLessonFilters({ ...defaults, classId: 'c-1' }, defaults)).toBe(true)
    expect(hasActiveLessonFilters({ ...defaults, teacherId: 'u-1' }, defaults)).toBe(true)
    expect(hasActiveLessonFilters({ ...defaults, status: 'cancelled' }, defaults)).toBe(true)
    expect(hasActiveLessonFilters({ ...defaults, to: '2026-11-30' }, defaults)).toBe(true)
    expect(hasActiveLessonFilters({ ...defaults, from: '2026-11-01' }, defaults)).toBe(true)
    expect(hasActiveLessonFilters({ ...defaults, from: undefined }, defaults)).toBe(true)
  })
})
