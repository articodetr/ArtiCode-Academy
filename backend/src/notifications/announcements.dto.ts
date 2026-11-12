import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDefined, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, Min, NotContains, ValidateNested, registerDecorator } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { ANNOUNCEMENT_AUDIENCE_KINDS, ANNOUNCEMENT_ROLE_KEYS } from './announcements.audience.js';
import { ANNOUNCEMENT_MAX_RECIPIENTS } from './notifications.errors.js';

export const ANNOUNCEMENTS_PAGE_DEFAULT = 20;
export const ANNOUNCEMENTS_PAGE_MAX = 100;
/** CHECK `ck_announcements_title_length`. */
export const ANNOUNCEMENT_TITLE_MAX_LENGTH = 200;
/** CHECK `ck_announcements_body_length`. */
export const ANNOUNCEMENT_BODY_MAX_LENGTH = 4000;
/** How many role keys a body may carry at all; which of them are valid is `checkAudience()`'s question (`audience_invalid`). */
const ROLE_KEYS_INPUT_MAX = 16;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** PostgreSQL stores no NUL in a text; refused here so it is a 400 and not a failed insert. */
const NUL = '\u0000';

/** Body booleans are the raw JSON value: the global implicit conversion must not turn `"no"` into `true` (KI-039). */
function rawBoolean({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  return obj[key];
}

/**
 * The sender's words are the raw JSON value, trimmed: a number or a boolean
 * stays what it is for @IsString to refuse (the implicit conversion would
 * make `42` the text "42" — KI-039), and a blank text fails the length rule.
 */
function rawText({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  const value = obj[key];
  return typeof value === 'string' ? value.trim() : value;
}

function trimmedParam({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * `min`..`max` characters, counted the way the CHECK on the column counts
 * them — PostgreSQL's `char_length()`: code points. class-validator's @Length
 * is a different count (it leaves out a variation selector and takes a
 * surrogate pair for one): two hearts written U+2764 U+FE0F are two
 * characters to it and four to the database, so a text it lets through could
 * fail the insert with a 500.
 */
function HasCharacters(min: number, max: number): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'hasCharacters',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: `${String(propertyName)} must be ${min} to ${max} characters long` },
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'string') return false;
          const characters = [...value].length;
          return characters >= min && characters <= max;
        },
      },
    });
  };
}

// ---------------------------------------------------------------------------
// The audience — in the request and, normalised, in every answer
// ---------------------------------------------------------------------------

/**
 * The audience of an announcement (D-R85). One class for the two shapes: the
 * DTO checks the type of each field only, and `checkAudience()` judges the
 * shape as a whole — a field that belongs to the other kind is
 * `audience_invalid`, not a validation error.
 */
export class AnnouncementAudienceDto {
  @ApiProperty({
    enum: ANNOUNCEMENT_AUDIENCE_KINDS,
    description: '`class`: people of one class (`classId` and at least one of `students` / `guardians` / `teachers`) · `academy`: everyone who holds one of `roleKeys` (needs `classes.manage` too)',
  })
  @IsString()
  kind: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'With `class` only (required): a class the caller teaches, or any class with `classes.manage`' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;

  @ApiPropertyOptional({ description: 'With `class` only: the students with an active enrollment in the class. A JSON boolean' })
  @IsOptional()
  @Transform(rawBoolean)
  @IsBoolean()
  students?: boolean;

  @ApiPropertyOptional({ description: 'With `class` only: the guardians of those students (a link and the `guardian` role). A JSON boolean' })
  @IsOptional()
  @Transform(rawBoolean)
  @IsBoolean()
  guardians?: boolean;

  @ApiPropertyOptional({ description: 'With `class` only: the teachers of the class, lead and assistants. A JSON boolean' })
  @IsOptional()
  @Transform(rawBoolean)
  @IsBoolean()
  teachers?: boolean;

  @ApiPropertyOptional({
    enum: ANNOUNCEMENT_ROLE_KEYS,
    isArray: true,
    example: ['student', 'guardian'],
    description: 'With `academy` only (required): 1–4 distinct role keys — everyone who holds one of them',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ROLE_KEYS_INPUT_MAX)
  @IsString({ each: true })
  roleKeys?: string[];
}

// ---------------------------------------------------------------------------
// API-173 — sending
// ---------------------------------------------------------------------------

export class CreateAnnouncementDto {
  @ApiProperty({ type: AnnouncementAudienceDto })
  @IsDefined()
  @IsObject({ message: 'audience must be an object { kind, … }' })
  @ValidateNested()
  @Type(() => AnnouncementAudienceDto)
  audience: AnnouncementAudienceDto;

