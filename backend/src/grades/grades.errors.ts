// Error vocabulary of MOD-09 exams and grades (roadmap §4h.4/§4h.5, owner
// decisions D-R42..D-R49). One dictionary for the whole module: `grades/`
// (schemes, gradebook, final grades, «my grades») and `exams/` (exams,
// results, «my exams») both use it, as levels/ uses courses/courses.errors.ts.
// Same shape as AssignmentsHttpException: the body is
// `{ statusCode, error, code, message, ...details }` and the frontend maps the
// stable `code` to a localized message. A detail is never named `code` — it
// would overwrite the error code. The dictionary is complete from T02 on, so
// T03..T06 only use it.
//
//   -- grade schemes (T02) --
//   grade_scheme_not_found   404 — no grade scheme with this id
//   grade_scheme_invalid     400 — the bands break a rule: a band at 0, distinct
//                                  minimums, at least one passing band, every band
//                                  above a passing one passes ({ problems, duplicates })
//   grade_scheme_is_default  409 — the default scheme cannot be deactivated, deleted
//                                  or stop being the default (make another one the
//                                  default instead), and an inactive scheme cannot
//                                  become the default without being activated
//                                  ({ schemeId, action })
//   grade_scheme_in_use      409 — final grades still use the scheme; deactivate it
//                                  ({ finalGradeCount })
//   -- exams (T03/T04) --
//   exam_not_found           404 — no exam with this id, or one the caller may not see
//                                  (D-R16 — exams.read without classes.manage sees the
//                                  exams of assigned classes)
//   class_not_found          404 — unknown class, or one the caller may not see
//   lesson_not_found         404 — no lesson with this id ({ lessonId })
//   lesson_mismatch          422 — the lesson belongs to another class ({ lessonId, classId })
//   class_closed             409 — a cancelled class takes no exam write, and a
//                                  completed one no new exam ({ classId, status })
//   pass_score_invalid       400 — the pass score exceeds the maximum score (after a
//                                  PATCH merge too) ({ passScore, maxScore }) — added in T03
//   exam_locked              409 — the field cannot change: maxScore once a result
//                                  exists ({ status, fields, resultCount })
//   exam_has_results         409 — `unschedule` of an exam that holds results ({ action, resultCount })
//   exam_not_deletable       409 — only a draft or scheduled exam without results is
//                                  deleted ({ status, resultCount })
//   exam_not_recordable      409 — results are recorded for a scheduled or published
//                                  exam only ({ reason: not_scheduled })
//   invalid_transition       409 — status action not allowed from the current state
//                                  ({ from, action, allowed })
//   results_invalid          400 — the same student twice in one batch ({ duplicates })
//   not_enrolled             422 — students without an active or completed enrollment
//                                  in the class, before any write ({ studentIds })
//   score_out_of_range       400 — a score outside 0..maxScore ({ score, maxScore, studentId? })
//   -- gradebook and final grades (T05) --
//   class_not_gradable       409 — final grades are fixed for a running or completed
//                                  class only ({ classId, status })
//   grade_scheme_missing     409 — no default grade scheme (and none given)
//   grades_not_ready         409 — a weighted assignment is still open, a latest
//                                  attempt waits for review, a weighted exam is not
//                                  published, or nothing is weighted
//                                  ({ openAssignments, awaitingReview, unpublishedExams, reason? })
//   -- shared --
//   nothing_to_update        400 — PATCH body without any field (as API-018)
//   cursor_invalid           400 — the list cursor does not belong to this order
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const GRADES_ERROR_CODES = [
  'grade_scheme_not_found',
  'grade_scheme_invalid',
  'grade_scheme_is_default',
  'grade_scheme_in_use',
  'exam_not_found',
  'class_not_found',
  'lesson_not_found',
  'lesson_mismatch',
  'class_closed',
  'pass_score_invalid',
  'exam_locked',
  'exam_has_results',
  'exam_not_deletable',
  'exam_not_recordable',
  'invalid_transition',
  'results_invalid',
  'not_enrolled',
  'score_out_of_range',
  'class_not_gradable',
  'grade_scheme_missing',
  'grades_not_ready',
  'nothing_to_update',
  'cursor_invalid',
] as const;

export type GradesErrorCode = (typeof GRADES_ERROR_CODES)[number];

export interface GradesErrorBody {
  statusCode: number;
  error: string;
  code: GradesErrorCode;
  message: string;
  [detail: string]: unknown;
}

/** HttpException whose body is `{ statusCode, error, code, message, ...details }`. */
export class GradesHttpException extends HttpException {
  readonly code: GradesErrorCode;

  constructor(status: HttpStatus, code: GradesErrorCode, message: string, details: Record<string, unknown> = {}) {
    const body: GradesErrorBody = {
      statusCode: status,
      error: STATUS_CODES[status] ?? 'Error',
      code,
      message,
      ...details,
    };
    super(body, status);
    this.code = code;
  }
}

/** The band rules a grade scheme breaks (D-R46). */
export type GradeSchemeProblem = 'no_zero_band' | 'duplicate_min_percent' | 'no_passing_band' | 'pass_not_ascending';

export type DefaultSchemeAction = 'deactivate' | 'delete' | 'unset_default' | 'promote_inactive';

