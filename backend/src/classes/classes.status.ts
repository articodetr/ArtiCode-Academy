// Class state machine of MOD-05-T02 (D-R17: manual actions only, the dates
// are for display) as pure functions, unit-tested in classes.status.spec.ts:
//
//   open      planned → open
//   start     open → running
//   complete  running → completed            (active enrollments → completed)
//   cancel    planned | open | running → cancelled   (active enrollments → cancelled)
//   restore   cancelled → planned            (enrollments stay as they are)
//
// Deleting is a separate rule (DELETE /api/classes/:id): only a planned class
// without any enrollment; every other class is cancelled instead.
import type { ClassStatus, EnrollmentStatus } from '../generated/prisma/client.js';

export const CLASS_STATUS_ACTIONS = ['open', 'start', 'complete', 'cancel', 'restore'] as const;
export type ClassStatusAction = (typeof CLASS_STATUS_ACTIONS)[number];

const TRANSITIONS: Readonly<Record<ClassStatusAction, Partial<Readonly<Record<ClassStatus, ClassStatus>>>>> = {
  open: { planned: 'open' },
  start: { open: 'running' },
  complete: { running: 'completed' },
  cancel: { planned: 'cancelled', open: 'cancelled', running: 'cancelled' },
  restore: { cancelled: 'planned' },
};

/** What the action does to the class's `active` enrollments, in the same transaction. */
const ENROLLMENT_EFFECT: Partial<Readonly<Record<ClassStatusAction, EnrollmentStatus>>> = {
  complete: 'completed',
  cancel: 'cancelled',
};

/** The status the action leads to from `from`, or null when not allowed. */
export function nextClassStatus(action: ClassStatusAction, from: ClassStatus): ClassStatus | null {
  return TRANSITIONS[action][from] ?? null;
}

/** Actions allowed from a status, in catalogue order (the `allowed` detail of `invalid_transition`). */
export function allowedClassActions(from: ClassStatus): ClassStatusAction[] {
  return CLASS_STATUS_ACTIONS.filter((action) => TRANSITIONS[action][from] !== undefined);
}

/** The status the class's active enrollments move to, or null when the action leaves them alone. */
export function enrollmentStatusAfter(action: ClassStatusAction): EnrollmentStatus | null {
  return ENROLLMENT_EFFECT[action] ?? null;
}

/**
 * MOD-07-T03 (§4e.8 (3)): a completed or cancelled class must stop booking its
 * rooms and teachers, so the same two actions close the class's open-ended
 * weekly slots (`effective_to` = today in the academy's time zone) in the same
 * transaction. `restore` does not reopen them.
 */
export function closesOpenSlots(action: ClassStatusAction): boolean {
  return action === 'complete' || action === 'cancel';
}

/** Only a planned class without any enrollment (whatever its status) may be deleted. */
export function isClassDeletable(status: ClassStatus, enrollmentCount: number): boolean {
  return status === 'planned' && enrollmentCount === 0;
}
