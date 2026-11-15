// DTOs of the subscription routes (MOD-18-T04, API-194/195). A subscription
// ties an academy to a plan with a status and dates — no price, no invoice
// (D-R101; MOD-11 is the academy's billing of its own students, unrelated).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
import type { LocalizedText } from '../../authorization/localized-text.js';
import { SubscriptionStatus } from '../../generated/platform/client.js';
import { IsInstant } from '../../lessons/lessons.time.js';
import { CURRENT_SUBSCRIPTION_STATUSES } from './registry.changes.js';
import type { CurrentSubscriptionStatus } from './registry.changes.js';
import { PlatformLocalizedTextDto } from './registry.dto.js';
import { HasCharacters, NOTES_MAX_LENGTH, rawNullableText, rawValue } from './registry.validation.js';

export const SUBSCRIPTION_STATUSES = Object.values(SubscriptionStatus) as SubscriptionStatus[];

const INSTANT = 'ISO 8601 instant with an offset or `Z`, e.g. `2026-12-01T00:00:00Z`';

export class CreateSubscriptionDto {
  @ApiProperty({ format: 'uuid', description: 'An active plan (`422 plan_inactive` otherwise)' })
  @IsUUID('all')
  planId: string;

  @ApiProperty({ enum: CURRENT_SUBSCRIPTION_STATUSES, description: 'A new subscription is current: trial, active or past_due' })
  @IsIn(CURRENT_SUBSCRIPTION_STATUSES)
  status: CurrentSubscriptionStatus;

  @ApiProperty({ description: INSTANT })
  @Transform(rawValue)
  @IsInstant()
  startsAt: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: `${INSTANT}; after startsAt` })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsInstant()
  endsAt?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: `${INSTANT}; after startsAt; only with status \`trial\`` })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsInstant()
  trialEndsAt?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: NOTES_MAX_LENGTH, description: 'Plain text, trimmed' })
  @IsOptional()
  @Transform(rawNullableText)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @HasCharacters(1, NOTES_MAX_LENGTH)
  notes?: string | null;
}

/**
 * PATCH semantics: absent = unchanged, `null` clears `endsAt`, `trialEndsAt`
 * and `notes`. Status moves: trial→active|canceled|expired,
 * active→past_due|canceled|expired, past_due→active|canceled|expired;
 * canceled and expired are terminal. The plan and `startsAt` do not change —
 * end the subscription and create another.
 */
export class UpdateSubscriptionDto {
  @ApiPropertyOptional({ enum: SUBSCRIPTION_STATUSES })
  @IsOptional()
  @IsIn(SUBSCRIPTION_STATUSES)
  status?: SubscriptionStatus;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: INSTANT })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsInstant()
  endsAt?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: `${INSTANT}; a new non-null value only while the subscription is (or becomes) a trial` })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsInstant()
  trialEndsAt?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: NOTES_MAX_LENGTH, nullable: true })
  @IsOptional()
  @Transform(rawNullableText)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @HasCharacters(1, NOTES_MAX_LENGTH)
  notes?: string | null;
}

export class SubscriptionPlanRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'standard' })
  key: string;

  @ApiProperty({ type: () => PlatformLocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`' })
  name: LocalizedText;

  @ApiProperty()
  isActive: boolean;
}

export class SubscriptionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  academyId: string;

  @ApiProperty({ type: SubscriptionPlanRefDto })
  plan: SubscriptionPlanRefDto;

  @ApiProperty({ enum: SUBSCRIPTION_STATUSES })
  status: SubscriptionStatus;

  @ApiProperty({ description: 'ISO 8601' })
  startsAt: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'ISO 8601' })
  endsAt: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'ISO 8601' })
  trialEndsAt: string | null;

  @ApiProperty({ type: String, nullable: true })
  notes: string | null;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}
