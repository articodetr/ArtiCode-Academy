// Fixtures for the submissions tab and the review panel (MOD-08-T03 — J-F41):
// the shapes of API-108..API-111 as the backend returns them, with the
// MOD-08-T07 fields (D-R49 — the assignment's `allowLate` and `timeZone`, the
// submission's `history`). The assignment is the one of test/assignments.ts
// (PY-101-A, out of 20, due 2026-11-20 23:59 in Asia/Riyadh), here open with
// late submissions accepted and two attempts per student.
import type { Submission, SubmissionAssignment, SubmissionRoster, SubmissionRosterItem, SubmissionSummary } from '../api/submissions'
import type { EnrollmentStudent } from '../api/enrollments'
import { ASSIGNMENT_ID, ASSIGNMENT_TIME_ZONE } from './assignments'
import { CLASS_ID } from './classes'

export const SUBMISSION_IDS = [
  '0193e000-0000-7000-8000-00000000c001',
  '0193e000-0000-7000-8000-00000000c002',
  '0193e000-0000-7000-8000-00000000c003',
  '0193e000-0000-7000-8000-00000000c004',
] as const

/** The reviewer of the graded fixtures. */
export const REVIEWER = { fullName: 'خالد المعلم', displayName: null }

export const ROSTER_STUDENT_IDS = [
  '0193e000-0000-7000-8000-00000000d001',
  '0193e000-0000-7000-8000-00000000d002',
  '0193e000-0000-7000-8000-00000000d003',
  '0193e000-0000-7000-8000-00000000d004',
] as const

/** The assignment as API-108..API-111 carry it (`SubmissionAssignmentDto`). */
export function makeSubmissionAssignment(overrides: Partial<SubmissionAssignment> = {}): SubmissionAssignment {
  return {
    id: ASSIGNMENT_ID,
    classId: CLASS_ID,
    title: { ar: 'تمارين الحلقات', en: 'Loop exercises' },
    status: 'open',
    maxScore: 20,
    dueAt: '2026-11-20T20:59:00.000Z',
    allowLate: true,
    timeZone: ASSIGNMENT_TIME_ZONE,
    ...overrides,
  }
}

/** A student in the caller's projection (reduced here: no contact fields). */
export function makeRosterStudent(overrides: Partial<EnrollmentStudent> = {}): EnrollmentStudent {
  return {
    id: ROSTER_STUDENT_IDS[0],
    fullName: 'سارة الطالبة',
    fullNameLatin: 'Sara',
    displayName: null,
    avatarUrl: null,
    status: 'active',
    email: null,
    username: null,
    phone: null,
    deletedAt: null,
    ...overrides,
  }
}

/** Sara's first attempt, on time, waiting for review. */
export function makeSubmissionSummary(overrides: Partial<SubmissionSummary> = {}): SubmissionSummary {
  return {
    id: SUBMISSION_IDS[0],
    attemptNo: 1,
    submittedAt: '2026-11-18T07:30:00.000Z',
    isLate: false,
    status: 'submitted',
    score: null,
    gradedAt: null,
    ...overrides,
  }
}

export function makeRosterItem(overrides: Partial<SubmissionRosterItem> = {}): SubmissionRosterItem {
  return {
    student: makeRosterStudent(),
    enrollmentStatus: 'active',
    attempts: 1,
    attemptsAllowed: 2,
    latest: makeSubmissionSummary(),
    lastGradedScore: null,
    ...overrides,
  }
}

/**
 * The four students of PY-101-A: سارة (active, attempt 1 waiting for review),
 * يوسف (active, attempt 1 submitted late and graded 17.5), ليلى (withdrawn,
 * attempt 1 graded 12 then attempt 2 returned — three attempts allowed) and
 * عمر (completed, no submission).
 */
