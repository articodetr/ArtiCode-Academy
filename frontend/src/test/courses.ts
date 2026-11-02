// Fixtures for the courses screen (MOD-04-T05): the shapes of API-037 and
// API-042..API-046 as the backend returns them, plus the permission sets.
import type { Course, CourseList } from '../api/courses'
import type { Level, LevelList } from '../api/levels'

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
