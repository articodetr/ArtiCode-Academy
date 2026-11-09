import { describe, expect, it } from 'vitest'
import { dayEndInstant, dayStartInstant } from './lessons.format'
import { CHILD_ONE, CHILD_TWO, SELF_STUDENT, makeMyLesson } from '../test/myLessons'
import {
  attendanceCellOf,
  classOptionsOf,
  defaultMyLessonsFilters,
  isNarrowed,
  myLessonKey,
  myLessonsQuery,
  showsStudents,
  studentOptionsOf,
  todayStartInstant,
} from './myLessons.view'

// A local afternoon, so "today" is the same calendar day in every time zone the tests run in.
const NOW = new Date(2026, 10, 10, 15, 30)

const classA = { id: 'class-a', code: 'PY-101-A', name: { ar: 'بايثون أ' } }
const classB = { id: 'class-b', code: 'AR-201', name: { ar: 'عربي متقدم' } }

describe('my lessons — views and parameters', () => {
  it('upcoming = from the start of today, oldest first; the other filters pass through', () => {
    const filters = { ...defaultMyLessonsFilters(), studentId: 's-1', classId: 'c-1', status: 'cancelled' as const, limit: 50 as const }
    expect(myLessonsQuery(filters, NOW)).toEqual({ classId: 'c-1', studentId: 's-1', status: 'cancelled', limit: 50, from: dayStartInstant('2026-11-10'), order: 'asc' })
    expect(todayStartInstant(NOW)).toBe(new Date(2026, 10, 10).toISOString())
  })

  it('past = everything that started before today, newest first (no overlap with upcoming)', () => {
    const query = myLessonsQuery({ ...defaultMyLessonsFilters(), view: 'past' }, NOW)
    expect(query).toEqual({ classId: undefined, studentId: undefined, status: undefined, limit: 20, to: new Date(new Date(2026, 10, 10).getTime() - 1).toISOString(), order: 'desc' })
    expect(query.from).toBeUndefined()
  })

  it('range = the chosen local days, both inclusive, in the chosen order; blank ends stay open', () => {
    const range = { ...defaultMyLessonsFilters(), view: 'range' as const, from: '2026-11-01', to: '2026-11-30', order: 'desc' as const }
    expect(myLessonsQuery(range, NOW)).toMatchObject({ from: dayStartInstant('2026-11-01'), to: dayEndInstant('2026-11-30'), order: 'desc' })
    expect(myLessonsQuery({ ...range, from: undefined, to: undefined }, NOW)).toMatchObject({ from: undefined, to: undefined, order: 'desc' })
  })

  it('a narrowed list is one with a student, class, status or range day', () => {
    expect(isNarrowed(defaultMyLessonsFilters())).toBe(false)
    expect(isNarrowed({ ...defaultMyLessonsFilters(), view: 'past' })).toBe(false)
    expect(isNarrowed({ ...defaultMyLessonsFilters(), view: 'range' })).toBe(false)
    expect(isNarrowed({ ...defaultMyLessonsFilters(), view: 'range', to: '2026-11-30' })).toBe(true)
    expect(isNarrowed({ ...defaultMyLessonsFilters(), from: '2026-11-30' })).toBe(false) // ignored outside the range view
    expect(isNarrowed({ ...defaultMyLessonsFilters(), status: 'completed' })).toBe(true)
    expect(isNarrowed({ ...defaultMyLessonsFilters(), studentId: 's-1' })).toBe(true)
  })
})

describe('my lessons — rows, roles and filter options', () => {
  it('keys a row by lesson AND student, so two children in one class give two rows', () => {
    const one = makeMyLesson({ relation: 'child', student: CHILD_ONE })
    const two = makeMyLesson({ relation: 'child', student: CHILD_TWO })
    expect(one.id).toBe(two.id)
    expect(myLessonKey(one)).not.toBe(myLessonKey(two))
  })

  // Who may open the page at all is the nav entry's rule (`myLessons`, roleKeys student/guardian — layout/navigation.test.ts).
  it('the student column follows the guardian role or a child row', () => {
    expect(showsStudents(['student'], [makeMyLesson()])).toBe(false)
    expect(showsStudents(['guardian'], [])).toBe(true)
    expect(showsStudents(['student'], [makeMyLesson({ relation: 'child' })])).toBe(true)
  })

  it('offers each owned student once — the caller first, then children by name', () => {
    const items = [
      { relation: 'child' as const, student: CHILD_TWO, class: classA },
      { relation: 'self' as const, student: SELF_STUDENT, class: classB },
      { relation: 'child' as const, student: CHILD_ONE, class: classA },
      { relation: 'child' as const, student: CHILD_TWO, class: classB },
    ]
    expect(studentOptionsOf(items).map((option) => [option.id, option.relation])).toEqual([
      [SELF_STUDENT.id, 'self'],
      [CHILD_ONE.id, 'child'], // «عمر» before «ليلى الأحمد»
      [CHILD_TWO.id, 'child'],
    ])
  })

  it('offers each owned class once by code, narrowed to the chosen student', () => {
    const items = [
      { student: CHILD_ONE, class: classA },
      { student: CHILD_TWO, class: classA },
      { student: CHILD_TWO, class: classB },
    ]
    expect(classOptionsOf(items).map((option) => option.code)).toEqual(['AR-201', 'PY-101-A'])
    expect(classOptionsOf(items, CHILD_ONE.id).map((option) => option.code)).toEqual(['PY-101-A'])
    expect(classOptionsOf(items, 'someone-else')).toEqual([])
  })
})

describe('my lessons — attendance cell', () => {
  const past = { startsAt: '2026-11-09T10:00:00.000Z', status: 'completed' as const }

  it('shows the record when there is one, lateness only with late', () => {
    expect(attendanceCellOf({ ...past, attendance: { status: 'late', minutesLate: 12, recordedAt: '2026-11-09T10:20:00.000Z' } }, NOW)).toEqual({ kind: 'recorded', status: 'late', minutesLate: 12 })
    expect(attendanceCellOf({ ...past, attendance: { status: 'present', minutesLate: 5, recordedAt: '2026-11-09T10:20:00.000Z' } }, NOW)).toEqual({ kind: 'recorded', status: 'present', minutesLate: null })
  })

  it('without a record: cancelled, not started yet, or not recorded', () => {
    expect(attendanceCellOf({ ...past, status: 'cancelled', attendance: null }, NOW)).toEqual({ kind: 'cancelled' })
    expect(attendanceCellOf({ startsAt: '2026-12-01T10:00:00.000Z', status: 'scheduled', attendance: null }, NOW)).toEqual({ kind: 'not_started' })
    expect(attendanceCellOf({ ...past, attendance: null }, NOW)).toEqual({ kind: 'not_recorded' })
  })
})
