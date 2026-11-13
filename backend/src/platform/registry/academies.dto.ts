// DTOs of the academies registry routes (MOD-18-T04, API-183..190).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import type { LocalizedText } from '../../authorization/localized-text.js';
import { AcademyStatus, DomainKind, ProbeOutcome, SubscriptionStatus } from '../../generated/platform/client.js';
import { ACADEMY_STATUS_ACTIONS } from './academy-status.js';
import type { AcademyStatusAction } from './academy-status.js';
import { PlatformLocalizedTextDto } from './registry.dto.js';
import {
  ACADEMY_SLUG_PATTERN,
  EMAIL_MAX_LENGTH,
  HasCharacters,
  IsAcademyOrigin,
  IsPlatformHostname,
  NOTES_MAX_LENGTH,
  ORIGIN_MAX_LENGTH,
  REASON_MAX_LENGTH,
  queryBoolean,
  queryText,
  rawIdentifier,
  rawNullableEmail,
  rawNullableOrigin,
  rawNullableText,
  rawValue,
} from './registry.validation.js';
import { SubscriptionDto } from './subscriptions.dto.js';

export const ACADEMIES_PAGE_DEFAULT = 20;
export const ACADEMIES_PAGE_MAX = 100;
export const ACADEMY_STATUSES = Object.values(AcademyStatus) as AcademyStatus[];
export const DOMAIN_KINDS = Object.values(DomainKind) as DomainKind[];

const SLUG_MESSAGE = 'slug must be 1–32 lower-case letters, digits or "-", starting and ending with a letter or digit';
const ORIGIN_DESCRIPTION =
  'Public origin of the academy: `https://host[:port]`, or `http://localhost` / `http://127.0.0.1` with an optional port; host lower-cased, no path, no trailing slash (normalized)';

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export class ListAcademiesQueryDto {
  @ApiPropertyOptional({ maxLength: 100, description: 'Case-insensitive literal substring of the slug or of the Arabic/English name (`%` and `_` match themselves)' })
  @IsOptional()
  @Transform(queryText)
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ enum: ACADEMY_STATUSES, description: 'Exactly this status (also `archived`). Without it every status but `archived` is listed, unless `includeArchived=true`' })
  @IsOptional()
  @IsIn(ACADEMY_STATUSES)
  status?: AcademyStatus;

  @ApiPropertyOptional({ type: Boolean, default: false, description: '`true` also lists archived academies (ignored when `status` is given)' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  includeArchived?: boolean;

  @ApiPropertyOptional({ default: ACADEMIES_PAGE_DEFAULT, minimum: 1, maximum: ACADEMIES_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ACADEMIES_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 512, description: 'Opaque `nextCursor` of the previous page; send it with the same filters' })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;
}

export class CreateAcademyDto {
  @ApiProperty({ maxLength: 32, example: 'al-noor', description: 'Trimmed and lower-cased; the compose project is `academy-<slug>` (MOD-17); unique and immutable' })
  @Transform(rawIdentifier)
  @IsString()
  @Matches(ACADEMY_SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug: string;

  @ApiProperty({ type: PlatformLocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`; `ar` is required' })
  @IsDefined()
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => PlatformLocalizedTextDto)
  name: PlatformLocalizedTextDto;

  @ApiPropertyOptional({ maxLength: ORIGIN_MAX_LENGTH, example: 'https://al-noor.example.com', description: ORIGIN_DESCRIPTION })
  @IsOptional()
  @Transform(rawNullableOrigin)
  @ValidateIf((_dto, value) => value !== null)
  @IsAcademyOrigin()
  origin?: string | null;

  @ApiPropertyOptional({ maxLength: EMAIL_MAX_LENGTH, example: 'owner@al-noor.example.com', description: 'Trimmed and lower-cased' })
  @IsOptional()
  @Transform(rawNullableEmail)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  @IsEmail({}, { message: 'contactEmail must be an e-mail address' })
  contactEmail?: string | null;

  @ApiPropertyOptional({ maxLength: NOTES_MAX_LENGTH, description: 'Internal notes of the platform team (plain text, trimmed)' })
  @IsOptional()
  @Transform(rawNullableText)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @HasCharacters(1, NOTES_MAX_LENGTH)
  notes?: string | null;
}

/**
 * PATCH semantics: absent = unchanged, `null` (or a blank text) clears
 * `origin`, `contactEmail` and `notes`; `name` is replaced as a whole and is
 * not nullable. The slug is immutable — sending it is a 400 (whitelist).
 */
export class UpdateAcademyDto {
  @ApiPropertyOptional({ type: PlatformLocalizedTextDto, description: 'Replaces the whole localized name; `ar` required; not nullable' })
  @ValidateIf((dto: UpdateAcademyDto) => dto.name !== undefined)
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => PlatformLocalizedTextDto)
  name?: PlatformLocalizedTextDto;

  @ApiPropertyOptional({ maxLength: ORIGIN_MAX_LENGTH, nullable: true, description: `${ORIGIN_DESCRIPTION}. \`null\` clears it — refused while the academy is active (\`422 origin_required\`)` })
  @IsOptional()
  @Transform(rawNullableOrigin)
  @ValidateIf((_dto, value) => value !== null)
  @IsAcademyOrigin()
  origin?: string | null;

  @ApiPropertyOptional({ maxLength: EMAIL_MAX_LENGTH, nullable: true })
  @IsOptional()
  @Transform(rawNullableEmail)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  @IsEmail({}, { message: 'contactEmail must be an e-mail address' })
  contactEmail?: string | null;

  @ApiPropertyOptional({ maxLength: NOTES_MAX_LENGTH, nullable: true })
  @IsOptional()
  @Transform(rawNullableText)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @HasCharacters(1, NOTES_MAX_LENGTH)
  notes?: string | null;
}

export class ChangeAcademyStatusDto {
  @ApiProperty({
    enum: ACADEMY_STATUS_ACTIONS,
    description:
      'activate: provisioning|suspended→active (needs an origin) · suspend: active→suspended · archive: provisioning|active|suspended→archived · restore: archived→suspended',
  })
  @IsIn(ACADEMY_STATUS_ACTIONS)
  action: AcademyStatusAction;

  @ApiPropertyOptional({ maxLength: REASON_MAX_LENGTH, description: 'Why — kept in the audit event (plain text, trimmed)' })
  @IsOptional()
  @Transform(rawNullableText)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @HasCharacters(1, REASON_MAX_LENGTH)
  reason?: string | null;
}

export class AddDomainDto {
  @ApiProperty({ maxLength: 253, example: 'al-noor.articode.example', description: 'Trimmed and lower-cased; unique across every academy' })
  @Transform(rawIdentifier)
  @IsString()
  @IsPlatformHostname()
  hostname: string;

  @ApiProperty({ enum: DOMAIN_KINDS })
  @IsIn(DOMAIN_KINDS)
  kind: DomainKind;

  @ApiPropertyOptional({ type: Boolean, default: false, description: '`true` makes it the primary domain; the current primary steps down in the same write. A JSON boolean' })
  @IsOptional()
  @Transform(rawValue)
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateDomainDto {
  @ApiProperty({ type: Boolean, enum: [true], description: 'Only `true` (promote; the current primary steps down). `false` is `400 domain_demote_forbidden` — make another domain primary instead' })
  @Transform(rawValue)
  @IsBoolean()
  isPrimary: boolean;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class AcademyCurrentSubscriptionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  planId: string;

  @ApiProperty({ example: 'standard' })
  planKey: string;

  @ApiProperty({ enum: ['trial', 'active', 'past_due'] })
  status: SubscriptionStatus;

  @ApiProperty({ description: 'ISO 8601' })
  startsAt: string;

  @ApiProperty({ nullable: true, description: 'ISO 8601' })
  endsAt: string | null;

  @ApiProperty({ nullable: true, description: 'ISO 8601' })
  trialEndsAt: string | null;
}

/** The newest `academy_health_checks` row (written by the fleet probe, MOD-18-T05). */
export class AcademyLatestHealthCheckDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'ISO 8601' })
  checkedAt: string;

  @ApiProperty({ enum: Object.values(ProbeOutcome) })
  outcome: ProbeOutcome;

  @ApiProperty({ nullable: true })
  httpStatus: number | null;

  @ApiProperty({ nullable: true })
  latencyMs: number | null;

  @ApiProperty({ nullable: true, description: 'The academy API version (its GET /api/health)' })
  apiVersion: string | null;

  @ApiProperty({ nullable: true })
  environment: string | null;

  @ApiProperty({ nullable: true, description: '`checks.schema.status` of the academy readiness answer' })
  schemaStatus: string | null;

  @ApiProperty({ nullable: true, description: 'Newest migration the academy build expects' })
  schemaExpected: string | null;

  @ApiProperty({ nullable: true, description: 'Newest migration applied to the academy database' })
  schemaApplied: string | null;

  @ApiProperty({ nullable: true })
  reason: string | null;
}

