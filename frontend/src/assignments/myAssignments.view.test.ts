import { describe, expect, it } from 'vitest'
import { ASSIGNMENT_ID_2 } from '../test/assignments'
import { makeMyClassItem } from '../test/enrollments'
import { FUTURE_DUE, PAST_DUE, SUBMISSION_ID_2, makeLatest, makeMyAssignment, makeMySubmission } from '../test/myAssignments'
import { CHILD_ONE, SELF_STUDENT } from '../test/myLessons'
import {
  applySubmission,
  attemptsLeftAfterNext,
  defaultMyAssignmentsFilters,
  enrollmentIndexOf,
  enrollmentStatusOf,
  feedbackExcerpt,
  gradedScoreOf,
  isNarrowed,
  isPastDue,
  leadTeacherOf,
  myAssignmentKey,
  myAssignmentsQuery,
  offersSubmit,
  scoreText,
  submissionCellOf,
  submitAvailability,
} from './myAssignments.view'
import type { MyAssignmentsFilters } from './myAssignments.view'

const ZONE = 'Asia/Riyadh'
const NOW = new Date('2026-11-10T12:00:00.000Z')
const filters = (patch: Partial<MyAssignmentsFilters> = {}): MyAssignmentsFilters => ({ ...defaultMyAssignmentsFilters(ZONE), ...patch })

describe('myAssignmentsQuery (API-112 parameters of a view)', () => {
  it('opens on every open assignment, earliest due first, 20 per page', () => {
    expect(myAssignmentsQuery(filters())).toEqual({ classId: undefined, studentId: undefined, limit: 20, status: 'open', order: 'asc' })
  })

  it('asks the server for pending=true for «not submitted yet», closed ones latest due first, and both statuses for «all»', () => {
    expect(myAssignmentsQuery(filters({ view: 'pending' }))).toMatchObject({ status: 'open', pending: true, order: 'asc' })
    expect(myAssignmentsQuery(filters({ view: 'closed' }))).toMatchObject({ status: 'closed', order: 'desc' })
    const all = myAssignmentsQuery(filters({ view: 'all', order: 'desc' }))
    expect(all).toEqual({ classId: undefined, studentId: undefined, limit: 20, dueFrom: undefined, dueTo: undefined, order: 'desc' })
    expect(all).not.toHaveProperty('status')
    expect(all).not.toHaveProperty('pending')
  })

  it('turns the due days of «all» into the first and last instants of those days in the filter zone (both inclusive)', () => {
    const query = myAssignmentsQuery(filters({ view: 'all', dueFrom: '2026-11-01', dueTo: '2026-11-30' }))
    // Asia/Riyadh is UTC+3 all year.
    expect(query.dueFrom).toBe('2026-10-31T21:00:00.000Z')
    expect(query.dueTo).toBe('2026-11-30T20:59:59.999Z')
  })

  it('ignores the days and the chosen order outside «all», and passes the class, the student and the page size through', () => {
    const query = myAssignmentsQuery(filters({ view: 'open', dueFrom: '2026-11-01', order: 'desc', classId: 'c-1', studentId: 's-1', limit: 50 }))
    expect(query).toEqual({ classId: 'c-1', studentId: 's-1', limit: 50, status: 'open', order: 'asc' })
  })

  it('counts the student, the class and the days of «all» as narrowing — never the view, the order or the page size', () => {
    expect(isNarrowed(filters())).toBe(false)
    expect(isNarrowed(filters({ view: 'closed', order: 'desc', limit: 100 }))).toBe(false)
    expect(isNarrowed(filters({ studentId: 's-1' }))).toBe(true)
    expect(isNarrowed(filters({ classId: 'c-1' }))).toBe(true)
    expect(isNarrowed(filters({ view: 'all', dueTo: '2026-11-30' }))).toBe(true)
    expect(isNarrowed(filters({ view: 'open', dueTo: '2026-11-30' }))).toBe(false)
  })

  it('keys a row by assignment and student: a guardian with two children in one class gets two rows of one assignment', () => {
    const self = makeMyAssignment()
    const child = makeMyAssignment({ relation: 'child', student: CHILD_ONE })
    expect(myAssignmentKey(self)).not.toBe(myAssignmentKey(child))
    expect(myAssignmentKey(self)).toBe(`${self.id}:${SELF_STUDENT.id}`)
  })
})

