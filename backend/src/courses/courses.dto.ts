import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import { CourseStatus } from '../generated/prisma/client.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { COURSE_STATUS_ACTIONS } from './courses.status.js';
import type { CourseStatusAction } from './courses.status.js';
import { codeParam, COURSE_CODE_PATTERN } from './courses.validation.js';

export const COURSES_PAGE_DEFAULT = 20;
export const COURSES_PAGE_MAX = 100;
export const COURSE_SORT_FIELDS = ['code', 'createdAt'] as const;
export type CourseSortField = (typeof COURSE_SORT_FIELDS)[number];
export const COURSE_STATUSES = Object.values(CourseStatus) as CourseStatus[];

/** numeric(6,1): at most 99999.9 hours. */
export const DURATION_HOURS_MAX = 99999.9;
export const AGE_MAX = 120;
export const SESSIONS_MAX = 10000;

const CODE_MESSAGE = 'code must be 1–32 characters: letters, digits, ".", "_" or "-" (stored upper-case)';

/** Query strings: blank means absent. */
function trimmedParam({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Body numbers must be JSON numbers (or null in a PATCH): no implicit "12" → 12. */
function rawNumber({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  return obj[key];
}

export class ListCoursesQueryDto {
  @ApiPropertyOptional({ maxLength: 100, description: 'Case-insensitive substring of the code, or substring of the Arabic/English name (`%`/`_` literal)' })
  @IsOptional()
  @Transform(trimmedParam)
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({
    enum: COURSE_STATUSES,
    description: 'Holders of `courses.manage` filter by any status; everyone else only sees `published` (any other value is 403)',
  })
  @IsOptional()
  @IsIn(COURSE_STATUSES)
  status?: CourseStatus;

  @ApiPropertyOptional({ format: 'uuid', description: 'Courses of this level' })
  @IsOptional()
  @IsUUID('all')
  levelId?: string;

  @ApiPropertyOptional({ enum: COURSE_SORT_FIELDS, default: 'code', description: '`code` = alphabetical; `createdAt` = creation order (time-ordered primary key)' })
  @IsOptional()
  @IsIn(COURSE_SORT_FIELDS)
  sort?: CourseSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: 'Default: `asc` for code, `desc` for createdAt (newest first)' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: SortOrder;

  @ApiPropertyOptional({ default: COURSES_PAGE_DEFAULT, minimum: 1, maximum: COURSES_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(COURSES_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 512, description: 'Opaque `nextCursor` of the previous page; send it with the same filters, sort and order' })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;
}

export class CreateCourseDto {
  @ApiProperty({ maxLength: 32, example: 'PY-101', description: 'Trimmed and upper-cased; unique among courses' })
  @Transform(codeParam)
  @IsString()
  @Matches(COURSE_CODE_PATTERN, { message: CODE_MESSAGE })
  code: string;

  @ApiProperty({ type: LocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`; `ar` is required' })
  @IsDefined()
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name: LocalizedTextDto;

  @ApiPropertyOptional({ type: LocalizedTextDto })
  @IsOptional()
  @IsObject({ message: 'summary must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  summary?: LocalizedTextDto;

  @ApiPropertyOptional({ type: LocalizedTextDto })
  @IsOptional()
  @IsObject({ message: 'description must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  description?: LocalizedTextDto;

  @ApiPropertyOptional({ format: 'uuid', description: 'An existing level (inactive levels are accepted)' })
  @IsOptional()
  @IsUUID('all')
  levelId?: string;

  @ApiPropertyOptional({ minimum: 0.1, maximum: DURATION_HOURS_MAX, example: 24.5, description: 'Total hours, one decimal' })
  @IsOptional()
  @Transform(rawNumber)
  @IsNumber({ maxDecimalPlaces: 1, allowNaN: false, allowInfinity: false })
  @Min(0.1)
  @Max(DURATION_HOURS_MAX)
  durationHours?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: SESSIONS_MAX, example: 12 })
  @IsOptional()
  @Transform(rawNumber)
  @IsInt()
  @Min(1)
  @Max(SESSIONS_MAX)
  sessionsCount?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: AGE_MAX, example: 8 })
  @IsOptional()
  @Transform(rawNumber)
  @IsInt()
  @Min(0)
  @Max(AGE_MAX)
  minAge?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: AGE_MAX, example: 14, description: 'Not below minAge' })
  @IsOptional()
  @Transform(rawNumber)
  @IsInt()
  @Min(0)
  @Max(AGE_MAX)
  maxAge?: number;
}

/**
 * PATCH semantics (as API-018): absent = unchanged, `null` clears the
 * optional fields (`summary`, `description`, `levelId`, `durationHours`,
 * `sessionsCount`, `minAge`, `maxAge`); `code` and `name` are required columns
 * and refuse null. The status changes through `POST /api/courses/:id/status`.
 */
export class UpdateCourseDto {
  @ApiPropertyOptional({ maxLength: 32, example: 'PY-102' })
  @ValidateIf((dto: UpdateCourseDto) => dto.code !== undefined)
  @Transform(codeParam)
  @IsString()
  @Matches(COURSE_CODE_PATTERN, { message: CODE_MESSAGE })
  code?: string;

  @ApiPropertyOptional({ type: LocalizedTextDto, description: 'Replaces the whole localized name; `ar` required; not nullable' })
  @ValidateIf((dto: UpdateCourseDto) => dto.name !== undefined)
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name?: LocalizedTextDto;

  @ApiPropertyOptional({ type: LocalizedTextDto, nullable: true })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'summary must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  summary?: LocalizedTextDto | null;

  @ApiPropertyOptional({ type: LocalizedTextDto, nullable: true })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'description must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  description?: LocalizedTextDto | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  levelId?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0.1, maximum: DURATION_HOURS_MAX })
  @IsOptional()
  @Transform(rawNumber)
  @ValidateIf((_dto, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 1, allowNaN: false, allowInfinity: false })
  @Min(0.1)
  @Max(DURATION_HOURS_MAX)
  durationHours?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: SESSIONS_MAX })
  @IsOptional()
  @Transform(rawNumber)
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(SESSIONS_MAX)
  sessionsCount?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: AGE_MAX })
  @IsOptional()
  @Transform(rawNumber)
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(AGE_MAX)
  minAge?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: AGE_MAX })
  @IsOptional()
  @Transform(rawNumber)
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(AGE_MAX)
  maxAge?: number | null;
}

export class ChangeCourseStatusDto {
  @ApiProperty({ enum: COURSE_STATUS_ACTIONS, description: 'publish: draft→published · unpublish: published→draft · archive: draft|published→archived · restore: archived→draft' })
  @IsIn(COURSE_STATUS_ACTIONS)
  action: CourseStatusAction;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class CourseLevelDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'BEG' })
  code: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`' })
  name: LocalizedText;

  @ApiProperty()
  isActive: boolean;
}

export class CourseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'PY-101' })
  code: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`', example: { ar: 'أساسيات بايثون', en: 'Python Basics' } })
  name: LocalizedText;

  @ApiProperty({ nullable: true })
  summary: LocalizedText | null;

  @ApiProperty({ nullable: true })
  description: LocalizedText | null;

  @ApiProperty({ type: CourseLevelDto, nullable: true })
  level: CourseLevelDto | null;

  @ApiProperty({ enum: COURSE_STATUSES })
  status: CourseStatus;

  @ApiProperty({ nullable: true, example: 24.5 })
  durationHours: number | null;

  @ApiProperty({ nullable: true })
  sessionsCount: number | null;

  @ApiProperty({ nullable: true })
  minAge: number | null;

  @ApiProperty({ nullable: true })
  maxAge: number | null;

  @ApiProperty({ description: 'Number of syllabus items (MOD-04-T04)' })
  syllabusCount: number;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class CourseListDto {
  @ApiProperty({ type: [CourseDto] })
  items: CourseDto[];

  @ApiProperty({ nullable: true, description: 'Cursor of the next page; null on the last page' })
  nextCursor: string | null;
}
