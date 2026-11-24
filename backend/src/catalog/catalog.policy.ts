// What the catalog tells a reader about a class (MOD-19 — roadmap §4p,
// D-R123/D-R124/D-R129) as pure rules, unit-tested in catalog.policy.spec.ts.
// The blocker order is the refusal order of API-221 (`POST
// /api/catalog/classes/:id/enroll`), so the screen never offers a button the
// server would refuse for another reason first.
import type { ClassStatus, EnrollmentStatus } from '../generated/prisma/client.js';
import { existingRowKind } from '../enrollments/enrollment-requests.policy.js';
import { hasFreeSeat, isEnrollableClass } from '../enrollments/enrollments.status.js';

export const SELF_ENROLL_PERMISSION = 'enrollments.self_enroll';
export const STUDENT_ROLE = 'student';

/**
 * `not_allowed` — the reader may not enroll themself (no `enrollments.self_enroll`
 * or no `student` role); `request_pending` / `already_enrolled` — the reader's own
 * row; `not_open` — the class is not open to self-service now (closed by the
 * office, planned, completed or cancelled); `class_full`; `price_unavailable` —
 * the course is paid and its plan cannot price a request.
 */
export const CATALOG_BLOCKERS = ['not_allowed', 'request_pending', 'already_enrolled', 'not_open', 'class_full', 'price_unavailable'] as const;
export type CatalogBlocker = (typeof CATALOG_BLOCKERS)[number];

export const SELF_SERVICE_REASONS = ['no_permission', 'not_a_student'] as const;
export type SelfServiceReason = (typeof SELF_SERVICE_REASONS)[number];

/** Whether the reader may enroll themself at all (D-R124): the key, then the role. */
export function selfServiceReason(caller: { permissions: readonly string[]; roles: readonly string[] }): SelfServiceReason | null {
  if (!caller.permissions.includes(SELF_ENROLL_PERMISSION)) return 'no_permission';
  if (!caller.roles.includes(STUDENT_ROLE)) return 'not_a_student';
  return null;
}

/**
 * `nextStartsOn` of the public catalog (PORTAL-01, #205 — agreed with the
 * frontend): the earliest start day, today or later in the academy's zone, of
 * the classes a visitor could enroll in now; null when none has one (no start
 * day set, or every such class has already started). All `YYYY-MM-DD`, so the
 * string order is the calendar order.
 */
export function nextStartsOn(startDays: readonly (string | null)[], today: string): string | null {
  let next: string | null = null;
  for (const day of startDays) if (day !== null && day >= today && (next === null || day < next)) next = day;
  return next;
}

/** A class open to self-service now: the office opened it, and it runs or takes students (D-R123). The course is published by the catalog's own filter. */
export function isSelfServiceOpen(klass: { selfEnrollment: boolean; status: ClassStatus }): boolean {
  return klass.selfEnrollment && isEnrollableClass(klass.status);
}

export interface ClassBlockerInput {
  selfService: boolean;
  mine: { status: EnrollmentStatus; activatedAt: Date | null } | null;
  selfEnrollment: boolean;
  status: ClassStatus;
  capacity: number;
  enrolledCount: number;
  coursePaid: boolean;
  priceUsable: boolean;
}

export function classBlocker(input: ClassBlockerInput): CatalogBlocker | null {
  if (!input.selfService) return 'not_allowed';
  const kind = existingRowKind(input.mine);
  if (kind === 'pending') return 'request_pending';
  if (kind === 'taken') return 'already_enrolled';
  if (!isSelfServiceOpen(input)) return 'not_open';
  if (!hasFreeSeat(input.capacity, input.enrolledCount)) return 'class_full';
  if (input.coursePaid && !input.priceUsable) return 'price_unavailable';
  return null;
}

/** The seats left, never negative (a capacity lowered below the active count is refused, but a race-free read is still safe). */
export function seatsLeft(capacity: number, enrolledCount: number): number {
  return Math.max(0, capacity - enrolledCount);
}
