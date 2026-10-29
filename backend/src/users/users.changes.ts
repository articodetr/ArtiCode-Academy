// Planning of a PATCH /api/users/:id (MOD-03-T04) as a pure function, so the
// rules can be unit-tested without a database (users.changes.spec.ts). The
// request is compared with the current row: only fields whose value actually
// changes are written, an idempotent PATCH writes nothing and records no audit
// event, and the audit metadata carries the names of the changed fields —
// never their values. Changing the e-mail address drops `email_verified_at`
// (the new address is unproven until LR-01 confirms it — D-R08).
import type { Locale } from '../generated/prisma/client.js';
import { calendarDateToDate } from './users.validation.js';

/** The login identifiers; changing them is guarded by the no-exceeding rule (SEC-R-15). */
export const IDENTIFIER_FIELDS = ['email', 'username'] as const;

/** Scalar fields of `users` a PATCH may set. */
export interface UserScalarPatch {
  email?: string | null;
  username?: string | null;
  phone?: string | null;
  fullName?: string;
  fullNameLatin?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  locale?: Locale | null;
}

/** Fields of `student_profiles` a PATCH may set (dates as `YYYY-MM-DD`). */
export interface StudentProfilePatch {
  studentNumber?: string | null;
  dateOfBirth?: string | null;
  enrolledOn?: string | null;
  notes?: string | null;
}

/** Fields of `employee_profiles` a PATCH may set (`kind` and `isActive` belong to T06/T07). */
export interface EmployeeProfilePatch {
  employeeNumber?: string | null;
  jobTitle?: string | null;
  specialization?: string | null;
  hiredOn?: string | null;
}

export interface UserPatch extends UserScalarPatch {
  studentProfile?: StudentProfilePatch;
  employeeProfile?: EmployeeProfilePatch;
}

/** What the planner needs to know about the row as it is now. */
export interface CurrentUserRow {
  email: string | null;
  username: string | null;
  phone: string | null;
  fullName: string;
  fullNameLatin: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  locale: Locale | null;
  emailVerifiedAt: Date | null;
  studentProfile: { studentNumber: string | null; dateOfBirth: Date | null; enrolledOn: Date | null; notes: string | null } | null;
  employeeProfile: { employeeNumber: string | null; jobTitle: string | null; specialization: string | null; hiredOn: Date | null } | null;
}

/** Column values to write (Prisma update data); dates already converted. */
export type UserUpdateData = UserScalarPatch & { emailVerifiedAt?: null };
export interface StudentProfileUpdateData {
  studentNumber?: string | null;
  dateOfBirth?: Date | null;
  enrolledOn?: Date | null;
  notes?: string | null;
}
export interface EmployeeProfileUpdateData {
  employeeNumber?: string | null;
  jobTitle?: string | null;
  specialization?: string | null;
  hiredOn?: Date | null;
}

export type UserUpdatePlan =
  /** A profile object was sent for a profile the user does not have (422 profile_mismatch). */
  | { kind: 'profile_mismatch'; profile: 'student' | 'employee' }
  /** The change would leave the account with neither e-mail nor username (400 identifier_required). */
  | { kind: 'identifier_required' }
  | {
      kind: 'ok';
      user: UserUpdateData;
      studentProfile: StudentProfileUpdateData | null;
      employeeProfile: EmployeeProfileUpdateData | null;
      /** Names of the fields that change, in a fixed order (`studentProfile.notes`, `emailVerifiedAt`, …); empty = nothing to write. */
      fields: string[];
      /** True when `email` or `username` changes (SEC-R-15 applies). */
      identifierChanged: boolean;
    };

const USER_FIELDS = ['email', 'username', 'phone', 'fullName', 'fullNameLatin', 'displayName', 'avatarUrl', 'locale'] as const;
const STUDENT_FIELDS = ['studentNumber', 'dateOfBirth', 'enrolledOn', 'notes'] as const;
const STUDENT_DATE_FIELDS: ReadonlySet<string> = new Set(['dateOfBirth', 'enrolledOn']);
const EMPLOYEE_FIELDS = ['employeeNumber', 'jobTitle', 'specialization', 'hiredOn'] as const;
const EMPLOYEE_DATE_FIELDS: ReadonlySet<string> = new Set(['hiredOn']);

/** True when the body carries no field at all (nested objects count only by their own fields). */
export function isEmptyPatch(patch: UserPatch): boolean {
  const { studentProfile, employeeProfile, ...scalars } = patch;
  if (Object.values(scalars).some((value) => value !== undefined)) return false;
  if (studentProfile && Object.values(studentProfile).some((value) => value !== undefined)) return false;
  if (employeeProfile && Object.values(employeeProfile).some((value) => value !== undefined)) return false;
  return true;
}

/** `@db.Date` columns arrive as midnight UTC; only the calendar day is compared. */
function dayOf(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * Collects, for one row, the fields whose requested value differs from the
 * current one. Date fields are compared by calendar day and converted.
 */
function diffFields<K extends string>(
  keys: readonly K[],
  dateKeys: ReadonlySet<string>,
  current: Partial<Record<K, unknown>>,
  patch: Partial<Record<K, unknown>>,
  prefix: string,
  fields: string[],
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of keys) {
    const requested = patch[key];
    if (requested === undefined) continue;
    const isDate = dateKeys.has(key);
    const currentValue = isDate ? dayOf(current[key] as Date | null) : current[key];
    if (currentValue === requested) continue;
    data[key] = isDate && typeof requested === 'string' ? calendarDateToDate(requested) : requested;
    fields.push(`${prefix}${key}`);
  }
  return data;
}

/**
 * Decides what a PATCH writes. Validation (formats, lengths, normalisation of
 * identifiers) happened in the DTO; this function only compares and converts.
 */
export function planUserUpdate(current: CurrentUserRow, patch: UserPatch): UserUpdatePlan {
  if (patch.studentProfile && !current.studentProfile) return { kind: 'profile_mismatch', profile: 'student' };
  if (patch.employeeProfile && !current.employeeProfile) return { kind: 'profile_mismatch', profile: 'employee' };

  const email = patch.email === undefined ? current.email : patch.email;
  const username = patch.username === undefined ? current.username : patch.username;
  if (!email && !username) return { kind: 'identifier_required' };

  const fields: string[] = [];
  const user = diffFields(USER_FIELDS, new Set(), current, patch, '', fields) as UserUpdateData;
  if (user.email !== undefined && current.emailVerifiedAt !== null) {
    // The new address (or the absence of one) is unproven: verification restarts in LR-01.
    user.emailVerifiedAt = null;
    fields.push('emailVerifiedAt');
  }
  const studentProfile =
    patch.studentProfile && current.studentProfile
      ? (diffFields(STUDENT_FIELDS, STUDENT_DATE_FIELDS, current.studentProfile, patch.studentProfile, 'studentProfile.', fields) as StudentProfileUpdateData)
      : null;
  const employeeProfile =
    patch.employeeProfile && current.employeeProfile
      ? (diffFields(EMPLOYEE_FIELDS, EMPLOYEE_DATE_FIELDS, current.employeeProfile, patch.employeeProfile, 'employeeProfile.', fields) as EmployeeProfileUpdateData)
      : null;

  return {
    kind: 'ok',
    user,
    studentProfile: studentProfile && Object.keys(studentProfile).length > 0 ? studentProfile : null,
    employeeProfile: employeeProfile && Object.keys(employeeProfile).length > 0 ? employeeProfile : null,
    fields,
    identifierChanged: IDENTIFIER_FIELDS.some((key) => fields.includes(key)),
  };
}
