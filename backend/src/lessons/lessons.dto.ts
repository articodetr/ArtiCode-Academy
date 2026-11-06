import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDefined, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import { DeliveryMode, LessonStatus } from '../generated/prisma/client.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { ScheduleRoomDto, ScheduleTeacherDto } from '../schedule/class-schedule.dto.js';
import { TimetableClassDto } from '../schedule/timetable.dto.js';
import { nullableTextParam, textParam } from '../users/users.validation.js';
import { LESSON_STATUS_ACTIONS } from './lessons.status.js';
import type { LessonStatusAction } from './lessons.status.js';
import { IsInstant, MAX_LESSON_HOURS } from './lessons.time.js';

export const LESSONS_PAGE_DEFAULT = 20;
export const LESSONS_PAGE_MAX = 100;
export const LESSON_STATUSES = Object.values(LessonStatus) as LessonStatus[];
export const DELIVERY_MODES = Object.values(DeliveryMode) as DeliveryMode[];
/** The list is keyset-paginated on `(starts_at, id)`; the sort key is fixed. */
export const LESSON_SORT_FIELD = 'startsAt';
export const MEETING_URL_MAX_LENGTH = 2048;
/** `https://` and no whitespace (CHECK `ck_lessons_meeting_url_https` is the backstop). */
export const MEETING_URL_PATTERN = /^https:\/\/\S+$/;
/** Upper bound of the free-text reason (stored in `cancellation_reason` for `cancel`, recorded in the audit event). */
export const LESSON_STATUS_REASON_MAX_LENGTH = 500;

const MEETING_URL_MESSAGE = 'meetingUrl must be an https:// link without spaces';

export class ListLessonsQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Lessons of this class' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Lessons assigned to this teacher (a lesson without a teacher never matches)' })
  @IsOptional()
  @IsUUID('all')
  teacherId?: string;

  @ApiPropertyOptional({ enum: LESSON_STATUSES })
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

  @ApiPropertyOptional({ default: LESSONS_PAGE_DEFAULT, minimum: 1, maximum: LESSONS_PAGE_MAX })
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

export class CreateLessonDto {
  @ApiProperty({ type: LocalizedTextDto, description: 'Localized title `{ ar, en?, tr? }`; `ar` is required' })
  @IsDefined()
  @IsObject({ message: 'title must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  title: LocalizedTextDto;

  @ApiPropertyOptional({ type: LocalizedTextDto, nullable: true, description: 'Localized description; absent or null = none' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'description must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  description?: LocalizedTextDto | null;

  @ApiPropertyOptional({ enum: DELIVERY_MODES, default: DeliveryMode.in_person })
  @IsOptional()
  @IsIn(DELIVERY_MODES)
  deliveryMode?: DeliveryMode;

  @ApiProperty({ example: '2026-11-10T10:00:00+03:00', description: 'ISO 8601 instant with an offset; a past instant is accepted (a session that already took place)' })
  @IsInstant()
  startsAt: string;

  @ApiProperty({ example: '2026-11-10T11:30:00+03:00', description: `After startsAt and at most ${MAX_LESSON_HOURS} hours later (\`time_range_invalid\`)` })
  @IsInstant()
  endsAt: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'An existing, active room; absent or null = no room' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  roomId?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'One of the class’s teachers (`teacher_not_assigned`); absent = the class’s lead teacher at creation (a snapshot — D-R33), null = no teacher',
  })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  teacherUserId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'A syllabus item of the class’s course (`syllabus_item_mismatch` otherwise)' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  syllabusItemId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: MEETING_URL_MAX_LENGTH, example: 'https://meet.example.com/abc', description: '`https://` only; null or blank = none' })
  @IsOptional()
  @Transform(nullableTextParam)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @Length(1, MEETING_URL_MAX_LENGTH)
  @Matches(MEETING_URL_PATTERN, { message: MEETING_URL_MESSAGE })
  meetingUrl?: string | null;
}

/**
 * PATCH semantics (as API-018): absent = unchanged, `null` clears
 * `description`, `roomId`, `teacherUserId`, `syllabusItemId` and
 * `meetingUrl`; `title`, `deliveryMode`, `startsAt` and `endsAt` refuse null.
 * Time, room and teacher change for a scheduled lesson only; a cancelled
 * lesson accepts nothing (`lesson_locked`). The status changes through
 * `POST /api/lessons/:id/status`.
 */
