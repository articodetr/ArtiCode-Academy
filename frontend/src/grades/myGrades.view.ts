// Pure rules of «my grades» (J-F50): the filters turned into API-129
// parameters, the relations the caller's keys leave out (the server drops
// them without a word — D-R48), and what each component and the final grade
// show. Every number is the server's — the score, the score after the late
// penalty (`effectiveScore`), the weight and the final percentage — so
// nothing here computes a grade: no running average before the class is
// finalized (D-R48). The student and class filter options are those of «my
// lessons» (lessons/myLessons.view.ts — the same API-060 ownership). No
// React, no i18next instance; unit-tested in myGrades.view.test.ts.
import type { MyClassRelation } from '../api/enrollments'
import { READ_LINKED_GRADES_PERMISSION, READ_OWN_GRADES_PERMISSION } from '../api/myGrades'
import type { GradeCellStatus, ListMyGradesParams, MyFinalGrade, MyGradeComponent } from '../api/myGrades'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'

export interface MyGradesFilters {
  /** The caller or one of their children; blank = every owned student. */
  studentId: string | undefined
  classId: string | undefined
}

export const DEFAULT_MY_GRADES_FILTERS: MyGradesFilters = { studentId: undefined, classId: undefined }

/** API-129 parameters of the filters (no pagination). */
export function myGradesQuery(filters: MyGradesFilters): ListMyGradesParams {
  return { classId: filters.classId, studentId: filters.studentId }
}

/** True when a filter narrows the list (the empty text then says so). */
export function isNarrowed(filters: MyGradesFilters): boolean {
  return Boolean(filters.studentId || filters.classId)
}

/**
 * The relations the caller owns but may not read (`opensRelation()` of
 * my-grades.policy.ts — keep in sync): their own enrollments without
 * `grades.read_own` while they hold the `student` role key, their children's
 * without `grades.read_linked` while they hold `guardian`. Nothing when the
 * caller holds neither key — the server then refuses the whole page (403).
 */
export function hiddenRelations(roleKeys: readonly string[], permissions: readonly string[]): MyClassRelation[] {
  const own = permissions.includes(READ_OWN_GRADES_PERMISSION)
  const linked = permissions.includes(READ_LINKED_GRADES_PERMISSION)
  if (!own && !linked) return []
  const hidden: MyClassRelation[] = []
  if (!own && roleKeys.includes('student')) hidden.push('self')
  if (!linked && roleKeys.includes('guardian')) hidden.push('child')
  return hidden
}

/** Counted in the final grade: a weight above 0 (null or 0 = informational — D-R43). */
export function isWeighted(component: Pick<MyGradeComponent, 'weight'>): boolean {
  return component.weight !== null && component.weight > 0
}

/** antd `Tag` preset colours of the component states. */
export const GRADE_CELL_COLORS: Readonly<Record<GradeCellStatus, string>> = {
  graded: 'green',
  awaiting_review: 'gold',
  returned: 'orange',
  scored: 'green',
  absent: 'red',
  excused: 'blue',
  missing: 'default',
}

/** The translation key suffix of a component's state (`myGrades.status.*`): «missing» reads differently for an assignment and an exam. */
export function statusKeyOf(component: Pick<MyGradeComponent, 'kind' | 'status'>): string {
  return component.status === 'missing' ? `missing_${component.kind}` : component.status
}

export type ComponentScoreCell =
  /** The server's score; `adjusted` = its score after the late penalty when that differs (a late graded attempt). */
  | { kind: 'score'; score: number; adjusted: number | null }
  /** No score, but the component counts the server's value: an absence counts 0. */
  | { kind: 'counted'; value: number }
  /** Nothing to show yet (missing, waiting for review, returned) or left out (excused). */
  | { kind: 'none' }

/** What the score of a component shows — the server's numbers only. */
export function scoreCellOf(component: Pick<MyGradeComponent, 'score' | 'effectiveScore' | 'late'>): ComponentScoreCell {
  if (component.score !== null) {
    const adjusted = component.late && component.effectiveScore !== null && component.effectiveScore !== component.score ? component.effectiveScore : null
    return { kind: 'score', score: component.score, adjusted }
  }
  if (component.effectiveScore !== null) return { kind: 'counted', value: component.effectiveScore }
  return { kind: 'none' }
}

/** The score shown comes from an earlier graded attempt while a newer one waits for review. */
export function scoreFromEarlierAttempt(component: Pick<MyGradeComponent, 'kind' | 'status' | 'score'>): boolean {
  return component.kind === 'assignment' && component.status === 'awaiting_review' && component.score !== null
}

/** `86.4%` — the server's percentage as it came. */
export function percentText(percent: number): string {
  return `${percent}%`
}

/** The band of the final grade in the active language, with its letter when the scheme has one: `جيد جداً (B)`. */
export function bandText(final: Pick<MyFinalGrade, 'label' | 'letter'>, language: Language): string {
  const label = localizedLabel(final.label, language)
  if (!final.letter) return label
  return label ? `${label} (${final.letter})` : final.letter
}