  @ApiProperty({ minLength: 1, maxLength: ANNOUNCEMENT_TITLE_MAX_LENGTH, example: 'تأجيل درس الغد', description: 'Plain text, trimmed; shown to every recipient as typed' })
  @Transform(rawText)
  @IsString()
  @HasCharacters(1, ANNOUNCEMENT_TITLE_MAX_LENGTH)
  @NotContains(NUL, { message: 'title must not contain a NUL character' })
  title: string;

  @ApiProperty({
    minLength: 1,
    maxLength: ANNOUNCEMENT_BODY_MAX_LENGTH,
    example: 'يُؤجَّل درس الغد إلى يوم الخميس في الموعد نفسه.',
    description: 'Plain text, trimmed; stored and returned as typed — never interpreted as HTML',
  })
  @Transform(rawText)
  @IsString()
  @HasCharacters(1, ANNOUNCEMENT_BODY_MAX_LENGTH)
  @NotContains(NUL, { message: 'body must not contain a NUL character' })
  body: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'true: each recipient with a confirmed address who left the e-mail of the `announcements` category on is also e-mailed (the title and a link — never the body). A JSON boolean',
  })
  @IsOptional()
  @Transform(rawBoolean)
  @IsBoolean()
  sendEmail?: boolean;
}

// ---------------------------------------------------------------------------
// API-174 — listing
// ---------------------------------------------------------------------------

/** Filters of the announcements a caller may read; keyset pagination on the id, newest first. */
export class ListAnnouncementsQueryDto {
  @ApiPropertyOptional({ default: ANNOUNCEMENTS_PAGE_DEFAULT, minimum: 1, maximum: ANNOUNCEMENTS_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ANNOUNCEMENTS_PAGE_MAX)
  limit?: number = ANNOUNCEMENTS_PAGE_DEFAULT;

  @ApiPropertyOptional({ description: 'Opaque page cursor: pass the `nextCursor` of the previous page (same filters) to fetch the next, older page.' })
  @IsOptional()
  @Transform(trimmedParam)
  @IsString()
  @Matches(UUID_PATTERN, { message: 'cursor must be a nextCursor value of a previous page' })
  cursor?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Announcements sent to this class only' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class AnnouncementClassDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ENG-A1-2026-1' })
  code: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`' })
  name: LocalizedText;
}

export class AnnouncementSenderDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  fullName: string;

  @ApiProperty({ type: String, nullable: true })
  displayName: string | null;
}

export class AnnouncementDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    type: AnnouncementAudienceDto,
    description:
      'The audience as sent, normalised: `{ kind: "class", classId, students, guardians, teachers }` with the three groups spelled out, or `{ kind: "academy", roleKeys }` with the keys in the order student, guardian, teacher, staff',
  })
  audience: AnnouncementAudienceDto;

  @ApiProperty({ type: AnnouncementClassDto, nullable: true, description: 'The class of a class announcement; null for an academy announcement (and for a class that no longer exists — `audience.classId` keeps its id)' })
  class: AnnouncementClassDto | null;

  @ApiProperty({ description: 'As the sender typed it (trimmed) — plain text' })
  title: string;

  @ApiProperty({ description: 'As the sender typed it (trimmed) — plain text, never HTML' })
  body: string;

  @ApiProperty({ description: 'Whether the sender asked for an e-mail copy' })
  sendEmail: boolean;

  @ApiProperty({ minimum: 1, maximum: ANNOUNCEMENT_MAX_RECIPIENTS, description: 'Recipients when it was sent: active accounts, each once, without the sender' })
  recipientCount: number;

  @ApiProperty({ type: AnnouncementSenderDto, nullable: true, description: 'null when the sender’s account no longer exists' })
  sender: AnnouncementSenderDto | null;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;
}

export class AnnouncementListDto {
  @ApiProperty({ type: [AnnouncementDto] })
  items: AnnouncementDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Cursor of the next, older page; null on the last page' })
  nextCursor: string | null;
}

/** The e-mail copies of an announcement by their state — counts only, never an address. */
export class AnnouncementEmailCountsDto {
  @ApiProperty({ minimum: 0, description: 'No e-mail was due: not asked for, no confirmed address, or the recipient switched the category off' })
  none: number;

  @ApiProperty({ minimum: 0, description: 'Waiting to be sent' })
  queued: number;

  @ApiProperty({ minimum: 0 })
  sent: number;

  @ApiProperty({ minimum: 0 })
  failed: number;

  @ApiProperty({ minimum: 0, description: 'Due, but the academy has no mail transport (or the recipient lost the address before sending)' })
  skipped: number;
}

/** API-175: the announcement with what became of it — counts only, no list of recipients. */
export class AnnouncementDetailDto extends AnnouncementDto {
  @ApiProperty({ minimum: 0, description: 'Recipients who marked its notification as read' })
  readCount: number;

  @ApiProperty({ type: AnnouncementEmailCountsDto })
  email: AnnouncementEmailCountsDto;
}
