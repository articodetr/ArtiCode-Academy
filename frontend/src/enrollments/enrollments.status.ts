// Enrollment rules of the roster tab (J-F04), pure: a manual mirror of the
// backend state machine (backend/src/enrollments/enrollments.status.ts) — keep
// the two in sync — plus what the tab decides locally before any request. The
// server stays the boundary (409 invalid_transition / class_full /
// class_not_enrollable / already_enrolled, 422 not_a_student / user_not_eligible).
//
//   withdraw    active → withdrawn                 (withdrawnAt + withdrawalReason)
//   complete    active → completed                 (completedAt)
//   cancel      active → cancelled
//   reactivate  withdrawn | cancelled → active     (open/running class with a free seat, eligible student)
//
// `completed` is final; `pending` is not written by version 1 (no waitlist).
import type { AcademyClass, ClassStatus } from '../api/classes'
import type { Enrollment, EnrollmentStatus, EnrollmentStatusAction } from '../api/enrollments'
import { ENROLLMENT_STATUS_ACTIONS } from '../api/enrollments'
import type { UserListItem } from '../api/users'

const TRANSITIONS: Readonly<Record<EnrollmentStatusAction, Partial<Readonly<Record<EnrollmentStatus, EnrollmentStatus>>>>> = {
  withdraw: { active: 'withdrawn' },
  complete: { active: 'completed' },
  cancel: { active: 'cancelled' },
  reactivate: { withdrawn: 'active', cancelled: 'active' },
}

/** Class states that accept new students and reactivations. */
const ENROLLABLE_CLASS_STATUSES: readonly ClassStatus[] = ['open', 'running']

/** The role an enrolled student must hold, and the account states that may be enrolled. */
const STUDENT_ROLE_KEY = 'student'
const ELIGIBLE_STATUSES: readonly string[] = ['invited', 'active']

/** Upper bound of the optional reason (ENROLLMENT_REASON_MAX_LENGTH). */
export const ENROLLMENT_REASON_MAX_LENGTH = 500

export function nextEnrollmentStatus(action: EnrollmentStatusAction, from: EnrollmentStatus): EnrollmentStatus | null {
  return TRANSITIONS[action][from] ?? null
}

/** What the row menu offers: nothing without `enrollments.manage`; else the actions allowed from the status, in catalogue order. */
export function availableEnrollmentActions(status: EnrollmentStatus, canManage: boolean): EnrollmentStatusAction[] {
  if (!canManage) return []
  return ENROLLMENT_STATUS_ACTIONS.filter((action) => TRANSITIONS[action][status] !== undefined)
}

/** Actions shown in red and confirmed as dangerous. */
export function isDangerousEnrollmentAction(action: EnrollmentStatusAction): boolean {
  return action === 'withdraw' || action === 'cancel'
}

/** True when the action takes a seat again, so the tab warns about a full class before the server does. */
export function takesSeat(action: EnrollmentStatusAction): boolean {
  return action === 'reactivate'
}

/** Students are enrolled (and reactivated) in an open or running class only. */
export function isEnrollableClass(status: ClassStatus): boolean {
  return ENROLLABLE_CLASS_STATUSES.includes(status)
}

/** Hard capacity (D-R18): a seat is free while the active enrollments stay below the capacity. */
export function hasFreeSeat(capacity: number, activeCount: number): boolean {
  return activeCount < capacity
}

/**
 * How a change moves the class's `enrolledCount` (active enrollments): +1 when
 * an enrollment becomes active, −1 when it stops being active, 0 otherwise. A
 * new enrollment has no `from`.
 */
export function enrolledCountDelta(from: EnrollmentStatus | null, to: EnrollmentStatus): -1 | 0 | 1 {
  const wasActive = from === 'active'
  const isActive = to === 'active'
  if (wasActive === isActive) return 0
  return isActive ? 1 : -1
}

export type StudentRefusal = 'already_enrolled' | 'not_a_student' | 'not_eligible'

/**
 * Why a search result cannot be enrolled (shown disabled, never sent); null
 * when it can. `roster` is what the tab has loaded — a student on another page
 * is refused by the server (`already_enrolled`).
 */
export function studentRefusal(
  candidate: Pick<UserListItem, 'id' | 'roles' | 'status' | 'deletedAt'>,
  roster: readonly Pick<Enrollment, 'student'>[],
): StudentRefusal | null {
  if (roster.some((row) => row.student.id === candidate.id)) return 'already_enrolled'
  if (!candidate.roles.includes(STUDENT_ROLE_KEY)) return 'not_a_student'
  if (candidate.deletedAt !== null || !ELIGIBLE_STATUSES.includes(candidate.status)) return 'not_eligible'
  return null
}

/** Case-insensitive match of the local roster search against the names and identifiers the caller can see. */
export function matchesRosterSearch(row: Pick<Enrollment, 'student'>, text: string): boolean {
  const needle = text.trim().toLowerCase()
  if (!needle) return true
  const { fullName, fullNameLatin, displayName, email, username } = row.student
  return [fullName, fullNameLatin, displayName, email, username].some((value) => value !== null && value.toLowerCase().includes(needle))
}

/**
 * Mirror of the server's roster rule (D-R16, `canReadRoster()` in
 * backend/src/enrollments/enrollments.status.ts behind `enrollments.read`): a
 * holder of `enrollments.manage` reads any roster, an assigned teacher their
 * own class's. Decides only whether the drawer shows the students tab; the
 * server stays the boundary (404 class_not_found).
 */
export function canReadRoster(hasPermission: (key: string) => boolean, cls: Pick<AcademyClass, 'teachers'>, userId: string | undefined): boolean {
  if (!hasPermission('enrollments.read')) return false
  return hasPermission('enrollments.manage') || cls.teachers.some((teacher) => teacher.userId === userId)
}
