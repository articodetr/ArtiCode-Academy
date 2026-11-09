import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import { MyClassStudentDto, MyClassTeacherDto } from '../enrollments/my-classes.dto.js';
import type { MyClassRelation } from '../enrollments/my-classes.policy.js';
import type { AttendanceStatus, DeliveryMode, LessonStatus } from '../generated/prisma/client.js';
import { ScheduleRoomDto } from '../schedule/class-schedule.dto.js';
import { TimetableClassDto } from '../schedule/timetable.dto.js';
import { ATTENDANCE_STATUSES } from './attendance.dto.js';
import { DELIVERY_MODES, LESSON_STATUSES, LESSONS_PAGE_DEFAULT, LESSONS_PAGE_MAX, LessonSyllabusItemDto } from './lessons.dto.js';
import { IsInstant } from './lessons.time.js';

const RELATIONS: MyClassRelation[] = ['self', 'child'];

/** Filters of «my lessons»; the page is keyset-paginated on `(starts_at, id)` like API-093. */
export class ListMyLessonsQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Lessons of this class only (a class the caller does not own matches nothing)' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Lessons owned through this student only — the caller or one of their linked children (anyone else matches nothing)' })
  @IsOptional()
  @IsUUID('all')
  studentId?: string;

  @ApiPropertyOptional({ enum: LESSON_STATUSES, description: 'Only lessons in this status (cancelled lessons are listed by default, with their status)' })
  @IsOptional()
  @IsIn(LESSON_STATUSES)
  status?: LessonStatus;

  @ApiPropertyOptional({ example: '2026-11-01T00:00:00+03:00', description: 'Lessons starting at or after this instant (ISO 8601 with an offset)' })
  @IsOptional()
  @IsInstant()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30T23:59:59+03:00', description: 'Lessons starting at or before this instant (ISO 8601 with an offset)' })
  @IsOptional()
  @IsInstant()
  to?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc', description: 'By start time, then id' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: SortOrder;

  @ApiPropertyOptional({ default: LESSONS_PAGE_DEFAULT, minimum: 1, maximum: LESSONS_PAGE_MAX, description: 'Lessons per page (a lesson owned through two children yields two items)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(LESSONS_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 512, description: 'Opaque `nextCursor` of the previous page; send it with the same filters and order' })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** The student's own attendance record in the lesson — status and lateness only; the teacher's note never reaches the learner (D-R32). */
export class MyLessonAttendanceDto {
  @ApiProperty({ enum: ATTENDANCE_STATUSES })
  status: AttendanceStatus;

  @ApiProperty({ type: Number, nullable: true, description: 'With status `late` only' })
  minutesLate: number | null;

  @ApiProperty({ description: 'ISO 8601 — when the record was first written' })
  recordedAt: string;
}

/** One lesson the caller owns through one relation (a lesson owned twice — two children in one class — appears twice). */
export class MyLessonItemDto {
  @ApiProperty({ format: 'uuid', description: 'The lesson (repeated when the caller owns it through several students)' })
  id: string;

  @ApiProperty({ description: 'Localized title `{ ar, en?, tr? }`' })
  title: LocalizedText;

  @ApiProperty({ type: Object, nullable: true, description: 'Localized description or null' })
  description: LocalizedText | null;

  @ApiProperty({ enum: DELIVERY_MODES })
  deliveryMode: DeliveryMode;

  @ApiProperty({ description: 'ISO 8601 (UTC)' })
  startsAt: string;

  @ApiProperty({ description: 'ISO 8601 (UTC)' })
  endsAt: string;

  @ApiProperty({ enum: LESSON_STATUSES, description: 'Cancelled lessons are listed with their status; the cancellation reason is never shown here' })
  status: LessonStatus;

  @ApiProperty({ type: String, nullable: true, description: 'The meeting link of a live lesson, as stored' })
  meetingUrl: string | null;

  @ApiProperty({ type: ScheduleRoomDto, nullable: true })
  room: ScheduleRoomDto | null;

  @ApiProperty({ example: 'Europe/Istanbul', description: 'IANA time zone the lesson is displayed in: the room’s branch when it has one, else the academy’s (D-R41 — as `timeZone` in API-090/091)' })
  timeZone: string;

  @ApiProperty({ type: MyClassTeacherDto, nullable: true, description: 'The lesson’s teacher by name only (no id, no contact fields); null = none' })
  teacher: MyClassTeacherDto | null;

  @ApiProperty({ type: LessonSyllabusItemDto, nullable: true })
  syllabusItem: LessonSyllabusItemDto | null;

  @ApiProperty({ type: TimetableClassDto, description: 'The class with its course' })
  class: TimetableClassDto;

  @ApiProperty({ enum: RELATIONS, description: '`self` = the caller is enrolled in the class; `child` = a student linked to the caller as guardian is' })
  relation: MyClassRelation;

  @ApiProperty({ type: MyClassStudentDto, description: 'The enrolled student the item is about (identity only)' })
  student: MyClassStudentDto;

  @ApiProperty({ type: MyLessonAttendanceDto, nullable: true, description: 'That student’s attendance in the lesson; null until recorded' })
  attendance: MyLessonAttendanceDto | null;
}

export class MyLessonListDto {
  @ApiProperty({ type: [MyLessonItemDto], description: 'By start time then lesson id, inside a lesson `self` → `child` by student id; empty for a user with no owned enrollment' })
  items: MyLessonItemDto[];

  @ApiProperty({ nullable: true, description: 'Cursor of the next page of lessons; null on the last page' })
  nextCursor: string | null;
}
