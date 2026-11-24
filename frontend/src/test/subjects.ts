// Fixtures of the school subjects (PORTAL-04): the shapes of GET /api/subjects as backend/src/subjects/subjects.dto.ts
// answers them.
import type { Subject, SubjectList } from '../api/subjects'

export const SUBJECT_IDS = ['0193a000-0000-7000-8000-00000000a001', '0193a000-0000-7000-8000-00000000a002', '0193a000-0000-7000-8000-00000000a003'] as const
export const SUBJECT_ID = SUBJECT_IDS[0]

export function makeSubject(overrides: Partial<Subject> = {}): Subject {
  return {
    id: SUBJECT_ID,
    code: 'PROG',
    name: { ar: 'البرمجة', en: 'Programming' },
    sortOrder: 0,
    isActive: true,
    courseCount: 1,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  }
}

export function makeSubjectList(items: Subject[] = [makeSubject()]): SubjectList {
  return { items }
}

/** Three subjects in order: PROG (1 course), MATH (no course), ART (inactive, no course). */
export function THREE_SUBJECTS(): Subject[] {
  return [
    makeSubject(),
    makeSubject({ id: SUBJECT_IDS[1], code: 'MATH', name: { ar: 'الرياضيات', en: 'Mathematics' }, sortOrder: 1, courseCount: 0 }),
    makeSubject({ id: SUBJECT_IDS[2], code: 'ART', name: { ar: 'الفنون' }, sortOrder: 2, isActive: false, courseCount: 0 }),
  ]
}
