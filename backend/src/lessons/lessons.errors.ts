// Error vocabulary of MOD-06 lessons and attendance (roadmap §4f.4/§4f.5,
// owner decisions D-R30..D-R34). Same shape as ClassesHttpException /
// ScheduleHttpException: the body is `{ statusCode, error, code, message,
// ...details }` and the frontend maps the stable `code` to a localized
// message. The whole dictionary is defined in T02 so T03 (attendance) and
// T04 («my lessons») never edit this file for a new code. A detail is never
// named `code` — it would overwrite the error code.
//
//   lesson_not_found          404 — no lesson with this id, or one the caller may
//                                   not see (lessons.read without classes.manage
//                                   sees the lessons of assigned classes — D-R16)
//   class_not_found           404 — unknown class, or one the caller may not see
//   class_closed              409 — the class is completed or cancelled: its lessons
//                                   are frozen (D-R33 (1)) ({ classId, status })
//   teacher_not_assigned      422 — the lesson's teacher is not one of the class's
//                                   teachers ({ userId })
//   syllabus_item_not_found   404 — no syllabus item with this id ({ syllabusItemId })
//   syllabus_item_mismatch    422 — the syllabus item belongs to another course
//                                   ({ syllabusItemId, courseId })
//   room_not_found            404 — no room with this id ({ roomId })
//   room_inactive             422 — the room is inactive ({ roomId })
//   time_range_invalid        400 — endsAt not after startsAt, or longer than 12 hours
//                                   ({ startsAt, endsAt, maxHours })
//   lesson_conflict           409 — the room or the teacher already has a lesson at an
//                                   overlapping time (EXCLUDE constraints — D-R34)
//                                   ({ resource: room|teacher, conflictingLessonId, conflictingClassId })
//   lesson_locked             409 — the field cannot change in the lesson's status
//                                   (time, room, teacher of a non-scheduled lesson;
//                                   anything of a cancelled one) ({ status, fields })
//   lesson_not_started        409 — `complete` before the lesson's start time ({ startsAt })
//   invalid_transition        409 — status action not allowed from the current state
//                                   ({ from, action, allowed })
//   lesson_not_deletable      409 — only a scheduled lesson without attendance records
//                                   is deleted; cancel the others ({ status, attendanceCount })
//   nothing_to_update         400 — PATCH body without any field (as API-018)
//   cursor_invalid            400 — the list cursor does not belong to this order
//   -- T03 (attendance) --
//   attendance_closed         409 — attendance for a cancelled lesson, or before its
//                                   start time (D-R33) ({ reason: cancelled|not_started, startsAt })
//   not_enrolled              422 — a student without an active or completed enrollment
//                                   in the class ({ studentIds })
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const LESSONS_ERROR_CODES = [
  'lesson_not_found',
  'class_not_found',
  'class_closed',
  'teacher_not_assigned',
  'syllabus_item_not_found',
  'syllabus_item_mismatch',
  'room_not_found',
  'room_inactive',
  'time_range_invalid',
  'lesson_conflict',
  'lesson_locked',
  'lesson_not_started',
  'invalid_transition',
  'lesson_not_deletable',
  'nothing_to_update',
  'cursor_invalid',
  'attendance_closed',
  'not_enrolled',
] as const;

export type LessonsErrorCode = (typeof LESSONS_ERROR_CODES)[number];

export interface LessonsErrorBody {
  statusCode: number;
  error: string;
  code: LessonsErrorCode;
  message: string;
  [detail: string]: unknown;
}

/** HttpException whose body is `{ statusCode, error, code, message, ...details }`. */
export class LessonsHttpException extends HttpException {
  readonly code: LessonsErrorCode;

