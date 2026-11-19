// Enrollment rules of MOD-05-T04 (D-R18: enrolled by staff straight to
// `active`, hard capacity, no waitlist) as pure functions, unit-tested in
// enrollments.status.spec.ts:
//
//   withdraw    active → withdrawn                 (withdrawn_at + withdrawal_reason)
//   complete    active → completed                 (completed_at)
//   cancel      active → cancelled
//   reactivate  withdrawn | cancelled → active     (needs an eligible student and an open/running class with a free seat)
//   approve     pending → active                   (MOD-19, D-R125: the reactivate checks + every issued invoice paid)
//   reject      pending → cancelled                (MOD-19, D-R126: rejected_at/by + a required reason)
//
// `completed` is final. `pending` is an enrollment REQUEST since MOD-19
// (D-R121; it was unused before — no waitlist): only approve and reject apply
// to it, and the student's own cancel goes through API-223. The class state
// machine (classes.status.ts) moves active enrollments to completed/cancelled
// on its own `complete`/`cancel`; pending requests stay for the office.
import type { ClassStatus, EnrollmentStatus, Prisma } from '../generated/prisma/client.js';

export const ENROLLMENT_STATUS_ACTIONS = ['withdraw', 'complete', 'cancel', 'reactivate', 'approve', 'reject'] as const;
export type EnrollmentStatusAction = (typeof ENROLLMENT_STATUS_ACTIONS)[number];

const TRANSITIONS: Readonly<Record<EnrollmentStatusAction, Partial<Readonly<Record<EnrollmentStatus, EnrollmentStatus>>>>> = {
  withdraw: { active: 'withdrawn' },
  complete: { active: 'completed' },
  cancel: { active: 'cancelled' },
  reactivate: { withdrawn: 'active', cancelled: 'active' },
  approve: { pending: 'active' },
  reject: { pending: 'cancelled' },
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

/** True when the action takes a seat (again), so the student, the class state and the capacity are checked under the class lock, as for a new enrollment. */
export function takesSeat(action: EnrollmentStatusAction): boolean {
  return action === 'reactivate' || action === 'approve';
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
 * enrollment; its history is in the audit log) — and the rejection columns of
 * a closed request it reopens. `approve` writes what `reactivate` writes;
 * `reject` stamps `rejected_at`/`rejected_by` and keeps the reason in
 * `rejection_reason` (D-R126).
 */
export function enrollmentWrite(
  action: EnrollmentStatusAction,
  to: EnrollmentStatus,
  now: Date,
  reason: string | null,
  actorId: string | null = null,
): Prisma.EnrollmentUncheckedUpdateManyInput {
  switch (action) {
    case 'withdraw':
      return { status: to, withdrawnAt: now, withdrawalReason: reason };
    case 'complete':
      return { status: to, completedAt: now };
    case 'cancel':
      return { status: to };
    case 'reactivate':
    case 'approve':
      return {
        status: to,
        activatedAt: now,
        withdrawnAt: null,
        withdrawalReason: null,
        completedAt: null,
        rejectedAt: null,
        rejectedById: null,
        rejectionReason: null,
      };
    case 'reject':
      return { status: to, rejectedAt: now, rejectedById: actorId, rejectionReason: reason };
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
