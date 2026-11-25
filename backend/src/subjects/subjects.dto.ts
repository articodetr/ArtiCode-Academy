import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDefined, IsObject, IsOptional, IsString, IsUUID, Matches, ValidateIf, ValidateNested } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { codeParam, LEVEL_CODE_PATTERN, rawBoolean } from '../courses/courses.validation.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';

/** No academy needs more subjects than this; also bounds the order list. */
export const SUBJECTS_MAX = 100;

/** Subject codes follow the level code rule: 1–16 characters, stored upper-case (the column is varchar(16)). */
export const SUBJECT_CODE_PATTERN = LEVEL_CODE_PATTERN;

const CODE_MESSAGE = 'code must be 1–16 characters: letters, digits, ".", "_" or "-" (stored upper-case)';

export class CreateSubjectDto {
  @ApiProperty({ maxLength: 16, example: 'MATH', description: 'Trimmed and upper-cased; unique among subjects' })
  @Transform(codeParam)
  @IsString()
  @Matches(SUBJECT_CODE_PATTERN, { message: CODE_MESSAGE })
  code: string;

  @ApiProperty({ type: LocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`; `ar` is required' })
  @IsDefined()
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name: LocalizedTextDto;

  @ApiPropertyOptional({ default: true, description: 'Inactive subjects stay on their courses but are hidden from non-managers and pickers' })
  @IsOptional()
  @Transform(rawBoolean)
  @IsBoolean()
  isActive?: boolean;
}

/**
 * PATCH semantics (as API-018): an absent field is left alone, a value
 * replaces it; none of the three fields is nullable. `name` is replaced as a
 * whole object (ADR-044). The order is changed through `PUT
 * /api/subjects/order` only.
 */
export class UpdateSubjectDto {
  @ApiPropertyOptional({ maxLength: 16, example: 'PHYS', description: 'Trimmed and upper-cased; unique among subjects' })
  @ValidateIf((dto: UpdateSubjectDto) => dto.code !== undefined)
  @Transform(codeParam)
  @IsString()
  @Matches(SUBJECT_CODE_PATTERN, { message: CODE_MESSAGE })
  code?: string;

  @ApiPropertyOptional({ type: LocalizedTextDto, description: 'Replaces the whole localized name; `ar` required; not nullable' })
  @ValidateIf((dto: UpdateSubjectDto) => dto.name !== undefined)
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name?: LocalizedTextDto;

  @ApiPropertyOptional({ description: 'Hide (false) or show (true) the subject for non-managers and pickers' })
  @ValidateIf((dto: UpdateSubjectDto) => dto.isActive !== undefined)
  @Transform(rawBoolean)
  @IsBoolean()
  isActive?: boolean;
}

export class ReorderSubjectsDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Every subject id exactly once, in the new order (first = sort order 0)',
  })
  @IsArray()
  @ArrayMaxSize(SUBJECTS_MAX)
  @IsUUID('all', { each: true, message: 'each subjectId must be a UUID' })
  subjectIds: string[];
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class SubjectDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'MATH' })
  code: string;

  @ApiProperty({ type: () => LocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`', example: { ar: 'الرياضيات', en: 'Mathematics' } })
  name: LocalizedText;

  @ApiProperty({ type: 'integer', description: 'Position in the list (0 first); gaps are possible after a deletion' })
  sortOrder: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description: 'Courses of any state using the subject — for holders of `courses.manage` only (null otherwise); a subject in use cannot be deleted',
  })
  courseCount: number | null;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class SubjectListDto {
  @ApiProperty({ type: [SubjectDto], description: 'By sort order; inactive subjects only for holders of `courses.manage`' })
  items: SubjectDto[];
}
