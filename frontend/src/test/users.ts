// Fixtures for the users screens (MOD-03-T11, extended in T14): API shapes of
// API-012/API-013/API-022/API-029 as the backend returns them, plus the
// permission sets the tests switch between.
import type { GuardianLinkItem } from '../api/guardians'
import type { Role } from '../api/roles'
import type { UserDetail, UserList, UserListItem } from '../api/users'
import { makeRole } from './roles'

/** Everything an academy admin holds that the users screens look at. */
export const ADMIN_PERMISSIONS = [
  'users.read',
  'users.read_contact',
  'users.create',
  'users.update',
  'users.deactivate',
  'users.roles.assign',
  'guardians.link',
  'roles.manage',
]

/** A teacher-like viewer: the list without contact details, no write actions. */
export const READ_ONLY_PERMISSIONS = ['users.read']

/** Assigns roles but holds neither `users.create`/`users.update` nor `roles.manage`: cannot reach `academy_admin` or `staff` (SEC-R-16). */
export const LIMITED_ASSIGNER_PERMISSIONS = ['users.read', 'users.read_contact', 'users.roles.assign']

/** Support staff: `users.update` without `users.deactivate` — `unlock` is the only account action. */
export const SUPPORT_PERMISSIONS = ['users.read', 'users.read_contact', 'users.update']

export function makeListItem(overrides: Partial<UserListItem> = {}): UserListItem {
  return {
    id: '0192f0a0-0000-7000-8000-000000000001',
    email: 'sara@test.local',
    username: 'sara.ahmed',
    phone: '+905551234567',
    fullName: 'سارة أحمد',
    fullNameLatin: 'Sara Ahmed',
    displayName: null,
    avatarUrl: null,
    locale: 'ar',
    status: 'active',
    emailVerifiedAt: null,
    lastLoginAt: '2026-10-29T08:00:00.000Z',
    lockedUntil: null,
    createdAt: '2026-10-28T10:30:00.000Z',
    updatedAt: '2026-10-29T08:00:00.000Z',
    deletedAt: null,
    roles: ['teacher'],
    ...overrides,
  }
}

export function makeUserList(items: UserListItem[], nextCursor: string | null = null): UserList {
  return { items, nextCursor }
}

/** A student with one primary guardian, as GET /api/users/:id returns it (full projection). */
export function makeUserDetail(overrides: Partial<UserDetail> = {}): UserDetail {
  return {
    id: '0192f0a0-0000-7000-8000-000000000002',
    email: 'omar@test.local',
    username: 'omar',
    phone: null,
    fullName: 'عمر خالد',
    fullNameLatin: 'Omar Khaled',
    displayName: null,
    avatarUrl: null,
    locale: null,
    status: 'invited',
    emailVerifiedAt: null,
    lastLoginAt: null,
    lockedUntil: null,
    createdAt: '2026-10-30T09:00:00.000Z',
    updatedAt: '2026-10-30T09:00:00.000Z',
    deletedAt: null,
    roles: [{ key: 'student', label: { ar: 'طالب', en: 'Student' } }],
    studentProfile: { studentNumber: 'S-2026-001', dateOfBirth: '2012-05-01', enrolledOn: '2026-09-01' },
    employeeProfile: null,
    guardians: [
      { userId: '0192f0a0-0000-7000-8000-000000000003', fullName: 'خالد محمود', displayName: null, relationship: 'father', isPrimary: true },
    ],
    students: [],
    ...overrides,
  }
}

/** The reduced projection of the same detail (caller without `users.read_contact`, D-R07). */
export function reduced<T extends UserListItem | UserDetail>(user: T): T {
  return { ...user, email: null, username: null, phone: null, emailVerifiedAt: null, lastLoginAt: null, lockedUntil: null }
}

// ---------------------------------------------------------------------------
// MOD-03-T14 — roles of GET /api/roles and links of GET /api/users/:id/guardians|students
// ---------------------------------------------------------------------------

/** Role labels as the seed stores them (backend/src/authorization/system-roles.ts). */
export const ROLE_LABELS = {
  academy_admin: { ar: 'مدير الأكاديمية', en: 'Academy Admin' },
  staff: { ar: 'موظف', en: 'Staff' },
  teacher: { ar: 'معلم', en: 'Teacher' },
  guardian: { ar: 'ولي أمر', en: 'Guardian' },
  student: { ar: 'طالب', en: 'Student' },
  librarian: { ar: 'أمين المكتبة', en: 'Librarian' },
} as const

/**
 * The roles the tab offers, system roles first as API-022 orders them. The
 * permission sets are small but keep the reach relations of the seed: the
 * admin role needs everything in ADMIN_PERMISSIONS, `staff` needs the user
 * write keys, `teacher` only `users.read`, learners only baseline keys.
 */
export const ROLE_OPTIONS: Role[] = [
  makeRole({ id: '0192f0b0-0000-7000-8000-000000000001', key: 'academy_admin', label: ROLE_LABELS.academy_admin, isSystem: true, userCount: 1, permissions: [...ADMIN_PERMISSIONS].sort() }),
  makeRole({ id: '0192f0b0-0000-7000-8000-000000000005', key: 'staff', label: ROLE_LABELS.staff, isSystem: true, userCount: 2, permissions: ['guardians.link', 'users.create', 'users.read', 'users.read_contact', 'users.update'] }),
  makeRole({ id: '0192f0b0-0000-7000-8000-000000000002', key: 'teacher', label: ROLE_LABELS.teacher, isSystem: true, userCount: 3, permissions: ['courses.read', 'users.read'] }),
  makeRole({ id: '0192f0b0-0000-7000-8000-000000000004', key: 'guardian', label: ROLE_LABELS.guardian, isSystem: true, userCount: 4, permissions: ['attendance.read', 'courses.read'] }),
  makeRole({ id: '0192f0b0-0000-7000-8000-000000000003', key: 'student', label: ROLE_LABELS.student, isSystem: true, isDefaultForSignup: true, userCount: 12, permissions: ['courses.read', 'exams.take'] }),
  makeRole({ id: '0192f0b0-0000-7000-8000-000000000101', key: 'librarian', label: ROLE_LABELS.librarian, permissions: ['courses.read'] }),
]

export function makeRoleList(items: Role[] = ROLE_OPTIONS) {
  return { items }
}

/** The guardian of the fixture student, as GET /api/users/:studentId/guardians lists him (full projection). */
export function makeGuardianLinkItem(overrides: Partial<GuardianLinkItem> = {}): GuardianLinkItem {
  return {
    user: makeListItem({
      id: '0192f0a0-0000-7000-8000-000000000003',
      email: 'khaled@test.local',
      username: 'khaled',
      phone: '+905550000003',
      fullName: 'خالد محمود',
      fullNameLatin: 'Khaled Mahmoud',
      roles: ['guardian'],
    }),
    relationship: 'father',
    isPrimary: true,
    createdAt: '2026-10-30T10:00:00.000Z',
    ...overrides,
  }
}
