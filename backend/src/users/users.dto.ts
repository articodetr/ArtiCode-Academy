import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { LOCALES } from '../authorization/localized-text.js';
import type { LocaleCode } from '../authorization/localized-text.js';
import { KIND_ROLE_KEYS } from '../authorization/system-roles.js';
import type { KindRoleKey } from '../authorization/system-roles.js';
import { EmployeeKind, GuardianRelationship, UserStatus } from '../generated/prisma/client.js';
import { SORT_ORDERS, USER_SORT_FIELDS } from './users.cursor.js';
import type { SortOrder, UserSortField } from './users.cursor.js';
import { USER_STATUS_ACTIONS } from './users.status.js';
import type { UserStatusAction } from './users.status.js';
import {
  E164_PATTERN,
  EMAIL_MAX_LENGTH,
  IsCalendarDate,
  REFERENCE_NUMBER_PATTERN,
  USERNAME_PATTERN,
  identifierParam,
  nullableIdentifierParam,
  nullableTextParam,
  textParam,
  trimParam,
} from './users.validation.js';

export const USERS_PAGE_DEFAULT = 20;
export const USERS_PAGE_MAX = 100;

/** Role keys: lower-case, 3–64 characters (same shape as the seeded system roles). */
export const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
/** Upper bound of extra roles on creation (the catalog has five system roles; custom roles are few). */
export const CREATE_ROLE_KEYS_MAX = 10;

/**
 * Query booleans: `true`/`false` (also `1`/`0`). Reads the raw query value so
 * the implicit conversion of the ValidationPipe (`Boolean('false') === true`)
 * cannot turn "false" into true; anything else is left for @IsBoolean to reject.
 */
function booleanParam({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  const value = obj[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}

/** Trims a text parameter; an empty result counts as absent. */
function trimmedParam({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export class ListUsersQueryDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive substring searched in full name, Latin name and display name — and in e-mail and username for callers holding `users.read_contact` (`%`/`_` are matched literally)',
    maxLength: 200,
    example: 'sara',
  })
  @IsOptional()
  @Transform(trimmedParam)
  @IsString()
  @Length(1, 200)
  q?: string;

  @ApiPropertyOptional({ enum: Object.values(UserStatus), description: 'Account status' })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ description: 'Role key the user must hold', example: 'teacher' })
  @IsOptional()
  @IsString()
  @Matches(ROLE_KEY_PATTERN)
  role?: string;

  @ApiPropertyOptional({
    description: 'Also return soft-deleted users. Requires the `users.deactivate` permission.',
    default: false,
  })
  @IsOptional()
  @Transform(booleanParam)
  @IsBoolean()
  includeDeleted?: boolean;

  @ApiPropertyOptional({
    enum: USER_SORT_FIELDS,
    default: 'createdAt',
    description: '`createdAt` = creation order (time-ordered primary key); `fullName` = alphabetical with the id as tie-breaker',
  })
  @IsOptional()
  @IsIn(USER_SORT_FIELDS)
  sort?: UserSortField;

  @ApiPropertyOptional({ enum: SORT_ORDERS, description: 'Default: `desc` for createdAt (newest first), `asc` for fullName' })
  @IsOptional()
  @IsIn(SORT_ORDERS)
  order?: SortOrder;

  @ApiPropertyOptional({ default: USERS_PAGE_DEFAULT, minimum: 1, maximum: USERS_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(USERS_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Opaque `nextCursor` of the previous page; send it with the same filters, sort and order',
    maxLength: 512,
  })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;
}

export class UserDetailQueryDto {
  @ApiPropertyOptional({
    description: 'Also resolve a soft-deleted user. Requires the `users.deactivate` permission.',
    default: false,
  })
  @IsOptional()
  @Transform(booleanParam)
  @IsBoolean()
  includeDeleted?: boolean;
}

// ---------------------------------------------------------------------------
// MOD-03-T02 — creation
// ---------------------------------------------------------------------------

