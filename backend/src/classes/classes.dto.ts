import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDefined, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import { codeParam, rawNumber } from '../courses/courses.validation.js';
import { ClassStatus, ClassTeacherRole, CourseStatus } from '../generated/prisma/client.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { IsCalendarDate, nullableTextParam, textParam } from '../users/users.validation.js';
import { CLASS_STATUS_ACTIONS } from './classes.status.js';
import type { ClassStatusAction } from './classes.status.js';

export const CLASSES_PAGE_DEFAULT = 20;
export const CLASSES_PAGE_MAX = 100;
export const CLASS_SORT_FIELDS = ['code', 'createdAt'] as const;
export type ClassSortField = (typeof CLASS_SORT_FIELDS)[number];
export const CLASS_STATUSES = Object.values(ClassStatus) as ClassStatus[];
const CLASS_TEACHER_ROLES = Object.values(ClassTeacherRole) as ClassTeacherRole[];
const COURSE_STATUSES = Object.values(CourseStatus) as CourseStatus[];

/** Class codes: 1–32 characters, upper-case letters, digits, `.`, `_`, `-` (same alphabet as course codes). */
export const CLASS_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;
/** `capacity` is a smallint (> 0 by CHECK). */
export const CLASS_CAPACITY_MAX = 32767;
export const CLASS_NOTES_MAX_LENGTH = 2000;
/** Upper bound of the free-text reason recorded in the audit event (as MOD-03-T06). */
export const CLASS_STATUS_REASON_MAX_LENGTH = 500;

const CODE_MESSAGE = 'code must be 1–32 characters: letters, digits, ".", "_" or "-" (stored upper-case)';

