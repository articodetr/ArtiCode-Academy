import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDefined, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { IsDecimalNumber } from '../common/decimal-number.js';
import { AssignmentInstructionsDto, AssignmentLessonDto } from '../assignments/assignments.dto.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import { ExamStatus, ExamType } from '../generated/prisma/client.js';
import { IsInstant } from '../lessons/lessons.time.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { TimetableClassDto } from '../schedule/timetable.dto.js';
import { textParam } from '../users/users.validation.js';
import { EXAM_STATUS_ACTIONS } from './exams.status.js';
import type { ExamStatusAction } from './exams.status.js';

export const EXAMS_PAGE_DEFAULT = 20;
export const EXAMS_PAGE_MAX = 100;
export const EXAM_STATUSES = Object.values(ExamStatus) as ExamStatus[];
export const EXAM_TYPES = Object.values(ExamType) as ExamType[];
/** `numeric(6,2)`. */
export const EXAM_SCORE_LIMIT = 9999.99;
/** `numeric(5,2)`. */
export const EXAM_WEIGHT_LIMIT = 999.99;
/** CHECK `ck_exams_duration_range`. */
export const EXAM_DURATION_MAX = 720;
export const EXAM_STATUS_REASON_MAX_LENGTH = 500;

/** Body numbers must be JSON numbers (or null in a PATCH): no implicit "12" → 12. */
function rawValue({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  return obj[key];
}

export class ListExamsQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Exams of this class' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Exams held in this lesson' })
  @IsOptional()
  @IsUUID('all')
  lessonId?: string;

  @ApiPropertyOptional({ enum: EXAM_STATUSES })
  @IsOptional()
  @IsIn(EXAM_STATUSES)
  status?: ExamStatus;

  @ApiPropertyOptional({ enum: EXAM_TYPES })
  @IsOptional()
  @IsIn(EXAM_TYPES)
  type?: ExamType;

  @ApiPropertyOptional({ example: '2026-11-01T00:00:00+03:00', description: 'Exams taking place at or after this instant (ISO 8601 with an offset); undated exams never match' })
  @IsOptional()
  @IsInstant()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30T23:59:59+03:00', description: 'Exams taking place at or before this instant (ISO 8601 with an offset); undated exams never match' })
  @IsOptional()
  @IsInstant()
  to?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc', description: 'By exam date (undated last), then id' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: SortOrder;

  @ApiPropertyOptional({ default: EXAMS_PAGE_DEFAULT, minimum: 1, maximum: EXAMS_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(EXAMS_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 512, description: 'Opaque `nextCursor` of the previous page; send it with the same filters and order' })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;
}

export class CreateExamDto {
  @ApiProperty({ type: LocalizedTextDto, description: 'Localized title `{ ar, en?, tr? }`; `ar` is required' })
  @IsDefined()
  @IsObject({ message: 'title must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  title: LocalizedTextDto;

  @ApiPropertyOptional({ type: AssignmentInstructionsDto, nullable: true, description: 'Localized description (4,000 characters per locale); absent or null = none' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'description must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => AssignmentInstructionsDto)
  description?: AssignmentInstructionsDto | null;

  @ApiProperty({ enum: EXAM_TYPES, description: 'quiz, midterm, final, project, oral, practice or other (D-R42)' })
  @IsIn(EXAM_TYPES)
  type: ExamType;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'A lesson of the same class (`lesson_mismatch` otherwise); absent or null = none' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  lessonId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2026-11-20T10:00:00+03:00', description: 'When the exam takes place (ISO 8601 instant with an offset); absent or null = not dated yet' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsInstant()
  scheduledAt?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: EXAM_DURATION_MAX, example: 60, description: 'Minutes (a JSON integer); absent or null = none' })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(EXAM_DURATION_MAX)
  durationMinutes?: number | null;

  @ApiProperty({ minimum: 0.01, maximum: EXAM_SCORE_LIMIT, example: 50, description: 'A JSON number with at most two decimals' })
  @Transform(rawValue)
  @IsDecimalNumber(2)
  @Min(0.01)
  @Max(EXAM_SCORE_LIMIT)
  maxScore: number;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: EXAM_SCORE_LIMIT, example: 25, description: 'At most maxScore (`pass_score_invalid`); informational — passing the course comes from the grade scheme' })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsDecimalNumber(2)
  @Min(0)
  @Max(EXAM_SCORE_LIMIT)
  passScore?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: EXAM_WEIGHT_LIMIT, example: 30, description: 'Weight in the final grade (D-R43); absent or null = informational' })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsDecimalNumber(2)
  @Min(0)
  @Max(EXAM_WEIGHT_LIMIT)
  weight?: number | null;
}

/**
 * PATCH semantics (as API-018): absent = unchanged, `null` clears
 * `description`, `lessonId`, `scheduledAt`, `durationMinutes`, `passScore` and
 * `weight`; `title`, `type` and `maxScore` refuse null. `maxScore` is locked
 * once a result exists (`exam_locked`); an exam of a cancelled class is frozen
 * (`class_closed`). The status changes through `POST /api/exams/:id/status`.
 */
