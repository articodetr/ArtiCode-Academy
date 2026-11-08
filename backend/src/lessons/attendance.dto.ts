import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID, Length, ValidateIf, ValidateNested, registerDecorator } from 'class-validator';
import type { ValidationArguments, ValidationOptions } from 'class-validator';
import { EnrollmentStudentDto } from '../enrollments/enrollments.dto.js';
import { AttendanceStatus, EnrollmentStatus, LessonStatus } from '../generated/prisma/client.js';
import { ScheduleTeacherDto } from '../schedule/class-schedule.dto.js';
import { nullableTextParam } from '../users/users.validation.js';
import type { AttendanceBlocker } from './attendance.changes.js';
import { AttendanceCountsDto, LESSON_STATUSES } from './lessons.dto.js';
import { MAX_LESSON_HOURS } from './lessons.time.js';

export const ATTENDANCE_STATUSES = Object.values(AttendanceStatus) as AttendanceStatus[];
const ENROLLMENT_STATUSES = Object.values(EnrollmentStatus) as EnrollmentStatus[];
/**
 * Records per request. A lesson's roster rarely exceeds a few dozen students;
 * a larger one is saved in several requests, since students absent from a
 * request are never touched. The largest valid body (500 records with
 * three-byte notes of 500 characters) is about 800 KB, so the route has its
 * own JSON limit of 1 MB in LARGE_JSON_ROUTES (ADR-062, TEST-064).
 */
export const ATTENDANCE_BATCH_MAX = 500;
export const ATTENDANCE_NOTE_MAX_LENGTH = 500;
/** Whole minutes of lateness: at most the longest lesson (12 h). */
export const MINUTES_LATE_MAX = MAX_LESSON_HOURS * 60;
export const ATTENDANCE_BLOCKERS: readonly AttendanceBlocker[] = ['class_cancelled', 'cancelled', 'not_started'];

const MINUTES_LATE_MESSAGE = `minutesLate must be a whole number from 1 to ${MINUTES_LATE_MAX} and is allowed with status late only`;

/**
 * `minutesLate` is a whole number from 1 to MINUTES_LATE_MAX and only with
 * status `late` (the CHECKs `ck_attendance_records_minutes_late_*` are the
 * backstop). Absent or null is always fine (checked by @IsOptional before).
 * The property is typed `number | null`, so the global implicit conversion
 * never turns the string "5" into a number — a JSON number is required.
 */
export function IsMinutesLate(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isMinutesLate',
      target: target.constructor,
      propertyName: String(propertyName),
      options: { message: MINUTES_LATE_MESSAGE, ...options },
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const status = (args.object as { status?: unknown }).status;
          return status === 'late' && typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MINUTES_LATE_MAX;
        },
      },
    });
  };
}

/** One student's record as the request states it — the whole new state of that record. */
export class AttendanceRecordInputDto {
  @ApiProperty({ format: 'uuid', description: 'A student with an active or completed enrollment in the lesson’s class (`not_enrolled` otherwise)' })
  @IsUUID('all')
  studentId: string;

  @ApiProperty({ enum: ATTENDANCE_STATUSES })
  @IsIn(ATTENDANCE_STATUSES)
  status: AttendanceStatus;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 1,
    maximum: MINUTES_LATE_MAX,
    description: `Whole minutes of lateness, with status \`late\` only (1–${MINUTES_LATE_MAX}, a JSON integer); absent or null = none`,
  })
  @IsOptional()
  @IsMinutesLate()
  minutesLate?: number | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: ATTENDANCE_NOTE_MAX_LENGTH,
    description: 'The teacher’s note (shown on the sheet only — never to the student or the guardian); trimmed; absent, null or blank = none',
  })
  @IsOptional()
  @Transform(nullableTextParam)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @Length(1, ATTENDANCE_NOTE_MAX_LENGTH)
  note?: string | null;
}

/**
 * `PUT /api/lessons/:id/attendance` (API-100): a batch upsert. Each record is
 * the whole new state of that student's record (absent `minutesLate`/`note`
 * clear them); students absent from the request keep their records; nothing is
 * deleted. An identical batch is a 200 without a write or an event.
 */
export class RecordAttendanceDto {
  @ApiProperty({ type: [AttendanceRecordInputDto], minItems: 1, maxItems: ATTENDANCE_BATCH_MAX, description: 'One entry per student, no student twice' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ATTENDANCE_BATCH_MAX)
  @ArrayUnique((record: AttendanceRecordInputDto) => record?.studentId, { message: 'records must not repeat a studentId' })
  @ValidateNested({ each: true })
  @Type(() => AttendanceRecordInputDto)
  records: AttendanceRecordInputDto[];
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class AttendanceRecordDto {
  @ApiProperty({ enum: ATTENDANCE_STATUSES })
  status: AttendanceStatus;

  @ApiProperty({ type: Number, nullable: true, description: 'With status `late` only' })
  minutesLate: number | null;

  @ApiProperty({ type: String, nullable: true, description: 'The teacher’s note — holders of `attendance.read` only (D-R32)' })
  note: string | null;

  @ApiProperty({ type: ScheduleTeacherDto, nullable: true, description: 'Who last wrote the record (null when that account was deleted)' })
  recordedBy: ScheduleTeacherDto | null;

  @ApiProperty({ description: 'ISO 8601 — when the record was first written' })
  recordedAt: string;

  @ApiProperty({ description: 'ISO 8601 — last change' })
  updatedAt: string;
}

export class AttendanceItemDto {
  @ApiProperty({ type: EnrollmentStudentDto, description: 'The student in the caller’s projection (`email`/`username`/`phone` need `users.read_contact` — D-R07)' })
  student: EnrollmentStudentDto;

  @ApiProperty({
    enum: ENROLLMENT_STATUSES,
    nullable: true,
    description: 'The student’s enrollment in the class; `withdrawn`/`cancelled` students stay listed while they have a record but can no longer be recorded',
  })
  enrollmentStatus: EnrollmentStatus | null;

  @ApiProperty({ type: AttendanceRecordDto, nullable: true, description: 'null until the student is recorded' })
  record: AttendanceRecordDto | null;
}

/** The attendance sheet of a lesson (API-099), also the response of every successful PUT (API-100). */
export class AttendanceSheetDto {
  @ApiProperty({ format: 'uuid' })
  lessonId: string;

  @ApiProperty({ format: 'uuid' })
  classId: string;

  @ApiProperty({ enum: LESSON_STATUSES })
  lessonStatus: LessonStatus;

  @ApiProperty({ description: 'ISO 8601 (UTC)' })
  startsAt: string;

  @ApiProperty({ description: 'ISO 8601 (UTC)' })
  endsAt: string;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 — set by the first recording, never changed afterwards' })
  attendanceTakenAt: string | null;

  @ApiProperty({ description: 'True when a PUT would be accepted right now (class not cancelled, lesson not cancelled, start time passed — D-R33)' })
  recordable: boolean;

  @ApiProperty({ enum: ATTENDANCE_BLOCKERS, nullable: true, description: 'Why a PUT is refused: `class_cancelled` (→ `class_closed`), `cancelled` or `not_started` (→ `attendance_closed`)' })
  closedReason: AttendanceBlocker | null;

  @ApiProperty({ type: AttendanceCountsDto, description: 'Records by status (the same counts as `LessonDto.attendance`)' })
  counts: AttendanceCountsDto;

  @ApiProperty({
    type: [AttendanceItemDto],
    description: 'Every student with an active or completed enrollment in the class, plus any other student holding a record in the lesson; in enrollment order',
  })
  items: AttendanceItemDto[];
}