export class AcademyItemDto {
  @ApiProperty({ format: 'uuid', description: 'Also `academy.platform_academy_id` in the academy database' })
  id: string;

  @ApiProperty({ example: 'al-noor' })
  slug: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`', example: { ar: 'أكاديمية النور', en: 'Al-Noor Academy' } })
  name: LocalizedText;

  @ApiProperty({ enum: ACADEMY_STATUSES })
  status: AcademyStatus;

  @ApiProperty({ nullable: true, example: 'https://al-noor.example.com' })
  origin: string | null;

  @ApiProperty({ nullable: true })
  contactEmail: string | null;

  @ApiProperty({ nullable: true, description: 'Hostname of the primary domain' })
  primaryDomain: string | null;

  @ApiProperty({ type: AcademyCurrentSubscriptionDto, nullable: true, description: 'The trial | active | past_due subscription' })
  currentSubscription: AcademyCurrentSubscriptionDto | null;

  @ApiProperty({ type: AcademyLatestHealthCheckDto, nullable: true, description: 'The newest probe of the academy (null before the first one)' })
  latestHealthCheck: AcademyLatestHealthCheckDto | null;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class AcademyListDto {
  @ApiProperty({ type: [AcademyItemDto] })
  items: AcademyItemDto[];

  @ApiProperty({ nullable: true, description: 'Cursor of the next page; null on the last page' })
  nextCursor: string | null;
}

export class DomainDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'al-noor.articode.example' })
  hostname: string;

  @ApiProperty({ enum: DOMAIN_KINDS })
  kind: DomainKind;

  @ApiProperty()
  isPrimary: boolean;

  @ApiProperty({ nullable: true, description: 'ISO 8601; ownership is not verified in v1 (D-R102), so always null' })
  verifiedAt: string | null;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;
}

export class PlatformUserRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  fullName: string;
}

export class AcademyDetailDto extends AcademyItemDto {
  @ApiProperty({ nullable: true })
  notes: string | null;

  @ApiProperty({ nullable: true, description: 'ISO 8601; set exactly while archived' })
  archivedAt: string | null;

  @ApiProperty({ type: PlatformUserRefDto, nullable: true, description: 'The platform user who registered it (null once that account is deleted)' })
  createdBy: PlatformUserRefDto | null;

  @ApiProperty({ type: [DomainDto], description: 'Primary first, then by hostname' })
  domains: DomainDto[];

  @ApiProperty({ type: [SubscriptionDto], description: 'Newest first' })
  subscriptions: SubscriptionDto[];
}
