// Pure rules of «my assignments» (J-F42): the four views turned into API-112
// parameters, the row key (an assignment repeats once per owned student), the
// cells of the learner's own submission, whether a row may take an attempt
// now — a mirror of the checks of SubmissionsService.submit()
// (backend/src/assignments/submissions.service.ts + submissionWindow() and
// summarizeAttempts() of submissions.policy.ts; keep them in sync) — and the
// row update a submission answer (API-109/API-110) brings. The student and
// class filter options, and the student column rule, are those of «my
// lessons» (myLessons.view.ts — the same API-060 ownership). No React, no
// i18next instance; unit-tested in myAssignments.view.test.ts.
import type { AssignmentSortOrder } from '../api/assignments'
import type { EnrollmentStatus, MyClassItem, MyClassTeacher } from '../api/enrollments'
import type { ListMyAssignmentsParams, MyAssignmentItem, MySubmission, MySubmissionStatus } from '../api/myAssignments'
import { dayEndIn, dayStartIn } from './assignments.zone'

/**
 * `open` (default) = every open assignment, earliest due first — the work at
 * hand with its state, a returned attempt included; `pending` = the open
 * assignments a student has not submitted yet (API-112 `pending=true`: a
 * returned attempt counts as submitted, so it is not there); `closed` = the
 * closed ones, latest due first; `all` = both, with an optional due-day range
 * and a chosen order.
 */
export const MY_ASSIGNMENT_VIEWS = ['open', 'pending', 'closed', 'all'] as const
export type MyAssignmentView = (typeof MY_ASSIGNMENT_VIEWS)[number]

/** Assignments per page (`limit` counts assignments — a page can hold more rows). */
export const MY_ASSIGNMENT_PAGE_SIZES = [20, 50, 100] as const

export interface MyAssignmentsFilters {
  view: MyAssignmentView
  /** The caller or one of their children; blank = every owned student. */
  studentId: string | undefined
  classId: string | undefined
  /** `all` view only: calendar days (`YYYY-MM-DD`) of `timeZone`; blank = open-ended. */
  dueFrom: string | undefined
  dueTo: string | undefined
  /** The zone the two days are read in (the academy's — this device's until it is known — as on /assignments). */
  timeZone: string
  /** `all` view only — `open`/`pending` are earliest due first and `closed` latest due first. */
  order: AssignmentSortOrder
  limit: (typeof MY_ASSIGNMENT_PAGE_SIZES)[number]
}

export function defaultMyAssignmentsFilters(timeZone: string): MyAssignmentsFilters {
  return { view: 'open', studentId: undefined, classId: undefined, dueFrom: undefined, dueTo: undefined, timeZone, order: 'asc', limit: 20 }
}

/** API-112 parameters of the filters (the cursor is added by the caller). */
export function myAssignmentsQuery(filters: MyAssignmentsFilters): ListMyAssignmentsParams {
  const base: ListMyAssignmentsParams = { classId: filters.classId, studentId: filters.studentId, limit: filters.limit }
  if (filters.view === 'open') return { ...base, status: 'open', order: 'asc' }
  if (filters.view === 'pending') return { ...base, status: 'open', pending: true, order: 'asc' }
  if (filters.view === 'closed') return { ...base, status: 'closed', order: 'desc' }
  return { ...base, dueFrom: dayStartIn(filters.dueFrom, filters.timeZone), dueTo: dayEndIn(filters.dueTo, filters.timeZone), order: filters.order }
}

/** True when a filter beyond the view narrows the list (the empty text then says so). */
export function isNarrowed(filters: MyAssignmentsFilters): boolean {
  return Boolean(filters.studentId || filters.classId || (filters.view === 'all' && (filters.dueFrom || filters.dueTo)))
}

/** A row is an assignment × a student: the assignment id alone repeats for a guardian with two children in the class. */
export function myAssignmentKey(item: Pick<MyAssignmentItem, 'id' | 'student'>): string {
  return `${item.id}:${item.student.id}`
}