/** Profile fields of a student (kind `student` only). */
export class CreateStudentProfileDto {
  @ApiPropertyOptional({ maxLength: 32, example: 'S-2026-001', description: 'Unique within the academy' })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Matches(REFERENCE_NUMBER_PATTERN, { message: 'studentNumber must be 1–32 letters, digits, ".", "_", "-" or "/"' })
  studentNumber?: string;

  @ApiPropertyOptional({ example: '2012-05-01', description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsCalendarDate()
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsCalendarDate()
  enrolledOn?: string;

  @ApiPropertyOptional({ maxLength: 2000, description: 'Administrative notes (never returned by the list or detail)' })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Profile fields of an employee (kinds `teacher` and `staff`); `kind` is taken from the user kind. */
export class CreateEmployeeProfileDto {
  @ApiPropertyOptional({ maxLength: 32, example: 'EMP-017', description: 'Unique within the academy' })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Matches(REFERENCE_NUMBER_PATTERN, { message: 'employeeNumber must be 1–32 letters, digits, ".", "_", "-" or "/"' })
  employeeNumber?: string;

  @ApiPropertyOptional({ maxLength: 120, example: 'Mathematics teacher' })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, 120)
  jobTitle?: string;

  @ApiPropertyOptional({ maxLength: 120, example: 'Mathematics' })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, 120)
  specialization?: string;

  @ApiPropertyOptional({ example: '2025-02-10', description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsCalendarDate()
  hiredOn?: string;
}

export class CreateUserDto {
  @ApiProperty({
    enum: KIND_ROLE_KEYS,
    example: 'student',
    description:
      'Kind of person: names the default system role and the profile created with the account (`student` → student profile, `teacher`/`staff` → employee profile, `guardian` → none). Admin accounts are a kind plus `academy_admin` in `roleKeys`.',
  })
  @IsIn(KIND_ROLE_KEYS)
  kind: KindRoleKey;

  @ApiPropertyOptional({ maxLength: EMAIL_MAX_LENGTH, example: 'sara@example.com', description: 'Trimmed and lower-cased; e-mail or username is required' })
  @IsOptional()
  @Transform(identifierParam)
  @IsEmail({}, { message: 'email must be a valid e-mail address' })
  @MaxLength(EMAIL_MAX_LENGTH)
  email?: string;

  @ApiPropertyOptional({
    minLength: 3,
    maxLength: 64,
    example: 'sara.ahmed',
    description: 'Trimmed and lower-cased; letters, digits, ".", "_", "-"; e-mail or username is required',
  })
  @IsOptional()
  @Transform(identifierParam)
  @IsString()
  @Matches(USERNAME_PATTERN, { message: 'username must be 3–64 lower-case letters, digits, ".", "_" or "-" starting with a letter or digit' })
  username?: string;

  @ApiPropertyOptional({ example: '+905551234567', description: 'E.164' })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Matches(E164_PATTERN, { message: 'phone must be in E.164 form, e.g. +905551234567' })
  phone?: string;

  @ApiProperty({ minLength: 2, maxLength: 200, example: 'سارة أحمد' })
  @Transform(textParam)
  @IsString()
  @Length(2, 200)
  fullName: string;

  @ApiPropertyOptional({ minLength: 2, maxLength: 200, example: 'Sara Ahmed', description: 'Latin-script name for English documents' })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(2, 200)
  fullNameLatin?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, 120)
  displayName?: string;

  @ApiPropertyOptional({ enum: LOCALES, description: 'Preferred language; absent = academy default' })
  @IsOptional()
  @IsIn(LOCALES)
  locale?: LocaleCode;

  @ApiPropertyOptional({ type: CreateStudentProfileDto, description: 'Only with `kind: "student"`' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateStudentProfileDto)
  studentProfile?: CreateStudentProfileDto;

  @ApiPropertyOptional({ type: CreateEmployeeProfileDto, description: 'Only with `kind: "teacher"` or `"staff"`' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateEmployeeProfileDto)
  employeeProfile?: CreateEmployeeProfileDto;

  @ApiPropertyOptional({
    type: [String],
    example: ['academy_admin'],
    description:
      'Additional role keys beyond the kind’s default role. Requires `users.roles.assign`; no role may confer a permission the caller does not hold (learner baseline excepted).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CREATE_ROLE_KEYS_MAX)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(ROLE_KEY_PATTERN, { each: true })
  roleKeys?: string[];
}

// ---------------------------------------------------------------------------
// MOD-03-T04 — update
// ---------------------------------------------------------------------------

/** Upper bound of an avatar URL in a request (`avatar_url` is unbounded text). */
export const AVATAR_URL_MAX_LENGTH = 2048;

const STUDENT_NUMBER_MESSAGE = 'studentNumber must be 1–32 letters, digits, ".", "_", "-" or "/"';
const EMPLOYEE_NUMBER_MESSAGE = 'employeeNumber must be 1–32 letters, digits, ".", "_", "-" or "/"';

/**
 * PATCH semantics for every field below: absent = unchanged, `null` = cleared
 * (optional fields only), value = replaced. Text is trimmed; a blank string
 * clears an optional field and is rejected for `fullName`.
 */
export class UpdateStudentProfileDto {
  @ApiPropertyOptional({ nullable: true, maxLength: 32, example: 'S-2026-001', description: 'Unique within the academy; null clears it' })
  @IsOptional()
  @Transform(nullableTextParam)
  @IsString()
  @Matches(REFERENCE_NUMBER_PATTERN, { message: STUDENT_NUMBER_MESSAGE })
  studentNumber?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2012-05-01', description: 'YYYY-MM-DD; null clears it' })
  @IsOptional()
  @IsCalendarDate()
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-09-01', description: 'YYYY-MM-DD; null clears it' })
  @IsOptional()
  @IsCalendarDate()
  enrolledOn?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000, description: 'Administrative notes (never returned); null clears them' })
  @IsOptional()
  @Transform(nullableTextParam)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

/** Employee profile fields; `kind` (T07) and `isActive` (employment status — not part of the account state machine, no API yet) are not updatable here. */
export class UpdateEmployeeProfileDto {
  @ApiPropertyOptional({ nullable: true, maxLength: 32, example: 'EMP-017', description: 'Unique within the academy; null clears it' })
  @IsOptional()
  @Transform(nullableTextParam)
  @IsString()
  @Matches(REFERENCE_NUMBER_PATTERN, { message: EMPLOYEE_NUMBER_MESSAGE })
  employeeNumber?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 120, example: 'Mathematics teacher' })
  @IsOptional()
  @Transform(nullableTextParam)
  @IsString()
  @Length(1, 120)
  jobTitle?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 120, example: 'Mathematics' })
  @IsOptional()
  @Transform(nullableTextParam)
  @IsString()
  @Length(1, 120)
  specialization?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2025-02-10', description: 'YYYY-MM-DD; null clears it' })
  @IsOptional()
  @IsCalendarDate()
  hiredOn?: string | null;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ nullable: true, maxLength: EMAIL_MAX_LENGTH, example: 'sara@example.com', description: 'Trimmed and lower-cased; null removes it (a username must remain). Changing it resets the e-mail verification.' })
  @IsOptional()
  @Transform(nullableIdentifierParam)
  @IsEmail({}, { message: 'email must be a valid e-mail address' })
  @MaxLength(EMAIL_MAX_LENGTH)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true, minLength: 3, maxLength: 64, example: 'sara.ahmed', description: 'Trimmed and lower-cased; null removes it (an e-mail must remain)' })
  @IsOptional()
  @Transform(nullableIdentifierParam)
  @IsString()
  @Matches(USERNAME_PATTERN, { message: 'username must be 3–64 lower-case letters, digits, ".", "_" or "-" starting with a letter or digit' })
  username?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '+905551234567', description: 'E.164; null clears it' })
  @IsOptional()
  @Transform(nullableTextParam)
  @IsString()
  @Matches(E164_PATTERN, { message: 'phone must be in E.164 form, e.g. +905551234567' })
  phone?: string | null;

  @ApiPropertyOptional({ minLength: 2, maxLength: 200, example: 'سارة أحمد', description: 'Cannot be cleared' })
  @ValidateIf((dto: UpdateUserDto) => dto.fullName !== undefined)
  @Transform(trimParam)
  @IsString()
  @Length(2, 200)
  fullName?: string;

  @ApiPropertyOptional({ nullable: true, minLength: 2, maxLength: 200, example: 'Sara Ahmed' })
  @IsOptional()
  @Transform(nullableTextParam)
  @IsString()
  @Length(2, 200)
  fullNameLatin?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @IsOptional()
  @Transform(nullableTextParam)
  @IsString()
  @Length(1, 120)
  displayName?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: AVATAR_URL_MAX_LENGTH, example: 'https://cdn.example.com/avatars/sara.png', description: 'Absolute http(s) URL; null clears it' })
  @IsOptional()
  @Transform(nullableTextParam)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false }, { message: 'avatarUrl must be an absolute http(s) URL' })
  @MaxLength(AVATAR_URL_MAX_LENGTH)
  avatarUrl?: string | null;

  @ApiPropertyOptional({ nullable: true, enum: LOCALES, description: 'Preferred language; null = academy default' })
  @IsOptional()
  @IsIn(LOCALES)
  locale?: LocaleCode | null;

  @ApiPropertyOptional({ type: UpdateStudentProfileDto, description: 'Only for a user who has a student profile' })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateStudentProfileDto)
  studentProfile?: UpdateStudentProfileDto;

  @ApiPropertyOptional({ type: UpdateEmployeeProfileDto, description: 'Only for a user who has an employee profile' })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateEmployeeProfileDto)
  employeeProfile?: UpdateEmployeeProfileDto;
}

