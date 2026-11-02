// Fixtures for the courses screen (MOD-04-T05/T06): the shapes of API-037,
// API-042..API-046 and API-048 as the backend returns them, plus the permission sets.
import type { Course, CourseList } from '../api/courses'
import type { Level, LevelList } from '../api/levels'
import type { Syllabus, SyllabusItem } from '../api/syllabus'

export const COURSE_ID = '0193a000-0000-7000-8000-00000000c001'
export const LEVEL_ID = '0193a000-0000-7000-8000-00000000b001'

/** An academy admin as far as the courses screen is concerned. */
export const COURSE_MANAGER_PERMISSIONS = ['courses.read', 'courses.manage']

/** Teachers, students, guardians and staff by seed: published courses, read-only. */
export const COURSE_READER_PERMISSIONS = ['courses.read']

export function makeLevel(overrides: Partial<Level> = {}): Level {
  return {
    id: LEVEL_ID,
    code: 'BEG',
    name: { ar: 'مبتدئ', en: 'Beginner' },
    description: null,
    sortOrder: 0,
    isActive: true,
    courseCount: 1,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  }
}

export function makeLevelList(items: Level[] = [makeLevel()]): LevelList {
  return { items }
}

export function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: COURSE_ID,
    code: 'PY-101',
    name: { ar: 'أساسيات بايثون', en: 'Python Basics' },
    summary: null,
    description: null,
    level: { id: LEVEL_ID, code: 'BEG', name: { ar: 'مبتدئ', en: 'Beginner' }, isActive: true },
    status: 'draft',
    durationHours: 24,
    sessionsCount: 12,
    minAge: 10,
    maxAge: 14,
    syllabusCount: 0,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T11:00:00.000Z',
    ...overrides,
  }
}

export function makeCourseList(items: Course[], nextCursor: string | null = null): CourseList {
  return { items, nextCursor }
}

export const SYLLABUS_ITEM_IDS = ['0193a000-0000-7000-8000-00000000d001', '0193a000-0000-7000-8000-00000000d002', '0193a000-0000-7000-8000-00000000d003'] as const

export function makeSyllabusItem(overrides: Partial<SyllabusItem> = {}): SyllabusItem {
  return {
    id: SYLLABUS_ITEM_IDS[0],
    sortOrder: 0,
    title: { ar: 'المتغيرات', en: 'Variables' },
    description: null,
    estimatedMinutes: 45,
    createdAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    ...overrides,
  }
}

/** Three items: «المتغيرات» (45 min), «الشروط» (60 min, with a description), «الحلقات» (no estimate). */
export function makeSyllabus(items: SyllabusItem[] = THREE_ITEMS()): Syllabus {
  return { courseId: COURSE_ID, items }
}

export function THREE_ITEMS(): SyllabusItem[] {
  return [
    makeSyllabusItem(),
    makeSyllabusItem({ id: SYLLABUS_ITEM_IDS[1], sortOrder: 1, title: { ar: 'الشروط' }, description: { ar: 'if و else' }, estimatedMinutes: 60 }),
    makeSyllabusItem({ id: SYLLABUS_ITEM_IDS[2], sortOrder: 2, title: { ar: 'الحلقات', en: 'Loops', tr: 'Döngüler' }, estimatedMinutes: null }),
  ]
}

export const LEVEL_IDS = ['0193a000-0000-7000-8000-00000000b001', '0193a000-0000-7000-8000-00000000b002', '0193a000-0000-7000-8000-00000000b003'] as const

/** Three levels in order: BEG (1 course), INT (no course), ADV (inactive, no course). */
export function THREE_LEVELS(): Level[] {
  return [
    makeLevel(),
    makeLevel({ id: LEVEL_IDS[1], code: 'INT', name: { ar: 'متوسط', en: 'Intermediate' }, sortOrder: 1, courseCount: 0 }),
    makeLevel({ id: LEVEL_IDS[2], code: 'ADV', name: { ar: 'متقدم' }, sortOrder: 2, isActive: false, courseCount: 0 }),
  ]
}