// ---------------------------------------------------------------------------
// The learner's own submission
// ---------------------------------------------------------------------------

function isPast(iso: string | null, now: Date): boolean {
  if (!iso) return false
  const at = Date.parse(iso)
  return !Number.isNaN(at) && now.getTime() > at
}

/** Past the due date on this device's clock (an undated assignment never is) — the server's `now > due_at` (submissionWindow()). */
export function isPastDue(item: Pick<MyAssignmentItem, 'dueAt'>, now: Date = new Date()): boolean {
  return isPast(item.dueAt, now)
}

/** Tag colors of an attempt's status. */
export const MY_SUBMISSION_COLORS: Readonly<Record<MySubmissionStatus, string>> = {
  submitted: 'gold',
  graded: 'green',
  returned: 'orange',
}

/** The first characters of the feedback for the table cell (the drawer shows all of it). */
export function feedbackExcerpt(text: string, max = 140): string {
  const flat = text.trim()
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat
}

/** Past the due date and not taking late attempts, or closed: no attempt can come any more. */
function windowShut(item: Pick<MyAssignmentItem, 'status' | 'dueAt' | 'allowLate'>, now: Date): boolean {
  return item.status !== 'open' || (isPast(item.dueAt, now) && !item.allowLate)
}

export type MySubmissionCell =
  /** The latest attempt as the server reviewed it; `late` = `isLate` of that attempt (the server's mark). */
  | { kind: 'submitted' | 'graded' | 'returned'; attemptNo: number; late: boolean }
  /** No attempt yet and one can still come. */
  | { kind: 'none' }
  /** No attempt, and the assignment no longer takes one (closed, or past due without late attempts). */
  | { kind: 'missed' }

/** What the submission column shows. */
export function submissionCellOf(item: Pick<MyAssignmentItem, 'latest' | 'status' | 'dueAt' | 'allowLate'>, now: Date = new Date()): MySubmissionCell {
  if (item.latest) return { kind: item.latest.status, attemptNo: item.latest.attemptNo, late: item.latest.isLate }
  return windowShut(item, now) ? { kind: 'missed' } : { kind: 'none' }
}

/** The score shown with the latest attempt: graded only (a returned attempt has no score — D-R39). */
export function gradedScoreOf(item: Pick<MyAssignmentItem, 'latest'>): number | null {
  return item.latest?.status === 'graded' ? item.latest.score : null
}

/** `17.5 / 20` — numbers as the server sends them (no rounding, no penalty: the grades module applies it — D-R36). */
export function scoreText(score: number, maxScore: number): string {
  return `${score} / ${maxScore}`
}

/** Why the student cannot send an attempt now, in the order the server checks (enrollment → window → attempts). */
export type SubmitBlocker = 'not_enrolled' | 'closed' | 'past_due' | 'attempts_exhausted'

export interface SubmitAvailability {
  blocker: SubmitBlocker | null
  /** The attempt would be marked late (past the due date, under allowLate). */
  late: boolean
}

/**
 * Whether the row's student may send an attempt now — for a `self` row of a
 * holder of `assignments.submit` (the page decides that part). The
 * enrollment status comes from «my classes» (API-060 — API-112 does not carry
 * it); unknown (null) blocks nothing and leaves `not_enrolled` to the server.
 * The window reads this device's clock: a clock off by minutes near the due
 * date gets the server's 409 instead, which the modal shows.
 */
export function submitAvailability(
  item: Pick<MyAssignmentItem, 'status' | 'dueAt' | 'allowLate' | 'attempts' | 'attemptsAllowed'>,
  enrollmentStatus: EnrollmentStatus | null,
  now: Date = new Date(),
): SubmitAvailability {
  const late = isPast(item.dueAt, now)
  if (enrollmentStatus !== null && enrollmentStatus !== 'active') return { blocker: 'not_enrolled', late }
  if (item.status !== 'open') return { blocker: 'closed', late }
  if (late && !item.allowLate) return { blocker: 'past_due', late }
  if (item.attempts >= item.attemptsAllowed) return { blocker: 'attempts_exhausted', late }
  return { blocker: null, late }
}