// ---------------------------------------------------------------------------
// MOD-03-T06 — account status and soft delete
// ---------------------------------------------------------------------------

/** Upper bound of the free-text reason recorded in the audit event. */
export const STATUS_REASON_MAX_LENGTH = 500;

const REASON_API = {
  maxLength: STATUS_REASON_MAX_LENGTH,
  example: 'Repeated violations of the academy rules',
  description: 'Free text recorded in the audit event only (never shown to the user); trimmed, blank = absent',
} as const;

export class ChangeUserStatusDto {
  @ApiProperty({
    enum: USER_STATUS_ACTIONS,
    example: 'suspend',
    description:
      '`activate`: pending|suspended → active · `suspend`: active → suspended · `archive`: active|suspended → archived · ' +
      '`restore`: archived → active · `unlock`: clears the failed-login lock of an active account. ' +
      '`suspend` and `archive` sign the user out of every device.',
  })
  @IsIn(USER_STATUS_ACTIONS)
  action: UserStatusAction;

  @ApiPropertyOptional(REASON_API)
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, STATUS_REASON_MAX_LENGTH)
  reason?: string;
}

/** Optional body of `DELETE /api/users/:id` (a client may send none). */
export class DeleteUserDto {
  @ApiPropertyOptional(REASON_API)
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, STATUS_REASON_MAX_LENGTH)
  reason?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * Identity fields shared by the list item and the detail. Deliberately absent:
 * the password hash, the failed-login counter, `password_changed_at` and
 * `must_change_password` (no field of the response matches /hash|password/i).
 * For callers without `users.read_contact` the contact and login identifiers
 * (`email`, `username`, `phone`) and the account-security timestamps
 * (`emailVerifiedAt`, `lastLoginAt`, `lockedUntil`) are null (D-R07).
 */
