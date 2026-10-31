import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsObject, IsString, IsUrl, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { LOCALES } from '../authorization/localized-text.js';
import type { LocaleCode, LocalizedText } from '../authorization/localized-text.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { E164_PATTERN, EMAIL_MAX_LENGTH, nullableIdentifierParam, nullableTextParam, trimParam } from '../users/users.validation.js';
import { CURRENCY_PATTERN, IsIanaTimeZone, TIME_ZONE_MAX_LENGTH, currencyParam } from './academy.validation.js';

/** Upper bound of the logo URL in a request (`logo_url` is unbounded text). */
export const LOGO_URL_MAX_LENGTH = 2048;

/**
 * PATCH semantics (D-R10, as API-018): an absent field is left alone, `null`
 * clears a nullable field (`logoUrl`, `contactEmail`, `contactPhone`), a value
 * replaces. `name`, `defaultLocale`, `timezone` and `currency` are NOT NULL in
 * the database and refuse `null` (ValidateIf runs the rules on every value but
 * `undefined`). `slug`, `platformAcademyId` and `settings` are out of scope and
 * rejected by the global `forbidNonWhitelisted`.
 */
export class UpdateAcademyDto {
  @ApiPropertyOptional({
    type: LocalizedTextDto,
    description: 'Localized name `{ ar, en?, tr? }` — replaces the whole object; `ar` required, a blank or null `en`/`tr` drops that locale',
  })
  @ValidateIf((dto: UpdateAcademyDto) => dto.name !== undefined)
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name?: LocalizedTextDto;

  @ApiPropertyOptional({ nullable: true, maxLength: LOGO_URL_MAX_LENGTH, example: 'https://cdn.example.com/academy/logo.png', description: 'Absolute http(s) URL; null clears it' })
  @ValidateIf((dto: UpdateAcademyDto) => dto.logoUrl !== undefined && dto.logoUrl !== null)
  @Transform(nullableTextParam)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false }, { message: 'logoUrl must be an absolute http(s) URL' })
  @MaxLength(LOGO_URL_MAX_LENGTH)
  logoUrl?: string | null;

  @ApiPropertyOptional({ enum: LOCALES, description: 'Language of the academy (fallback for users without a preference); not nullable' })
  @ValidateIf((dto: UpdateAcademyDto) => dto.defaultLocale !== undefined)
  @IsIn(LOCALES)
  defaultLocale?: LocaleCode;

  @ApiPropertyOptional({ maxLength: TIME_ZONE_MAX_LENGTH, example: 'Asia/Riyadh', description: 'Canonical IANA time zone name (`Intl.supportedValuesOf("timeZone")`) or `UTC`; not nullable' })
  @ValidateIf((dto: UpdateAcademyDto) => dto.timezone !== undefined)
  @Transform(trimParam)
  @IsString()
  @MaxLength(TIME_ZONE_MAX_LENGTH)
  @IsIanaTimeZone()
  timezone?: string;

  @ApiPropertyOptional({ minLength: 3, maxLength: 3, example: 'SAR', description: 'ISO 4217 alphabetic code; trimmed and upper-cased; not nullable' })
  @ValidateIf((dto: UpdateAcademyDto) => dto.currency !== undefined)
  @Transform(currencyParam)
  @IsString()
  @Matches(CURRENCY_PATTERN, { message: 'currency must be an ISO 4217 code of three letters, e.g. SAR' })
  currency?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: EMAIL_MAX_LENGTH, example: 'info@academy.example', description: 'Trimmed and lower-cased; null clears it' })
  @ValidateIf((dto: UpdateAcademyDto) => dto.contactEmail !== undefined && dto.contactEmail !== null)
  @Transform(nullableIdentifierParam)
  @IsEmail({}, { message: 'contactEmail must be a valid e-mail address' })
  @MaxLength(EMAIL_MAX_LENGTH)
  contactEmail?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '+966500000000', description: 'E.164; null clears it' })
  @ValidateIf((dto: UpdateAcademyDto) => dto.contactPhone !== undefined && dto.contactPhone !== null)
  @Transform(nullableTextParam)
  @IsString()
  @Matches(E164_PATTERN, { message: 'contactPhone must be in E.164 form, e.g. +966500000000' })
  contactPhone?: string | null;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/**
 * The single academy row as every signed-in user may see it (D-R09). Not
 * exposed: `singleton`, `platformAcademyId` (platform-internal) and `settings`
 * (deferred until its zod schema exists — ADR-044).
 */
export class AcademyDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'articode', description: 'Deployment identifier; read-only here' })
  slug: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`', example: { ar: 'أكاديمية آرتي كود', en: 'ArtiCode Academy' } })
  name: LocalizedText;

  @ApiProperty({ nullable: true, description: 'Absolute URL of the logo' })
  logoUrl: string | null;

  @ApiProperty({ enum: LOCALES, example: 'ar' })
  defaultLocale: LocaleCode;

  @ApiProperty({ example: 'Asia/Riyadh', description: 'IANA time zone name' })
  timezone: string;

  @ApiProperty({ example: 'SAR', description: 'ISO 4217 code' })
  currency: string;

  @ApiProperty({ nullable: true })
  contactEmail: string | null;

  @ApiProperty({ nullable: true, description: 'E.164' })
  contactPhone: string | null;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}