/** Only the student themselves submits: a guardian reads their children's rows (D-R40), and the key is `assignments.submit`. */
export function offersSubmit(item: Pick<MyAssignmentItem, 'relation'>, holdsSubmitKey: boolean): boolean {
  return item.relation === 'self' && holdsSubmitKey
}

/** The attempts left once the next one is sent (0 = the next is the last). */
export function attemptsLeftAfterNext(item: Pick<MyAssignmentItem, 'attempts' | 'attemptsAllowed'>): number {
  return Math.max(0, item.attemptsAllowed - item.attempts - 1)
}

/**
 * The row after a submission answer of the server (API-109 or API-110): the
 * student's counts, the assignment as it is now, and — unless the answer is
 * an older attempt than the one on screen — the latest attempt. An answer
 * about another assignment or student leaves the row as it is.
 */
export function applySubmission(item: MyAssignmentItem, submission: MySubmission): MyAssignmentItem {
  if (submission.assignment.id !== item.id || submission.student.id !== item.student.id) return item
  const { assignment } = submission
  const newer = !item.latest || submission.attemptNo >= item.latest.attemptNo
  return {
    ...item,
    title: assignment.title,
    // A learner's item is open or closed; any other status of the answer (a draft cannot come back — D-R37) keeps the row's.
    status: assignment.status === 'open' || assignment.status === 'closed' ? assignment.status : item.status,
    maxScore: assignment.maxScore,
    dueAt: assignment.dueAt,
    attempts: submission.attempts,
    attemptsAllowed: submission.attemptsAllowed,
    latest: newer
      ? {
          id: submission.id,
          attemptNo: submission.attemptNo,
          submittedAt: submission.submittedAt,
          isLate: submission.isLate,
          status: submission.status,
          score: submission.score,
          feedback: submission.feedback,
          gradedAt: submission.gradedAt,
        }
      : item.latest,
  }
}

// ---------------------------------------------------------------------------
// What «my classes» (API-060) adds: the enrollment and the lead teacher
// ---------------------------------------------------------------------------

export type EnrollmentIndex = ReadonlyMap<string, Pick<MyClassItem, 'enrollmentStatus' | 'class'>>

/** The owned enrollments of API-060 by class × student (API-112 rows join them by the same pair). */
export function enrollmentIndexOf(items: readonly Pick<MyClassItem, 'enrollmentStatus' | 'class' | 'student'>[]): EnrollmentIndex {
  const index = new Map<string, Pick<MyClassItem, 'enrollmentStatus' | 'class'>>()
  for (const item of items) index.set(`${item.class.id}:${item.student.id}`, item)
  return index
}

function enrollmentOf(index: EnrollmentIndex, item: Pick<MyAssignmentItem, 'class' | 'student'>) {
  return index.get(`${item.class.id}:${item.student.id}`) ?? null
}

/** The row's enrollment status, or null when «my classes» does not know it (still loading, failed). */
export function enrollmentStatusOf(index: EnrollmentIndex, item: Pick<MyAssignmentItem, 'class' | 'student'>): EnrollmentStatus | null {
  return enrollmentOf(index, item)?.enrollmentStatus ?? null
}

export type LeadTeacherCell = { kind: 'teacher'; teacher: MyClassTeacher } | { kind: 'none' } | { kind: 'unknown' }

/** The class's lead teacher by name (API-112 names no teacher): `none` = the class has none, `unknown` = «my classes» does not know the class. */
export function leadTeacherOf(index: EnrollmentIndex, item: Pick<MyAssignmentItem, 'class' | 'student'>): LeadTeacherCell {
  const enrollment = enrollmentOf(index, item)
  if (!enrollment) return { kind: 'unknown' }
  return enrollment.class.leadTeacher ? { kind: 'teacher', teacher: enrollment.class.leadTeacher } : { kind: 'none' }
}