  constructor(status: HttpStatus, code: LessonsErrorCode, message: string, details: Record<string, unknown> = {}) {
    const body: LessonsErrorBody = {
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

export type LessonConflictResource = 'room' | 'teacher';
export type AttendanceClosedReason = 'cancelled' | 'not_started';

export const lessonsError = {
  lessonNotFound: (lessonId: string) => new LessonsHttpException(HttpStatus.NOT_FOUND, 'lesson_not_found', 'No lesson with this id', { lessonId }),
  classNotFound: (classId: string) => new LessonsHttpException(HttpStatus.NOT_FOUND, 'class_not_found', 'No class with this id', { classId }),
  classClosed: (classId: string, status: string) =>
    new LessonsHttpException(HttpStatus.CONFLICT, 'class_closed', 'A completed or cancelled class has no editable lessons', { classId, status }),
  teacherNotAssigned: (userId: string) =>
    new LessonsHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'teacher_not_assigned', 'The teacher is not assigned to the class', { userId }),
  syllabusItemNotFound: (syllabusItemId: string) =>
    new LessonsHttpException(HttpStatus.NOT_FOUND, 'syllabus_item_not_found', 'No syllabus item with this id', { syllabusItemId }),
  syllabusItemMismatch: (syllabusItemId: string, courseId: string) =>
    new LessonsHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'syllabus_item_mismatch', 'The syllabus item belongs to another course', {
      syllabusItemId,
      courseId,
    }),
  roomNotFound: (roomId: string) => new LessonsHttpException(HttpStatus.NOT_FOUND, 'room_not_found', 'No room with this id', { roomId }),
  roomInactive: (roomId: string) => new LessonsHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'room_inactive', 'The room is inactive', { roomId }),
  timeRangeInvalid: (startsAt: string, endsAt: string, maxHours: number) =>
    new LessonsHttpException(HttpStatus.BAD_REQUEST, 'time_range_invalid', `endsAt must be after startsAt and at most ${maxHours} hours later`, {
      startsAt,
      endsAt,
      maxHours,
    }),
  lessonConflict: (resource: LessonConflictResource, conflictingLessonId: string | null, conflictingClassId: string | null) =>
    new LessonsHttpException(HttpStatus.CONFLICT, 'lesson_conflict', `The ${resource} already has a lesson at an overlapping time`, {
      resource,
      conflictingLessonId,
      conflictingClassId,
    }),
  lessonLocked: (status: string, fields: readonly string[]) =>
    new LessonsHttpException(HttpStatus.CONFLICT, 'lesson_locked', `These fields cannot change for a ${status} lesson`, { status, fields: [...fields] }),
  lessonNotStarted: (startsAt: string) =>
    new LessonsHttpException(HttpStatus.CONFLICT, 'lesson_not_started', 'The lesson can be completed once its start time has passed', { startsAt }),
  invalidTransition: (from: string, action: string, allowed: readonly string[]) =>
    new LessonsHttpException(HttpStatus.CONFLICT, 'invalid_transition', `Action "${action}" is not allowed for a ${from} lesson`, {
      from,
      action,
      allowed: [...allowed],
    }),
  lessonNotDeletable: (status: string, attendanceCount: number) =>
    new LessonsHttpException(HttpStatus.CONFLICT, 'lesson_not_deletable', 'Only a scheduled lesson without attendance records can be deleted; cancel it instead', {
      status,
      attendanceCount,
    }),
  nothingToUpdate: () => new LessonsHttpException(HttpStatus.BAD_REQUEST, 'nothing_to_update', 'The request body contains no field to update'),
  cursorInvalid: () =>
    new LessonsHttpException(HttpStatus.BAD_REQUEST, 'cursor_invalid', 'The cursor is invalid or belongs to a different order; restart from the first page'),
  attendanceClosed: (reason: AttendanceClosedReason, startsAt: string) =>
    new LessonsHttpException(HttpStatus.CONFLICT, 'attendance_closed', 'Attendance is recorded for a lesson that is not cancelled and has started', {
      reason,
      startsAt,
    }),
  notEnrolled: (studentIds: readonly string[]) =>
    new LessonsHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'not_enrolled', 'These students have no active or completed enrollment in the class', {
      studentIds: [...studentIds],
    }),
};
