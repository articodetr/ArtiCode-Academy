// Error vocabulary of MOD-07 scheduling (O9 — roadmap §4e, draft of T00). Same
// shape as BranchesHttpException / ClassesHttpException: the body is
// `{ statusCode, error, code, message, ...details }` and the frontend maps the
// stable `code` to a localized message. Never name a detail `code`: it would
// overwrite the error code. The whole dictionary is defined here so T02..T04
// never edit the same file for a new code.
//
//   room_not_found         404 — no room with this id
//   room_code_taken        409 — another room of the same branch (or of the
//                                academy's own site) already uses the code
//   room_in_use            409 — weekly slots still point to the room (and
//                                lessons, once MOD-06 exists); deactivate it instead
//   room_inactive          422 — a new slot names an inactive room (T03)
//   branch_not_found       404 — the branch named for a room does not exist
//   branch_inactive        422 — the branch named for a room is inactive
//   class_not_found        404 — unknown class, or one the caller may not see (T03)
//   class_not_schedulable  409 — the class is completed or cancelled (T03)
//   schedule_invalid       400 — unknown slot ids or duplicates in a PUT (T03)
//   schedule_conflict      409 — the room or the teacher is double-booked (T03)
//   non_working_day        422 — the weekday is outside scheduling.workingDays (T03)
//   teacher_not_assigned   422 — the slot's teacher is not a teacher of the class (T03)
//   nothing_to_update      400 — PATCH body without any field (as API-018)
import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const SCHEDULE_ERROR_CODES = [
  'room_not_found',
  'room_code_taken',
  'room_in_use',
  'room_inactive',
  'branch_not_found',
  'branch_inactive',
  'class_not_found',
  'class_not_schedulable',
  'schedule_invalid',
  'schedule_conflict',
  'non_working_day',
  'teacher_not_assigned',
  'nothing_to_update',
] as const;

export type ScheduleErrorCode = (typeof SCHEDULE_ERROR_CODES)[number];

export interface ScheduleErrorBody {
  statusCode: number;
  error: string;
  code: ScheduleErrorCode;
  message: string;
  [detail: string]: unknown;
}

/** HttpException whose body is `{ statusCode, error, code, message, ...details }`. */
export class ScheduleHttpException extends HttpException {
  readonly code: ScheduleErrorCode;

  constructor(status: HttpStatus, code: ScheduleErrorCode, message: string, details: Record<string, unknown> = {}) {
    const body: ScheduleErrorBody = {
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

export type ScheduleConflictKind = 'room' | 'teacher';

export const scheduleError = {
  roomNotFound: (roomId: string) => new ScheduleHttpException(HttpStatus.NOT_FOUND, 'room_not_found', 'No room with this id', { roomId }),
  roomCodeTaken: (roomCode: string, branchId: string | null) =>
    new ScheduleHttpException(HttpStatus.CONFLICT, 'room_code_taken', 'Another room of this branch already uses the code', { roomCode, branchId }),
  roomInUse: (slotCount: number) =>
    new ScheduleHttpException(HttpStatus.CONFLICT, 'room_in_use', 'Weekly slots still use this room; deactivate it instead', { slotCount }),
  roomInactive: (roomId: string) => new ScheduleHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'room_inactive', 'The room is inactive', { roomId }),
  branchNotFound: (branchId: string) => new ScheduleHttpException(HttpStatus.NOT_FOUND, 'branch_not_found', 'No branch with this id', { branchId }),
  branchInactive: (branchId: string) =>
    new ScheduleHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'branch_inactive', 'The branch is inactive; activate it or pick another', { branchId }),
  classNotFound: (classId: string) => new ScheduleHttpException(HttpStatus.NOT_FOUND, 'class_not_found', 'No class with this id', { classId }),
  classNotSchedulable: (status: string) =>
    new ScheduleHttpException(HttpStatus.CONFLICT, 'class_not_schedulable', 'A completed or cancelled class has no editable schedule', { status }),
  scheduleInvalid: (unknown: string[], duplicates: string[]) =>
    new ScheduleHttpException(HttpStatus.BAD_REQUEST, 'schedule_invalid', 'The slot list names unknown or duplicate slot ids', { unknown, duplicates }),
  scheduleConflict: (kind: ScheduleConflictKind, slot: unknown, conflictingSlotId: string | null, conflictingClassId: string | null) =>
    new ScheduleHttpException(HttpStatus.CONFLICT, 'schedule_conflict', `The ${kind} is already booked for an overlapping slot`, {
      kind,
      slot,
      conflictingSlotId,
      conflictingClassId,
    }),
  nonWorkingDay: (weekday: number) =>
    new ScheduleHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'non_working_day', 'The weekday is outside the academy’s working days', { weekday }),
  teacherNotAssigned: (userId: string) =>
    new ScheduleHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'teacher_not_assigned', 'The teacher is not assigned to the class', { userId }),
  nothingToUpdate: () => new ScheduleHttpException(HttpStatus.BAD_REQUEST, 'nothing_to_update', 'The request body contains no field to update'),
};
