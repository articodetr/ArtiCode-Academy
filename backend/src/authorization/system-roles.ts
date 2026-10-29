// System roles (ROLE-02..ROLE-06) seeded into `roles` with `is_system = true`,
// and the default permission matrix of docs section 6.7.8 (ADR-023).
//
// Seeding rules: `academy_admin` always holds every active catalog key; the
// other system roles receive their defaults only when first created, so an
// academy admin's later edits are never overwritten. Custom roles (ROLE-07)
// are not touched by the seed.

import type { LocalizedText } from './localized-text.js';
import { PERMISSION_KEYS } from './permission-catalog.js';

export interface SystemRoleDefinition {
  readonly key: string;
  readonly label: LocalizedText;
  readonly description: LocalizedText;
  /** Granted automatically on self-registration (usually the student role). */
  readonly isDefaultForSignup: boolean;
  /** Default permission keys; `academy_admin` uses the whole catalog. */
  readonly permissions: readonly string[];
}

export const ACADEMY_ADMIN_ROLE_KEY = 'academy_admin';

export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    key: ACADEMY_ADMIN_ROLE_KEY,
    label: { ar: 'مدير الأكاديمية', en: 'Academy Admin' },
    description: {
      ar: 'يملك كل الصلاحيات داخل هذه الأكاديمية',
      en: 'Holds every permission inside this academy',
    },
    isDefaultForSignup: false,
    permissions: PERMISSION_KEYS,
  },
  {
    key: 'teacher',
    label: { ar: 'معلم', en: 'Teacher' },
    description: {
      ar: 'يدير فصوله ودروسه وواجباته واختباراته ودرجاته',
      en: 'Manages own classes, lessons, assignments, exams and grades',
    },
    isDefaultForSignup: false,
    permissions: [
      'users.read',
      'courses.read',
      'classes.read',
      'enrollments.read',
      'schedule.read',
      'lessons.read',
      'lessons.manage',
      'attendance.read',
      'attendance.record',
      'recordings.manage',
      'assignments.read',
      'assignments.manage',
      'assignments.grade',
      'exams.read',
      'exams.manage',
      'exams.grade',
      'questions.manage',
      'grades.read_all',
      'grades.manage',
      'notifications.send',
    ],
  },
  {
    key: 'student',
    label: { ar: 'طالب', en: 'Student' },
    description: {
      ar: 'يتابع دروسه ويسلّم واجباته ويؤدي اختباراته ويطّلع على درجاته وشهاداته',
      en: 'Follows lessons, submits assignments, takes exams, views own grades and certificates',
    },
    isDefaultForSignup: true,
    permissions: [
      'courses.read',
      'schedule.read',
      'lessons.read',
      'assignments.read',
      'assignments.submit',
      'exams.read',
      'exams.take',
      'grades.read_own',
      'certificates.read_own',
      'invoices.read_own',
    ],
  },
  {
    key: 'guardian',
    label: { ar: 'ولي أمر', en: 'Guardian' },
    description: {
      ar: 'يتابع الطلاب المرتبطين به: الحضور والدرجات والشهادات والفواتير',
      en: 'Follows linked students: attendance, grades, certificates and invoices',
    },
    isDefaultForSignup: false,
    permissions: [
      'courses.read',
      'schedule.read',
      'attendance.read',
      'assignments.read',
      'exams.read',
      'grades.read_linked',
      'certificates.read_linked',
      'invoices.read_linked',
    ],
  },
  {
    key: 'staff',
    label: { ar: 'موظف', en: 'Staff' },
    description: {
      ar: 'مهام إدارية: التسجيل والتحصيل وإصدار الشهادات والتقارير',
      en: 'Administrative tasks: registration, collection, certificate issuing and reports',
    },
    isDefaultForSignup: false,
    permissions: [
      'users.read',
      'users.read_contact',
      'users.create',
      'users.update',
      'guardians.link',
      'courses.read',
      'classes.read',
      'classes.manage',
      'enrollments.read',
      'enrollments.manage',
      'schedule.read',
      'lessons.read',
      'attendance.read',
      'certificates.issue',
      'invoices.manage',
      'payments.record',
      'fee_plans.manage',
      'reports.financial.view',
      'reports.attendance.view',
    ],
  },
] as const;

export const SYSTEM_ROLE_KEYS: readonly string[] = SYSTEM_ROLES.map((role) => role.key);

/**
 * System roles that double as the `kind` of a created user (MOD-03-T02): the
 * kind names the default role and the profile table (student_profiles for
 * `student`, employee_profiles for `teacher`/`staff`, none for `guardian`).
 */
export const KIND_ROLE_KEYS = ['student', 'teacher', 'staff', 'guardian'] as const;
export type KindRoleKey = (typeof KIND_ROLE_KEYS)[number];

/**
 * Learner self-service permissions: the seeded defaults of `student` and
 * `guardian`. Conferring them never elevates the grantor, so the escalation
 * guard of user creation (users.policy.ts) exempts exactly these keys.
 */
export const LEARNER_BASELINE_PERMISSIONS: ReadonlySet<string> = new Set(
  SYSTEM_ROLES.filter((role) => role.key === 'student' || role.key === 'guardian').flatMap((role) => [
    ...role.permissions,
  ]),
);
