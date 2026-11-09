// Assignment state machine of MOD-08-T02 (D-R37: manual actions; `grading` and
// `graded` are in the enum but unused in the first version) as pure
// functions, unit-tested in assignments.status.spec.ts:
//
//   publish  draft  → open    (sets published_at; the class must be planned/open/running)
//   close    open   → closed  (sets closed_at; allowed whatever the class status)
//   reopen   closed → open    (clears closed_at; the class must be planned/open/running)
//
// Deleting is a separate rule (DELETE /api/assignments/:id): only a draft
// without any submission; every other assignment is closed. Editing: every
// field of a draft or open assignment; the grading rules (maxScore,
// maxAttempts, allowLate, latePenaltyPercent) are locked once a submission
// exists, and a closed assignment accepts nothing (roadmap §4g.4 API-105).
import type { AssignmentStatus } from '../generated/prisma/client.js';

export const ASSIGNMENT_STATUS_ACTIONS = ['publish', 'close', 'reopen'] as const;
export type AssignmentStatusAction = (typeof ASSIGNMENT_STATUS_ACTIONS)[number];

const TRANSITIONS: Readonly<Record<AssignmentStatusAction, Partial<Readonly<Record<AssignmentStatus, AssignmentStatus>>>>> = {
  publish: { draft: 'open' },
  close: { open: 'closed' },
  reopen: { closed: 'open' },
};

/** The status the action leads to from `from`, or null when not allowed. */
export function nextAssignmentStatus(action: AssignmentStatusAction, from: AssignmentStatus): AssignmentStatus | null {
  return TRANSITIONS[action][from] ?? null;
}

/** Actions allowed from a status, in catalogue order (the `allowed` detail of `invalid_transition`). */
export function allowedAssignmentActions(from: AssignmentStatus): AssignmentStatusAction[] {
  return ASSIGNMENT_STATUS_ACTIONS.filter((action) => TRANSITIONS[action][from] !== undefined);
}

/** `close` ends an assignment even in a completed or cancelled class; the other actions need an open class (§4g.8 (3)). */
export function actionNeedsOpenClass(action: AssignmentStatusAction): boolean {
  return action !== 'close';
}

/** Only a draft without any submission may be deleted. */
export function isAssignmentDeletable(status: AssignmentStatus, submissionCount: number): boolean {
  return status === 'draft' && submissionCount === 0;
}

/** The grading rules a submitted student relies on — locked once a submission exists. */
export const ASSIGNMENT_GRADING_FIELDS = ['maxScore', 'maxAttempts', 'allowLate', 'latePenaltyPercent'] as const;
export type AssignmentGradingField = (typeof ASSIGNMENT_GRADING_FIELDS)[number];

/**
 * Which of the requested fields the assignment refuses: everything for a
 * closed assignment, the grading rules once a submission exists, nothing
 * otherwise.
 */
export function lockedAssignmentFields(status: AssignmentStatus, submissionCount: number, requested: readonly string[]): string[] {
  if (status === 'closed') return [...requested];
  if (submissionCount > 0) return requested.filter((field) => (ASSIGNMENT_GRADING_FIELDS as readonly string[]).includes(field));
  return [];
}
