// The student as every class roster shows them (D-R07) — one helper for the
// class roster (enrollments.service.ts, API-057), the attendance sheet
// (lessons/attendance.service.ts, API-099), the submission roster
// (assignments/submissions.service.ts, API-108) and the exam results sheet
// (exams/exam-results.service.ts, API-119); the three former copies were moved
// here before the fourth one (roadmap §4h.8 (3)). Identity only, contact
// fields nulled in the reduced projection (no `users.read_contact`). Never the
// password hash, the login counters or the security timestamps.
import type { AuthPrincipal } from '../auth/principal.js';
import type { Prisma } from '../generated/prisma/client.js';
import { READ_CONTACT_PERMISSION } from '../users/users.policy.js';
import type { UsersProjection } from '../users/users.service.js';
import type { EnrollmentStudentDto } from './enrollments.dto.js';

export const ROSTER_STUDENT_SELECT = {
  id: true,
  fullName: true,
  fullNameLatin: true,
  displayName: true,
  avatarUrl: true,
  status: true,
  email: true,
  username: true,
  phone: true,
  deletedAt: true,
} satisfies Prisma.UserSelect;

export type RosterStudentRow = Prisma.UserGetPayload<{ select: typeof ROSTER_STUDENT_SELECT }>;

/** `full` with `users.read_contact`, else the reduced projection (D-R07). */
export function rosterProjectionOf(caller: Pick<AuthPrincipal, 'permissions'>): UsersProjection {
  return caller.permissions.includes(READ_CONTACT_PERMISSION) ? 'full' : 'reduced';
}

export function toRosterStudentDto(row: RosterStudentRow, view: UsersProjection): EnrollmentStudentDto {
  const full = view === 'full';
  return {
    id: row.id,
    fullName: row.fullName,
    fullNameLatin: row.fullNameLatin,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    status: row.status,
    email: full ? row.email : null,
    username: full ? row.username : null,
    phone: full ? row.phone : null,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}
