import { describe, expect, it } from 'vitest'
import { makeMyClassItem } from '../test/enrollments'
import { makeLatest, makeMyAssignment } from '../test/myAssignments'
import { makeMyExam, makeMyExamResult, makeOnlineMyExam, makePublishedMyExam } from '../test/myExams'
import { makeFinalGrade, makeMyGradeItem } from '../test/myGrades'
import { CHILD_ONE, CHILD_TWO, SELF_STUDENT, makeMyLesson } from '../test/myLessons'
import { makeMyInvoice } from '../test/payments'
import { agendaOf, daysUntil, examBoardOf, formatScore, isLearnerOnly, learnersOf, lessonBoardOf, lessonLinkOf, nextLessonOf, resultsOf, todoOf } from './learner.data'

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

  it('keeps a lesson link before, during and after the lesson (KI-062)', () => {
    const url = 'https://meet.example.com/room'
    const lesson = makeMyLesson({ meetingUrl: url, deliveryMode: 'live_online', status: 'scheduled', startsAt: '2026-11-23T08:00:00Z', endsAt: '2026-11-23T09:00:00Z' })
    expect(lessonLinkOf(lesson, Date.parse('2026-11-23T07:00:00Z'))).toEqual({ url, action: 'join' })
    expect(lessonLinkOf(lesson, Date.parse('2026-11-23T08:30:00Z'))).toEqual({ url, action: 'join' })
    expect(lessonLinkOf(lesson, Date.parse('2026-11-23T09:00:00Z'))).toEqual({ url, action: 'open' })
    expect(lessonLinkOf({ ...lesson, status: 'completed' }, Date.parse('2026-11-23T08:30:00Z'))).toEqual({ url, action: 'open' })
    expect(lessonLinkOf({ ...lesson, deliveryMode: 'recorded' }, Date.parse('2026-11-23T07:00:00Z'))).toEqual({ url, action: 'open' })
  })

  it('J-F77 (TEST-340) — offers the video of a recorded lesson, of a lesson without a join link, and of a live lesson once it ended', () => {
    const video = 'https://videos.example.com/v'
    const join = 'https://meet.example.com/room'
    const before = Date.parse('2026-11-23T07:00:00Z')
    const after = Date.parse('2026-11-23T09:30:00Z')
    const live = makeMyLesson({ meetingUrl: join, recordingUrl: video, deliveryMode: 'live_online', status: 'scheduled', startsAt: '2026-11-23T08:00:00Z', endsAt: '2026-11-23T09:00:00Z' })
    expect(lessonLinkOf(live, before)).toEqual({ url: join, action: 'join' })
    expect(lessonLinkOf(live, after)).toEqual({ url: video, action: 'watch' })
    expect(lessonLinkOf({ ...live, deliveryMode: 'recorded' }, before)).toEqual({ url: video, action: 'watch' })
    expect(lessonLinkOf({ ...live, meetingUrl: null }, before)).toEqual({ url: video, action: 'watch' })
    expect(lessonLinkOf({ ...live, status: 'cancelled' }, after)).toBeNull()
  })

  it('offers no link for a cancelled lesson or a lesson without one', () => {
    const now = Date.parse('2026-11-23T07:00:00Z')
    const lesson = makeMyLesson({ meetingUrl: 'https://meet.example.com/room', endsAt: '2026-11-23T09:00:00Z' })
    expect(lessonLinkOf({ ...lesson, status: 'cancelled' }, now)).toBeNull()
    expect(lessonLinkOf({ ...lesson, meetingUrl: null }, now)).toBeNull()
  })

  it('counts whole days between two calendar days', () => {
    expect(daysUntil('2026-11-16', '2026-11-14')).toBe(2)
    expect(daysUntil('2026-11-13', '2026-11-14')).toBe(-1)
  })

  it('puts overdue money first, then work by date; skips what can no longer be handed in', () => {
    const open = makeMyAssignment({ id: 'a1', dueAt: '2026-11-16T20:59:00Z', submitBlocker: null })
    const closed = makeMyAssignment({ id: 'a2', submitBlocker: 'closed' })
    const late = makeMyAssignment({ id: 'a3', dueAt: '2026-11-10T20:59:00Z', submitBlocker: 'past_due', allowLate: true })
    const overdue = makeMyInvoice({ id: 'i1', status: 'issued', balance: 300, overdue: true })
    const paid = makeMyInvoice({ id: 'i2', status: 'issued', balance: 0, overdue: false })
    const keys = todoOf({ assignments: [open, closed, late], invoices: [paid, overdue], zone: 'Europe/Istanbul', today: '2026-11-14' }).map((item) => item.key.split(':')[0] + ':' + item.key.split(':')[1])
    expect(keys).toEqual(['i:i1', 'a:a3', 'a:a1'])
  })

  it('features the lessons running now, else the next one, and keeps ended lessons after the coming ones', () => {
    const at = (hour: number) => `2026-11-14T${String(hour).padStart(2, '0')}:00:00Z`
    const ended = makeMyLesson({ id: 'ended', startsAt: at(6), endsAt: at(7) })
    const running = makeMyLesson({ id: 'running', startsAt: at(8), endsAt: at(10) })
    const later = makeMyLesson({ id: 'later', startsAt: at(12), endsAt: at(13) })
    const live = lessonBoardOf([ended, running, later], Date.parse(at(9)), 'UTC')
    expect(live).toMatchObject({ live: true, hidden: 0 })
    expect(live.featured.map((lesson) => lesson.id)).toEqual(['running'])
    expect(live.days[0]!.lessons.map((lesson) => lesson.id)).toEqual(['later', 'ended'])

    const between = lessonBoardOf([ended, later], Date.parse(at(9)), 'UTC')
    expect(between.live).toBe(false)
    expect(between.featured.map((lesson) => lesson.id)).toEqual(['later'])
  })

  it('caps the list under the featured lesson and counts the rest', () => {
    const lessons = [1, 2, 3, 4].map((day) => makeMyLesson({ id: `l${day}`, startsAt: `2026-11-1${day}T09:00:00Z`, endsAt: `2026-11-1${day}T10:00:00Z` }))
    const board = lessonBoardOf(lessons, Date.parse('2026-11-10T00:00:00Z'), 'UTC', 2)
    expect(board.featured.map((lesson) => lesson.id)).toEqual(['l1'])
    expect(board.days.flatMap((day) => day.lessons.map((lesson) => lesson.id))).toEqual(['l2', 'l3'])
    expect(board.hidden).toBe(1)
  })

  it('sorts the exams by what the server says can be taken, whatever the date', () => {
    const zone = 'UTC'
    const today = '2026-11-20'
    const serverNow = '2026-11-20T07:30:00.000Z'
    // Opened three days ago and still open: the old list dropped it as a past exam.
    const open = makeOnlineMyExam({ id: 'open', scheduledAt: '2026-11-17T07:00:00Z' }, { closesAt: '2026-11-21T07:00:00Z', serverNow })
    const resume = makeOnlineMyExam({ id: 'resume' }, { canStart: false, inProgress: { id: 'a1', attemptNo: 1, expiresAt: '2026-11-20T08:00:00Z', remainingSeconds: 600 }, serverNow })
    const soon = makeOnlineMyExam({ id: 'soon', scheduledAt: '2026-11-22T07:00:00Z' }, { canStart: false, blocker: 'not_open_yet', serverNow })
    const closed = makeOnlineMyExam({ id: 'closed' }, { canStart: false, blocker: 'closed', serverNow })
    const used = makeOnlineMyExam({ id: 'used' }, { canStart: false, blocker: 'attempts_exhausted', serverNow })
    const manual = makeMyExam({ id: 'manual', scheduledAt: '2026-11-21T07:00:00Z' })
    const manualPast = makeMyExam({ id: 'manual-past', scheduledAt: '2026-11-01T07:00:00Z' })
    const published = makePublishedMyExam({ id: 'published' })
    const board = examBoardOf([open, resume, soon, closed, used, manual, manualPast, published], zone, today)
    expect(board.now.map((item) => item.id)).toEqual(['resume', 'open'])
    expect(board.upcoming.map((item) => item.id)).toEqual(['manual', 'soon'])
  })

  it('places a child\'s online exam by its window for a guardian, who can never start it', () => {
    const serverNow = '2026-11-20T07:30:00.000Z'
    const blocked = { canStart: false, blocker: 'not_self' as const, serverNow }
    const during = makeOnlineMyExam({ id: 'during', relation: 'child', scheduledAt: '2026-11-20T07:00:00Z' }, { ...blocked, closesAt: '2026-11-20T09:00:00Z' })
    const before = makeOnlineMyExam({ id: 'before', relation: 'child', scheduledAt: '2026-11-21T07:00:00Z' }, { ...blocked, closesAt: '2026-11-21T09:00:00Z' })
    const after = makeOnlineMyExam({ id: 'after', relation: 'child', scheduledAt: '2026-11-19T07:00:00Z' }, { ...blocked, closesAt: '2026-11-19T09:00:00Z' })
    const board = examBoardOf([during, before, after], 'UTC', '2026-11-20')
    expect(board.now.map((item) => item.id)).toEqual(['during'])
    expect(board.upcoming.map((item) => item.id)).toEqual(['before'])

    // Every attempt used and none running: the exam is over for that child, even while its window is open.
    const finished = makeOnlineMyExam({ id: 'finished', relation: 'child', scheduledAt: '2026-11-20T07:00:00Z' }, { ...blocked, closesAt: '2026-11-20T09:00:00Z', attemptsAllowed: 1, attemptsUsed: 1 })
    expect(examBoardOf([finished], 'UTC', '2026-11-20').now).toEqual([])
  })

  it('keeps a coming lesson over one that ended when the list is capped', () => {
    const ended = makeMyLesson({ id: 'ended', startsAt: '2026-11-14T06:00:00Z', endsAt: '2026-11-14T07:00:00Z' })
    const next = makeMyLesson({ id: 'next', startsAt: '2026-11-15T06:00:00Z', endsAt: '2026-11-15T07:00:00Z' })
    const later = makeMyLesson({ id: 'later', startsAt: '2026-11-16T06:00:00Z', endsAt: '2026-11-16T07:00:00Z' })
    const afterThat = makeMyLesson({ id: 'after', startsAt: '2026-11-17T06:00:00Z', endsAt: '2026-11-17T07:00:00Z' })
    const board = lessonBoardOf([ended, next, later, afterThat], Date.parse('2026-11-14T09:00:00Z'), 'UTC', 1)
    expect(board.featured.map((lesson) => lesson.id)).toEqual(['next'])
    expect(board.days.flatMap((day) => day.lessons.map((lesson) => lesson.id))).toEqual(['later'])
    expect(board.hidden).toBe(2)
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
