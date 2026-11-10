// Error vocabulary of MOD-08 assignments (roadmap §4g.4/§4g.5, owner decisions
// D-R35..D-R40). Same shape as LessonsHttpException / ClassesHttpException:
// the body is `{ statusCode, error, code, message, ...details }` and the
// frontend maps the stable `code` to a localized message. The whole dictionary
// is defined in T02 so T03 (submissions and review) and T04 («my assignments»)
// never edit this file for a new code. A detail is never named `code` — it
// would overwrite the error code.
//
//   assignment_not_found      404 — no assignment with this id, or one the caller may
//                                   not see (assignments.read without classes.manage
//                                   sees the assignments of assigned classes — D-R16)
//   class_not_found           404 — unknown class, or one the caller may not see
//   class_closed              409 — the class is completed or cancelled: no new
//                                   assignment, no edit, no publish or reopen
//                                   ({ classId, status }); close and deleting a draft
//                                   stay possible
//   lesson_not_found          404 — no lesson with this id ({ lessonId })
//   lesson_mismatch           422 — the lesson belongs to another class ({ lessonId, classId })
//   late_penalty_invalid      400 — a late penalty without `allowLate` (after the PATCH is
//                                   merged) ({ allowLate, latePenaltyPercent })
//   assignment_locked         409 — the field cannot change: everything of a closed
//                                   assignment, the grading rules (maxScore, maxAttempts,
//                                   allowLate, latePenaltyPercent) once a submission
//                                   exists ({ status, fields, submissionCount })
//   invalid_transition        409 — status action not allowed from the current state
//                                   ({ from, action, allowed })
//   assignment_not_deletable  409 — only a draft without submissions is deleted; close
//                                   the others ({ status, submissionCount })
//   nothing_to_update         400 — PATCH body without any field (as API-018)
//   cursor_invalid            400 — the list cursor does not belong to this order
//   -- T03 (submissions and review) --
//   submission_not_found      404 — no submission with this id, or one the caller may not see
//   assignment_closed         409 — submitting to a draft or closed assignment, or after
//                                   the due date without allowLate
//                                   ({ reason: not_published|closed|past_due, dueAt })
//   not_enrolled              403 — the caller has no active enrollment in the class ({ classId })
//   attempts_exhausted        409 — no attempt left ({ maxAttempts, attempts })
//   score_out_of_range        400 — score outside 0..maxScore ({ score, maxScore })
//   feedback_required         400 — `return` without feedback
//   submission_invalid        400 — neither text nor link
//   -- T07 (contract follow-ups, D-R49) --
//   attempt_conflict          409 — the body names an attemptNo that is not the student's next
//                                   one (a retried request whose attempt was already
//                                   created) ({ expected, next })
//   review_conflict           409 — expectedGradedAt no longer matches the submission's last
//                                   review: someone reviewed it meanwhile
//                                   ({ submissionId, status, gradedAt })
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const ASSIGNMENTS_ERROR_CODES = [
  'assignment_not_found',
  'class_not_found',
  'class_closed',
  'lesson_not_found',
  'lesson_mismatch',
  'late_penalty_invalid',
  'assignment_locked',
  'invalid_transition',
  'assignment_not_deletable',
  'nothing_to_update',
  'cursor_invalid',
  'submission_not_found',
  'assignment_closed',
  'not_enrolled',
  'attempts_exhausted',
  'score_out_of_range',
  'feedback_required',
  'submission_invalid',
  'attempt_conflict',
  'review_conflict',
] as const;

export type AssignmentsErrorCode = (typeof ASSIGNMENTS_ERROR_CODES)[number];

export interface AssignmentsErrorBody {
  statusCode: number;
  error: string;
  code: AssignmentsErrorCode;
  message: string;
  [detail: string]: unknown;
}

/** HttpException whose body is `{ statusCode, error, code, message, ...details }`. */
export class AssignmentsHttpException extends HttpException {
  readonly code: AssignmentsErrorCode;

