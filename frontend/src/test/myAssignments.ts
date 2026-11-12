// Fixtures for «my assignments» (MOD-08-T04 — J-F42): the shapes of API-112,
// API-109 and API-110 as the backend returns them (my-assignments.dto.ts,
// submissions.dto.ts), with the MOD-08-T07 fields (D-R49 — the item's
// `enrollmentStatus`/`submitBlocker`/`submitsLate`, the attempt's `history`
// and its assignment's `allowLate`/`timeZone`), plus the permission sets of
// the seeded learner roles (backend/src/authorization/system-roles.ts). The
// submit state is the server's verdict and is never derived here: a fixture
// that is past due, closed or out of attempts says so in `submitBlocker` /
// `submitsLate` itself. The assignment part reuses the J-F38 fixture and the
// students those of J-F11, so the class, course, zone and people are the same
// everywhere.
import type { MyAssignmentItem, MyAssignmentLatest, MyAssignmentList, MySubmission, MySubmissionSummary } from '../api/myAssignments'
import { ASSIGNMENT_ID, makeAssignment } from './assignments'
import { SELF_STUDENT } from './myLessons'

/** The seeded student: reads by ownership and sends attempts (`assignments.submit`). */
export const STUDENT_LEARNER_PERMISSIONS = ['courses.read', 'assignments.read', 'assignments.submit', 'schedule.read', 'lessons.read']

/** The seeded guardian: reads their children's assignments by ownership and never submits (no `assignments.submit`). */
export const GUARDIAN_LEARNER_PERMISSIONS = ['courses.read', 'assignments.read', 'grades.read_linked', 'schedule.read', 'attendance.read']

/** Far in the future: the window stays open whatever the test machine's clock says. */
export const FUTURE_DUE = '2030-01-15T20:59:00.000Z'
/** Long past. */
export const PAST_DUE = '2026-01-15T20:59:00.000Z'

export const SUBMISSION_ID = '0193f000-0000-7000-8000-00000000c001'
export const SUBMISSION_ID_2 = '0193f000-0000-7000-8000-00000000c002'

/**
 * An open assignment of PY-101-A owned by the student themselves (active enrollment), due in 2030 (Asia/Riyadh),
 * out of 20, one attempt, not submitted yet — so the server takes an attempt now, on time.
 */
export function makeMyAssignment(overrides: Partial<MyAssignmentItem> = {}): MyAssignmentItem {
  const assignment = makeAssignment({ status: 'open', publishedAt: '2026-11-09T09:00:00.000Z', dueAt: FUTURE_DUE })
  return {
    id: assignment.id,
    title: assignment.title,
    instructions: assignment.instructions,
    status: 'open',
    maxScore: assignment.maxScore,
    dueAt: assignment.dueAt,
    timeZone: assignment.timeZone,
    allowLate: false,
    latePenaltyPercent: null,
    maxAttempts: 1,
    publishedAt: assignment.publishedAt,
    closedAt: null,
    lesson: null,
    class: assignment.class,
    relation: 'self',
    student: SELF_STUDENT,
    attempts: 0,
    attemptsAllowed: 1,
    latest: null,
    enrollmentStatus: 'active',
    submitBlocker: null,
    submitsLate: false,
    ...overrides,
  }
}

/** The latest attempt as API-112 shows it: attempt 1, on time, waiting for review. */
export function makeLatest(overrides: Partial<MyAssignmentLatest> = {}): MyAssignmentLatest {
  return {
    id: SUBMISSION_ID,
    attemptNo: 1,
    submittedAt: '2026-11-10T08:30:00.000Z',
    isLate: false,
    status: 'submitted',
    score: null,
    feedback: null,
    gradedAt: null,
    ...overrides,
  }
}

export function makeMyAssignmentList(items: MyAssignmentItem[], nextCursor: string | null = null): MyAssignmentList {
  return { items, nextCursor }
}

/** The summary an attempt has in a `history`. */
export function mySummaryOf(submission: Pick<MySubmission, 'id' | 'attemptNo' | 'submittedAt' | 'isLate' | 'status' | 'score' | 'gradedAt'>): MySubmissionSummary {
  const { id, attemptNo, submittedAt, isLate, status, score, gradedAt } = submission
  return { id, attemptNo, submittedAt, isLate, status, score, gradedAt }
}

/**
 * The attempt as API-109 / API-110 return it: the student's first attempt on the fixture assignment, a text and a
 * link, not reviewed. Without a `history` override the history holds this attempt alone.
 */
export function makeMySubmission(overrides: Partial<MySubmission> = {}): MySubmission {
  const item = makeMyAssignment()
  const submission: MySubmission = {
    id: SUBMISSION_ID,
    assignment: { id: ASSIGNMENT_ID, classId: item.class.id, title: item.title, status: 'open', maxScore: item.maxScore, dueAt: item.dueAt, allowLate: item.allowLate, timeZone: item.timeZone },
    student: SELF_STUDENT,
    attemptNo: 1,
    submittedAt: '2026-11-10T08:30:00.000Z',
    isLate: false,
    textAnswer: 'الحلقة for تكرر الأوامر',
    linkUrl: 'https://docs.example.com/answer',
    status: 'submitted',
    score: null,
    feedback: null,
    gradedBy: null,
    gradedAt: null,
    attempts: 1,
    attemptsAllowed: 1,
    history: [],
    ...overrides,
  }
  return overrides.history ? submission : { ...submission, history: [mySummaryOf(submission)] }
}
