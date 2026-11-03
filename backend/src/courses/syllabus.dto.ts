import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDefined, IsInt, IsObject, IsOptional, IsUUID, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { rawNumber } from './courses.validation.js';

/** Upper bound of a syllabus (also bounds the request body). */
export const SYLLABUS_ITEMS_MAX = 200;
/** One item is at most a day of teaching. */
export const SYLLABUS_MINUTES_MAX = 1440;

export class SyllabusItemInputDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Id of an existing item of this course; absent for a new item' })
  @IsOptional()
  @IsUUID('all')
  id?: string;

  @ApiProperty({ type: LocalizedTextDto, description: 'Localized title `{ ar, en?, tr? }`; `ar` required' })
  @IsDefined()
  @IsObject({ message: 'title must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  title: LocalizedTextDto;

  @ApiPropertyOptional({ type: LocalizedTextDto, nullable: true, description: 'Absent or null = no description (the list is the complete state)' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'description must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  description?: LocalizedTextDto | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: SYLLABUS_MINUTES_MAX, example: 45, description: 'Absent or null = no estimate; a JSON number' })
  @IsOptional()
  @Transform(rawNumber)
  @ValidateIf((_dto, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(SYLLABUS_MINUTES_MAX)
  estimatedMinutes?: number | null;
}

/** The complete syllabus in its new order (first item = position 0). */
export class ReplaceSyllabusDto {
  @ApiProperty({ type: [SyllabusItemInputDto], maxItems: SYLLABUS_ITEMS_MAX })
  @IsArray()
  @ArrayMaxSize(SYLLABUS_ITEMS_MAX)
  @ValidateNested({ each: true })
  @Type(() => SyllabusItemInputDto)
  items: SyllabusItemInputDto[];
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class SyllabusItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Position (0 first)' })
  sortOrder: number;

  @ApiProperty({ description: 'Localized title `{ ar, en?, tr? }`' })
  title: LocalizedText;

  @ApiProperty({ nullable: true })
  description: LocalizedText | null;

  @ApiProperty({ nullable: true })
  estimatedMinutes: number | null;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class SyllabusDto {
  @ApiProperty({ format: 'uuid' })
  courseId: string;

  @ApiProperty({ type: [SyllabusItemDto], description: 'In order' })
  items: SyllabusItemDto[];
}