export function rosterOfFour(): SubmissionRosterItem[] {
  return [
    makeRosterItem(),
    makeRosterItem({
      student: makeRosterStudent({ id: ROSTER_STUDENT_IDS[1], fullName: 'يوسف الطالب', fullNameLatin: 'Yousef', displayName: 'يوسف' }),
      latest: makeSubmissionSummary({ id: SUBMISSION_IDS[1], submittedAt: '2026-11-21T06:00:00.000Z', isLate: true, status: 'graded', score: 17.5, gradedAt: '2026-11-21T09:00:00.000Z' }),
      lastGradedScore: 17.5,
    }),
    makeRosterItem({
      student: makeRosterStudent({ id: ROSTER_STUDENT_IDS[2], fullName: 'ليلى المنسحبة', fullNameLatin: 'Layla' }),
      enrollmentStatus: 'withdrawn',
      attempts: 2,
      attemptsAllowed: 3,
      latest: makeSubmissionSummary({ id: SUBMISSION_IDS[2], attemptNo: 2, submittedAt: '2026-11-19T15:45:00.000Z', status: 'returned', gradedAt: '2026-11-20T08:00:00.000Z' }),
      lastGradedScore: 12,
    }),
    makeRosterItem({
      student: makeRosterStudent({ id: ROSTER_STUDENT_IDS[3], fullName: 'عمر الخريج', fullNameLatin: 'Omar' }),
      enrollmentStatus: 'completed',
      attempts: 0,
      latest: null,
    }),
  ]
}

export function makeSubmissionRoster(overrides: Partial<SubmissionRoster> = {}): SubmissionRoster {
  return { assignment: makeSubmissionAssignment(), maxAttempts: 2, items: rosterOfFour(), ...overrides }
}

/** The summary an attempt has in a `history` (and in the roster). */
export function summaryOf(submission: Pick<Submission, 'id' | 'attemptNo' | 'submittedAt' | 'isLate' | 'status' | 'score' | 'gradedAt'>): SubmissionSummary {
  const { id, attemptNo, submittedAt, isLate, status, score, gradedAt } = submission
  return { id, attemptNo, submittedAt, isLate, status, score, gradedAt }
}

/**
 * Sara's first attempt as API-110 answers it: a text answer and a link, waiting for review. Without a `history`
 * override the history holds this attempt alone (as the server lists a single attempt).
 */
export function makeSubmission(overrides: Partial<Submission> = {}): Submission {
  const submission: Submission = {
    id: SUBMISSION_IDS[0],
    assignment: makeSubmissionAssignment(),
    student: { id: ROSTER_STUDENT_IDS[0], fullName: 'سارة الطالبة', displayName: null },
    attemptNo: 1,
    submittedAt: '2026-11-18T07:30:00.000Z',
    isLate: false,
    textAnswer: 'الحلقة for تكرّر الأوامر\nوالحلقة while تكرّر ما دام الشرط صحيحاً',
    linkUrl: 'https://docs.example.com/sara-loops',
    status: 'submitted',
    score: null,
    feedback: null,
    gradedBy: null,
    gradedAt: null,
    attempts: 1,
    attemptsAllowed: 2,
    history: [],
    ...overrides,
  }
  return overrides.history ? submission : { ...submission, history: [summaryOf(submission)] }
}

/** The same attempt after `grade` 17.5 with feedback by خالد المعلم. */
export function makeGradedSubmission(overrides: Partial<Submission> = {}): Submission {
  return makeSubmission({
    status: 'graded',
    score: 17.5,
    feedback: 'عمل جيد؛ راجع شرط التوقف',
    gradedBy: REVIEWER,
    gradedAt: '2026-11-21T09:00:00.000Z',
    ...overrides,
  })
}

/**
 * Sara's two attempts as API-110 answers each of them, both returned for rework (two attempts used of four
 * allowed: two plus one per return), with the same `history` — the case where attempt 1 is graded after attempt 2
 * was returned (MOD-08-T07). [attempt 1, attempt 2].
 */
export function saraTwoAttempts(): [Submission, Submission] {
  const counts = { attempts: 2, attemptsAllowed: 4 }
  const first = makeSubmission({ ...counts, status: 'returned', feedback: 'أكمل التمرين الثالث', gradedBy: REVIEWER, gradedAt: '2026-11-19T08:00:00.000Z' })
  const second = makeSubmission({
    ...counts,
    id: SUBMISSION_IDS[3],
    attemptNo: 2,
    submittedAt: '2026-11-20T10:15:00.000Z',
    textAnswer: 'المحاولة الثانية: الحلقة while مع شرط توقف',
    linkUrl: null,
    status: 'returned',
    feedback: 'ما زال شرط التوقف ناقصاً',
    gradedBy: REVIEWER,
    gradedAt: '2026-11-21T08:00:00.000Z',
  })
  const history = [summaryOf(first), summaryOf(second)]
  return [
    { ...first, history },
    { ...second, history },
  ]
}
