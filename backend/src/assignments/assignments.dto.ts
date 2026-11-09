import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import { AssignmentStatus } from '../generated/prisma/client.js';
import { IsInstant } from '../lessons/lessons.time.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { TimetableClassDto } from '../schedule/timetable.dto.js';
import { nullableTextParam, textParam } from '../users/users.validation.js';
import { ASSIGNMENT_STATUS_ACTIONS } from './assignments.status.js';
import type { AssignmentStatusAction } from './assignments.status.js';

export const ASSIGNMENTS_PAGE_DEFAULT = 20;
export const ASSIGNMENTS_PAGE_MAX = 100;
export const ASSIGNMENT_STATUSES = Object.values(AssignmentStatus) as AssignmentStatus[];
/** `numeric(6,2)`. */
export const MAX_SCORE_LIMIT = 9999.99;
/** `numeric(5,2)`. */
export const WEIGHT_LIMIT = 999.99;
export const MAX_ATTEMPTS_LIMIT = 20;
/** Per locale; the localized title keeps the shared 200-character limit. */
export const INSTRUCTIONS_MAX_LENGTH = 4000;
/** Upper bound of the free-text reason recorded in the audit event of a status action. */
export const ASSIGNMENT_STATUS_REASON_MAX_LENGTH = 500;

/** Body numbers and booleans must be JSON numbers/booleans (or null in a PATCH): no implicit "12" → 12 or "yes" → true. */
function rawValue({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  return obj[key];
}

function trimParam({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Localized instructions `{ ar, en?, tr? }` — like LocalizedTextDto with a longer limit (4,000 characters per locale). */
export class AssignmentInstructionsDto {
  @ApiProperty({ minLength: 1, maxLength: INSTRUCTIONS_MAX_LENGTH, example: 'حلّ تمارين الصفحة 12 وارفع صورة الحل' })
  @Transform(trimParam)
  @IsString()
  @Length(1, INSTRUCTIONS_MAX_LENGTH)
  ar: string;

  @ApiPropertyOptional({ maxLength: INSTRUCTIONS_MAX_LENGTH })
  @IsOptional()
  @Transform(nullableTextParam)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @Length(1, INSTRUCTIONS_MAX_LENGTH)
  en?: string | null;

  @ApiPropertyOptional({ maxLength: INSTRUCTIONS_MAX_LENGTH })
  @IsOptional()
  @Transform(nullableTextParam)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @Length(1, INSTRUCTIONS_MAX_LENGTH)
  tr?: string | null;
}

/** Drops empty optional locales so the stored JSON holds strings only. */
export function toInstructionsText(dto: AssignmentInstructionsDto): LocalizedText {
  const text: LocalizedText = { ar: dto.ar };
  if (typeof dto.en === 'string') text.en = dto.en;
  if (typeof dto.tr === 'string') text.tr = dto.tr;
  return text;
}

export class ListAssignmentsQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Assignments of this class' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Assignments linked to this lesson' })
  @IsOptional()
  @IsUUID('all')
  lessonId?: string;

  @ApiPropertyOptional({ enum: ASSIGNMENT_STATUSES })
  @IsOptional()
  @IsIn(ASSIGNMENT_STATUSES)
  status?: AssignmentStatus;

  @ApiPropertyOptional({ example: '2026-11-01T00:00:00+03:00', description: 'Assignments due at or after this instant (ISO 8601 with an offset); assignments without a due date never match' })
  @IsOptional()
  @IsInstant()
  dueFrom?: string;

  @ApiPropertyOptional({ example: '2026-11-30T23:59:59+03:00', description: 'Assignments due at or before this instant (ISO 8601 with an offset); assignments without a due date never match' })
  @IsOptional()
  @IsInstant()
  dueTo?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc', description: 'By due date (assignments without one last), then id' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: SortOrder;

  @ApiPropertyOptional({ default: ASSIGNMENTS_PAGE_DEFAULT, minimum: 1, maximum: ASSIGNMENTS_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ASSIGNMENTS_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 512, description: 'Opaque `nextCursor` of the previous page; send it with the same filters and order' })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;
}

