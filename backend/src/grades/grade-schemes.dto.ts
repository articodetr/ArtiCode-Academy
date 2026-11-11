import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDefined, IsObject, IsOptional, IsString, Length, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { IsDecimalNumber } from '../common/decimal-number.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { rawBoolean, rawNumber } from '../courses/courses.validation.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { nullableTextParam } from '../users/users.validation.js';

export const GRADE_SCHEME_BANDS_MIN = 2;
export const GRADE_SCHEME_BANDS_MAX = 20;
export const BAND_LETTER_MAX_LENGTH = 4;

/** One band of a scheme (D-R46): it covers the percentages from `minPercent` up to the next band's. */
export class GradeSchemeBandInputDto {
  @ApiProperty({ minimum: 0, maximum: 100, example: 60, description: 'A JSON number with at most two decimals; unique inside the scheme; one band must start at 0' })
  @Transform(rawNumber)
  @IsDecimalNumber(2)
  @Min(0)
  @Max(100)
  minPercent: number;

  @ApiProperty({ type: LocalizedTextDto, description: 'Localized label `{ ar, en?, tr? }` (e.g. ممتاز); `ar` is required' })
  @IsDefined()
  @IsObject({ message: 'label must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  label: LocalizedTextDto;

  @ApiPropertyOptional({ maxLength: BAND_LETTER_MAX_LENGTH, nullable: true, example: 'A', description: 'Optional short code; trimmed, blank = none' })
  @IsOptional()
  @Transform(nullableTextParam)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @Length(1, BAND_LETTER_MAX_LENGTH)
  letter?: string | null;

  @ApiProperty({ description: 'A JSON boolean: this band passes; every band above a passing one must pass too' })
  @Transform(rawBoolean)
  @IsBoolean()
  isPass: boolean;
}

/** API-123: a new scheme with its whole band list. */
export class CreateGradeSchemeDto {
  @ApiProperty({ type: LocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`; `ar` is required' })
  @IsDefined()
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name: LocalizedTextDto;

  @ApiProperty({ type: [GradeSchemeBandInputDto], minItems: GRADE_SCHEME_BANDS_MIN, maxItems: GRADE_SCHEME_BANDS_MAX, description: 'Every band, in any order (stored ascending)' })
  @IsArray()
  @ArrayMinSize(GRADE_SCHEME_BANDS_MIN)
  @ArrayMaxSize(GRADE_SCHEME_BANDS_MAX)
  @ValidateNested({ each: true })
  @Type(() => GradeSchemeBandInputDto)
  bands: GradeSchemeBandInputDto[];

  @ApiPropertyOptional({ description: 'A JSON boolean; true makes it the default (the previous default steps down). The first scheme of the academy is the default whatever this says' })
  @IsOptional()
  @Transform(rawBoolean)
  @IsBoolean()
  isDefault?: boolean;
}

/** API-124: PATCH semantics — an absent field is left alone; `bands` replaces the whole list. */
export class UpdateGradeSchemeDto {
  @ApiPropertyOptional({ type: LocalizedTextDto, description: 'Replaces the whole localized name; `ar` required' })
  @ValidateIf((dto: UpdateGradeSchemeDto) => dto.name !== undefined)
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name?: LocalizedTextDto;

  @ApiPropertyOptional({ type: [GradeSchemeBandInputDto], minItems: GRADE_SCHEME_BANDS_MIN, maxItems: GRADE_SCHEME_BANDS_MAX, description: 'The whole new band list; final grades already fixed keep their snapshot' })
  @ValidateIf((dto: UpdateGradeSchemeDto) => dto.bands !== undefined)
  @IsArray()
  @ArrayMinSize(GRADE_SCHEME_BANDS_MIN)
  @ArrayMaxSize(GRADE_SCHEME_BANDS_MAX)
  @ValidateNested({ each: true })
  @Type(() => GradeSchemeBandInputDto)
  bands?: GradeSchemeBandInputDto[];

  @ApiPropertyOptional({ description: 'true promotes the scheme to the default (the previous one steps down); false on the default is `grade_scheme_is_default` — promote another scheme instead' })
  @ValidateIf((dto: UpdateGradeSchemeDto) => dto.isDefault !== undefined)
  @Transform(rawBoolean)
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'false deactivates the scheme (refused for the default); inactive schemes are listed for `academy.settings.manage` only' })
  @ValidateIf((dto: UpdateGradeSchemeDto) => dto.isActive !== undefined)
  @Transform(rawBoolean)
  @IsBoolean()
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class GradeSchemeBandDto {
  @ApiProperty({ example: 60 })
  minPercent: number;

  @ApiProperty({ description: 'Localized label `{ ar, en?, tr? }`', example: { ar: 'مقبول', en: 'Pass' } })
  label: LocalizedText;

  @ApiProperty({ type: String, nullable: true, example: 'D' })
  letter: string | null;

  @ApiProperty()
  isPass: boolean;
}

export class GradeSchemeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`', example: { ar: 'السلّم الافتراضي', en: 'Default scale' } })
  name: LocalizedText;

  @ApiProperty({ description: 'Exactly one scheme is the default once a scheme exists' })
  isDefault: boolean;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ type: [GradeSchemeBandDto], description: 'Ascending by minimum' })
  bands: GradeSchemeBandDto[];

  @ApiProperty({ type: Number, nullable: true, description: 'Final grades fixed with this scheme (a used scheme is deactivated, never deleted); null without `academy.settings.manage`' })
  finalGradeCount: number | null;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class GradeSchemeListDto {
  @ApiProperty({ type: [GradeSchemeDto], description: 'The default first, then by creation' })
  items: GradeSchemeDto[];
}
