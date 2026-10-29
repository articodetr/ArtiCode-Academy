import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { EmployeeKind, GuardianRelationship, UserStatus } from '../generated/prisma/client.js';
import { SORT_ORDERS, USER_SORT_FIELDS } from './users.cursor.js';
import type { SortOrder, UserSortField } from './users.cursor.js';

export const USERS_PAGE_DEFAULT = 20;
export const USERS_PAGE_MAX = 100;

/** Role keys: lower-case, 3–64 characters (same shape as the seeded system roles). */
export const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

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
      'Case-insensitive substring searched in e-mail, username, full name, Latin name and display name (`%`/`_` are matched literally)',
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

/**
 * Identity fields shared by the list item and the detail. Deliberately absent:
 * the password hash, the failed-login counter, `password_changed_at` and
 * `must_change_password` (no field of the response matches /hash|password/i).
 */
export class UserSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ nullable: true, example: 'sara@example.com' })
  email: string | null;

  @ApiProperty({ nullable: true, example: 'sara.ahmed' })
  username: string | null;

  @ApiProperty({ nullable: true, example: '+905551234567', description: 'E.164' })
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

  @ApiProperty({ nullable: true, description: 'ISO 8601' })
  emailVerifiedAt: string | null;

  @ApiProperty({ nullable: true, description: 'ISO 8601' })
  lastLoginAt: string | null;

  @ApiProperty({ nullable: true, description: 'ISO 8601; set while the account is temporarily locked after failed logins' })
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