export class UpdateLessonDto {
  @ApiPropertyOptional({ type: LocalizedTextDto, description: 'Replaces the whole localized title; `ar` required; not nullable' })
  @ValidateIf((dto: UpdateLessonDto) => dto.title !== undefined)
  @IsObject({ message: 'title must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  title?: LocalizedTextDto;

  @ApiPropertyOptional({ type: LocalizedTextDto, nullable: true, description: 'Replaces the whole localized description; null clears it' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'description must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  description?: LocalizedTextDto | null;

  @ApiPropertyOptional({ enum: DELIVERY_MODES })
  @ValidateIf((dto: UpdateLessonDto) => dto.deliveryMode !== undefined)
  @IsIn(DELIVERY_MODES)
  deliveryMode?: DeliveryMode;

  @ApiPropertyOptional({ example: '2026-11-10T10:00:00+03:00', description: 'Scheduled lessons only (`lesson_locked`)' })
  @ValidateIf((dto: UpdateLessonDto) => dto.startsAt !== undefined)
  @IsInstant()
  startsAt?: string;

  @ApiPropertyOptional({ example: '2026-11-10T11:30:00+03:00', description: 'Scheduled lessons only; the merged range is checked (`time_range_invalid`)' })
  @ValidateIf((dto: UpdateLessonDto) => dto.endsAt !== undefined)
  @IsInstant()
  endsAt?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Scheduled lessons only; null clears the room' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  roomId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Scheduled lessons only; one of the class’s teachers; null clears the teacher' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  teacherUserId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'A syllabus item of the class’s course; null clears the link' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  syllabusItemId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: MEETING_URL_MAX_LENGTH, description: '`https://` only; null or blank clears it' })
  @IsOptional()
  @Transform(nullableTextParam)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @Length(1, MEETING_URL_MAX_LENGTH)
  @Matches(MEETING_URL_PATTERN, { message: MEETING_URL_MESSAGE })
  meetingUrl?: string | null;
}

export class ChangeLessonStatusDto {
  @ApiProperty({
    enum: LESSON_STATUS_ACTIONS,
    description:
      'complete: scheduled→completed once the start time has passed (`lesson_not_started`) · cancel: scheduled→cancelled (the reason is stored) · ' +
      'restore: cancelled→scheduled (conflicts are re-checked — `lesson_conflict`)',
  })
  @IsIn(LESSON_STATUS_ACTIONS)
  action: LessonStatusAction;

  @ApiPropertyOptional({
    maxLength: LESSON_STATUS_REASON_MAX_LENGTH,
    description: 'Free text; stored as `cancellationReason` for `cancel` and recorded in the audit event; trimmed, blank = absent',
  })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, LESSON_STATUS_REASON_MAX_LENGTH)
  reason?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class LessonSyllabusItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 1 })
  sortOrder: number;

  @ApiProperty({ description: 'Localized title `{ ar, en?, tr? }`' })
  title: LocalizedText;
}

/** Attendance records of the lesson by status (computed, never stored). */
export class AttendanceCountsDto {
  @ApiProperty({ example: 12, description: 'Records of any status' })
  recorded: number;

  @ApiProperty({ example: 10 })
  present: number;

  @ApiProperty({ example: 1 })
  absent: number;

  @ApiProperty({ example: 1 })
  late: number;

  @ApiProperty({ example: 0 })
  excused: number;
}

export class LessonDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: TimetableClassDto, description: 'The class with its course' })
  class: TimetableClassDto;

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

  @ApiProperty({ enum: LESSON_STATUSES })
  status: LessonStatus;

  @ApiProperty({ type: ScheduleRoomDto, nullable: true })
  room: ScheduleRoomDto | null;

  @ApiProperty({ type: ScheduleTeacherDto, nullable: true, description: 'The lesson’s teacher by id and name; null = none' })
  teacher: ScheduleTeacherDto | null;

  @ApiProperty({ type: LessonSyllabusItemDto, nullable: true })
  syllabusItem: LessonSyllabusItemDto | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'The weekly slot the lesson was generated from (MOD-07-T05); null when created by hand' })
  scheduleId: string | null;

  @ApiProperty({ type: String, nullable: true })
  meetingUrl: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Set by `cancel`, cleared by `restore`' })
  cancellationReason: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601; set when attendance is first recorded (T03)' })
  attendanceTakenAt: string | null;

  @ApiProperty({ type: AttendanceCountsDto })
  attendance: AttendanceCountsDto;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class LessonListDto {
  @ApiProperty({ type: [LessonDto], description: 'By start time, then id' })
  items: LessonDto[];

  @ApiProperty({ nullable: true, description: 'Cursor of the next page; null on the last page' })
  nextCursor: string | null;
}
