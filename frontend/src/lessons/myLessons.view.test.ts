import { describe, expect, it } from 'vitest'
import { LESSON_TIME_ZONE } from '../test/lessons'
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

// 22:30 UTC on the 10th: already the 11th (01:30) in the academy's zone, Asia/Riyadh (UTC+3) — «today» is the academy's day (D-R41 — J-F28).
const NOW = new Date(Date.UTC(2026, 10, 10, 22, 30))
const ZONE = LESSON_TIME_ZONE

const classA = { id: 'class-a', code: 'PY-101-A', name: { ar: 'بايثون أ' } }
const classB = { id: 'class-b', code: 'AR-201', name: { ar: 'عربي متقدم' } }

describe('my lessons — views and parameters', () => {
  it('upcoming = from the start of the academy’s today, oldest first; the other filters pass through', () => {
    const filters = { ...defaultMyLessonsFilters(), studentId: 's-1', classId: 'c-1', status: 'cancelled' as const, limit: 50 as const }
    expect(myLessonsQuery(filters, ZONE, NOW)).toEqual({ classId: 'c-1', studentId: 's-1', status: 'cancelled', limit: 50, from: '2026-11-10T21:00:00.000Z', order: 'asc' })
    expect(todayStartInstant(ZONE, NOW)).toBe('2026-11-10T21:00:00.000Z')
    // In UTC that same instant is still the 10th.
    expect(todayStartInstant('UTC', NOW)).toBe('2026-11-10T00:00:00.000Z')
  })

  it('past = everything that started before the academy’s today, newest first (no overlap with upcoming)', () => {
    const query = myLessonsQuery({ ...defaultMyLessonsFilters(), view: 'past' }, ZONE, NOW)
    expect(query).toEqual({ classId: undefined, studentId: undefined, status: undefined, limit: 20, to: '2026-11-10T20:59:59.999Z', order: 'desc' })
    expect(query.from).toBeUndefined()
  })

  it('range = the chosen days of the academy’s zone, both inclusive, in the chosen order; blank ends stay open', () => {
    const range = { ...defaultMyLessonsFilters(), view: 'range' as const, from: '2026-11-01', to: '2026-11-30', order: 'desc' as const }
    expect(myLessonsQuery(range, ZONE, NOW)).toMatchObject({ from: '2026-10-31T21:00:00.000Z', to: '2026-11-30T20:59:59.999Z', order: 'desc' })
    expect(myLessonsQuery({ ...range, from: undefined, to: undefined }, ZONE, NOW)).toMatchObject({ from: undefined, to: undefined, order: 'desc' })
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
