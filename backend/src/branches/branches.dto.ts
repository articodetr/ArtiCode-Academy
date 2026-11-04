import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { IsIanaTimeZone, TIME_ZONE_MAX_LENGTH } from '../academy/academy.validation.js';
import { codeParam, LEVEL_CODE_PATTERN, rawBoolean } from '../courses/courses.validation.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { E164_PATTERN, nullableTextParam, trimParam } from '../users/users.validation.js';

/** Branch codes: 1–16 characters, upper-case letters, digits, `.`, `_`, `-` — the level alphabet (CHECK `ck_branches_code_trimmed`). */
export const BRANCH_CODE_PATTERN = LEVEL_CODE_PATTERN;

const CODE_MESSAGE = 'code must be 1–16 characters: letters, digits, ".", "_" or "-" (stored upper-case)';
const PHONE_MESSAGE = 'phone must be in E.164 form, e.g. +966500000000';

/** `trim`; a blank string becomes null (cleared) — for the nullable time zone. */
function nullableTrimParam(params: { value: unknown }): unknown {
  const value = trimParam(params);
  return value === '' ? null : value;
}

export class CreateBranchDto {
  @ApiProperty({ maxLength: 16, example: 'MAIN', description: 'Trimmed and upper-cased; unique among branches' })
  @Transform(codeParam)
  @IsString()
  @Matches(BRANCH_CODE_PATTERN, { message: CODE_MESSAGE })
  code: string;

  @ApiProperty({ type: LocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`; `ar` is required' })
  @IsDefined()
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name: LocalizedTextDto;

  @ApiPropertyOptional({ type: LocalizedTextDto, description: 'Localized address `{ ar, en?, tr? }`; `ar` is required when given' })
  @IsOptional()
  @IsObject({ message: 'address must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  address?: LocalizedTextDto;

  @ApiPropertyOptional({ example: '+966500000000', description: 'E.164' })
  @IsOptional()
  @Transform(nullableTextParam)
  @IsString()
  @Matches(E164_PATTERN, { message: PHONE_MESSAGE })
  phone?: string;

  @ApiPropertyOptional({ maxLength: TIME_ZONE_MAX_LENGTH, example: 'Europe/Istanbul', description: 'Canonical IANA name or `UTC` when it differs from the academy; absent = the academy’s' })
  @IsOptional()
  @Transform(nullableTrimParam)
  @IsString()
  @MaxLength(TIME_ZONE_MAX_LENGTH)
  @IsIanaTimeZone()
  timezone?: string;

  @ApiPropertyOptional({ default: false, description: 'Makes this the main branch; the current main branch steps down in the same transaction' })
  @IsOptional()
  @Transform(rawBoolean)
  @IsBoolean()
  isMain?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Inactive branches are visible to holders of `branches.manage` only; a main branch must be active' })
  @IsOptional()
  @Transform(rawBoolean)
  @IsBoolean()
  isActive?: boolean;
}

/**
 * PATCH semantics (as API-018): an absent field is left alone, `null` clears
 * `address`, `phone` and `timezone`, a value replaces. `name`/`address` are
 * replaced as whole objects (ADR-044). `code`, `name`, `isMain` and `isActive`
 * refuse `null`.
 */
export class UpdateBranchDto {
  @ApiPropertyOptional({ maxLength: 16, example: 'NORTH', description: 'Trimmed and upper-cased; unique among branches' })
  @ValidateIf((dto: UpdateBranchDto) => dto.code !== undefined)
  @Transform(codeParam)
  @IsString()
  @Matches(BRANCH_CODE_PATTERN, { message: CODE_MESSAGE })
  code?: string;

  @ApiPropertyOptional({ type: LocalizedTextDto, description: 'Replaces the whole localized name; `ar` required' })
  @ValidateIf((dto: UpdateBranchDto) => dto.name !== undefined)
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name?: LocalizedTextDto;

  @ApiPropertyOptional({ type: LocalizedTextDto, nullable: true, description: 'Replaces the whole localized address; null clears it' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'address must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  address?: LocalizedTextDto | null;

  @ApiPropertyOptional({ nullable: true, example: '+966500000000', description: 'E.164; null clears it' })
  @ValidateIf((dto: UpdateBranchDto) => dto.phone !== undefined && dto.phone !== null)
  @Transform(nullableTextParam)
  @IsString()
  @Matches(E164_PATTERN, { message: PHONE_MESSAGE })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: TIME_ZONE_MAX_LENGTH, example: 'Europe/Istanbul', description: 'Canonical IANA name or `UTC`; null = the academy’s again' })
  @ValidateIf((dto: UpdateBranchDto) => dto.timezone !== undefined && dto.timezone !== null)
  @Transform(nullableTrimParam)
  @IsString()
  @MaxLength(TIME_ZONE_MAX_LENGTH)
  @IsIanaTimeZone()
  timezone?: string | null;

  @ApiPropertyOptional({ description: 'true makes this the main branch (the current one steps down); false leaves the academy without a main branch' })
  @ValidateIf((dto: UpdateBranchDto) => dto.isMain !== undefined)
  @Transform(rawBoolean)
  @IsBoolean()
  isMain?: boolean;

  @ApiPropertyOptional({ description: 'false deactivates the branch (refused for the main branch unless `isMain: false` comes with it)' })
  @ValidateIf((dto: UpdateBranchDto) => dto.isActive !== undefined)
  @Transform(rawBoolean)
  @IsBoolean()
  isActive?: boolean;
}

export class BranchDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'MAIN' })
  code: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`', example: { ar: 'الفرع الرئيسي', en: 'Main branch' } })
  name: LocalizedText;

  @ApiProperty({ nullable: true, description: 'Localized address `{ ar, en?, tr? }`' })
  address: LocalizedText | null;

  @ApiProperty({ nullable: true, description: 'E.164' })
  phone: string | null;

  @ApiProperty({ nullable: true, description: 'IANA time zone; null = the academy’s' })
  timezone: string | null;

  @ApiProperty({ description: 'At most one branch is main' })
  isMain: boolean;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class BranchListDto {
  @ApiProperty({ type: [BranchDto], description: 'The main branch first, then by code' })
  items: BranchDto[];
}