export class CreateAssignmentDto {
  @ApiProperty({ type: LocalizedTextDto, description: 'Localized title `{ ar, en?, tr? }`; `ar` is required' })
  @IsDefined()
  @IsObject({ message: 'title must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  title: LocalizedTextDto;

  @ApiPropertyOptional({ type: AssignmentInstructionsDto, nullable: true, description: 'Localized instructions (4,000 characters per locale); absent or null = none' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'instructions must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => AssignmentInstructionsDto)
  instructions?: AssignmentInstructionsDto | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'A lesson of the same class (`lesson_mismatch` otherwise); absent or null = none' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  lessonId?: string | null;

  @ApiProperty({ minimum: 0.01, maximum: MAX_SCORE_LIMIT, example: 20, description: 'A JSON number with at most two decimals' })
  @Transform(rawValue)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(MAX_SCORE_LIMIT)
  maxScore: number;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: WEIGHT_LIMIT, example: 10, description: 'Weight in the final grade, read by MOD-09 (D-R36); absent or null = none' })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(WEIGHT_LIMIT)
  weight?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2026-11-20T23:59:00+03:00', description: 'ISO 8601 instant with an offset; absent or null = no due date' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsInstant()
  dueAt?: string | null;

  @ApiPropertyOptional({ default: false, description: 'Submissions after the due date are accepted and marked late (D-R38)' })
  @IsOptional()
  @Transform(rawValue)
  @IsBoolean()
  allowLate?: boolean;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: 100, example: 10, description: 'Needs allowLate (`late_penalty_invalid`); applied by MOD-09 (D-R36)' })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100)
  latePenaltyPercent?: number | null;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: MAX_ATTEMPTS_LIMIT, description: 'Attempts per student; a returned submission grants one more (D-R39)' })
  @IsOptional()
  @Transform(rawValue)
  @IsInt()
  @Min(1)
  @Max(MAX_ATTEMPTS_LIMIT)
  maxAttempts?: number;
}

/**
 * PATCH semantics (as API-018): absent = unchanged, `null` clears
 * `instructions`, `lessonId`, `weight`, `dueAt` and `latePenaltyPercent`;
 * `title`, `maxScore`, `allowLate` and `maxAttempts` refuse null. The grading
 * rules (maxScore, maxAttempts, allowLate, latePenaltyPercent) are locked once a
 * submission exists and a closed assignment accepts nothing (`assignment_locked`).
 * The status changes through `POST /api/assignments/:id/status`.
 */
export class UpdateAssignmentDto {
  @ApiPropertyOptional({ type: LocalizedTextDto, description: 'Replaces the whole localized title; `ar` required; not nullable' })
  @ValidateIf((dto: UpdateAssignmentDto) => dto.title !== undefined)
  @IsObject({ message: 'title must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  title?: LocalizedTextDto;

  @ApiPropertyOptional({ type: AssignmentInstructionsDto, nullable: true, description: 'Replaces the whole localized instructions; null clears them' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'instructions must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => AssignmentInstructionsDto)
  instructions?: AssignmentInstructionsDto | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'A lesson of the same class; null clears the link' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  lessonId?: string | null;

  @ApiPropertyOptional({ minimum: 0.01, maximum: MAX_SCORE_LIMIT, description: 'Locked once a submission exists; not nullable' })
  @Transform(rawValue)
  @ValidateIf((dto: UpdateAssignmentDto) => dto.maxScore !== undefined)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(MAX_SCORE_LIMIT)
  maxScore?: number;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: WEIGHT_LIMIT, description: 'null clears the weight' })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(WEIGHT_LIMIT)
  weight?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'ISO 8601 instant with an offset; null clears the due date' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsInstant()
  dueAt?: string | null;

  @ApiPropertyOptional({ description: 'Locked once a submission exists; not nullable' })
  @Transform(rawValue)
  @ValidateIf((dto: UpdateAssignmentDto) => dto.allowLate !== undefined)
  @IsBoolean()
  allowLate?: boolean;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: 100, description: 'Locked once a submission exists; needs allowLate after the merge; null clears it' })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100)
  latePenaltyPercent?: number | null;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_ATTEMPTS_LIMIT, description: 'Locked once a submission exists; not nullable' })
  @Transform(rawValue)
  @ValidateIf((dto: UpdateAssignmentDto) => dto.maxAttempts !== undefined)
  @IsInt()
  @Min(1)
  @Max(MAX_ATTEMPTS_LIMIT)
  maxAttempts?: number;
}