export class UserSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ nullable: true, example: 'sara@example.com', description: 'null without `users.read_contact`' })
  email: string | null;

  @ApiProperty({ nullable: true, example: 'sara.ahmed', description: 'null without `users.read_contact`' })
  username: string | null;

  @ApiProperty({ nullable: true, example: '+905551234567', description: 'E.164; null without `users.read_contact`' })
  phone: string | null;

  @ApiProperty({ example: 'سارة أحمد' })
  fullName: string;

  @ApiProperty({ nullable: true, example: 'Sara Ahmed' })
  fullNameLatin: string | null;

  @ApiProperty({ nullable: true })
  displayName: string | null;

  @ApiProperty({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ nullable: true, enum: ['ar', 'en', 'tr'] })
  locale: string | null;

  @ApiProperty({ enum: Object.values(UserStatus), example: 'active' })
  status: UserStatus;

  @ApiProperty({ nullable: true, description: 'ISO 8601; null without `users.read_contact`' })
  emailVerifiedAt: string | null;

  @ApiProperty({ nullable: true, description: 'ISO 8601; null without `users.read_contact`' })
  lastLoginAt: string | null;

  @ApiProperty({ nullable: true, description: 'ISO 8601; set while the account is temporarily locked after failed logins; null without `users.read_contact`' })
  lockedUntil: string | null;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;

  @ApiProperty({ nullable: true, description: 'ISO 8601; non-null only for soft-deleted users (visible with includeDeleted)' })
  deletedAt: string | null;
}

