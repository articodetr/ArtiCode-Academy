// Fixtures for the users screens (MOD-03-T11): API shapes of API-012/API-013
// as the backend returns them, plus the permission sets the tests switch between.
import type { UserDetail, UserList, UserListItem } from '../api/users'

/** Everything an academy admin holds that the users screens look at. */
export const ADMIN_PERMISSIONS = [
  'users.read',
  'users.read_contact',
  'users.create',
  'users.update',
  'users.deactivate',
  'users.roles.assign',
]

/** A teacher-like viewer: the list without contact details, no write actions. */
export const READ_ONLY_PERMISSIONS = ['users.read']

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