  constructor(status: HttpStatus, code: AssignmentsErrorCode, message: string, details: Record<string, unknown> = {}) {
    const body: AssignmentsErrorBody = {
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

export type AssignmentClosedReason = 'not_published' | 'closed' | 'past_due';

export const assignmentsError = {
  assignmentNotFound: (assignmentId: string) =>
    new AssignmentsHttpException(HttpStatus.NOT_FOUND, 'assignment_not_found', 'No assignment with this id', { assignmentId }),
  classNotFound: (classId: string) => new AssignmentsHttpException(HttpStatus.NOT_FOUND, 'class_not_found', 'No class with this id', { classId }),
  classClosed: (classId: string, status: string) =>
    new AssignmentsHttpException(HttpStatus.CONFLICT, 'class_closed', 'A completed or cancelled class takes no new or edited assignments', { classId, status }),
  lessonNotFound: (lessonId: string) => new AssignmentsHttpException(HttpStatus.NOT_FOUND, 'lesson_not_found', 'No lesson with this id', { lessonId }),
  lessonMismatch: (lessonId: string, classId: string) =>
    new AssignmentsHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'lesson_mismatch', 'The lesson belongs to another class', { lessonId, classId }),
  latePenaltyInvalid: (allowLate: boolean, latePenaltyPercent: number) =>
    new AssignmentsHttpException(HttpStatus.BAD_REQUEST, 'late_penalty_invalid', 'A late penalty needs allowLate', { allowLate, latePenaltyPercent }),
  assignmentLocked: (status: string, fields: readonly string[], submissionCount: number) =>
    new AssignmentsHttpException(HttpStatus.CONFLICT, 'assignment_locked', 'These fields cannot change for this assignment', {
      status,
      fields: [...fields],
      submissionCount,
    }),
  invalidTransition: (from: string, action: string, allowed: readonly string[]) =>
    new AssignmentsHttpException(HttpStatus.CONFLICT, 'invalid_transition', `Action "${action}" is not allowed for a ${from} assignment`, {
      from,
      action,
      allowed: [...allowed],
    }),
  assignmentNotDeletable: (status: string, submissionCount: number) =>
    new AssignmentsHttpException(HttpStatus.CONFLICT, 'assignment_not_deletable', 'Only a draft without submissions can be deleted; close it instead', {
      status,
      submissionCount,
    }),
  nothingToUpdate: () => new AssignmentsHttpException(HttpStatus.BAD_REQUEST, 'nothing_to_update', 'The request body contains no field to update'),
  cursorInvalid: () =>
    new AssignmentsHttpException(HttpStatus.BAD_REQUEST, 'cursor_invalid', 'The cursor is invalid or belongs to a different order; restart from the first page'),
  submissionNotFound: (submissionId: string) =>
    new AssignmentsHttpException(HttpStatus.NOT_FOUND, 'submission_not_found', 'No submission with this id', { submissionId }),
  assignmentClosed: (reason: AssignmentClosedReason, dueAt: string | null) =>
    new AssignmentsHttpException(HttpStatus.CONFLICT, 'assignment_closed', 'The assignment does not take submissions now', { reason, dueAt }),
  notEnrolled: (classId: string) =>
    new AssignmentsHttpException(HttpStatus.FORBIDDEN, 'not_enrolled', 'Only a student with an active enrollment in the class submits', { classId }),
  attemptsExhausted: (maxAttempts: number, attempts: number) =>
    new AssignmentsHttpException(HttpStatus.CONFLICT, 'attempts_exhausted', 'No attempt left for this assignment', { maxAttempts, attempts }),
  scoreOutOfRange: (score: number, maxScore: number) =>
    new AssignmentsHttpException(HttpStatus.BAD_REQUEST, 'score_out_of_range', `The score must be between 0 and ${maxScore}`, { score, maxScore }),
  feedbackRequired: () => new AssignmentsHttpException(HttpStatus.BAD_REQUEST, 'feedback_required', 'Returning a submission needs feedback'),
  submissionInvalid: () => new AssignmentsHttpException(HttpStatus.BAD_REQUEST, 'submission_invalid', 'A submission needs a text answer or a link'),
  attemptConflict: (expected: number, next: number) =>
    new AssignmentsHttpException(HttpStatus.CONFLICT, 'attempt_conflict', `Attempt ${expected} is not the next attempt (${next}); it may already have been submitted`, { expected, next }),
  reviewConflict: (submissionId: string, status: string, gradedAt: string | null) =>
    new AssignmentsHttpException(HttpStatus.CONFLICT, 'review_conflict', 'The submission was reviewed meanwhile; reload it before reviewing', { submissionId, status, gradedAt }),
};
