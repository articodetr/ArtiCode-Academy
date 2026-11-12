// Pure helpers of the gradebook tab of the class drawer (J-F49 — MOD-09-T08
// part c, API-126..API-128): what a cell shows, which readiness checks pass,
// and whether finalizing or withdrawing is offered. Every number is the
// server's — these helpers pick, compare and label, and never compute a score,
// a percentage or a band (roadmap §4h.5: «الأرقام كلها من الخادم — لا حاسبة في
// الواجهة»). No React, no i18next instance. Unit-tested in gradebook.view.test.ts.
import { GRADABLE_CLASS_STATUSES } from '../api/gradebook'
import type { Gradebook, GradebookCell, GradebookCellStatus, GradebookComponent, GradebookScheme, GradebookStudent } from '../api/gradebook'
import type { ClassStatus } from '../api/classes'
import type { GradeScheme } from '../api/gradeSchemes'

/** antd `Tag` preset colours of the statuses a cell names (a graded or scored cell shows its number alone). */
export const CELL_STATUS_COLORS: Readonly<Record<GradebookCellStatus, string>> = {
  graded: 'green',
  scored: 'green',
  awaiting_review: 'gold',
  returned: 'purple',
  absent: 'red',
  excused: 'blue',
  missing: 'default',
}

/** The student's cell for a component: aligned by index (the DTO's promise), found by kind and id if it ever is not. */
export function cellOf(student: Pick<GradebookStudent, 'cells'>, component: Pick<GradebookComponent, 'kind' | 'id'>, index: number): GradebookCell | null {
  const aligned = student.cells[index]
  if (aligned && aligned.kind === component.kind && aligned.id === component.id) return aligned
  return student.cells.find((cell) => cell.kind === component.kind && cell.id === component.id) ?? null
}

/** What one cell shows, all of it as the server sent it. */
export interface CellView {
  /** The counted score (`effectiveScore` — after the late penalty; 0 for an absence); null when the cell has none. */
  value: number | null
  /** The graded score before the late penalty, only when the server's counted score differs from it. */
  before: number | null
  /** The counted attempt was late. */
  late: boolean
  /** The status label under `gradebook.cell.status.*`, or null for a graded or scored cell (its number says it). */
  label: string | null
  color: string
}

export function cellView(cell: GradebookCell): CellView {
  const before = cell.late && cell.score !== null && cell.effectiveScore !== null && cell.score !== cell.effectiveScore ? cell.score : null
  let label: string | null = null
  if (cell.status === 'missing') label = cell.kind === 'assignment' ? 'missing_assignment' : 'missing_exam'
  else if (cell.status !== 'graded' && cell.status !== 'scored') label = cell.status
  return { value: cell.effectiveScore, before, late: cell.late, label, color: CELL_STATUS_COLORS[cell.status] }
}

/** True for a class whose final grades may be fixed (a mirror of the server's GRADABLE_CLASS_STATUSES). */
export function isGradableClass(status: ClassStatus): boolean {
  return GRADABLE_CLASS_STATUSES.includes(status)
}

export const READINESS_CHECKS = ['classStatus', 'weightedComponents', 'openAssignments', 'awaitingReview', 'unpublishedExams'] as const
export type ReadinessCheckKey = (typeof READINESS_CHECKS)[number]

export interface ReadinessCheck {
  key: ReadinessCheckKey
  ok: boolean
  /** The server's count behind the check (none for the class's status). */
  count?: number
}

/**
 * The finalization's conditions (D-R45) with the server's counts: a running or
 * completed class, a weighted component at least, no weighted assignment open,
 * no latest attempt waiting for review, every weighted exam published.
 */
export function readinessChecks(gradebook: Pick<Gradebook, 'class' | 'readiness'>): ReadinessCheck[] {
  const { readiness } = gradebook
  return [
    { key: 'classStatus', ok: isGradableClass(gradebook.class.status) },
    { key: 'weightedComponents', ok: readiness.weightedComponents > 0, count: readiness.weightedComponents },
    { key: 'openAssignments', ok: readiness.openAssignments === 0, count: readiness.openAssignments },
    { key: 'awaitingReview', ok: readiness.awaitingReview === 0, count: readiness.awaitingReview },
    { key: 'unpublishedExams', ok: readiness.unpublishedExams === 0, count: readiness.unpublishedExams },
  ]
}

/** A finalization would be accepted now: the server's `ready` and a running or completed class (the rule `ready` leaves out). */
export function canFinalize(gradebook: Pick<Gradebook, 'class' | 'readiness'>): boolean {
  return gradebook.readiness.ready && isGradableClass(gradebook.class.status)
}

/** Some student of the gradebook holds a final grade (a finalization repeats it; a withdrawal has something to remove). */
export function hasFinalGrades(gradebook: Pick<Gradebook, 'students'>): boolean {
  return gradebook.students.some((student) => student.final !== null)
}

/** Some final grade is stale: a source changed after it was fixed. */
export function hasStaleFinalGrades(gradebook: Pick<Gradebook, 'students'>): boolean {
  return gradebook.students.some((student) => student.final?.stale === true)
}

/** The schemes a finalization may use: the active ones (an inactive one is `404 grade_scheme_not_found`), in the server's order — the default first. */
export function finalizeSchemeOptions(schemes: readonly GradeScheme[]): GradeScheme[] {
  return schemes.filter((scheme) => scheme.isActive)
}

/** The scheme the dialog preselects: the default among the options, else the gradebook's default scheme when it is one of them. */
export function preselectedSchemeId(options: readonly GradeScheme[], defaultScheme: GradebookScheme | null): string | null {
  const flagged = options.find((scheme) => scheme.isDefault)
  if (flagged) return flagged.id
  return defaultScheme && options.some((scheme) => scheme.id === defaultScheme.id) ? defaultScheme.id : null
}
