import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { ROLE_KEY_PATTERN } from '../users/users.dto.js';
import { identifierParam, nullableTextParam, trimParam } from '../users/users.validation.js';

/** Permission keys: `<area>.<action>` in lower-case letters, digits, `_` and `.`, 3–100 characters (6.2). */
export const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9_.]{2,99}$/;
/** A role can never hold more keys than the catalog has room for. */
export const ROLE_PERMISSIONS_MAX = 200;
export const LOCALIZED_TEXT_MAX_LENGTH = 200;

/**
 * Localized text as stored in the jsonb columns (D1): `ar` is required, `en`
 * and `tr` optional; a blank optional locale is dropped. Unknown locales are
 * rejected by the global `forbidNonWhitelisted`.
 */
export class LocalizedTextDto {
  @ApiProperty({ minLength: 1, maxLength: LOCALIZED_TEXT_MAX_LENGTH, example: 'أمين المكتبة' })
  @Transform(trimParam)
  @IsString()
  @Length(1, LOCALIZED_TEXT_MAX_LENGTH)
  ar: string;

  @ApiPropertyOptional({ maxLength: LOCALIZED_TEXT_MAX_LENGTH, example: 'Librarian' })
  @IsOptional()
  @Transform(nullableTextParam)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @Length(1, LOCALIZED_TEXT_MAX_LENGTH)
  en?: string | null;

  @ApiPropertyOptional({ maxLength: LOCALIZED_TEXT_MAX_LENGTH, example: 'Kütüphaneci' })
  @IsOptional()
  @Transform(nullableTextParam)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @Length(1, LOCALIZED_TEXT_MAX_LENGTH)
  tr?: string | null;
}

/** Drops empty optional locales so the stored JSON holds strings only. */
export function toLocalizedText(dto: LocalizedTextDto): LocalizedText {
  const text: LocalizedText = { ar: dto.ar };
  if (typeof dto.en === 'string') text.en = dto.en;
  if (typeof dto.tr === 'string') text.tr = dto.tr;
  return text;
}

export class CreateRoleDto {
  @ApiProperty({
    minLength: 3,
    maxLength: 64,
    example: 'librarian',
    description: 'Trimmed and lower-cased; letters, digits and `_`, starting with a letter. System role keys are reserved.',
  })
  @Transform(identifierParam)
  @IsString()
  @Matches(ROLE_KEY_PATTERN, { message: 'key must be 3–64 lower-case letters, digits or "_" starting with a letter' })
  key: string;

  @ApiProperty({ type: LocalizedTextDto, description: '`ar` is required' })
  @IsDefined()
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  label: LocalizedTextDto;

  @ApiPropertyOptional({ type: LocalizedTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  description?: LocalizedTextDto;

  @ApiProperty({
    type: [String],
    example: ['courses.read', 'lessons.read'],
    description:
      'Keys of the active catalog (`GET /api/permissions`). No key may be one the caller does not hold (learner baseline excepted).',
  })
  @IsArray()
  @ArrayMaxSize(ROLE_PERMISSIONS_MAX)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(PERMISSION_KEY_PATTERN, { each: true, message: 'each permission must be a catalog key such as "courses.read"' })
  permissions: string[];
}

/**
 * PATCH semantics: an absent field is left alone, `description: null` clears
 * it, `permissions` replaces the whole set. System roles other than
 * `academy_admin` accept `permissions` only.
 */
export class UpdateRoleDto {
  @ApiPropertyOptional({ type: LocalizedTextDto, description: 'Custom roles only' })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  label?: LocalizedTextDto;

  @ApiPropertyOptional({ type: LocalizedTextDto, nullable: true, description: 'Custom roles only; null clears it' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  description?: LocalizedTextDto | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['courses.read', 'lessons.read', 'lessons.manage'],
    description: 'The complete new set; keys added must be held by the caller (learner baseline excepted)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ROLE_PERMISSIONS_MAX)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(PERMISSION_KEY_PATTERN, { each: true, message: 'each permission must be a catalog key such as "courses.read"' })
  permissions?: string[];
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class RoleDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'teacher' })
  key: string;

  @ApiProperty({ description: 'Localized label `{ ar, en?, tr? }`', example: { ar: 'معلم', en: 'Teacher' } })
  label: LocalizedText;

  @ApiProperty({ nullable: true, description: 'Localized description `{ ar, en?, tr? }`' })
  description: LocalizedText | null;

  @ApiProperty({ description: 'Seeded system role: cannot be deleted; `academy_admin` cannot be changed at all' })
  isSystem: boolean;

  @ApiProperty({ description: 'Granted automatically on self-registration (D-R04, not enabled yet)' })
  isDefaultForSignup: boolean;

  @ApiProperty({ description: 'Users currently holding the role (soft-deleted users included)' })
  userCount: number;

  @ApiProperty({ type: [String], description: 'Active permission keys, sorted (deprecated grants are not listed)' })
  permissions: string[];

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class RoleListDto {
  @ApiProperty({ type: [RoleDto], description: 'System roles first, then custom roles, each group by key' })
  items: RoleDto[];
}

export class PermissionDto {
  @ApiProperty({ example: 'users.read' })
  key: string;

  @ApiProperty({ nullable: true, description: 'Localized description `{ ar, en? }`', example: { ar: 'عرض المستخدمين', en: 'View users' } })
  description: LocalizedText | null;
}

export class PermissionGroupDto {
  @ApiProperty({ example: 'MOD-03', description: 'Owning module identifier (master documentation, section 08)' })
  module: string;

  @ApiProperty({ type: [PermissionDto], description: 'In catalog declaration order' })
  permissions: PermissionDto[];
}

export class PermissionCatalogDto {
  @ApiProperty({ type: [PermissionGroupDto], description: 'Active keys only, grouped by module (module order)' })
  groups: PermissionGroupDto[];

  @ApiProperty({ description: 'Number of active keys' })
  total: number;
}
