// Enrollment rules of MOD-05-T04 (D-R18: enrolled by staff straight to
// `active`, hard capacity, no waitlist) as pure functions, unit-tested in
// enrollments.status.spec.ts:
//
//   withdraw    active → withdrawn                 (withdrawn_at + withdrawal_reason)
//   complete    active → completed                 (completed_at)
//   cancel      active → cancelled
//   reactivate  withdrawn | cancelled → active     (needs an open/running class with a free seat)
//
// `completed` is final; `pending` is not used by version 1 (no waitlist), so
// no action applies to it. The class state machine (classes.status.ts) moves
// active enrollments to completed/cancelled on its own `complete`/`cancel`.
import type { ClassStatus, EnrollmentStatus, Prisma } from '../generated/prisma/client.js';

export const ENROLLMENT_STATUS_ACTIONS = ['withdraw', 'complete', 'cancel', 'reactivate'] as const;
export type EnrollmentStatusAction = (typeof ENROLLMENT_STATUS_ACTIONS)[number];

const TRANSITIONS: Readonly<Record<EnrollmentStatusAction, Partial<Readonly<Record<EnrollmentStatus, EnrollmentStatus>>>>> = {
  withdraw: { active: 'withdrawn' },
  complete: { active: 'completed' },
  cancel: { active: 'cancelled' },
  reactivate: { withdrawn: 'active', cancelled: 'active' },
};

/** Class states that accept new students and reactivations. */
const ENROLLABLE_CLASS_STATUSES: readonly ClassStatus[] = ['open', 'running'];

/** The status the action leads to from `from`, or null when not allowed. */
export function nextEnrollmentStatus(action: EnrollmentStatusAction, from: EnrollmentStatus): EnrollmentStatus | null {
  return TRANSITIONS[action][from] ?? null;
}

/** Actions allowed from a status, in catalogue order (the `allowed` detail of `invalid_transition`). */
export function allowedEnrollmentActions(from: EnrollmentStatus): EnrollmentStatusAction[] {
  return ENROLLMENT_STATUS_ACTIONS.filter((action) => TRANSITIONS[action][from] !== undefined);
}

/** True when the action takes a seat again, so the class state and capacity are checked under the class lock. */
export function takesSeat(action: EnrollmentStatusAction): boolean {
  return action === 'reactivate';
}

/** Students are enrolled (and reactivated) in an open or running class only. */
export function isEnrollableClass(status: ClassStatus): boolean {
  return ENROLLABLE_CLASS_STATUSES.includes(status);
}

/** Hard capacity (D-R18): a seat is free while the active enrollments stay below the capacity. */
export function hasFreeSeat(capacity: number, activeCount: number): boolean {
  return activeCount < capacity;
}

/**
 * The columns an allowed action writes besides `status`. `withdraw` stamps
 * `withdrawn_at` and keeps the reason in `withdrawal_reason`; `complete`
 * stamps `completed_at`; `reactivate` stamps `activated_at` and clears the
 * withdrawal and completion columns (the row describes the current
 * enrollment; its history is in the audit log).
 */
export function enrollmentWrite(
  action: EnrollmentStatusAction,
  to: EnrollmentStatus,
  now: Date,
  reason: string | null,
): Prisma.EnrollmentUncheckedUpdateManyInput {
  switch (action) {
    case 'withdraw':
      return { status: to, withdrawnAt: now, withdrawalReason: reason };
    case 'complete':
      return { status: to, completedAt: now };
    case 'cancel':
      return { status: to };
    case 'reactivate':
      return { status: to, activatedAt: now, withdrawnAt: null, withdrawalReason: null, completedAt: null };
  }
}

/**
 * Who may read a class roster (D-R16): holders of `enrollments.manage` for any
 * class, or a teacher assigned to the class (lead or assistant). Everyone else
 * gets 404 class_not_found, as for a class they cannot see.
 */
export function canReadRoster(managesEnrollments: boolean, assignedToClass: boolean): boolean {
  return managesEnrollments || assignedToClass;
}
