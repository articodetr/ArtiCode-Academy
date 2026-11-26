import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDefined, IsIn, IsInt, IsObject, IsOptional, IsString, IsUrl, IsUUID, Length, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { IsDecimalNumber } from '../common/decimal-number.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import { CourseStatus } from '../generated/prisma/client.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { COURSE_STATUS_ACTIONS } from './courses.status.js';
import type { CourseStatusAction } from './courses.status.js';
import { codeParam, COURSE_CODE_PATTERN, optionalCodeParam } from './courses.validation.js';

export const COURSES_PAGE_DEFAULT = 20;
export const COURSES_PAGE_MAX = 100;
export const COURSE_SORT_FIELDS = ['code', 'createdAt'] as const;
export type CourseSortField = (typeof COURSE_SORT_FIELDS)[number];
export const COURSE_STATUSES = Object.values(CourseStatus) as CourseStatus[];

/** numeric(6,1): at most 99999.9 hours. */
export const DURATION_HOURS_MAX = 99999.9;
export const AGE_MAX = 120;
export const SESSIONS_MAX = 10000;
/** MOD-19 (D-R129): the cover URL, as the CHECK ck_courses_cover_image_url. */
export const COVER_IMAGE_URL_MAX = 2048;
const COVER_URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true, require_tld: false };
const COVER_URL_MESSAGE = 'coverImageUrl must be an absolute http(s) URL';
export const COURSE_PRICINGS = ['free', 'paid'] as const;
export type CoursePricing = (typeof COURSE_PRICINGS)[number];

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
  @ApiPropertyOptional({
    maxLength: 32,
    example: 'PY-101',
    description:
      'Trimmed and upper-cased; unique among courses (409 course_code_taken). Absent = the server generates `CRS-NNNNN` ' +
      '(a running number, five digits or more) that no course uses yet; `null` or a blank string is 400.',
  })
  // Absent, never null: `IsOptional` would let a null through to the service.
  @ValidateIf((dto: CreateCourseDto) => dto.code !== undefined)
  @Transform(optionalCodeParam)
  @IsString()
  @Matches(COURSE_CODE_PATTERN, { message: CODE_MESSAGE })
  code?: string;

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
  @IsDecimalNumber(1)
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

  @ApiPropertyOptional({
    maxLength: COVER_IMAGE_URL_MAX,
    example: 'https://cdn.example.org/courses/py-101.jpg',
    description: 'MOD-19: an absolute http(s) URL of the cover image (no upload)',
  })
  @IsOptional()
  @IsString()
  @Length(1, COVER_IMAGE_URL_MAX)
  @IsUrl(COVER_URL_OPTIONS, { message: COVER_URL_MESSAGE })
  coverImageUrl?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'MOD-19 (D-R122): an active general fee plan that prices a request for this course; absent = a free course. ' +
      'Needs `fee_plans.manage` besides `courses.manage`.',
  })
  @IsOptional()
  @IsUUID('all')
  enrollmentFeePlanId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'PORTAL-04: the school subject the course teaches — an existing, active subject (404 subject_not_found / 422 subject_inactive); absent or null = none',
  })
  @IsOptional()
  @IsUUID('all')
  subjectId?: string | null;
}