export class ChangeAssignmentStatusDto {
  @ApiProperty({
    enum: ASSIGNMENT_STATUS_ACTIONS,
    description:
      'publish: draft→open (sets publishedAt; the class must be planned, open or running) · close: open→closed (sets closedAt; also for a completed or cancelled class) · ' +
      'reopen: closed→open (clears closedAt; the class must be planned, open or running)',
  })
  @IsIn(ASSIGNMENT_STATUS_ACTIONS)
  action: AssignmentStatusAction;

  @ApiPropertyOptional({ maxLength: ASSIGNMENT_STATUS_REASON_MAX_LENGTH, description: 'Free text recorded in the audit event; trimmed, blank = absent' })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, ASSIGNMENT_STATUS_REASON_MAX_LENGTH)
  reason?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class AssignmentLessonDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Localized title `{ ar, en?, tr? }`' })
  title: LocalizedText;

  @ApiProperty({ description: 'ISO 8601 (UTC)' })
  startsAt: string;
}

/** The students' latest attempts by status (computed, never stored). */
export class SubmissionCountsDto {
  @ApiProperty({ example: 14, description: 'Students with at least one submission' })
  students: number;

  @ApiProperty({ example: 6, description: 'Students whose latest attempt waits for review' })
  submitted: number;

  @ApiProperty({ example: 7, description: 'Students whose latest attempt is graded' })
  graded: number;

  @ApiProperty({ example: 1, description: 'Students whose latest attempt was returned for rework' })
  returned: number;
}

export class AssignmentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: TimetableClassDto, description: 'The class with its course' })
  class: TimetableClassDto;

  @ApiProperty({ type: AssignmentLessonDto, nullable: true, description: 'The linked lesson, if any' })
  lesson: AssignmentLessonDto | null;

  @ApiProperty({ description: 'Localized title `{ ar, en?, tr? }`' })
  title: LocalizedText;

  @ApiProperty({ type: Object, nullable: true, description: 'Localized instructions or null' })
  instructions: LocalizedText | null;

  @ApiProperty({ example: 20 })
  maxScore: number;

  @ApiProperty({ type: Number, nullable: true, example: 10 })
  weight: number | null;

  @ApiProperty({ enum: ASSIGNMENT_STATUSES, description: '`grading`/`graded` are unused in the first version (D-R37)' })
  status: AssignmentStatus;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601; set by `publish`' })
  publishedAt: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601; set by `close`, cleared by `reopen`' })
  closedAt: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 (UTC) or null' })
  dueAt: string | null;

  @ApiProperty({ example: 'Europe/Istanbul', description: 'IANA time zone to display the due date in: the linked lesson’s room branch, else the academy’s (D-R41)' })
  timeZone: string;

  @ApiProperty()
  allowLate: boolean;

  @ApiProperty({ type: Number, nullable: true, example: 10 })
  latePenaltyPercent: number | null;

  @ApiProperty({ example: 1 })
  maxAttempts: number;

  @ApiProperty({ type: SubmissionCountsDto })
  submissions: SubmissionCountsDto;

  @ApiProperty({ example: 18, description: 'Active enrollments of the class (the «total» of «submitted / total»)' })
  activeStudents: number;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class AssignmentListDto {
  @ApiProperty({ type: [AssignmentDto], description: 'By due date (none last), then id' })
  items: AssignmentDto[];

  @ApiProperty({ nullable: true, description: 'Cursor of the next page; null on the last page' })
  nextCursor: string | null;
}