describe('the learner’s own submission cell', () => {
  it('shows the latest attempt with the server’s late mark and its number', () => {
    expect(submissionCellOf(makeMyAssignment({ latest: makeLatest({ status: 'graded', score: 18, isLate: true, attemptNo: 2 }) }), NOW)).toEqual({ kind: 'graded', attemptNo: 2, late: true })
    expect(submissionCellOf(makeMyAssignment({ latest: makeLatest({ status: 'returned', feedback: 'أعد الحل' }) }), NOW)).toEqual({ kind: 'returned', attemptNo: 1, late: false })
  })

  it('tells «not submitted yet» from «missed»: closed, or past due without late submissions', () => {
    expect(submissionCellOf(makeMyAssignment(), NOW)).toEqual({ kind: 'none' })
    expect(submissionCellOf(makeMyAssignment({ dueAt: null }), NOW)).toEqual({ kind: 'none' })
    expect(submissionCellOf(makeMyAssignment({ dueAt: PAST_DUE, allowLate: true }), NOW)).toEqual({ kind: 'none' })
    expect(submissionCellOf(makeMyAssignment({ dueAt: PAST_DUE }), NOW)).toEqual({ kind: 'missed' })
    expect(submissionCellOf(makeMyAssignment({ status: 'closed' }), NOW)).toEqual({ kind: 'missed' })
  })

  it('shows a score for a graded attempt only (a returned attempt has none — D-R39), as the server sends it', () => {
    expect(gradedScoreOf(makeMyAssignment({ latest: makeLatest({ status: 'graded', score: 17.5 }) }))).toBe(17.5)
    expect(gradedScoreOf(makeMyAssignment({ latest: makeLatest({ status: 'returned', feedback: 'أعد' }) }))).toBeNull()
    expect(gradedScoreOf(makeMyAssignment())).toBeNull()
    expect(scoreText(17.5, 20)).toBe('17.5 / 20')
  })

  it('shortens a long feedback for the table only', () => {
    expect(feedbackExcerpt('  أحسنت  ')).toBe('أحسنت')
    expect(feedbackExcerpt('ا'.repeat(200), 10)).toBe(`${'ا'.repeat(10)}…`)
  })
})

describe('submitAvailability (mirror of SubmissionsService.submit(): enrollment → window → attempts)', () => {
  it('lets the student send an attempt to an open assignment before its due date while attempts are left', () => {
    expect(submitAvailability(makeMyAssignment(), 'active', NOW)).toEqual({ blocker: null, late: false })
    expect(submitAvailability(makeMyAssignment({ dueAt: null }), null, NOW)).toEqual({ blocker: null, late: false })
  })

  it('takes a late attempt under allowLate and marks it, and refuses one without (past_due)', () => {
    expect(submitAvailability(makeMyAssignment({ dueAt: PAST_DUE, allowLate: true }), 'active', NOW)).toEqual({ blocker: null, late: true })
    expect(submitAvailability(makeMyAssignment({ dueAt: PAST_DUE }), 'active', NOW)).toEqual({ blocker: 'past_due', late: true })
  })

  it('refuses a closed assignment, and used-up attempts — a returned attempt grants one more through attemptsAllowed', () => {
    expect(submitAvailability(makeMyAssignment({ status: 'closed' }), 'active', NOW).blocker).toBe('closed')
    const used = makeMyAssignment({ attempts: 1, attemptsAllowed: 1, latest: makeLatest() })
    expect(submitAvailability(used, 'active', NOW).blocker).toBe('attempts_exhausted')
    const returned = makeMyAssignment({ attempts: 1, attemptsAllowed: 2, latest: makeLatest({ status: 'returned', feedback: 'أعد' }) })
    expect(submitAvailability(returned, 'active', NOW).blocker).toBeNull()
  })

  it('checks the enrollment first when «my classes» knows it, and leaves an unknown one to the server', () => {
    expect(submitAvailability(makeMyAssignment({ status: 'closed', dueAt: PAST_DUE }), 'completed', NOW).blocker).toBe('not_enrolled')
    expect(submitAvailability(makeMyAssignment(), 'withdrawn', NOW).blocker).toBe('not_enrolled')
    expect(submitAvailability(makeMyAssignment(), null, NOW).blocker).toBeNull()
    // The window comes before the attempts, as on the server.
    expect(submitAvailability(makeMyAssignment({ status: 'closed', attempts: 1, attemptsAllowed: 1 }), 'active', NOW).blocker).toBe('closed')
  })

  it('reads the due date against the given clock', () => {
    expect(isPastDue(makeMyAssignment({ dueAt: FUTURE_DUE }), NOW)).toBe(false)
    expect(isPastDue(makeMyAssignment({ dueAt: '2026-11-10T11:59:59.000Z' }), NOW)).toBe(true)
    expect(isPastDue(makeMyAssignment({ dueAt: null }), NOW)).toBe(false)
  })

  it('offers sending to the student themselves holding assignments.submit — never on a guardian’s child row', () => {
    expect(offersSubmit(makeMyAssignment(), true)).toBe(true)
    expect(offersSubmit(makeMyAssignment(), false)).toBe(false)
    expect(offersSubmit(makeMyAssignment({ relation: 'child', student: CHILD_ONE }), true)).toBe(false)
  })

  it('counts the attempts left once the next is sent', () => {
    expect(attemptsLeftAfterNext(makeMyAssignment({ attempts: 0, attemptsAllowed: 1 }))).toBe(0)
    expect(attemptsLeftAfterNext(makeMyAssignment({ attempts: 1, attemptsAllowed: 3 }))).toBe(1)
    expect(attemptsLeftAfterNext(makeMyAssignment({ attempts: 3, attemptsAllowed: 2 }))).toBe(0)
  })
})