export class UserListItemDto extends UserSummaryDto {
  @ApiProperty({ type: [String], example: ['teacher'], description: 'Role keys, sorted' })
  roles: string[];
}

export class UserListDto {
  @ApiProperty({ type: [UserListItemDto] })
  items: UserListItemDto[];

  @ApiProperty({ nullable: true, description: 'Pass as `cursor` to fetch the next page; null when exhausted' })
  nextCursor: string | null;
}

export class UserRoleSummaryDto {
  @ApiProperty({ example: 'teacher' })
  key: string;

  @ApiProperty({ description: 'Localized label `{ ar, en?, tr? }`', example: { ar: 'معلم', en: 'Teacher' } })
  label: LocalizedText;
}

export class StudentProfileSummaryDto {
  @ApiProperty({ nullable: true })
  studentNumber: string | null;

  @ApiProperty({ nullable: true, description: 'YYYY-MM-DD' })
  dateOfBirth: string | null;

  @ApiProperty({ nullable: true, description: 'YYYY-MM-DD' })
  enrolledOn: string | null;
}

export class EmployeeProfileSummaryDto {
  @ApiProperty({ nullable: true })
  employeeNumber: string | null;

  @ApiProperty({ enum: Object.values(EmployeeKind) })
  kind: EmployeeKind;

  @ApiProperty({ nullable: true })
  jobTitle: string | null;

  @ApiProperty({ nullable: true })
  specialization: string | null;

  @ApiProperty({ nullable: true, description: 'YYYY-MM-DD' })
  hiredOn: string | null;

  @ApiProperty()
  isActive: boolean;
}

/** One side of a guardian ↔ student link, seen from the other side. */
export class GuardianLinkDto {
  @ApiProperty({ format: 'uuid', description: 'The linked user (guardian or student)' })
  userId: string;

  @ApiProperty()
  fullName: string;

  @ApiProperty({ nullable: true })
  displayName: string | null;

  @ApiProperty({ enum: Object.values(GuardianRelationship) })
  relationship: GuardianRelationship;

  @ApiProperty()
  isPrimary: boolean;
}

export class UserDetailDto extends UserSummaryDto {
  @ApiProperty({ type: [UserRoleSummaryDto] })
  roles: UserRoleSummaryDto[];

  @ApiProperty({ type: StudentProfileSummaryDto, nullable: true })
  studentProfile: StudentProfileSummaryDto | null;

  @ApiProperty({ type: EmployeeProfileSummaryDto, nullable: true })
  employeeProfile: EmployeeProfileSummaryDto | null;

  @ApiProperty({ type: [GuardianLinkDto], description: 'Guardians of this user (when the user is a student)' })
  guardians: GuardianLinkDto[];

  @ApiProperty({ type: [GuardianLinkDto], description: 'Students of this user (when the user is a guardian)' })
  students: GuardianLinkDto[];
}
