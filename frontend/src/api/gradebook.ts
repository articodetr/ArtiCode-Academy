// The gradebook and the final grades of a class (MOD-09-T05 — J-F49): API-126
// GET /api/classes/:id/gradebook, API-127 POST /api/classes/:id/final-grades
// and API-128 DELETE /api/classes/:id/final-grades. Types mirror
// backend/src/grades/gradebook.dto.ts field by field; every call goes through
// apiRequest (Bearer header, refresh-and-retry on 401). Reading needs
// `grades.read_all`, finalizing and withdrawing `grades.manage`, all through
// the class's visibility (D-R16: a holder of `classes.manage`, or a teacher
// assigned to the class; anyone else gets 404 `class_not_found`) — the server
// decides. The gradebook is computed by the server on every read (D-R43/D-R44):
// every number here — a cell's counted score after the late penalty, the
// current and projected percentages, the final grade — is the server's; the
// screen computes none. Both writes answer with the gradebook after the write.
import type { AssignmentStatus } from './assignments'
import { CLASSES_PATH } from './classes'
import type { ClassStatus } from './classes'
import { apiRequest } from './client'
import type { EnrollmentStatus, EnrollmentStudent } from './enrollments'
import type { ExamStatus } from './exams'
import type { LocalizedLabel } from './users'

/** `ComponentKind` of gradebook.calc.ts: the class's assignments come first, then its exams. */
export const GRADEBOOK_COMPONENT_KINDS = ['assignment', 'exam'] as const
export type GradebookComponentKind = (typeof GRADEBOOK_COMPONENT_KINDS)[number]

/**
 * `CellStatus` of gradebook.calc.ts. An assignment's cell follows the student's
 * latest attempt: `awaiting_review` (it waits for review — the score of an
 * earlier graded attempt stays), `graded` (a graded attempt counts),
 * `returned` (sent back, nothing graded yet) or `missing`; an exam's cell is
 * the recorded result: `scored`, `absent` (counts 0), `excused` (left out of
 * the percentage) or `missing` (no result).
 */
export const GRADEBOOK_CELL_STATUSES = ['graded', 'awaiting_review', 'returned', 'scored', 'absent', 'excused', 'missing'] as const
export type GradebookCellStatus = (typeof GRADEBOOK_CELL_STATUSES)[number]

/**
 * Final grades are fixed for a class in one of these states — a mirror of
 * `GRADABLE_CLASS_STATUSES` in backend/src/grades/gradebook.service.ts (keep in
 * sync): anything else is refused with `409 class_not_gradable`. `readiness.ready`
 * does not include it (the DTO says so), so the screen checks it too.
 */
export const GRADABLE_CLASS_STATUSES: readonly ClassStatus[] = ['running', 'completed']

/** `GradebookClassDto`. */
export interface GradebookClass {
  id: string
  code: string
  name: LocalizedLabel
  status: ClassStatus
}

/**
 * `GradebookComponentDto`: an assignment or an exam of the class that is not a
 * draft. The DTO types `status` as a string; it is the assignment's
 * (`open`/`closed`) or the exam's (`scheduled`/`published`) status.
 */
export interface GradebookComponent {
  kind: GradebookComponentKind
  /** The assignment or the exam. */
  id: string
  title: LocalizedLabel
  /** null or 0 = informational, not counted (D-R43). */
  weight: number | null
  maxScore: number
  /** Assignments: the late penalty applied to a late graded attempt (D-R36); null for exams and without a penalty. */
  latePenaltyPercent: number | null
  status: AssignmentStatus | ExamStatus
  /** True when the weight is above 0. */
  counted: boolean
}

/** `GradebookCellDto`: one student × one component, aligned with `components`. */
export interface GradebookCell {
  kind: GradebookComponentKind
  id: string
  status: GradebookCellStatus
  /** The latest graded attempt's score, or the exam score. */
  score: number | null
  /** After the late penalty (two decimals); 0 for an absence; null when missing or excused. */
  effectiveScore: number | null
  /** The counted attempt was late. */
  late: boolean
}

/** `FinalGradeRecorderDto`: who fixed the final grade (null when that account was deleted). */
export interface FinalGradeRecorder {
  userId: string
  fullName: string
}

/** `FinalGradeDto`: the snapshot fixed by the last finalization (D-R44). */
export interface FinalGrade {
  percent: number
  schemeId: string
  /** The band's label at finalization (snapshot). */
  label: LocalizedLabel
  letter: string | null
  isPass: boolean
  /** ISO 8601. */
  finalizedAt: string
  finalizedBy: FinalGradeRecorder | null
  /** A source (a component, a review, a result) changed after the finalization — finalize again to refresh it. */
  stale: boolean
}

/** `GradebookStudentDto`: one active or completed enrollment of the class. */
export interface GradebookStudent {
  enrollmentId: string
  enrollmentStatus: EnrollmentStatus
  /** The student in the caller's projection (D-R07). */
  student: EnrollmentStudent
  /** Aligned with `components`. */
  cells: GradebookCell[]
  /** Weighted average over what is graded or recorded (missing work left out); null when nothing counts yet. */
  current: number | null
  /** Weighted average with missing work counted as 0 — what a finalization would fix now (D-R45). */
  projected: number | null
  final: FinalGrade | null
}

/** `GradebookReadinessDto`: what still keeps the class from being finalized (D-R45). */
export interface GradebookReadiness {
  /** Weighted assignments still open. */
  openAssignments: number
  /** Weighted assignments × students whose latest attempt waits for review. */
  awaitingReview: number
  /** Weighted exams whose results are not published. */
  unpublishedExams: number
  /** Components with a weight above 0. */
  weightedComponents: number
  /** True when a finalization would be accepted now — it also needs a running or completed class (GRADABLE_CLASS_STATUSES). */
  ready: boolean
}

/** `GradebookSchemeDto`. */
export interface GradebookScheme {
  id: string
  name: LocalizedLabel
}

/** `GradebookDto` (API-126), also the answer of API-127 and API-128. */
export interface Gradebook {
  class: GradebookClass
  /** The class's assignments then exams that are not drafts. */
  components: GradebookComponent[]
  /** Every student with an active or completed enrollment, in enrollment order. */
  students: GradebookStudent[]
  readiness: GradebookReadiness
  /** The default grade scheme a finalization without `schemeId` would use. */
  defaultScheme: GradebookScheme | null
}

/** `FinalizeGradesDto` (API-127): an active grade scheme; absent = the default (`409 grade_scheme_missing` without one). */
export interface FinalizeGradesInput {
  schemeId?: string
}

const classPath = (classId: string) => `${CLASSES_PATH}/${encodeURIComponent(classId)}`

export function gradebookPath(classId: string): string {
  return `${classPath(classId)}/gradebook`
}

export function finalGradesPath(classId: string): string {
  return `${classPath(classId)}/final-grades`
}

/** API-126 — the gradebook of a class, computed on read. */
export function getGradebook(classId: string, signal?: AbortSignal): Promise<Gradebook> {
  return apiRequest<Gradebook>(gradebookPath(classId), { signal })
}

/** API-127 — fixes the final grades (repeatable: only what differs is written); answers with the gradebook after it. */
export function finalizeGrades(classId: string, input: FinalizeGradesInput): Promise<Gradebook> {
  return apiRequest<Gradebook>(finalGradesPath(classId), { method: 'POST', body: input })
}

/** API-128 — withdraws every final grade of the class; answers with the gradebook after it. */
export function withdrawFinalGrades(classId: string): Promise<Gradebook> {
  return apiRequest<Gradebook>(finalGradesPath(classId), { method: 'DELETE' })
}
