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
//   course_not_found      404  — no course with this id, or a course the caller
//                                may not see (not published, no courses.manage) ({ courseId })
//   course_code_taken     409  — another course already uses the code ({ courseCode })
//   course_not_deletable  409  — only a draft can be deleted; archive the others ({ status })
//   course_in_use         409  — classes still belong to the course (MOD-05-T02) ({ classCount })
//   invalid_transition    409  — status action not allowed from the current
//                                state ({ from, action, allowed })
//   age_range_invalid     400  — maxAge below minAge after merging the PATCH ({ minAge, maxAge })
//   cursor_invalid        400  — the list cursor does not belong to this sort/order
//   syllabus_invalid      400  — a syllabus replacement names an item of another
//                                course (or none) or repeats an id ({ unknown, duplicates })
//   -- MOD-19 (D-R122): the plan that prices a request --
//   fee_plan_not_found    404  — no fee plan with this id ({ feePlanId })
//   fee_plan_inactive     422  — the plan is deactivated ({ feePlanId })
//   fee_plan_mismatch     422  — the plan prices a class, or another course ({ feePlanId, courseId })
//   -- PORTAL-04: the school subjects (/api/subjects) and the course subject --
//   subject_not_found     404  — no subject with this id ({ subjectId })
//   subject_code_taken    409  — another subject already uses the code ({ subjectCode })
//   subject_in_use        409  — courses still point at the subject ({ courseCount })
//   subject_order_invalid 400  — the order list is not a permutation of every
//                                subject ({ missing, unknown, duplicates })
//   subject_inactive      422  — a course may not be given a deactivated subject ({ subjectId })
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const COURSES_ERROR_CODES = [
  'level_not_found',
  'level_code_taken',
  'level_in_use',
  'level_order_invalid',
  'nothing_to_update',
  'course_not_found',
  'course_code_taken',
  'course_not_deletable',
  'course_in_use',
  'invalid_transition',
  'age_range_invalid',
  'cursor_invalid',
  'syllabus_invalid',
  'fee_plan_not_found',
  'fee_plan_inactive',
  'fee_plan_mismatch',
  'subject_not_found',
  'subject_code_taken',
  'subject_in_use',
  'subject_order_invalid',
  'subject_inactive',
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

/** PORTAL-04: the same three lists for the subjects order. */
export type SubjectOrderProblems = LevelOrderProblems;

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
  courseNotFound: (courseId: string) =>
    new CoursesHttpException(HttpStatus.NOT_FOUND, 'course_not_found', 'No course with this id', { courseId }),
  courseCodeTaken: (courseCode: string) =>
    new CoursesHttpException(HttpStatus.CONFLICT, 'course_code_taken', 'Another course already uses this code', { courseCode }),
  courseNotDeletable: (status: string) =>
    new CoursesHttpException(
      HttpStatus.CONFLICT,
      'course_not_deletable',
      'Only a draft course can be deleted; archive it instead',
      { status },
    ),
  courseInUse: (classCount: number) =>
    new CoursesHttpException(
      HttpStatus.CONFLICT,
      'course_in_use',
      'Classes still belong to this course; archive it instead',
      { classCount },
    ),
  invalidTransition: (from: string, action: string, allowed: readonly string[]) =>
    new CoursesHttpException(HttpStatus.CONFLICT, 'invalid_transition', `Action "${action}" is not allowed for a ${from} course`, {
      from,
      action,
      allowed: [...allowed],
    }),
  ageRangeInvalid: (minAge: number, maxAge: number) =>
    new CoursesHttpException(HttpStatus.BAD_REQUEST, 'age_range_invalid', 'maxAge must not be below minAge', { minAge, maxAge }),
  cursorInvalid: () =>
    new CoursesHttpException(
      HttpStatus.BAD_REQUEST,
      'cursor_invalid',
      'The cursor is invalid or belongs to a different sort or order; restart from the first page',
    ),
  syllabusInvalid: (unknown: readonly string[], duplicates: readonly string[]) =>
    new CoursesHttpException(
      HttpStatus.BAD_REQUEST,
      'syllabus_invalid',
      'Every item id must belong to this course and appear at most once; new items carry no id',
      { unknown: [...unknown], duplicates: [...duplicates] },
    ),
  feePlanNotFound: (feePlanId: string) =>
    new CoursesHttpException(HttpStatus.NOT_FOUND, 'fee_plan_not_found', 'No fee plan with this id', { feePlanId }),
  feePlanInactive: (feePlanId: string) =>
    new CoursesHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'fee_plan_inactive', 'The fee plan is deactivated', { feePlanId }),
  feePlanMismatch: (feePlanId: string, courseId: string | null) =>
    new CoursesHttpException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'fee_plan_mismatch',
      'Only a general fee plan or a plan of this course (not of a class) can price the course',
      { feePlanId, courseId },
    ),
  subjectNotFound: (subjectId: string) =>
    new CoursesHttpException(HttpStatus.NOT_FOUND, 'subject_not_found', 'No subject with this id', { subjectId }),
  // The detail is `subjectCode`, never `code`: a `code` detail would overwrite the error code.
  subjectCodeTaken: (subjectCode: string) =>
    new CoursesHttpException(HttpStatus.CONFLICT, 'subject_code_taken', 'Another subject already uses this code', { subjectCode }),
  subjectInUse: (courseCount: number) =>
    new CoursesHttpException(
      HttpStatus.CONFLICT,
      'subject_in_use',
      'Courses still use this subject; move them to another subject or deactivate it instead',
      { courseCount },
    ),
  subjectOrderInvalid: (problems: SubjectOrderProblems) =>
    new CoursesHttpException(
      HttpStatus.BAD_REQUEST,
      'subject_order_invalid',
      'The order must list every subject exactly once',
      { ...problems },
    ),
  subjectInactive: (subjectId: string) =>
    new CoursesHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'subject_inactive', 'The subject is deactivated', { subjectId }),
};
