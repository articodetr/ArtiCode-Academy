// Fixtures of the profile page (J-F36): permission sets as the session user
// carries them (API-005..010 `permissions`).

/**
 * The 57 keys of backend/src/authorization/permission-catalog.ts in declaration
 * order — what a seeded `academy_admin` holds (a manual mirror, keep in sync).
 */
export const CATALOG_PERMISSION_KEYS: readonly string[] = [
  'academy.settings.read',
  'academy.settings.manage',
  'branches.manage',
  'users.read',
  'users.read_contact',
  'users.create',
  'users.update',
  'users.deactivate',
  'users.roles.assign',
  'roles.manage',
  'guardians.link',
  'courses.read',
  'courses.manage',
  'classes.read',
  'classes.manage',
  'classes.teachers.assign',
  'enrollments.read',
  'enrollments.manage',
  'enrollments.self_enroll',
  'schedule.read',
  'schedule.manage',
  'lessons.read',
  'lessons.manage',
  'recordings.manage',
  'attendance.read',
  'attendance.record',
  'assignments.read',
  'assignments.manage',
  'assignments.submit',
  'assignments.grade',
  'exams.read',
  'exams.manage',
  'exams.take',
  'exams.grade',
  'questions.manage',
  'grades.read_own',
  'grades.read_linked',
  'grades.read_all',
  'grades.manage',
  'certificates.read_own',
  'certificates.read_linked',
  'certificates.read_all',
  'certificates.issue',
  'certificates.revoke',
  'invoices.read_own',
  'invoices.read_linked',
  'invoices.read_all',
  'invoices.manage',
  'payments.record',
  'payments.refund',
  'fee_plans.manage',
  'notifications.send',
  'notifications.templates.manage',
  'reports.academic.view',
  'reports.financial.view',
  'reports.attendance.view',
  'audit.read',
]

/** The session sorts the keys (backend/src/auth/auth.service.ts toPrincipal). */
export const ADMIN_SESSION_PERMISSIONS: string[] = [...CATALOG_PERMISSION_KEYS].sort()

/** The seeded `student` role's keys (backend/src/authorization/system-roles.ts), as the session sorts them. */
export const STUDENT_SESSION_PERMISSIONS: string[] = [
  'assignments.read',
  'assignments.submit',
  'certificates.read_own',
  'courses.read',
  'exams.read',
  'exams.take',
  'grades.read_own',
  'invoices.read_own',
  'lessons.read',
  'schedule.read',
]
