// DTOs of the plans routes (MOD-18-T04, API-191..193). Plans carry no price, no
// currency and no billing (D-R101); `limits` is a flat object the platform
// team defines (e.g. `{ students: 500, storageGb: null }` — null = no limit).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsObject, IsOptional, IsString, Matches, ValidateIf, ValidateNested } from 'class-validator';
import type { LocalizedText } from '../../authorization/localized-text.js';
import { PlatformLocalizedTextDto } from './registry.dto.js';
import { PLAN_KEY_PATTERN, PLAN_LIMITS_MAX_KEYS, queryBoolean, rawIdentifier, rawValue } from './registry.validation.js';
import type { PlanLimits } from './registry.validation.js';

const KEY_MESSAGE = 'key must be 1–40 lower-case letters, digits, "_" or "-", starting with a letter or digit';
const LIMITS_DESCRIPTION = `A flat JSON object of at most ${PLAN_LIMITS_MAX_KEYS} keys \`^[a-z][a-zA-Z0-9]{0,39}$\`, each a non-negative integer or null (no limit); anything else is \`400 plan_limits_invalid { problems, keys }\``;

export class ListPlansQueryDto {
  @ApiPropertyOptional({ type: Boolean, default: false, description: '`true` also lists inactive plans' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreatePlanDto {
  @ApiProperty({ maxLength: 40, example: 'standard', description: 'Trimmed and lower-cased; unique and immutable' })
  @Transform(rawIdentifier)
  @IsString()
  @Matches(PLAN_KEY_PATTERN, { message: KEY_MESSAGE })
  key: string;

  @ApiProperty({ type: PlatformLocalizedTextDto })
  @IsDefined()
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => PlatformLocalizedTextDto)
  name: PlatformLocalizedTextDto;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'integer', nullable: true, minimum: 0 }, example: { students: 500, storageGb: null }, description: `${LIMITS_DESCRIPTION}; default \`{}\`` })
  @IsOptional()
  @Transform(rawValue)
  limits?: unknown;

  @ApiPropertyOptional({ type: Boolean, default: true, description: 'A JSON boolean' })
  @IsOptional()
  @Transform(rawValue)
  @IsBoolean()
  isActive?: boolean;
}

/** PATCH semantics: absent = unchanged; `name` and `limits` are replaced as a whole and not nullable. The key is immutable — sending it is a 400. */
export class UpdatePlanDto {
  @ApiPropertyOptional({ type: PlatformLocalizedTextDto })
  @ValidateIf((dto: UpdatePlanDto) => dto.name !== undefined)
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => PlatformLocalizedTextDto)
  name?: PlatformLocalizedTextDto;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'integer', nullable: true, minimum: 0 }, description: `${LIMITS_DESCRIPTION}; replaces the whole object (\`{}\` clears every limit)` })
  @IsOptional()
  @Transform(rawValue)
  limits?: unknown;

  @ApiPropertyOptional({ type: Boolean, description: '`false` keeps the existing subscriptions on the plan but refuses new ones (`422 plan_inactive`). A JSON boolean' })
  @IsOptional()
  @Transform(rawValue)
  @IsBoolean()
  isActive?: boolean;
}

export class PlanDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'standard' })
  key: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`', example: { ar: 'الخطة القياسية', en: 'Standard' } })
  name: LocalizedText;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'integer', nullable: true }, description: 'Keys sorted', example: { storageGb: null, students: 500 } })
  limits: PlanLimits;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class PlanListDto {
  @ApiProperty({ type: [PlanDto], description: 'By key' })
  items: PlanDto[];
}
