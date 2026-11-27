// J-F81 (TEST-344): the pure rules of the class lessons on «دوراتي».
import { describe, expect, it } from 'vitest'
import { makeMyExam, makeMyExamResult, makeOnlineMyExam } from '../../test/myExams'
import { makeMyLesson } from '../../test/myLessons'
import { enrollmentLessonCount, enrollmentLessonsOf, lessonExamsOf, matchesLessonFilter } from './classLessons.view'

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

  it('J-F82: hands a lesson the class exams linked to it, taken once there is a result or a finished attempt', () => {
    const lesson = { id: 'k1-l', title: { ar: 'درس' }, startsAt: '2026-11-20T10:00:00.000Z' }
    const exams = [
      makeMyExam({ id: 'manual', lesson }),
      makeMyExam({ id: 'scored', lesson, status: 'published', result: makeMyExamResult() }),
      makeOnlineMyExam({ id: 'finished', lesson }, { attemptsUsed: 1, inProgress: null }),
      makeOnlineMyExam({ id: 'other', lesson: { ...lesson, id: 'another' } }),
    ]
    const linked = lessonExamsOf(exams, 'k1-l')
    expect(linked.map((exam) => [exam.id, exam.done])).toEqual([
      ['manual', false],
      ['scored', true],
      ['finished', true],
    ])
    expect(lessonExamsOf(exams, 'none')).toEqual([])
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
