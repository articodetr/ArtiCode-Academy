// Fixtures for the roles screen (MOD-03-T13): API shapes of API-022/API-023
// as the backend returns them, plus the permission sets the tests switch between.
import type { PermissionCatalog, PermissionGroup, Role } from '../api/roles'

/** A small active catalog: three modules, eight keys, in declaration order. */
export const CATALOG_GROUPS: PermissionGroup[] = [
  {
    module: 'MOD-03',
    permissions: [
      { key: 'users.read', description: { ar: 'عرض المستخدمين', en: 'View users' } },
      { key: 'users.read_contact', description: { ar: 'عرض بيانات الاتصال', en: 'View contact details' } },
      { key: 'roles.manage', description: { ar: 'إدارة الأدوار والصلاحيات', en: 'Manage roles and permissions' } },
    ],
  },
  {
    module: 'MOD-04',
    permissions: [
      { key: 'courses.read', description: { ar: 'عرض الدورات', en: 'View courses' } },
      { key: 'courses.manage', description: { ar: 'إدارة الدورات', en: 'Manage courses' } },
    ],
  },
  {
    module: 'MOD-09',
    permissions: [
      { key: 'exams.read', description: { ar: 'عرض الاختبارات', en: 'View exams' } },
      { key: 'exams.take', description: { ar: 'أداء الاختبارات', en: 'Take exams' } },
      { key: 'grades.read_own', description: null },
    ],
  },
]

export const CATALOG_KEYS = CATALOG_GROUPS.flatMap((group) => group.permissions.map((permission) => permission.key))

export function makeCatalog(groups: PermissionGroup[] = CATALOG_GROUPS): PermissionCatalog {
  return { groups, total: groups.reduce((sum, group) => sum + group.permissions.length, 0) }
}

/** Everything the fixture catalog holds — what an academy admin carries. */
export const ROLES_ADMIN_PERMISSIONS = [...CATALOG_KEYS]

/** A manager of roles who lacks `courses.manage` and `users.read_contact`. */
export const LIMITED_MANAGER_PERMISSIONS = ['users.read', 'roles.manage', 'courses.read', 'exams.read', 'exams.take', 'grades.read_own']

export function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: '0192f0b0-0000-7000-8000-000000000101',
    key: 'librarian',
    label: { ar: 'أمين المكتبة', en: 'Librarian' },
    description: { ar: 'يدير المكتبة', en: 'Runs the library' },
    isSystem: false,
    isDefaultForSignup: false,
    userCount: 0,
    permissions: ['courses.read'],
    createdAt: '2026-10-30T09:00:00.000Z',
    updatedAt: '2026-10-30T09:00:00.000Z',
    ...overrides,
  }
}

export const ADMIN_ROLE = makeRole({
  id: '0192f0b0-0000-7000-8000-000000000001',
  key: 'academy_admin',
  label: { ar: 'مدير الأكاديمية', en: 'Academy Admin' },
  description: { ar: 'يملك كل الصلاحيات داخل هذه الأكاديمية', en: 'Holds every permission inside this academy' },
  isSystem: true,
  userCount: 1,
  permissions: [...CATALOG_KEYS].sort(),
})

export const TEACHER_ROLE = makeRole({
  id: '0192f0b0-0000-7000-8000-000000000002',
  key: 'teacher',
  label: { ar: 'معلم', en: 'Teacher' },
  description: { ar: 'يدير فصوله ودروسه', en: 'Manages own classes and lessons' },
  isSystem: true,
  userCount: 3,
  permissions: ['courses.read', 'exams.read', 'users.read'],
})

/** Custom, unassigned: fully editable and deletable. */
export const LIBRARIAN_ROLE = makeRole()

/** Custom, granted to two users: editable, not deletable. */
export const REGISTRAR_ROLE = makeRole({
  id: '0192f0b0-0000-7000-8000-000000000102',
  key: 'registrar',
  label: { ar: 'مسجّل', en: 'Registrar' },
  description: null,
  userCount: 2,
  permissions: ['courses.manage', 'courses.read', 'users.read'],
})

export const ALL_ROLES: Role[] = [ADMIN_ROLE, TEACHER_ROLE, LIBRARIAN_ROLE, REGISTRAR_ROLE]