/** Query strings: blank means absent. */
function trimmedParam({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export class ListClassesQueryDto {
  @ApiPropertyOptional({ maxLength: 100, description: 'Case-insensitive substring of the code or of the Arabic/English name (`%`/`_` literal)' })
  @IsOptional()
  @Transform(trimmedParam)
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Classes of this course' })
  @IsOptional()
  @IsUUID('all')
  courseId?: string;

  @ApiPropertyOptional({ enum: CLASS_STATUSES })
  @IsOptional()
  @IsIn(CLASS_STATUSES)
  status?: ClassStatus;

  @ApiPropertyOptional({ format: 'uuid', description: 'Classes this user teaches (lead or assistant)' })
  @IsOptional()
  @IsUUID('all')
  teacherId?: string;

  @ApiPropertyOptional({ enum: CLASS_SORT_FIELDS, default: 'code', description: '`code` = alphabetical; `createdAt` = creation order (time-ordered primary key)' })
  @IsOptional()
  @IsIn(CLASS_SORT_FIELDS)
  sort?: ClassSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: 'Default: `asc` for code, `desc` for createdAt (newest first)' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: SortOrder;

  @ApiPropertyOptional({ default: CLASSES_PAGE_DEFAULT, minimum: 1, maximum: CLASSES_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CLASSES_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 512, description: 'Opaque `nextCursor` of the previous page; send it with the same filters, sort and order' })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;
}

export class CreateClassDto {
  @ApiProperty({ format: 'uuid', description: 'A published course (`course_not_published` otherwise)' })
  @IsUUID('all')
  courseId: string;

  @ApiProperty({ maxLength: 32, example: 'PY-101-A', description: 'Trimmed and upper-cased; unique among classes' })
  @Transform(codeParam)
  @IsString()
  @Matches(CLASS_CODE_PATTERN, { message: CODE_MESSAGE })
  code: string;

  @ApiProperty({ type: LocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`; `ar` is required' })
  @IsDefined()
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name: LocalizedTextDto;

  @ApiProperty({ minimum: 1, maximum: CLASS_CAPACITY_MAX, example: 20, description: 'Hard capacity (D-R18); a JSON integer' })
  @Transform(rawNumber)
  @IsInt()
  @Min(1)
  @Max(CLASS_CAPACITY_MAX)
  capacity: number;

  @ApiPropertyOptional({ example: '2026-11-10', description: 'YYYY-MM-DD; display only (D-R17)' })
  @IsOptional()
  @IsCalendarDate()
  startsOn?: string;

  @ApiPropertyOptional({ example: '2026-12-20', description: 'YYYY-MM-DD; display only; not before startsOn' })
  @IsOptional()
  @IsCalendarDate()
  endsOn?: string;

  @ApiPropertyOptional({ maxLength: CLASS_NOTES_MAX_LENGTH, description: 'Free text; trimmed, blank = absent' })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, CLASS_NOTES_MAX_LENGTH)
  notes?: string;
}

/**
 * PATCH semantics (as API-018): absent = unchanged, `null` clears `startsOn`,
 * `endsOn` and `notes`; `code`, `name` and `capacity` refuse null. The course
 * is fixed (`courseId` → 400) and the status changes through
 * `POST /api/classes/:id/status`.
 */
export class UpdateClassDto {
  @ApiPropertyOptional({ maxLength: 32, example: 'PY-101-B' })
  @ValidateIf((dto: UpdateClassDto) => dto.code !== undefined)
  @Transform(codeParam)
  @IsString()
  @Matches(CLASS_CODE_PATTERN, { message: CODE_MESSAGE })
  code?: string;

  @ApiPropertyOptional({ type: LocalizedTextDto, description: 'Replaces the whole localized name; `ar` required; not nullable' })
  @ValidateIf((dto: UpdateClassDto) => dto.name !== undefined)
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name?: LocalizedTextDto;

  @ApiPropertyOptional({ minimum: 1, maximum: CLASS_CAPACITY_MAX, description: 'Not below the active enrollments (`capacity_below_enrolled`)' })
  @ValidateIf((dto: UpdateClassDto) => dto.capacity !== undefined)
  @Transform(rawNumber)
  @IsInt()
  @Min(1)
  @Max(CLASS_CAPACITY_MAX)
  capacity?: number;

  @ApiPropertyOptional({ nullable: true, example: '2026-11-10', description: 'YYYY-MM-DD or null' })
  @IsOptional()
  @IsCalendarDate()
  startsOn?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-12-20', description: 'YYYY-MM-DD or null' })
  @IsOptional()
  @IsCalendarDate()
  endsOn?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: CLASS_NOTES_MAX_LENGTH, description: 'null or a blank string clears' })
  @IsOptional()
  @Transform(nullableTextParam)
  @IsString()
  @Length(1, CLASS_NOTES_MAX_LENGTH)
  notes?: string | null;
}

export class ChangeClassStatusDto {
  @ApiProperty({
    enum: CLASS_STATUS_ACTIONS,
    description:
      'open: planned→open · start: open→running · complete: running→completed (active enrollments → completed) · ' +
      'cancel: planned|open|running→cancelled (active enrollments → cancelled) · restore: cancelled→planned (enrollments unchanged)',
  })
  @IsIn(CLASS_STATUS_ACTIONS)
  action: ClassStatusAction;

  @ApiPropertyOptional({
    maxLength: CLASS_STATUS_REASON_MAX_LENGTH,
    description: 'Free text recorded in the audit event only; trimmed, blank = absent',
  })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, CLASS_STATUS_REASON_MAX_LENGTH)
  reason?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class ClassCourseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'PY-101' })
  code: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`' })
  name: LocalizedText;

  @ApiProperty({ enum: COURSE_STATUSES, description: 'Unpublishing or archiving a course leaves its classes as they are' })
  status: CourseStatus;
}

export class ClassTeacherDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  fullName: string;

  @ApiProperty({ enum: CLASS_TEACHER_ROLES, description: 'At most one `lead` per class' })
  role: ClassTeacherRole;

  @ApiProperty({ description: 'ISO 8601' })
  assignedAt: string;
}

export class ClassDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'PY-101-A' })
  code: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`', example: { ar: 'بايثون — الفصل أ', en: 'Python — class A' } })
  name: LocalizedText;

  @ApiProperty({ example: 20 })
  capacity: number;

  @ApiProperty({ enum: CLASS_STATUSES })
  status: ClassStatus;

  @ApiProperty({ nullable: true, example: '2026-11-10', description: 'YYYY-MM-DD' })
  startsOn: string | null;

  @ApiProperty({ nullable: true, example: '2026-12-20', description: 'YYYY-MM-DD' })
  endsOn: string | null;

  @ApiProperty({ nullable: true })
  notes: string | null;

  @ApiProperty({ type: ClassCourseDto })
  course: ClassCourseDto;

  @ApiProperty({ type: [ClassTeacherDto], description: 'Lead first, then assistants by assignment time' })
  teachers: ClassTeacherDto[];

  @ApiProperty({ example: 12, description: 'Active enrollments (computed, never stored)' })
  enrolledCount: number;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class ClassListDto {
  @ApiProperty({ type: [ClassDto] })
  items: ClassDto[];

  @ApiProperty({ nullable: true, description: 'Cursor of the next page; null on the last page' })
  nextCursor: string | null;
}