export class UpdateExamDto {
  @ApiPropertyOptional({ type: LocalizedTextDto, description: 'Replaces the whole localized title; `ar` required; not nullable' })
  @ValidateIf((dto: UpdateExamDto) => dto.title !== undefined)
  @IsObject({ message: 'title must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  title?: LocalizedTextDto;

  @ApiPropertyOptional({ type: AssignmentInstructionsDto, nullable: true, description: 'Replaces the whole localized description; null clears it' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'description must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => AssignmentInstructionsDto)
  description?: AssignmentInstructionsDto | null;

  @ApiPropertyOptional({ enum: EXAM_TYPES, description: 'Not nullable' })
  @ValidateIf((dto: UpdateExamDto) => dto.type !== undefined)
  @IsIn(EXAM_TYPES)
  type?: ExamType;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'A lesson of the same class; null clears the link' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  lessonId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'ISO 8601 instant with an offset; null clears the date' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsInstant()
  scheduledAt?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: EXAM_DURATION_MAX, description: 'null clears it' })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(EXAM_DURATION_MAX)
  durationMinutes?: number | null;

  @ApiPropertyOptional({ minimum: 0.01, maximum: EXAM_SCORE_LIMIT, description: 'Locked once a result exists; not nullable' })
  @Transform(rawValue)
  @ValidateIf((dto: UpdateExamDto) => dto.maxScore !== undefined)
  @IsDecimalNumber(2)
  @Min(0.01)
  @Max(EXAM_SCORE_LIMIT)
  maxScore?: number;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: EXAM_SCORE_LIMIT, description: 'At most maxScore after the merge; null clears it' })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsDecimalNumber(2)
  @Min(0)
  @Max(EXAM_SCORE_LIMIT)
  passScore?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: EXAM_WEIGHT_LIMIT, description: 'null makes the exam informational' })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsDecimalNumber(2)
  @Min(0)
  @Max(EXAM_WEIGHT_LIMIT)
  weight?: number | null;
}

export class ChangeExamStatusDto {
  @ApiProperty({
    enum: EXAM_STATUS_ACTIONS,
    description:
      'schedule: draft→scheduled (the learners see the exam) · unschedule: scheduled→draft (only without results — `exam_has_results`) · ' +
      'publish: scheduled→published (sets publishedAt; the learners see their results) · unpublish: published→scheduled (hides them again); ' +
      '`schedule`/`publish` are refused for a cancelled class (`class_closed`)',
  })
  @IsIn(EXAM_STATUS_ACTIONS)
  action: ExamStatusAction;

  @ApiPropertyOptional({ maxLength: EXAM_STATUS_REASON_MAX_LENGTH, description: 'Free text recorded in the audit event; trimmed, blank = absent' })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, EXAM_STATUS_REASON_MAX_LENGTH)
  reason?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** The recorded results by status (computed, never stored). */
export class ExamResultCountsDto {
  @ApiProperty({ example: 14, description: 'Students with a recorded result' })
  students: number;

  @ApiProperty({ example: 12 })
  scored: number;

  @ApiProperty({ example: 1 })
  absent: number;

  @ApiProperty({ example: 1 })
  excused: number;
}

export class ExamDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: TimetableClassDto, description: 'The class with its course' })
  class: TimetableClassDto;

  @ApiProperty({ type: AssignmentLessonDto, nullable: true, description: 'The lesson the exam is held in, if any' })
  lesson: AssignmentLessonDto | null;

  @ApiProperty({ description: 'Localized title `{ ar, en?, tr? }`' })
  title: LocalizedText;

  @ApiProperty({ type: Object, nullable: true, description: 'Localized description or null' })
  description: LocalizedText | null;

  @ApiProperty({ enum: EXAM_TYPES })
  type: ExamType;

  @ApiProperty({ enum: EXAM_STATUSES, description: 'draft → scheduled (visible to the learners) → published (results visible) — D-R47' })
  status: ExamStatus;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 (UTC) — when the exam takes place' })
  scheduledAt: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 60 })
  durationMinutes: number | null;

  @ApiProperty({ example: 'Europe/Istanbul', description: 'IANA time zone to display the date in: the linked lesson’s room branch, else the academy’s (D-R41)' })
  timeZone: string;

  @ApiProperty({ example: 50 })
  maxScore: number;

  @ApiProperty({ type: Number, nullable: true, example: 25 })
  passScore: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 30, description: 'Weight in the final grade (D-R43); null = informational' })
  weight: number | null;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601; set by `publish`, cleared by `unpublish`' })
  publishedAt: string | null;

  @ApiProperty({ type: ExamResultCountsDto })
  results: ExamResultCountsDto;

  @ApiProperty({ example: 18, description: 'Active enrollments of the class' })
  activeStudents: number;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class ExamListDto {
  @ApiProperty({ type: [ExamDto], description: 'By exam date (undated last), then id' })
  items: ExamDto[];

  @ApiProperty({ nullable: true, description: 'Cursor of the next page; null on the last page' })
  nextCursor: string | null;
}
