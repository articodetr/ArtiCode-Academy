// Error vocabulary of MOD-04 (levels, courses, syllabus). Same shape as
// AuthHttpException / UsersHttpException / AcademyHttpException: the body is
// `{ statusCode, error, code, message, ...details }` and the frontend maps the
// stable `code` to a localized message.
//
//   level_not_found       404  — no level with this id ({ levelId })
//   level_code_taken      409  — another level already uses the code ({ levelCode })
//   level_in_use          409  — courses still point at the level ({ courseCount })
//   level_order_invalid   400  — the order list is not a permutation of every
//                                level ({ missing, unknown, duplicates })
//   nothing_to_update     400  — PATCH body without any field (as API-018)
//
// Course codes (course_not_found, course_code_taken, course_not_deletable,
// invalid_transition, cursor_invalid) join with MOD-04-T03/T04.
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const COURSES_ERROR_CODES = [
  'level_not_found',
  'level_code_taken',
  'level_in_use',
  'level_order_invalid',
  'nothing_to_update',
] as const;

export type CoursesErrorCode = (typeof COURSES_ERROR_CODES)[number];

export interface CoursesErrorBody {
  statusCode: number;
  error: string;
  code: CoursesErrorCode;
  message: string;
  [detail: string]: unknown;
}

/** HttpException whose body is `{ statusCode, error, code, message, ...details }`. */
export class CoursesHttpException extends HttpException {
  readonly code: CoursesErrorCode;

  constructor(status: HttpStatus, code: CoursesErrorCode, message: string, details: Record<string, unknown> = {}) {
    const body: CoursesErrorBody = {
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

export interface LevelOrderProblems {
  missing: string[];
  unknown: string[];
  duplicates: string[];
}

export const coursesError = {
  levelNotFound: (levelId: string) =>
    new CoursesHttpException(HttpStatus.NOT_FOUND, 'level_not_found', 'No level with this id', { levelId }),
  // The detail is `levelCode`, never `code`: a `code` detail would overwrite the error code.
  levelCodeTaken: (levelCode: string) =>
    new CoursesHttpException(HttpStatus.CONFLICT, 'level_code_taken', 'Another level already uses this code', { levelCode }),
  levelInUse: (courseCount: number) =>
    new CoursesHttpException(
      HttpStatus.CONFLICT,
      'level_in_use',
      'Courses still use this level; move them to another level or deactivate it instead',
      { courseCount },
    ),
  levelOrderInvalid: (problems: LevelOrderProblems) =>
    new CoursesHttpException(
      HttpStatus.BAD_REQUEST,
      'level_order_invalid',
      'The order must list every level exactly once',
      { ...problems },
    ),
  nothingToUpdate: () =>
    new CoursesHttpException(HttpStatus.BAD_REQUEST, 'nothing_to_update', 'The request body contains no field to update'),
};
