// Fixtures for the grade schemes tab of the settings page (J-F44 — MOD-09-T08
// part a): the shape of API-122 as the backend returns it (the default first,
// then by creation; bands ascending), plus the permission set the tests use.
import type { GradeScheme, GradeSchemeBand } from '../api/gradeSchemes'

export const GRADE_SCHEME_IDS = [
  '0193c000-0000-7000-8000-00000000f001',
  '0193c000-0000-7000-8000-00000000f002',
  '0193c000-0000-7000-8000-00000000f003',
] as const

export const GRADE_SCHEME_ID = GRADE_SCHEME_IDS[0]

/** An academy admin as far as the grade schemes tab is concerned (the settings keys; writes need `manage`). */
export const GRADE_SCHEME_MANAGER_PERMISSIONS = ['academy.settings.read', 'academy.settings.manage']

/** The bands the seed gives the default scheme (backend/src/grades/grade-schemes.defaults.ts), ascending. */
export function defaultBands(): GradeSchemeBand[] {
  return [
    { minPercent: 0, label: { ar: 'راسب', en: 'Fail' }, letter: 'F', isPass: false },
    { minPercent: 60, label: { ar: 'مقبول', en: 'Pass' }, letter: 'D', isPass: true },
    { minPercent: 70, label: { ar: 'جيد', en: 'Good' }, letter: 'C', isPass: true },
    { minPercent: 80, label: { ar: 'جيد جداً', en: 'Very good' }, letter: 'B', isPass: true },
    { minPercent: 90, label: { ar: 'ممتاز', en: 'Excellent' }, letter: 'A', isPass: true },
  ]
}

export function makeGradeScheme(overrides: Partial<GradeScheme> = {}): GradeScheme {
  return {
    id: GRADE_SCHEME_ID,
    name: { ar: 'السلّم الافتراضي', en: 'Default scale' },
    isDefault: true,
    isActive: true,
    bands: defaultBands(),
    finalGradeCount: 12,
    createdAt: '2026-11-10T09:00:00.000Z',
    updatedAt: '2026-11-10T09:00:00.000Z',
    ...overrides,
  }
}

/**
 * In the server's order: the default (12 final grades), an active pass/fail
 * scheme no grade uses, and an inactive scheme 3 final grades use — with
 * Turkish texts the form does not show (they must travel back untouched).
 */
export function THREE_GRADE_SCHEMES(): GradeScheme[] {
  return [
    makeGradeScheme(),
    makeGradeScheme({
      id: GRADE_SCHEME_IDS[1],
      name: { ar: 'ناجح أو راسب', en: 'Pass or fail' },
      isDefault: false,
      bands: [
        { minPercent: 0, label: { ar: 'لم ينجح' }, letter: null, isPass: false },
        { minPercent: 50, label: { ar: 'نجح' }, letter: null, isPass: true },
      ],
      finalGradeCount: 0,
    }),
    makeGradeScheme({
      id: GRADE_SCHEME_IDS[2],
      name: { ar: 'السلّم القديم', tr: 'Eski ölçek' },
      isDefault: false,
      isActive: false,
      bands: [
        { minPercent: 0, label: { ar: 'ضعيف', tr: 'Zayıf' }, letter: 'E', isPass: false },
        { minPercent: 65.5, label: { ar: 'متوسط', tr: 'Orta' }, letter: 'C', isPass: true },
      ],
      finalGradeCount: 3,
    }),
  ]
}
