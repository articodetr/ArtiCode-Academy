// J-F81 (TEST-344): the pure rules of the class lessons on «دوراتي».
import { describe, expect, it } from 'vitest'
import { makeMyLesson } from '../../test/myLessons'
import { enrollmentLessonCount, enrollmentLessonsOf, matchesLessonFilter } from './classLessons.view'

const base = makeMyLesson()
const lesson = (id: string, classId: string, studentId: string, status: 'scheduled' | 'completed' | 'cancelled' = 'scheduled') =>
  makeMyLesson({ id, status, class: { ...base.class, id: classId }, student: { ...base.student, id: studentId } })

describe('classLessons.view', () => {
  const items = [lesson('a', 'k1', 's1'), lesson('b', 'k1', 's2'), lesson('c', 'k2', 's1'), lesson('d', 'k1', 's1', 'cancelled'), lesson('e', 'k1', 's1', 'completed')]

  it('keeps the lessons of one class through one student, in the server order', () => {
    expect(enrollmentLessonsOf(items, 'k1', 's1').map((item) => item.id)).toEqual(['a', 'd', 'e'])
    expect(enrollmentLessonsOf(items, 'k3', 's1')).toEqual([])
  })

  it('counts the enrollment’s lessons that are not cancelled', () => {
    expect(enrollmentLessonCount(items, 'k1', 's1')).toBe(2)
    expect(enrollmentLessonCount(items, 'k1', 's2')).toBe(1)
    expect(enrollmentLessonCount([], 'k1', 's1')).toBe(0)
  })

  it('«المسجلة» keeps recorded lessons and «المباشرة» every other kind', () => {
    expect(matchesLessonFilter({ deliveryMode: 'recorded' }, 'recorded')).toBe(true)
    expect(matchesLessonFilter({ deliveryMode: 'recorded' }, 'live')).toBe(false)
    for (const mode of ['live_online', 'in_person', 'hybrid'] as const) {
      expect(matchesLessonFilter({ deliveryMode: mode }, 'live')).toBe(true)
      expect(matchesLessonFilter({ deliveryMode: mode }, 'recorded')).toBe(false)
      expect(matchesLessonFilter({ deliveryMode: mode }, 'all')).toBe(true)
    }
  })
})
