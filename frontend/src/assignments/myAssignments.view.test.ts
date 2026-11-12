import { describe, expect, it } from 'vitest'
import { ASSIGNMENT_ID_2 } from '../test/assignments'
import { makeMyClassItem } from '../test/enrollments'
import { PAST_DUE, SUBMISSION_ID_2, makeLatest, makeMyAssignment, makeMySubmission } from '../test/myAssignments'
import { CHILD_ONE, SELF_STUDENT } from '../test/myLessons'
import {
  applySubmission,
  attemptsLeftAfterNext,
  defaultMyAssignmentsFilters,
  enrollmentIndexOf,
  feedbackExcerpt,
  followSubmitState,
  gradedScoreOf,
  isNarrowed,
  leadTeacherOf,
  myAssignmentKey,
  myAssignmentsQuery,
  offersSubmit,
  scoreText,
  submissionCellOf,
} from './myAssignments.view'
import type { MyAssignmentsFilters } from './myAssignments.view'

const ZONE = 'Asia/Riyadh'
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
    expect(submissionCellOf(makeMyAssignment({ latest: makeLatest({ status: 'graded', score: 18, isLate: true, attemptNo: 2 }) }))).toEqual({ kind: 'graded', attemptNo: 2, late: true })
    expect(submissionCellOf(makeMyAssignment({ latest: makeLatest({ status: 'returned', feedback: 'أعد الحل' }) }))).toEqual({ kind: 'returned', attemptNo: 1, late: false })
  })

  it('tells «not submitted yet» from «missed» by the server’s verdict: closed, past due without late submissions, or no active enrollment', () => {
    expect(submissionCellOf(makeMyAssignment())).toEqual({ kind: 'none' })
    expect(submissionCellOf(makeMyAssignment({ dueAt: null }))).toEqual({ kind: 'none' })
    expect(submissionCellOf(makeMyAssignment({ dueAt: PAST_DUE, allowLate: true, submitsLate: true }))).toEqual({ kind: 'none' })
    expect(submissionCellOf(makeMyAssignment({ dueAt: PAST_DUE, submitBlocker: 'past_due' }))).toEqual({ kind: 'missed' })
    expect(submissionCellOf(makeMyAssignment({ status: 'closed', submitBlocker: 'closed' }))).toEqual({ kind: 'missed' })
    expect(submissionCellOf(makeMyAssignment({ enrollmentStatus: 'completed', submitBlocker: 'not_enrolled' }))).toEqual({ kind: 'missed' })
  })

  it('never reads this device’s clock: a due date already past here is still open while the server says so (#109 note 1)', () => {
    expect(submissionCellOf(makeMyAssignment({ dueAt: PAST_DUE, submitBlocker: null, submitsLate: false }))).toEqual({ kind: 'none' })
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

describe('followSubmitState (the server’s submitState() re-applied to a submission answer: enrollment → window → attempts)', () => {
  const answer = (patch: Parameters<typeof makeMySubmission>[0] = {}) => makeMySubmission(patch)
  const assignment = (patch: Partial<ReturnType<typeof makeMySubmission>['assignment']>) => ({ ...makeMySubmission().assignment, ...patch })

  it('blocks a new attempt once the answer’s attempts reach the allowance, and frees one a return granted', () => {
    // The last attempt was just sent.
    expect(followSubmitState(makeMyAssignment(), answer({ attempts: 1, attemptsAllowed: 1 }))).toEqual({ submitBlocker: 'attempts_exhausted', submitsLate: false })
    // The latest attempt (read again) was returned meanwhile: the allowance grew.
    const used = makeMyAssignment({ attempts: 1, attemptsAllowed: 1, latest: makeLatest(), submitBlocker: 'attempts_exhausted' })
    expect(followSubmitState(used, answer({ status: 'returned', feedback: 'أعد', attempts: 1, attemptsAllowed: 2 }))).toEqual({ submitBlocker: null, submitsLate: false })
  })

  it('takes the window from the answer’s assignment: closed (or a draft) blocks, in the server’s order before the attempts', () => {
    expect(followSubmitState(makeMyAssignment(), answer({ assignment: assignment({ status: 'closed' }), attempts: 1, attemptsAllowed: 1 }))).toEqual({ submitBlocker: 'closed', submitsLate: false })
    expect(followSubmitState(makeMyAssignment(), answer({ assignment: assignment({ status: 'draft' }) }))).toEqual({ submitBlocker: 'not_published', submitsLate: false })
  })

  it('checks the row’s enrollment first (an answer does not carry it)', () => {
    const completed = makeMyAssignment({ enrollmentStatus: 'completed', submitBlocker: 'not_enrolled', latest: makeLatest(), attempts: 1, attemptsAllowed: 3 })
    expect(followSubmitState(completed, answer({ attempts: 1, attemptsAllowed: 3 }))).toEqual({ submitBlocker: 'not_enrolled', submitsLate: false })
  })

  it('reads «past due» from the server only: the isLate of the attempt just created, else the list’s verdict — never this device’s clock', () => {
    const open = makeMyAssignment({ maxAttempts: 3, attemptsAllowed: 3 })
    // A late attempt was just created under allowLate: the next one is late too.
    expect(followSubmitState(open, answer({ isLate: true, attempts: 1, attemptsAllowed: 3, assignment: assignment({ allowLate: true }) }))).toEqual({ submitBlocker: null, submitsLate: true })
    // An attempt created on time: on time, whatever this device's clock says of the due date.
    expect(followSubmitState(makeMyAssignment({ dueAt: PAST_DUE, attemptsAllowed: 3 }), answer({ isLate: false, attempts: 1, attemptsAllowed: 3 }))).toEqual({ submitBlocker: null, submitsLate: false })
    // An older attempt read again keeps the list's verdict: late under allowLate…
    const late = makeMyAssignment({ allowLate: true, submitsLate: true, attempts: 2, attemptsAllowed: 3, latest: makeLatest({ id: SUBMISSION_ID_2, attemptNo: 2 }) })
    expect(followSubmitState(late, answer({ attemptNo: 1, isLate: false, attempts: 2, attemptsAllowed: 3, assignment: assignment({ allowLate: true }) }))).toEqual({ submitBlocker: null, submitsLate: true })
    // …and past due without late submissions.
    const shut = makeMyAssignment({ submitBlocker: 'past_due', attempts: 1, attemptsAllowed: 2, latest: makeLatest() })
    expect(followSubmitState(shut, answer({ status: 'returned', feedback: 'أعد', attempts: 1, attemptsAllowed: 2 }))).toEqual({ submitBlocker: 'past_due', submitsLate: false })
  })
})

describe('the attempt offer', () => {
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
  it('takes the new attempt, the counts, the assignment as the server holds it and the submit state that follows', () => {
    const row = makeMyAssignment({ attempts: 1, attemptsAllowed: 2, latest: makeLatest({ status: 'returned', feedback: 'أعد' }) })
    const answer = makeMySubmission({
      id: SUBMISSION_ID_2,
      attemptNo: 2,
      isLate: true,
      attempts: 2,
      attemptsAllowed: 2,
      assignment: { ...makeMySubmission().assignment, status: 'closed', maxScore: 25, allowLate: true, timeZone: 'Europe/Berlin' },
    })
    const next = applySubmission(row, answer)
    expect(next.latest).toEqual({ id: SUBMISSION_ID_2, attemptNo: 2, submittedAt: answer.submittedAt, isLate: true, status: 'submitted', score: null, feedback: null, gradedAt: null })
    expect(next).toMatchObject({ attempts: 2, attemptsAllowed: 2, status: 'closed', maxScore: 25, allowLate: true, timeZone: 'Europe/Berlin', submitBlocker: 'closed', submitsLate: false })
    // The answer and the link never land on the row (API-112 does not carry them).
    expect(next.latest).not.toHaveProperty('textAnswer')
  })

  it('hides «submit» once the last attempt is sent — no second read of the list needed', () => {
    const next = applySubmission(makeMyAssignment(), makeMySubmission({ attempts: 1, attemptsAllowed: 1 }))
    expect(next).toMatchObject({ attempts: 1, submitBlocker: 'attempts_exhausted', submitsLate: false })
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

describe('what «my classes» adds: the lead teacher', () => {
  const selfClass = makeMyClassItem({ student: SELF_STUDENT })
  const childClass = makeMyClassItem({ relation: 'child', student: CHILD_ONE, enrollmentStatus: 'completed', class: { ...selfClass.class, leadTeacher: null } })
  const index = enrollmentIndexOf([selfClass, childClass])

  it('names the class’s lead teacher, says when the class has none, and when «my classes» does not know the class', () => {
    expect(leadTeacherOf(index, makeMyAssignment())).toEqual({ kind: 'teacher', teacher: { fullName: 'خالد المعلم', displayName: null } })
    expect(leadTeacherOf(index, makeMyAssignment({ relation: 'child', student: CHILD_ONE }))).toEqual({ kind: 'none' })
    expect(leadTeacherOf(enrollmentIndexOf([]), makeMyAssignment())).toEqual({ kind: 'unknown' })
  })
})
