// Fixtures for the classes screen (MOD-05 — J-F01): the shapes of API-050..API-056
// as the backend returns them, plus the permission sets of the seeded roles.
import type { AcademyClass, ClassList, ClassTeacher } from '../api/classes'
import type { UserListItem } from '../api/users'
import { makeListItem } from './users'

export const CLASS_ID = '0193b000-0000-7000-8000-00000000e001'
export const CLASS_COURSE_ID = '0193a000-0000-7000-8000-00000000c001'
export const TEACHER_IDS = ['0193b000-0000-7000-8000-00000000f001', '0193b000-0000-7000-8000-00000000f002', '0193b000-0000-7000-8000-00000000f003'] as const

/** An academy admin as far as the classes screen is concerned (users.read for the teacher search). */
export const CLASS_ADMIN_PERMISSIONS = ['classes.read', 'classes.manage', 'classes.teachers.assign', 'courses.read', 'courses.manage', 'users.read']

/** Staff by seed: every class and every write, but not the teacher assignment. */
export const CLASS_MANAGER_PERMISSIONS = ['classes.read', 'classes.manage', 'courses.read', 'users.read']

/** Teachers by seed: the classes they are assigned to, read-only (D-R16). */
export const CLASS_READER_PERMISSIONS = ['classes.read', 'courses.read', 'users.read']

export function makeClassTeacher(overrides: Partial<ClassTeacher> = {}): ClassTeacher {
  return {
    userId: TEACHER_IDS[0],
    fullName: 'خالد المعلم',
    role: 'lead',
    assignedAt: '2026-11-03T09:00:00.000Z',
    ...overrides,
  }
}

export function makeClass(overrides: Partial<AcademyClass> = {}): AcademyClass {
  return {
    id: CLASS_ID,
    code: 'PY-101-A',
    name: { ar: 'بايثون — الفصل أ', en: 'Python — class A' },
    capacity: 20,
    status: 'planned',
    startsOn: '2026-11-10',
    endsOn: '2026-12-20',
    notes: null,
    course: { id: CLASS_COURSE_ID, code: 'PY-101', name: { ar: 'أساسيات بايثون', en: 'Python Basics' }, status: 'published' },
    teachers: [makeClassTeacher()],
    enrolledCount: 0,
    createdAt: '2026-11-03T08:00:00.000Z',
    updatedAt: '2026-11-03T08:30:00.000Z',
    ...overrides,
  }
}

export function makeClassList(items: AcademyClass[], nextCursor: string | null = null): ClassList {
  return { items, nextCursor }
}

/** A user holding the `teacher` role, as the teacher search (API-012 `role=teacher`) returns it. */
export function makeTeacherCandidate(overrides: Partial<UserListItem> = {}): UserListItem {
  return makeListItem({ id: TEACHER_IDS[1], fullName: 'منى المساعدة', fullNameLatin: 'Mona', roles: ['teacher'], ...overrides })
}
