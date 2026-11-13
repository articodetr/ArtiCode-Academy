// Shared DTO pieces of the academies registry (MOD-18-T04).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, ValidateIf } from 'class-validator';
import type { LocalizedText } from '../../authorization/localized-text.js';
import { REGISTRY_ERROR_CODES } from './registry.errors.js';
import { HasCharacters, LOCALIZED_NAME_MAX_LENGTH, rawNullableText, rawTrimmed } from './registry.validation.js';

/**
 * A localized name `{ ar, en?, tr? }` (the academy's D1 shape — the CHECKs
 * `ck_academies_name_localized` / `ck_plans_name_localized`): `ar` required,
 * `en`/`tr` optional (a blank or null optional locale is dropped), each at most
 * 200 characters. Unknown locales are refused by the global `forbidNonWhitelisted`.
 */
export class PlatformLocalizedTextDto {
  @ApiProperty({ minLength: 1, maxLength: LOCALIZED_NAME_MAX_LENGTH, example: 'أكاديمية النور' })
  @Transform(rawTrimmed)
  @IsString()
  @HasCharacters(1, LOCALIZED_NAME_MAX_LENGTH)
  ar: string;

  @ApiPropertyOptional({ maxLength: LOCALIZED_NAME_MAX_LENGTH, nullable: true, example: 'Al-Noor Academy' })
  @IsOptional()
  @Transform(rawNullableText)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @HasCharacters(1, LOCALIZED_NAME_MAX_LENGTH)
  en?: string | null;

  @ApiPropertyOptional({ maxLength: LOCALIZED_NAME_MAX_LENGTH, nullable: true })
  @IsOptional()
  @Transform(rawNullableText)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @HasCharacters(1, LOCALIZED_NAME_MAX_LENGTH)
  tr?: string | null;
}

/** Drops empty optional locales so the stored JSON holds strings only. */
export function toPlatformLocalizedText(dto: PlatformLocalizedTextDto): LocalizedText {
  const text: LocalizedText = { ar: dto.ar };
  if (typeof dto.en === 'string') text.en = dto.en;
  if (typeof dto.tr === 'string') text.tr = dto.tr;
  return text;
}

/** Body of every registry error (OpenAPI only). */
export class RegistryErrorDto {
  @ApiProperty({ example: 409 })
  statusCode: number;

  @ApiProperty({ example: 'Conflict' })
  error: string;

  @ApiProperty({ enum: REGISTRY_ERROR_CODES, example: 'academy_slug_taken' })
  code: string;

  @ApiProperty({ example: 'Another academy already uses this slug' })
  message: string;
}
