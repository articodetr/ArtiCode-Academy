// Fixtures for the roster tab and the «my classes» page (MOD-05 — J-F04): the
// shapes of API-057..API-060 as the backend returns them, plus the permission
// sets of the seeded roles that touch enrollments.
import type { Enrollment, EnrollmentList, EnrollmentStudent, MyClassItem, MyClassList } from '../api/enrollments'
import type { UserListItem } from '../api/users'
import { CLASS_COURSE_ID, CLASS_ID } from './classes'
import { makeListItem } from './users'

export const ENROLLMENT_IDS = ['0193c000-0000-7000-8000-00000000a001', '0193c000-0000-7000-8000-00000000a002', '0193c000-0000-7000-8000-00000000a003'] as const
export const STUDENT_IDS = ['0193c000-0000-7000-8000-00000000b001', '0193c000-0000-7000-8000-00000000b002', '0193c000-0000-7000-8000-00000000b003'] as const

/** Staff and academy_admin by seed: every roster, enrolling and the actions, with contact details and the student search. */
export const ROSTER_MANAGER_PERMISSIONS = ['classes.read', 'classes.manage', 'enrollments.read', 'enrollments.manage', 'users.read', 'users.read_contact']

/** Teachers by seed: the roster of an assigned class, read-only, in the reduced projection (no contact fields). */
export const ROSTER_TEACHER_PERMISSIONS = ['classes.read', 'enrollments.read', 'users.read']

export function makeEnrollmentStudent(overrides: Partial<EnrollmentStudent> = {}): EnrollmentStudent {
  return {
    id: STUDENT_IDS[0],
    fullName: 'عمر خالد',
    fullNameLatin: 'Omar Khaled',
    displayName: null,
    avatarUrl: null,
    status: 'active',
    email: 'omar@test.local',
    username: 'omar',
    phone: null,
    deletedAt: null,
    ...overrides,
  }
}

export function makeEnrollment(overrides: Partial<Enrollment> = {}): Enrollment {
  return {
    id: ENROLLMENT_IDS[0],
    classId: CLASS_ID,
    status: 'active',
    source: 'admin',
    enrolledAt: '2026-11-04T09:00:00.000Z',
    activatedAt: '2026-11-04T09:00:00.000Z',
    completedAt: null,
    withdrawnAt: null,
    withdrawalReason: null,
    student: makeEnrollmentStudent(),
    createdAt: '2026-11-04T09:00:00.000Z',
    updatedAt: '2026-11-04T09:00:00.000Z',
    ...overrides,
  }
}

export function makeEnrollmentList(items: Enrollment[], nextCursor: string | null = null): EnrollmentList {
  return { items, nextCursor }
}

/** A user holding the `student` role, as the student search (API-012 `role=student`) returns it. */
export function makeStudentCandidate(overrides: Partial<UserListItem> = {}): UserListItem {
  return makeListItem({ id: STUDENT_IDS[1], fullName: 'ليلى سعيد', fullNameLatin: 'Layla Saeed', email: 'layla@test.local', username: 'layla', roles: ['student'], ...overrides })
}

export function makeMyClassItem(overrides: Partial<MyClassItem> = {}): MyClassItem {
  return {
    enrollmentId: ENROLLMENT_IDS[0],
    enrollmentStatus: 'active',
    enrolledAt: '2026-11-04T09:00:00.000Z',
    completedAt: null,
    withdrawnAt: null,
    relation: 'self',
    student: { id: STUDENT_IDS[0], fullName: 'عمر خالد', displayName: null },
    class: {
      id: CLASS_ID,
      code: 'PY-101-A',
      name: { ar: 'بايثون — الفصل أ', en: 'Python — class A' },
      status: 'running',
      startsOn: '2026-11-10',
      endsOn: '2026-12-20',
      course: { id: CLASS_COURSE_ID, code: 'PY-101', name: { ar: 'أساسيات بايثون', en: 'Python Basics' } },
      leadTeacher: { fullName: 'خالد المعلم', displayName: null },
    },
    ...overrides,
  }
}

export function makeMyClassList(items: MyClassItem[]): MyClassList {
  return { items }
}