/**
 * PATCH semantics (as API-018): absent = unchanged, `null` clears the
 * optional fields (`summary`, `description`, `levelId`, `durationHours`,
 * `sessionsCount`, `minAge`, `maxAge`, `coverImageUrl`, `enrollmentFeePlanId`,
 * `subjectId`); `code` and `name` are required columns
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

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  levelId?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0.1, maximum: DURATION_HOURS_MAX })
  @IsOptional()
  @Transform(rawNumber)
  @ValidateIf((_dto, value) => value !== null)
  @IsDecimalNumber(1)
  @Min(0.1)
  @Max(DURATION_HOURS_MAX)
  durationHours?: number | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true, minimum: 1, maximum: SESSIONS_MAX })
  @IsOptional()
  @Transform(rawNumber)
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(SESSIONS_MAX)
  sessionsCount?: number | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true, minimum: 0, maximum: AGE_MAX })
  @IsOptional()
  @Transform(rawNumber)
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(AGE_MAX)
  minAge?: number | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true, minimum: 0, maximum: AGE_MAX })
  @IsOptional()
  @Transform(rawNumber)
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(AGE_MAX)
  maxAge?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: COVER_IMAGE_URL_MAX, description: 'MOD-19: an absolute http(s) URL; null clears it' })
  @ValidateIf((_dto, value) => value !== undefined && value !== null)
  @IsString()
  @Length(1, COVER_IMAGE_URL_MAX)
  @IsUrl(COVER_URL_OPTIONS, { message: COVER_URL_MESSAGE })
  coverImageUrl?: string | null;

  @ApiPropertyOptional({
    type: () => [CourseResourceDto],
    maxItems: 20,
    description:
      'J-F67: the course’s own materials (its textbook) as a whole new list — [{ title: { ar, en?, tr? }, url }], https only, at most 20; [] removes them. ' +
      'Checked as a lesson’s resources (400 resources_invalid { problems }). A lesson’s attachments stay on the lesson (API-228).',
  })
  // The raw JSON array: the global implicit conversion would turn each object into an array (as API-228 does).
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj['resources'])
  // Absent, never null: `IsOptional` would let a null through to the service.
  @ValidateIf((dto: UpdateCourseDto) => dto.resources !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  resources?: unknown[];

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'MOD-19 (D-R122): an active fee plan of this course or a general plan; null makes the course free again ' +
      '(enrollments already active are not touched). Needs `fee_plans.manage` besides `courses.manage`.',
  })
  @ValidateIf((_dto, value) => value !== undefined && value !== null)
  @IsUUID('all')
  enrollmentFeePlanId?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'PORTAL-04: the school subject — an existing, active subject (404 subject_not_found / 422 subject_inactive); null clears it. ' +
      'A course keeps a subject deactivated later until this field changes.',
  })
  @ValidateIf((_dto, value) => value !== undefined && value !== null)
  @IsUUID('all')
  subjectId?: string | null;
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

  @ApiProperty({ type: () => LocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`' })
  name: LocalizedText;

  @ApiProperty()
  isActive: boolean;
}

/** PORTAL-04: the school subject of a course (the subject's own `isActive` is read through /api/subjects). */
export class CourseSubjectDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'MATH' })
  code: string;

  @ApiProperty({ type: () => LocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`' })
  name: LocalizedText;
}

/** MOD-19 (D-R122): the plan that prices a request — its total in the academy currency. */
export class CourseFeePlanDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  name: LocalizedText;

  @ApiProperty({ description: 'false = the plan was deactivated: requests are refused with course_price_unavailable' })
  isActive: boolean;

  @ApiProperty({ type: Number, example: 1200, description: 'Sum of the plan lines, two decimals' })
  total: number;

  @ApiProperty({ example: 'SAR', description: 'The academy currency (D15)' })
  currency: string;

  @ApiProperty({ type: 'integer', description: 'Installments of an invoice built from the plan' })
  installments: number;
}

export class CourseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'PY-101' })
  code: string;

  @ApiProperty({ type: () => LocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`', example: { ar: 'أساسيات بايثون', en: 'Python Basics' } })
  name: LocalizedText;

  @ApiProperty({ type: () => LocalizedTextDto, nullable: true })
  summary: LocalizedText | null;

  @ApiProperty({ type: () => LocalizedTextDto, nullable: true })
  description: LocalizedText | null;

  @ApiProperty({ type: CourseLevelDto, nullable: true })
  level: CourseLevelDto | null;

  @ApiProperty({ type: CourseSubjectDto, nullable: true, description: 'PORTAL-04: the school subject the course teaches; null = not set' })
  subject: CourseSubjectDto | null;

  @ApiProperty({ enum: COURSE_STATUSES })
  status: CourseStatus;

  @ApiProperty({ type: Number, nullable: true, example: 24.5 })
  durationHours: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  sessionsCount: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  minAge: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  maxAge: number | null;

  @ApiProperty({ description: 'Number of syllabus items (MOD-04-T04)' })
  syllabusCount: number;

  @ApiProperty({ type: String, nullable: true, description: 'MOD-19: an absolute http(s) URL of the cover image' })
  coverImageUrl: string | null;

  @ApiProperty({ type: () => [CourseResourceDto], description: 'J-F67: the course’s own materials (its textbook), [] when none' })
  resources: CourseResourceDto[];

  @ApiProperty({ enum: COURSE_PRICINGS, description: 'MOD-19 (D-R122): paid exactly when `enrollmentFeePlan` is set' })
  pricing: CoursePricing;

  @ApiProperty({ type: CourseFeePlanDto, nullable: true })
  enrollmentFeePlan: CourseFeePlanDto | null;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class CourseListDto {
  @ApiProperty({ type: [CourseDto] })
  items: CourseDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Cursor of the next page; null on the last page' })
  nextCursor: string | null;
}

/** One of a course's own materials (J-F67): the shape of a lesson's resource. */
export class CourseResourceDto {
  @ApiProperty({ type: () => LocalizedTextDto })
  title: LocalizedText;

  @ApiProperty({ example: 'https://cdn.example.org/textbook.pdf' })
  url: string;
}