describe('applySubmission (the row follows the server’s answer)', () => {
  it('takes the new attempt, the counts and the assignment as the server holds it', () => {
    const row = makeMyAssignment({ attempts: 1, attemptsAllowed: 2, latest: makeLatest({ status: 'returned', feedback: 'أعد' }) })
    const answer = makeMySubmission({ id: SUBMISSION_ID_2, attemptNo: 2, isLate: true, attempts: 2, attemptsAllowed: 2, assignment: { ...makeMySubmission().assignment, status: 'closed', maxScore: 25 } })
    const next = applySubmission(row, answer)
    expect(next.latest).toEqual({ id: SUBMISSION_ID_2, attemptNo: 2, submittedAt: answer.submittedAt, isLate: true, status: 'submitted', score: null, feedback: null, gradedAt: null })
    expect(next).toMatchObject({ attempts: 2, attemptsAllowed: 2, status: 'closed', maxScore: 25 })
    // The answer and the link never land on the row (API-112 does not carry them).
    expect(next.latest).not.toHaveProperty('textAnswer')
  })

  it('keeps a newer attempt on screen when the answer is about an older one, but takes the counts', () => {
    const row = makeMyAssignment({ attempts: 2, attemptsAllowed: 2, latest: makeLatest({ id: SUBMISSION_ID_2, attemptNo: 2 }) })
    const next = applySubmission(row, makeMySubmission({ attemptNo: 1, status: 'graded', score: 12, attempts: 2, attemptsAllowed: 3 }))
    expect(next.latest?.id).toBe(SUBMISSION_ID_2)
    expect(next.attemptsAllowed).toBe(3)
  })

  it('leaves another assignment’s or another student’s row as it is', () => {
    const row = makeMyAssignment()
    expect(applySubmission(row, makeMySubmission({ assignment: { ...makeMySubmission().assignment, id: ASSIGNMENT_ID_2 } }))).toBe(row)
    expect(applySubmission(row, makeMySubmission({ student: CHILD_ONE }))).toBe(row)
  })

  it('keeps the row’s status when the answer carries a status a learner’s item never has', () => {
    const next = applySubmission(makeMyAssignment(), makeMySubmission({ assignment: { ...makeMySubmission().assignment, status: 'grading' } }))
    expect(next.status).toBe('open')
  })
})

describe('what «my classes» adds: the enrollment and the lead teacher', () => {
  const selfClass = makeMyClassItem({ student: SELF_STUDENT })
  const childClass = makeMyClassItem({ relation: 'child', student: CHILD_ONE, enrollmentStatus: 'completed', class: { ...selfClass.class, leadTeacher: null } })
  const index = enrollmentIndexOf([selfClass, childClass])

  it('joins a row to the enrollment of its class and student', () => {
    expect(enrollmentStatusOf(index, makeMyAssignment())).toBe('active')
    expect(enrollmentStatusOf(index, makeMyAssignment({ relation: 'child', student: CHILD_ONE }))).toBe('completed')
    expect(enrollmentStatusOf(enrollmentIndexOf([]), makeMyAssignment())).toBeNull()
  })

  it('names the class’s lead teacher, says when the class has none, and when «my classes» does not know the class', () => {
    expect(leadTeacherOf(index, makeMyAssignment())).toEqual({ kind: 'teacher', teacher: { fullName: 'خالد المعلم', displayName: null } })
    expect(leadTeacherOf(index, makeMyAssignment({ relation: 'child', student: CHILD_ONE }))).toEqual({ kind: 'none' })
    expect(leadTeacherOf(enrollmentIndexOf([]), makeMyAssignment())).toEqual({ kind: 'unknown' })
  })
})
