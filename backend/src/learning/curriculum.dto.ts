import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
} from 'class-validator';
import type { ValidationArguments, ValidatorConstraintInterface } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { rawBoolean, rawNumber } from '../courses/courses.validation.js';
import { SYLLABUS_ITEMS_MAX, SYLLABUS_MINUTES_MAX } from '../courses/syllabus.dto.js';
import type { LearningItemKind } from '../generated/prisma/client.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { LEARNING_ITEM_KINDS, RESOURCES_MAX } from './learning.content.js';
import type { CompletionMode } from './learning.content.js';

/** At most 50 levels per course (D-R130); the lessons stay bounded by SYLLABUS_ITEMS_MAX in total. */
export const CURRICULUM_SECTIONS_MAX = 50;

/** D-R145: a level opens at most a year after the learner's class starts (the column's CHECK: 0..365). */
export const RELEASE_AFTER_DAYS_MAX = 365;

export const COMPLETION_MODES = ['manual', 'playback', 'attendance'] as const satisfies readonly CompletionMode[];

/** The raw JSON value: no implicit conversion of a free-form object or array. */
function rawValue({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  return obj[key];
}

// ---------------------------------------------------------------------------
// API-227 — the complete structure
// ---------------------------------------------------------------------------

export class CurriculumItemInputDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Id of an existing lesson of this course; absent for a new lesson (a `text` lesson without content)' })
  @IsOptional()
  @IsUUID('all')
  id?: string;

  @ApiProperty({ type: LocalizedTextDto, description: 'Localized title `{ ar, en?, tr? }`; `ar` required' })
  @IsDefined()
  @IsObject({ message: 'title must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  title: LocalizedTextDto;

  @ApiPropertyOptional({ type: LocalizedTextDto, nullable: true, description: 'Absent or null = no description (the structure is the complete state)' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'description must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  description?: LocalizedTextDto | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true, minimum: 1, maximum: SYLLABUS_MINUTES_MAX, example: 45, description: 'Absent or null = no estimate; a JSON number' })
  @IsOptional()
  @Transform(rawNumber)
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(SYLLABUS_MINUTES_MAX)
  estimatedMinutes?: number | null;

  @ApiProperty({ type: Boolean, description: 'A required lesson counts in the progress (D-R135); a JSON boolean' })
  @Transform(rawBoolean)
  @IsDefined()
  @IsBoolean()
  isRequired: boolean;

  @ApiProperty({ type: Boolean, description: 'An unpublished lesson is hidden from learners and left out of their progress (D-R135); a JSON boolean' })
  @Transform(rawBoolean)
  @IsDefined()
  @IsBoolean()
  isPublished: boolean;
}

export class CurriculumSectionInputDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Id of an existing level of this course; absent for a new level' })
  @IsOptional()
  @IsUUID('all')
  id?: string;

  @ApiPropertyOptional({ type: LocalizedTextDto, nullable: true, description: 'Shown after «المستوى N»; absent or null = no title' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'title must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  title?: LocalizedTextDto | null;

  @ApiPropertyOptional({ type: LocalizedTextDto, nullable: true, description: 'Absent or null = no description' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'description must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  description?: LocalizedTextDto | null;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: 0,
    maximum: RELEASE_AFTER_DAYS_MAX,
    example: 14,
    description:
      'D-R145: for a learner the level opens on their class’s start day + N days (the academy’s time zone); absent or null = open from the start ' +
      '(the structure is the complete state); a JSON number',
  })
  @IsOptional()
  @Transform(rawNumber)
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(RELEASE_AFTER_DAYS_MAX)
  releaseAfterDays?: number | null;

  @ApiProperty({ type: [CurriculumItemInputDto], maxItems: SYLLABUS_ITEMS_MAX, description: 'The lessons of this level in order' })
  @IsArray()
  @ArrayMaxSize(SYLLABUS_ITEMS_MAX)
  @ValidateNested({ each: true })
  @Type(() => CurriculumItemInputDto)
  items: CurriculumItemInputDto[];
}

/** The levels' lessons and the loose lessons together stay within SYLLABUS_ITEMS_MAX. */
@ValidatorConstraint({ name: 'curriculumItemsWithinMax' })
class CurriculumItemsWithinMax implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as { sections?: unknown; looseItems?: unknown };
    const count = (list: unknown) => (Array.isArray(list) ? list.length : 0);
    const sections = Array.isArray(dto.sections) ? dto.sections : [];
    const total = sections.reduce<number>((sum, section) => sum + count((section as { items?: unknown } | null)?.items), 0) + count(dto.looseItems);
    return total <= SYLLABUS_ITEMS_MAX;
  }

  defaultMessage(): string {
    return `a curriculum holds at most ${SYLLABUS_ITEMS_MAX} lessons in total`;
  }
}

/** API-227: the complete curriculum — levels in order (position 0 first), then the lessons outside every level. */
export class ReplaceCurriculumDto {
  @ApiProperty({ type: [CurriculumSectionInputDto], maxItems: CURRICULUM_SECTIONS_MAX, description: `Every level in order; at most ${SYLLABUS_ITEMS_MAX} lessons in the whole body` })
  @IsArray()
  @ArrayMaxSize(CURRICULUM_SECTIONS_MAX)
  @ValidateNested({ each: true })
  @Type(() => CurriculumSectionInputDto)
  @Validate(CurriculumItemsWithinMax)
  sections: CurriculumSectionInputDto[];

  @ApiPropertyOptional({ type: [CurriculumItemInputDto], maxItems: SYLLABUS_ITEMS_MAX, description: 'Lessons outside every level, after the levels; absent = none' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SYLLABUS_ITEMS_MAX)
  @ValidateNested({ each: true })
  @Type(() => CurriculumItemInputDto)
  looseItems?: CurriculumItemInputDto[];
}

// ---------------------------------------------------------------------------
// API-228 — one lesson's content
// ---------------------------------------------------------------------------

/**
 * API-228: the lesson's kind, its content (checked against the kind by
 * `parseLessonContent()` — `content_invalid`) and its resources. All three
 * are present; `content: null` = no content yet, `resources: []` = none.
 */
export class ReplaceLessonContentDto {
  @ApiProperty({ enum: LEARNING_ITEM_KINDS, description: 'What the lesson holds (D-R131)' })
  @IsDefined()
  @IsIn(LEARNING_ITEM_KINDS)
  kind: LearningItemKind;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'By kind — text `{ body }`; video `{ provider: file|youtube|vimeo, url, durationSeconds?, captions? }` (a file video needs `durationSeconds`, captions only for a file); ' +
      'audio `{ url, durationSeconds }`; pdf `{ url }`; image `{ url, alt? }`; file `{ url, fileName? }`; live `{ note? }`. https URLs only. null = no content yet.',
  })
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsDefined({ message: 'content must be an object or null' })
  @IsObject({ message: 'content must be an object or null' })
  content: Record<string, unknown> | null;

  @ApiProperty({ type: () => [LessonResourceDto], maxItems: RESOURCES_MAX, description: 'Downloadable resources `[{ title, url }]` (https); [] = none' })
  @Transform(rawValue)
  @IsDefined()
  @IsArray()
  resources: unknown[];
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class LessonResourceDto {
  @ApiProperty({ type: () => LocalizedTextDto, description: 'Localized title `{ ar, en?, tr? }`' })
  title: LocalizedText;

  @ApiProperty({ example: 'https://cdn.example.org/handout.pdf', description: 'An absolute https URL' })
  url: string;
}

export class CurriculumItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: 'integer', description: 'Position in the course (0 first; the learning order sorts by level first)' })
  sortOrder: number;

  @ApiProperty({ type: () => LocalizedTextDto, description: 'Localized title `{ ar, en?, tr? }`' })
  title: LocalizedText;

  @ApiProperty({ type: () => LocalizedTextDto, nullable: true })
  description: LocalizedText | null;

  @ApiProperty({ type: 'integer', nullable: true })
  estimatedMinutes: number | null;

  @ApiProperty({ enum: LEARNING_ITEM_KINDS })
  kind: LearningItemKind;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true, description: 'The content of the kind as stored (a value that no longer fits its kind reads as null)' })
  content: Record<string, unknown> | null;

  @ApiProperty({ type: () => [LessonResourceDto] })
  resources: LessonResourceDto[];

  @ApiProperty({ type: Boolean })
  isRequired: boolean;

  @ApiProperty({ type: Boolean })
  isPublished: boolean;

  @ApiProperty({ enum: COMPLETION_MODES, description: 'manual = the learner’s button; playback = enough of the media played; attendance = a live lesson attended (D-R134)' })
  completionMode: CompletionMode;

  @ApiProperty({ type: 'integer', nullable: true, description: 'The media length when known, else the estimate in seconds' })
  durationSeconds: number | null;

  @ApiProperty({ type: 'integer', description: 'Learners with progress on this lesson — such a lesson can only be unpublished, never deleted (D-R135)' })
  progressCount: number;

  @ApiProperty({ type: 'integer', description: 'D-R143: the non-cancelled class sessions (MOD-06 lessons) linked to this lesson, in every class of the course' })
  sessionCount: number;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class CurriculumSectionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: 'integer', description: '1-based number of the level («المستوى الأول» = 1)' })
  number: number;

  @ApiProperty({ type: 'integer', description: 'Position (0 first)' })
  sortOrder: number;

  @ApiProperty({ type: () => LocalizedTextDto, nullable: true })
  title: LocalizedText | null;

  @ApiProperty({ type: () => LocalizedTextDto, nullable: true })
  description: LocalizedText | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    minimum: 0,
    maximum: RELEASE_AFTER_DAYS_MAX,
    description: 'D-R145: the level opens for a learner on their class’s start day + N days; null = open from the start',
  })
  releaseAfterDays: number | null;

  @ApiProperty({ type: () => [CurriculumItemDto], description: 'In order; empty for an empty level' })
  items: CurriculumItemDto[];
}

export class CurriculumDto {
  @ApiProperty({ format: 'uuid' })
  courseId: string;

  @ApiProperty()
  courseCode: string;

  @ApiProperty({ type: Boolean, description: 'True when the caller holds `courses.manage` (a teacher reads without editing)' })
  canManage: boolean;

  @ApiProperty({ type: () => [CurriculumSectionDto], description: 'Every level in order, empty ones too' })
  sections: CurriculumSectionDto[];

  @ApiProperty({ type: () => [CurriculumItemDto], description: 'The lessons outside every level, in order (after the levels)' })
  looseItems: CurriculumItemDto[];
}
