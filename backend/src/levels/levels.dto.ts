import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { codeParam, LEVEL_CODE_PATTERN, rawBoolean } from '../courses/courses.validation.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';

/** No academy needs more levels than this; also bounds the order list. */
export const LEVELS_MAX = 100;

const CODE_MESSAGE = 'code must be 1–16 characters: letters, digits, ".", "_" or "-" (stored upper-case)';

export class CreateLevelDto {
  @ApiProperty({ maxLength: 16, example: 'BEG', description: 'Trimmed and upper-cased; unique among levels' })
  @Transform(codeParam)
  @IsString()
  @Matches(LEVEL_CODE_PATTERN, { message: CODE_MESSAGE })
  code: string;

  @ApiProperty({ type: LocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`; `ar` is required' })
  @IsDefined()
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name: LocalizedTextDto;

  @ApiPropertyOptional({ type: LocalizedTextDto })
  @IsOptional()
  @IsObject({ message: 'description must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  description?: LocalizedTextDto;

  @ApiPropertyOptional({ default: true, description: 'Inactive levels stay on their courses but are hidden from non-managers and pickers' })
  @IsOptional()
  @Transform(rawBoolean)
  @IsBoolean()
  isActive?: boolean;
}

/**
 * PATCH semantics (as API-018): an absent field is left alone, `description:
 * null` clears it, a value replaces it. `name` is replaced as a whole object
 * (ADR-044). The order is changed through `PUT /api/levels/order` only.
 */
export class UpdateLevelDto {
  @ApiPropertyOptional({ maxLength: 16, example: 'INT', description: 'Trimmed and upper-cased; unique among levels' })
  @ValidateIf((dto: UpdateLevelDto) => dto.code !== undefined)
  @Transform(codeParam)
  @IsString()
  @Matches(LEVEL_CODE_PATTERN, { message: CODE_MESSAGE })
  code?: string;

  @ApiPropertyOptional({ type: LocalizedTextDto, description: 'Replaces the whole localized name; `ar` required' })
  @ValidateIf((dto: UpdateLevelDto) => dto.name !== undefined)
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name?: LocalizedTextDto;

  @ApiPropertyOptional({ type: LocalizedTextDto, nullable: true, description: 'Replaces the whole localized description; null clears it' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'description must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  description?: LocalizedTextDto | null;

  @ApiPropertyOptional({ description: 'Hide (false) or show (true) the level for non-managers and pickers' })
  @ValidateIf((dto: UpdateLevelDto) => dto.isActive !== undefined)
  @Transform(rawBoolean)
  @IsBoolean()
  isActive?: boolean;
}

export class ReorderLevelsDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Every level id exactly once, in the new order (first = sort order 0)',
  })
  @IsArray()
  @ArrayMaxSize(LEVELS_MAX)
  @IsUUID('all', { each: true, message: 'each levelId must be a UUID' })
  levelIds: string[];
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class LevelDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'BEG' })
  code: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`', example: { ar: 'مبتدئ', en: 'Beginner' } })
  name: LocalizedText;

  @ApiProperty({ nullable: true, description: 'Localized description `{ ar, en?, tr? }`' })
  description: LocalizedText | null;

  @ApiProperty({ description: 'Position in the list (0 first); gaps are possible after a deletion' })
  sortOrder: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({
    nullable: true,
    description: 'Courses of any state using the level — for holders of `courses.manage` only (null otherwise); a level in use cannot be deleted',
  })
  courseCount: number | null;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class LevelListDto {
  @ApiProperty({ type: [LevelDto], description: 'By sort order; inactive levels only for holders of `courses.manage`' })
  items: LevelDto[];
}
