import { describe, expect, it } from 'vitest'
import { makeMyClassItem } from '../test/enrollments'
import { makeLatest, makeMyAssignment } from '../test/myAssignments'
import { makeMyExam, makeMyExamResult, makePublishedMyExam } from '../test/myExams'
import { makeFinalGrade, makeMyGradeItem } from '../test/myGrades'
import { CHILD_ONE, CHILD_TWO, SELF_STUDENT, makeMyLesson } from '../test/myLessons'
import { makeMyInvoice } from '../test/payments'
import { agendaOf, daysUntil, formatScore, isLearnerOnly, learnersOf, nextLessonOf, resultsOf, todoOf } from './learner.data'

describe('learner home rules (redesign)', () => {
  it('gives the home to students and guardians with no other role', () => {
    expect(isLearnerOnly(['student'])).toBe(true)
    expect(isLearnerOnly(['guardian', 'student'])).toBe(true)
    expect(isLearnerOnly(['teacher', 'guardian'])).toBe(false)
    expect(isLearnerOnly([])).toBe(false)
  })

  it('lists the caller first, then each child once', () => {
    const items = [
      makeMyClassItem({ relation: 'child', student: CHILD_ONE }),
      makeMyClassItem({ relation: 'self', student: SELF_STUDENT }),
      makeMyClassItem({ relation: 'child', student: CHILD_ONE }),
      makeMyClassItem({ relation: 'child', student: CHILD_TWO }),
    ]
    expect(learnersOf(items).map((learner) => learner.id)).toEqual([SELF_STUDENT.id, CHILD_ONE.id, CHILD_TWO.id])
  })

  it('groups lessons by academy day in time order and finds the next one that has not ended', () => {
    const late = makeMyLesson({ id: 'l2', startsAt: '2026-11-15T13:00:00Z', endsAt: '2026-11-15T14:00:00Z' })
    const early = makeMyLesson({ id: 'l1', startsAt: '2026-11-14T06:00:00Z', endsAt: '2026-11-14T07:00:00Z' })
    const cancelled = makeMyLesson({ id: 'l3', status: 'cancelled', startsAt: '2026-11-14T09:00:00Z', endsAt: '2026-11-14T10:00:00Z' })
    expect(agendaOf([late, cancelled, early], 'Europe/Istanbul').map((day) => [day.date, day.lessons.map((l) => l.id)])).toEqual([
      ['2026-11-14', ['l1', 'l3']],
      ['2026-11-15', ['l2']],
    ])
    expect(nextLessonOf([late, cancelled, early], Date.parse('2026-11-14T08:00:00Z'))?.id).toBe('l2')
  })

  it('counts whole days between two calendar days', () => {
    expect(daysUntil('2026-11-16', '2026-11-14')).toBe(2)
    expect(daysUntil('2026-11-13', '2026-11-14')).toBe(-1)
  })

  it('puts overdue money first, then work and exams by date; skips what can no longer be handed in and past exams', () => {
    const open = makeMyAssignment({ id: 'a1', dueAt: '2026-11-16T20:59:00Z', submitBlocker: null })
    const closed = makeMyAssignment({ id: 'a2', submitBlocker: 'closed' })
    const late = makeMyAssignment({ id: 'a3', dueAt: '2026-11-10T20:59:00Z', submitBlocker: 'past_due', allowLate: true })
    const exam = makeMyExam({ id: 'e1', status: 'scheduled', scheduledAt: '2026-11-15T07:00:00Z' })
    const pastExam = makeMyExam({ id: 'e2', status: 'scheduled', scheduledAt: '2026-11-01T07:00:00Z' })
    const overdue = makeMyInvoice({ id: 'i1', status: 'issued', balance: 300, overdue: true })
    const paid = makeMyInvoice({ id: 'i2', status: 'issued', balance: 0, overdue: false })
    const keys = todoOf({ assignments: [open, closed, late], exams: [exam, pastExam], invoices: [paid, overdue], zone: 'Europe/Istanbul', today: '2026-11-14' }).map((item) => item.key.split(':')[0] + ':' + item.key.split(':')[1])
    expect(keys).toEqual(['i:i1', 'a:a3', 'e:e1', 'a:a1'])
  })

  it('lists the latest results newest first: graded attempts, published results and final grades', () => {
    const graded = makeMyAssignment({ id: 'a1', maxScore: 10, latest: makeLatest({ status: 'graded', score: 8.5, gradedAt: '2026-11-10T10:00:00Z' }) })
    const waiting = makeMyAssignment({ id: 'a2', latest: makeLatest({ status: 'submitted', score: null, gradedAt: null }) })
    const exam = makePublishedMyExam({ id: 'e1', maxScore: 20, passScore: 10, publishedAt: '2026-11-12T10:00:00Z', result: makeMyExamResult({ status: 'scored', score: 8 }) })
    const final = makeMyGradeItem({ final: makeFinalGrade({ percent: 83.8, isPass: true, finalizedAt: '2026-11-13T10:00:00Z' }) })
    const rows = resultsOf({ assignments: [graded, waiting], exams: [exam], grades: [final] })
    expect(rows.map((row) => row.kind)).toEqual(['final', 'exam', 'assignment'])
    expect(rows[1]).toMatchObject({ score: 8, max: 20, isPass: false })
    expect(formatScore(8.5)).toBe('8.5')
    expect(formatScore(10)).toBe('10')
  })
})
