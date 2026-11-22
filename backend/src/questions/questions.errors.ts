// Error vocabulary of the question banks (MOD-09 phase 2 — roadmap §4r.6,
// API-260..API-269; decisions D-R162..D-R164). Same shape as the other
// dictionaries: the body is `{ statusCode, error, code, message, ...details }`
// and the frontend maps the stable `code` to a localized message. A detail is
// never named `code` — it would overwrite the error code. The exam side of the
// phase (linking, attempts, grading) uses the MOD-09 dictionary of
// grades/grades.errors.ts.
//
//   question_bank_not_found  404 — no bank with this id, or one the caller may not see
//                                  (D-R162: their own, a course they teach, or every
//                                  bank with classes.manage)
//   question_bank_in_use     409 — an exam links a question of the bank: archive the
//                                  questions instead ({ linkedQuestionCount })
//   course_not_found         404 — the course does not exist, or the caller neither
//                                  teaches a class of it nor holds classes.manage
//                                  ({ courseId })
//   question_not_found       404 — no question with this id, or one in a bank the
//                                  caller may not see
//   question_invalid         400 — the content breaks a rule of its type or status
//                                  ({ problems })
//   question_in_use          409 — an exam links the question: archive it instead
//                                  ({ examCount })
//   nothing_to_update        400 — PATCH body without any field (as API-018)
//   cursor_invalid           400 — the list cursor does not belong to this list
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { QuestionProblem } from './questions.rules.js';

export const QUESTIONS_ERROR_CODES = [
  'question_bank_not_found',
  'question_bank_in_use',
  'course_not_found',
  'question_not_found',
  'question_invalid',
  'question_in_use',
  'nothing_to_update',
  'cursor_invalid',
] as const;

export type QuestionsErrorCode = (typeof QUESTIONS_ERROR_CODES)[number];

export interface QuestionsErrorBody {
  statusCode: number;
  error: string;
  code: QuestionsErrorCode;
  message: string;
  [detail: string]: unknown;
}

/** HttpException whose body is `{ statusCode, error, code, message, ...details }`. */
export class QuestionsHttpException extends HttpException {
  readonly code: QuestionsErrorCode;

  constructor(status: HttpStatus, code: QuestionsErrorCode, message: string, details: Record<string, unknown> = {}) {
    const body: QuestionsErrorBody = {
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

export const questionsError = {
  bankNotFound: (bankId: string) => new QuestionsHttpException(HttpStatus.NOT_FOUND, 'question_bank_not_found', 'No question bank with this id', { bankId }),
  bankInUse: (linkedQuestionCount: number) =>
    new QuestionsHttpException(HttpStatus.CONFLICT, 'question_bank_in_use', 'An exam links a question of this bank; archive its questions instead', { linkedQuestionCount }),
  courseNotFound: (courseId: string) => new QuestionsHttpException(HttpStatus.NOT_FOUND, 'course_not_found', 'No course with this id', { courseId }),
  questionNotFound: (questionId: string) => new QuestionsHttpException(HttpStatus.NOT_FOUND, 'question_not_found', 'No question with this id', { questionId }),
  questionInvalid: (problems: readonly QuestionProblem[]) =>
    new QuestionsHttpException(HttpStatus.BAD_REQUEST, 'question_invalid', 'The question breaks a rule of its type', { problems: [...problems] }),
  questionInUse: (examCount: number) =>
    new QuestionsHttpException(HttpStatus.CONFLICT, 'question_in_use', 'An exam links this question; archive it instead', { examCount }),
  nothingToUpdate: () => new QuestionsHttpException(HttpStatus.BAD_REQUEST, 'nothing_to_update', 'The request body contains no field to update'),
  cursorInvalid: () =>
    new QuestionsHttpException(HttpStatus.BAD_REQUEST, 'cursor_invalid', 'The cursor is invalid or belongs to a different list; restart from the first page'),
};
