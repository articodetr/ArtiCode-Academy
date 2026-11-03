// Error vocabulary of MOD-05 (classes, class teachers, enrollments). Same
// shape as CoursesHttpException / UsersHttpException: the body is
// `{ statusCode, error, code, message, ...details }` and the frontend maps the
// stable `code` to a localized message. The whole dictionary drafted in T00
// (roadmap §4d.5) lives here from T02 on, so T03 (teachers) and T04
// (enrollments) only use it; T02 added `course_not_found`, `cursor_invalid`
// and `date_range_invalid`. A detail is never named `code` — it would
// overwrite the error code.
//
//   class_not_found          404  — no class with this id, or one the caller may
//                                   not see (classes.read without classes.manage
//                                   sees assigned classes only — D-R16) ({ classId })
//   class_code_taken         409  — another class already uses the code ({ classCode })
//   class_not_deletable      409  — only a planned class without any enrollment can be
//                                   deleted; cancel the others ({ status, enrollmentCount })
//   capacity_below_enrolled  409  — the new capacity is below the active enrollments
//                                   ({ capacity, enrolledCount })
//   course_not_found         404  — no course with this id ({ courseId })
//   course_not_published     422  — a class is created for a published course only ({ courseId, status })
//   invalid_transition       409  — status action not allowed from the current state
//                                   ({ from, action, allowed })
//   date_range_invalid       400  — endsOn before startsOn after merging the PATCH ({ startsOn, endsOn })
//   nothing_to_update        400  — PATCH body without any field (as API-018)
//   cursor_invalid           400  — the list cursor does not belong to this sort/order
//   -- T03 (class teachers) --
//   not_a_teacher            422  — the user holds no `teacher` role ({ userId })
//   user_not_eligible        422  — the user is neither invited nor active ({ userId, status })
//   user_not_found           404  — unknown or soft-deleted user ({ userId })
//   -- T04 (enrollments) --
//   class_not_enrollable     409  — the class is neither open nor running ({ status })
//   class_full               409  — every seat is taken ({ capacity, enrolledCount })
//   not_a_student            422  — the user holds no `student` role ({ userId })
//   already_enrolled         409  — the student already has an enrollment in this class
//                                   ({ enrollmentId, status })
//   enrollment_not_found     404  — no enrollment with this id ({ enrollmentId })
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const CLASSES_ERROR_CODES = [
  'class_not_found',
  'class_code_taken',
  'class_not_deletable',
  'capacity_below_enrolled',
  'course_not_found',
  'course_not_published',
  'invalid_transition',
  'date_range_invalid',
  'nothing_to_update',
  'cursor_invalid',
  'not_a_teacher',
  'user_not_eligible',
  'user_not_found',
  'class_not_enrollable',
  'class_full',
  'not_a_student',
  'already_enrolled',
  'enrollment_not_found',
] as const;

export type ClassesErrorCode = (typeof CLASSES_ERROR_CODES)[number];

export interface ClassesErrorBody {
  statusCode: number;
  error: string;
  code: ClassesErrorCode;
  message: string;
  [detail: string]: unknown;
}

/** HttpException whose body is `{ statusCode, error, code, message, ...details }`. */
export class ClassesHttpException extends HttpException {
  readonly code: ClassesErrorCode;

  constructor(status: HttpStatus, code: ClassesErrorCode, message: string, details: Record<string, unknown> = {}) {
    const body: ClassesErrorBody = {
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

export const classesError = {
  classNotFound: (classId: string) =>
    new ClassesHttpException(HttpStatus.NOT_FOUND, 'class_not_found', 'No class with this id', { classId }),
  classCodeTaken: (classCode: string) =>
    new ClassesHttpException(HttpStatus.CONFLICT, 'class_code_taken', 'Another class already uses this code', { classCode }),
  classNotDeletable: (status: string, enrollmentCount: number) =>
    new ClassesHttpException(
      HttpStatus.CONFLICT,
      'class_not_deletable',
      'Only a planned class without enrollments can be deleted; cancel it instead',
      { status, enrollmentCount },
    ),
  capacityBelowEnrolled: (capacity: number, enrolledCount: number) =>
    new ClassesHttpException(
      HttpStatus.CONFLICT,
      'capacity_below_enrolled',
      'The capacity cannot be lower than the number of active enrollments',
      { capacity, enrolledCount },
    ),
  courseNotFound: (courseId: string) =>
    new ClassesHttpException(HttpStatus.NOT_FOUND, 'course_not_found', 'No course with this id', { courseId }),
  courseNotPublished: (courseId: string, status: string) =>
    new ClassesHttpException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'course_not_published',
      'A class can only be created for a published course',
      { courseId, status },
    ),
  invalidTransition: (from: string, action: string, allowed: readonly string[]) =>
    new ClassesHttpException(HttpStatus.CONFLICT, 'invalid_transition', `Action "${action}" is not allowed for a ${from} class`, {
      from,
      action,
      allowed: [...allowed],
    }),
  dateRangeInvalid: (startsOn: string, endsOn: string) =>
    new ClassesHttpException(HttpStatus.BAD_REQUEST, 'date_range_invalid', 'endsOn must not be before startsOn', { startsOn, endsOn }),
  nothingToUpdate: () =>
    new ClassesHttpException(HttpStatus.BAD_REQUEST, 'nothing_to_update', 'The request body contains no field to update'),
  cursorInvalid: () =>
    new ClassesHttpException(
      HttpStatus.BAD_REQUEST,
      'cursor_invalid',
      'The cursor is invalid or belongs to a different sort or order; restart from the first page',
    ),
  notATeacher: (userId: string) =>
    new ClassesHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'not_a_teacher', 'The user does not hold the teacher role', { userId }),
  userNotEligible: (userId: string, status: string) =>
    new ClassesHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'user_not_eligible', 'Only invited or active users can be assigned', {
      userId,
      status,
    }),
  userNotFound: (userId: string) =>
    new ClassesHttpException(HttpStatus.NOT_FOUND, 'user_not_found', 'No user with this id', { userId }),
  classNotEnrollable: (status: string) =>
    new ClassesHttpException(HttpStatus.CONFLICT, 'class_not_enrollable', 'Students can only be enrolled in an open or running class', {
      status,
    }),
  classFull: (capacity: number, enrolledCount: number) =>
    new ClassesHttpException(HttpStatus.CONFLICT, 'class_full', 'The class has no free seat', { capacity, enrolledCount }),
  notAStudent: (userId: string) =>
    new ClassesHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'not_a_student', 'The user does not hold the student role', { userId }),
  alreadyEnrolled: (enrollmentId: string, status: string) =>
    new ClassesHttpException(HttpStatus.CONFLICT, 'already_enrolled', 'The student already has an enrollment in this class', {
      enrollmentId,
      status,
    }),
  enrollmentNotFound: (enrollmentId: string) =>
    new ClassesHttpException(HttpStatus.NOT_FOUND, 'enrollment_not_found', 'No enrollment with this id', { enrollmentId }),
};
