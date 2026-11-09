// Assignment actions menu and field locks of the assignment drawer (J-F38): a
// manual mirror of the backend state machine (backend/src/assignments/
// assignments.status.ts and the class rule of assignments.policy.ts) — keep
// the two in sync. The server stays the boundary (409 invalid_transition /
// assignment_locked / assignment_not_deletable / class_closed).
//
//   publish  draft  → open    (sets publishedAt; the class must be planned/open/running)
//   close    open   → closed  (sets closedAt; allowed whatever the class status)
//   reopen   closed → open    (clears closedAt; the class must be planned/open/running)
//   delete   a draft without any submission (API-107), also of a completed or cancelled class
//
// Editing: every field of a draft or open assignment of an open class; the
// grading rules (maxScore, maxAttempts, allowLate, latePenaltyPercent) are
// locked once a submission exists, and a closed assignment accepts nothing.
// `grading`/`graded` are in the enum but unused in the first version (D-R37):
// no action leaves them and nothing leads to them.
import { ASSIGNMENT_STATUS_ACTIONS } from '../api/assignments'
import type { Assignment, AssignmentStatus, AssignmentStatusAction } from '../api/assignments'
import type { ClassStatus } from '../api/classes'

export type AssignmentMenuAction = AssignmentStatusAction | 'delete'

const TRANSITIONS: Readonly<Record<AssignmentStatusAction, Partial<Readonly<Record<AssignmentStatus, AssignmentStatus>>>>> = {
  publish: { draft: 'open' },
  close: { open: 'closed' },
  reopen: { closed: 'open' },
}

/** An assignment is created, edited, published or reopened for a class in one of these states (§4g.8 (3)). */
export const ASSIGNMENT_OPEN_CLASS_STATUSES: readonly ClassStatus[] = ['planned', 'open', 'running']

export function isClassOpenForAssignments(status: ClassStatus): boolean {
  return ASSIGNMENT_OPEN_CLASS_STATUSES.includes(status)
}

/** The status the action leads to from `from`, or null when not allowed. */
export function nextAssignmentStatus(action: AssignmentStatusAction, from: AssignmentStatus): AssignmentStatus | null {
  return TRANSITIONS[action][from] ?? null
}

/** Actions allowed from a status, in catalogue order (the `allowed` detail of `invalid_transition`). */
export function allowedAssignmentActions(from: AssignmentStatus): AssignmentStatusAction[] {
  return ASSIGNMENT_STATUS_ACTIONS.filter((action) => TRANSITIONS[action][from] !== undefined)
}

/** `close` ends an assignment even in a completed or cancelled class; the other actions need an open class. */
export function actionNeedsOpenClass(action: AssignmentStatusAction): boolean {
  return action !== 'close'
}

/** Only a draft without any submission may be deleted. */
export function isAssignmentDeletable(status: AssignmentStatus, submissionCount: number): boolean {
  return status === 'draft' && submissionCount === 0
}

/** The grading rules a submitted student relies on — locked once a submission exists. */
export const ASSIGNMENT_GRADING_FIELDS = ['maxScore', 'maxAttempts', 'allowLate', 'latePenaltyPercent'] as const

/**
 * Which of the requested fields the assignment refuses: everything for a
 * closed assignment, the grading rules once a submission exists, nothing
 * otherwise (mirror of `lockedAssignmentFields()`).
 */
export function lockedAssignmentFields(status: AssignmentStatus, submissionCount: number, requested: readonly string[]): string[] {
  if (status === 'closed') return [...requested]
  if (submissionCount > 0) return requested.filter((field) => (ASSIGNMENT_GRADING_FIELDS as readonly string[]).includes(field))
  return []
}

/**
 * Whether a submission exists. The server counts submission rows; the DTO
 * counts the students holding at least one, which is non-zero exactly when a
 * row exists.
 */
export function hasSubmissions(assignment: Pick<Assignment, 'submissions'>): boolean {
  return assignment.submissions.students > 0
}

export interface AssignmentEditability {
  /** The edit form may open at all (needs `assignments.manage`, an open class and an assignment that is not closed). */
  editable: boolean
  /** maxScore, maxAttempts, allowLate and latePenaltyPercent are read-only (a submission exists). */
  gradingLocked: boolean
}

export function assignmentEditability(assignment: Pick<Assignment, 'status' | 'class' | 'submissions'>, canManage: boolean): AssignmentEditability {
  const gradingLocked = hasSubmissions(assignment)
  if (!canManage || !isClassOpenForAssignments(assignment.class.status) || assignment.status === 'closed') return { editable: false, gradingLocked }
  return { editable: true, gradingLocked }
}

/**
 * What the menu offers: nothing without `assignments.manage`; the status
 * actions the state machine allows (publish and reopen only for an open
 * class, close always); `delete` for a draft without submissions — a draft of
 * a completed or cancelled class included, so it never stays behind.
 */
export function availableAssignmentActions(assignment: Pick<Assignment, 'status' | 'class' | 'submissions'>, canManage: boolean): AssignmentMenuAction[] {
  if (!canManage) return []
  const classOpen = isClassOpenForAssignments(assignment.class.status)
  const actions: AssignmentMenuAction[] = allowedAssignmentActions(assignment.status).filter((action) => classOpen || !actionNeedsOpenClass(action))
  if (isAssignmentDeletable(assignment.status, assignment.submissions.students)) actions.push('delete')
  return actions
}

/** Actions shown in red and confirmed as dangerous: deleting cannot be undone (closing can — reopen). */
export function isDangerousAssignmentAction(action: AssignmentMenuAction): boolean {
  return action === 'delete'
}
