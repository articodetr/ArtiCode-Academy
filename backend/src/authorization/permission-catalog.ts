// Permission catalog — the single source of truth for `permissions.key` (D8,
// ADR-023). The seed upserts every entry and marks keys that disappeared from
// this list as deprecated; it never deletes them while roles reference them.
//
// Key shape: `<area>.<action>` with the scope suffixes `read_own` (the user's
// own data), `read_linked` (a guardian's linked students) and `read_all`.
// No framework imports: the Prisma seed loads this file outside NestJS.

import type { LocalizedText } from './localized-text.js';

export interface PermissionDefinition {
  readonly key: string;
  /** Owning module identifier from the master documentation (section 08). */
  readonly module: string;
  readonly description: LocalizedText;
}

function p(key: string, module: string, ar: string, en: string): PermissionDefinition {
  return { key, module, description: { ar, en } };
}

export const PERMISSION_CATALOG: readonly PermissionDefinition[] = [
  // MOD-02 / MOD-14 — academy and settings
  p('academy.settings.read', 'MOD-14', 'عرض إعدادات الأكاديمية', 'View academy settings'),
  p('academy.settings.manage', 'MOD-14', 'تعديل إعدادات الأكاديمية', 'Manage academy settings'),
  p('branches.manage', 'MOD-02', 'إدارة الفروع', 'Manage branches'),

  // MOD-03 — users, roles, guardians
  p('users.read', 'MOD-03', 'عرض المستخدمين', 'View users'),
  p('users.create', 'MOD-03', 'إنشاء مستخدمين', 'Create users'),
  p('users.update', 'MOD-03', 'تعديل المستخدمين', 'Update users'),
  p('users.deactivate', 'MOD-03', 'تعطيل المستخدمين', 'Deactivate users'),
  p('users.roles.assign', 'MOD-03', 'تعيين الأدوار للمستخدمين', 'Assign roles to users'),
  p('roles.manage', 'MOD-03', 'إدارة الأدوار والصلاحيات', 'Manage roles and permissions'),
  p('guardians.link', 'MOD-03', 'ربط أولياء الأمور بالطلاب', 'Link guardians to students'),

  // MOD-04 / MOD-05 — courses, classes, enrollments
  p('courses.read', 'MOD-04', 'عرض الدورات', 'View courses'),
  p('courses.manage', 'MOD-04', 'إدارة الدورات', 'Manage courses'),
  p('classes.read', 'MOD-05', 'عرض الفصول', 'View classes'),
  p('classes.manage', 'MOD-05', 'إدارة الفصول', 'Manage classes'),
  p('classes.teachers.assign', 'MOD-05', 'تعيين معلمي الفصول', 'Assign class teachers'),
  p('enrollments.read', 'MOD-05', 'عرض التسجيلات', 'View enrollments'),
  p('enrollments.manage', 'MOD-05', 'إدارة التسجيلات', 'Manage enrollments'),
  p('enrollments.self_enroll', 'MOD-05', 'التسجيل الذاتي في الفصول', 'Self-enroll in classes'),

  // MOD-06 / MOD-07 — lessons, recordings, schedule, attendance
  p('schedule.read', 'MOD-07', 'عرض الجدول الزمني', 'View the schedule'),
  p('schedule.manage', 'MOD-07', 'إدارة الجدول الزمني', 'Manage the schedule'),
  p('lessons.read', 'MOD-06', 'عرض الدروس', 'View lessons'),
  p('lessons.manage', 'MOD-06', 'إدارة الدروس', 'Manage lessons'),
  p('recordings.manage', 'MOD-06', 'إدارة التسجيلات المرئية', 'Manage lesson recordings'),
  p('attendance.read', 'MOD-06', 'عرض الحضور', 'View attendance'),
  p('attendance.record', 'MOD-06', 'تسجيل الحضور', 'Record attendance'),

  // MOD-08 / MOD-09 — assignments, exams, questions, grades
  p('assignments.read', 'MOD-08', 'عرض الواجبات', 'View assignments'),
  p('assignments.manage', 'MOD-08', 'إدارة الواجبات', 'Manage assignments'),
  p('assignments.submit', 'MOD-08', 'تسليم الواجبات', 'Submit assignments'),
  p('assignments.grade', 'MOD-08', 'تصحيح الواجبات', 'Grade assignments'),
  p('exams.read', 'MOD-09', 'عرض الاختبارات', 'View exams'),
  p('exams.manage', 'MOD-09', 'إدارة الاختبارات', 'Manage exams'),
  p('exams.take', 'MOD-09', 'أداء الاختبارات', 'Take exams'),
  p('exams.grade', 'MOD-09', 'تصحيح الاختبارات', 'Grade exams'),
  p('questions.manage', 'MOD-09', 'إدارة بنوك الأسئلة', 'Manage question banks'),
  p('grades.read_own', 'MOD-09', 'عرض درجاتي', 'View own grades'),
  p('grades.read_linked', 'MOD-09', 'عرض درجات الطلاب المرتبطين', 'View linked students’ grades'),
  p('grades.read_all', 'MOD-09', 'عرض كل الدرجات', 'View all grades'),
  p('grades.manage', 'MOD-09', 'إدارة الدرجات', 'Manage grades'),

  // MOD-10 — certificates
  p('certificates.read_own', 'MOD-10', 'عرض شهاداتي', 'View own certificates'),
  p('certificates.read_linked', 'MOD-10', 'عرض شهادات الطلاب المرتبطين', 'View linked students’ certificates'),
  p('certificates.read_all', 'MOD-10', 'عرض كل الشهادات', 'View all certificates'),
  p('certificates.issue', 'MOD-10', 'إصدار الشهادات', 'Issue certificates'),
  p('certificates.revoke', 'MOD-10', 'إبطال الشهادات', 'Revoke certificates'),

  // MOD-11 — finance
  p('invoices.read_own', 'MOD-11', 'عرض فواتيري', 'View own invoices'),
  p('invoices.read_linked', 'MOD-11', 'عرض فواتير الطلاب المرتبطين', 'View linked students’ invoices'),
  p('invoices.read_all', 'MOD-11', 'عرض كل الفواتير', 'View all invoices'),
  p('invoices.manage', 'MOD-11', 'إدارة الفواتير', 'Manage invoices'),
  p('payments.record', 'MOD-11', 'تسجيل الدفعات', 'Record payments'),
  p('payments.refund', 'MOD-11', 'استرداد الدفعات', 'Refund payments'),
  p('fee_plans.manage', 'MOD-11', 'إدارة خطط الرسوم', 'Manage fee plans'),

  // MOD-12 — notifications
  p('notifications.send', 'MOD-12', 'إرسال الإشعارات', 'Send notifications'),
  p('notifications.templates.manage', 'MOD-12', 'إدارة قوالب الإشعارات', 'Manage notification templates'),

  // MOD-13 — reports
  p('reports.academic.view', 'MOD-13', 'عرض التقارير الأكاديمية', 'View academic reports'),
  p('reports.financial.view', 'MOD-13', 'عرض التقارير المالية', 'View financial reports'),
  p('reports.attendance.view', 'MOD-13', 'عرض تقارير الحضور', 'View attendance reports'),

  // Cross-cutting — audit log (12.2)
  p('audit.read', 'MOD-03', 'قراءة سجل التدقيق', 'Read the audit log'),
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]['key'];

/** All catalog keys in declaration order. */
export const PERMISSION_KEYS: readonly string[] = PERMISSION_CATALOG.map((item) => item.key);

const KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

export function isPermissionKey(value: string): value is PermissionKey {
  return KEY_SET.has(value);
}
