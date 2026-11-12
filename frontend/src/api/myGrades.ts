// «My grades» (MOD-09-T06 — J-F50): API-129 GET /api/me/grades. Types mirror
// backend/src/grades/my-grades.dto.ts field by field; the call goes through
// apiRequest (Bearer header, refresh-and-retry on 401).
//
// Ownership AND the keys of matrix 7.2 (D-R48): the caller's own `active` or
// `completed` enrollments need `grades.read_own` (`relation: self`), their
// linked, not soft-deleted children's need `grades.read_linked` and the
// `guardian` role (`relation: child`) — one key alone shows its relation
// only, and a caller holding neither gets `403 permission_denied { missing:
// ["grades.read_own", "grades.read_linked"] }` (a teacher or a manager too).
// One item per owned enrollment, in enrollment order, with the class's
// assignments (no drafts — the student's latest GRADED attempt, the late
// penalty applied by the server through the gradebook's `cellOutcome()`) and
// its PUBLISHED exams (that student's result), each with its weight and
// maximum, and the final grade once the class is finalized — no running
// average (D-R48), no breakdown, reviewer, recorder or finalizer. No
// pagination. Every number is the server's: the screen computes no grade.
import { apiRequest } from './client'
import type { MyClassRelation, MyClassStudent } from './enrollments'
import type { ScheduleClass } from './timetable'
import type { LocalizedLabel } from './users'

/** `MY_GRADES_PERMISSIONS` of my-grades.policy.ts — keep in sync: either key opens the page (each its own relation). */
export const READ_OWN_GRADES_PERMISSION = 'grades.read_own'
export const READ_LINKED_GRADES_PERMISSION = 'grades.read_linked'
export const MY_GRADES_PERMISSIONS = [READ_OWN_GRADES_PERMISSION, READ_LINKED_GRADES_PERMISSION] as const

/** `ComponentKind` of gradebook.calc.ts: the class's assignments come first, then its published exams. */
export const GRADE_COMPONENT_KINDS = ['assignment', 'exam'] as const
export type GradeComponentKind = (typeof GRADE_COMPONENT_KINDS)[number]

/**
 * `CellStatus` of gradebook.calc.ts — keep in sync. An assignment is
 * `awaiting_review` while its latest attempt waits (the score then is the
 * latest GRADED attempt's, if any), `graded` with a graded attempt,
 * `returned` when the latest attempt came back without any graded one, and
 * `missing` without a submission; an exam is `scored`, `absent` (counts 0),
 * `excused` (left out of the final grade) or `missing` (no result recorded).
 */
export const GRADE_CELL_STATUSES = ['graded', 'awaiting_review', 'returned', 'scored', 'absent', 'excused', 'missing'] as const
export type GradeCellStatus = (typeof GRADE_CELL_STATUSES)[number]

/** The enrollments «my grades» lists (`OWNED_ENROLLMENT_STATUSES` of my-grades.dto.ts). */
export const MY_GRADE_ENROLLMENT_STATUSES = ['active', 'completed'] as const
export type MyGradeEnrollmentStatus = (typeof MY_GRADE_ENROLLMENT_STATUSES)[number]

/** `MyGradeComponentDto`: one assignment or published exam of the class, as that student stands in it. */
export interface MyGradeComponent {
  kind: GradeComponentKind
  id: string
  title: LocalizedLabel
  /** Its weight in the final grade; null or 0 = not counted, informational (D-R43). */
  weight: number | null
  maxScore: number
  status: GradeCellStatus
  /** The latest graded attempt's score, or the exam score. */
  score: number | null
  /** After the late penalty (two decimals); 0 for an absence; null when missing or excused. */
  effectiveScore: number | null
  /** The counted attempt was late (assignments). */
  late: boolean
}

/** `MyFinalGradeDto`: the final grade fixed at finalization (a snapshot — D-R44). */
export interface MyFinalGrade {
  percent: number
  /** The grade scheme band at finalization. */
  label: LocalizedLabel
  letter: string | null
  isPass: boolean
  /** ISO 8601. */
  finalizedAt: string
}

/** `MyGradeItemDto`: one owned enrollment. */
export interface MyGradeItem {
  enrollmentId: string
  enrollmentStatus: MyGradeEnrollmentStatus
  /** `self` (needs grades.read_own) or `child` (needs grades.read_linked and the guardian role). */
  relation: MyClassRelation
  /** Identity only. */
  student: MyClassStudent
  /** `TimetableClassDto` — the class with its course. */
  class: ScheduleClass
  /** The class's assignments (no drafts) then its published exams, in the server's order. */
  components: MyGradeComponent[]
  /** The final grade once the class is finalized; null before (no running average — D-R48). */
  final: MyFinalGrade | null
}

export interface MyGradeList {
  /** One item per owned enrollment, in enrollment order. */
  items: MyGradeItem[]
}

export interface ListMyGradesParams {
  /** The grades of this class only (a class the caller does not own matches nothing). */
  classId?: string
  /** The grades of this student only — the caller or one of their children. */
  studentId?: string
}

export const MY_GRADES_PATH = '/api/me/grades'

/** `/api/me/grades?…` with the given parameters only, in a fixed order. */
export function myGradesPath(params: ListMyGradesParams = {}): string {
  const query = new URLSearchParams()
  if (params.classId) query.set('classId', params.classId)
  if (params.studentId) query.set('studentId', params.studentId)
  const search = query.toString()
  return search ? `${MY_GRADES_PATH}?${search}` : MY_GRADES_PATH
}

/** API-129: 400 on a malformed filter, 403 `permission_denied` without grades.read_own and grades.read_linked. */
export function listMyGrades(params: ListMyGradesParams = {}, signal?: AbortSignal): Promise<MyGradeList> {
  return apiRequest<MyGradeList>(myGradesPath(params), { signal })
}