const IS_DEFAULT_MESSAGES: Record<DefaultSchemeAction, string> = {
  deactivate: 'The default grade scheme cannot be deactivated; make another scheme the default first',
  delete: 'The default grade scheme cannot be deleted; make another scheme the default first',
  unset_default: 'A scheme stops being the default only when another one becomes the default',
  promote_inactive: 'An inactive grade scheme cannot become the default; activate it in the same request',
};

export type ExamNotRecordableReason = 'not_scheduled';

export interface GradesReadiness {
  openAssignments: number;
  awaitingReview: number;
  unpublishedExams: number;
}

export const gradesError = {
  gradeSchemeNotFound: (schemeId: string) =>
    new GradesHttpException(HttpStatus.NOT_FOUND, 'grade_scheme_not_found', 'No grade scheme with this id', { schemeId }),
  gradeSchemeInvalid: (problems: readonly GradeSchemeProblem[], duplicates: readonly number[]) =>
    new GradesHttpException(HttpStatus.BAD_REQUEST, 'grade_scheme_invalid', 'The bands of the grade scheme break its rules', {
      problems: [...problems],
      duplicates: [...duplicates],
    }),
  gradeSchemeIsDefault: (schemeId: string | null, action: DefaultSchemeAction) =>
    new GradesHttpException(HttpStatus.CONFLICT, 'grade_scheme_is_default', IS_DEFAULT_MESSAGES[action], { schemeId, action }),
  gradeSchemeInUse: (finalGradeCount: number) =>
    new GradesHttpException(HttpStatus.CONFLICT, 'grade_scheme_in_use', 'Final grades still use this grade scheme; deactivate it instead', { finalGradeCount }),
  examNotFound: (examId: string) => new GradesHttpException(HttpStatus.NOT_FOUND, 'exam_not_found', 'No exam with this id', { examId }),
  classNotFound: (classId: string) => new GradesHttpException(HttpStatus.NOT_FOUND, 'class_not_found', 'No class with this id', { classId }),
  lessonNotFound: (lessonId: string) => new GradesHttpException(HttpStatus.NOT_FOUND, 'lesson_not_found', 'No lesson with this id', { lessonId }),
  lessonMismatch: (lessonId: string, classId: string) =>
    new GradesHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'lesson_mismatch', 'The lesson belongs to another class', { lessonId, classId }),
  classClosed: (classId: string, status: string) =>
    new GradesHttpException(HttpStatus.CONFLICT, 'class_closed', 'This class takes no such exam write in its current status', { classId, status }),
  passScoreInvalid: (passScore: number, maxScore: number) =>
    new GradesHttpException(HttpStatus.BAD_REQUEST, 'pass_score_invalid', 'The pass score cannot exceed the maximum score', { passScore, maxScore }),
  examLocked: (status: string, fields: readonly string[], resultCount: number) =>
    new GradesHttpException(HttpStatus.CONFLICT, 'exam_locked', 'These fields cannot change for this exam', { status, fields: [...fields], resultCount }),
  examHasResults: (action: string, resultCount: number) =>
    new GradesHttpException(HttpStatus.CONFLICT, 'exam_has_results', 'The exam holds results', { action, resultCount }),
  examNotDeletable: (status: string, resultCount: number) =>
    new GradesHttpException(HttpStatus.CONFLICT, 'exam_not_deletable', 'Only a draft or scheduled exam without results can be deleted', { status, resultCount }),
  examNotRecordable: (reason: ExamNotRecordableReason) =>
    new GradesHttpException(HttpStatus.CONFLICT, 'exam_not_recordable', 'Results are recorded for a scheduled or published exam only', { reason }),
  invalidTransition: (from: string, action: string, allowed: readonly string[]) =>
    new GradesHttpException(HttpStatus.CONFLICT, 'invalid_transition', `Action "${action}" is not allowed for a ${from} exam`, { from, action, allowed: [...allowed] }),
  resultsInvalid: (duplicates: readonly string[]) =>
    new GradesHttpException(HttpStatus.BAD_REQUEST, 'results_invalid', 'A student appears more than once in the batch', { duplicates: [...duplicates] }),
  notEnrolled: (studentIds: readonly string[]) =>
    new GradesHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'not_enrolled', 'These students have no active or completed enrollment in the class', {
      studentIds: [...studentIds],
    }),
  scoreOutOfRange: (score: number, maxScore: number, studentId?: string) =>
    new GradesHttpException(HttpStatus.BAD_REQUEST, 'score_out_of_range', `The score must be between 0 and ${maxScore}`, { score, maxScore, ...(studentId ? { studentId } : {}) }),
  classNotGradable: (classId: string, status: string) =>
    new GradesHttpException(HttpStatus.CONFLICT, 'class_not_gradable', 'Final grades are fixed for a running or completed class only', { classId, status }),
  gradeSchemeMissing: () => new GradesHttpException(HttpStatus.CONFLICT, 'grade_scheme_missing', 'No default grade scheme; create one or name a scheme'),
  gradesNotReady: (readiness: GradesReadiness, reason?: 'no_weighted_components') =>
    new GradesHttpException(HttpStatus.CONFLICT, 'grades_not_ready', 'The class’s grades are not settled yet', { ...readiness, ...(reason ? { reason } : {}) }),
  nothingToUpdate: () => new GradesHttpException(HttpStatus.BAD_REQUEST, 'nothing_to_update', 'The request body contains no field to update'),
  cursorInvalid: () =>
    new GradesHttpException(HttpStatus.BAD_REQUEST, 'cursor_invalid', 'The cursor is invalid or belongs to a different order; restart from the first page'),
};
