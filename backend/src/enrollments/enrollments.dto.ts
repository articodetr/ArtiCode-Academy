import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { EnrollmentSource, EnrollmentStatus, UserStatus } from '../generated/prisma/client.js';
import { textParam } from '../users/users.validation.js';
import { ENROLLMENT_STATUS_ACTIONS } from './enrollments.status.js';
import type { EnrollmentStatusAction } from './enrollments.status.js';

export const ENROLLMENTS_PAGE_DEFAULT = 50;
export const ENROLLMENTS_PAGE_MAX = 100;
/** Upper bound of the free-text reason (audit event; `withdrawal_reason` on withdraw) — as the class actions. */
export const ENROLLMENT_REASON_MAX_LENGTH = 500;
export const ENROLLMENT_STATUSES = Object.values(EnrollmentStatus) as EnrollmentStatus[];
const ENROLLMENT_SOURCES = Object.values(EnrollmentSource) as EnrollmentSource[];
const USER_STATUSES = Object.values(UserStatus) as UserStatus[];

export class ListEnrollmentsQueryDto {
  @ApiPropertyOptional({ enum: ENROLLMENT_STATUSES, description: 'Only enrollments in this status (default: every status)' })
  @IsOptional()
  @IsIn(ENROLLMENT_STATUSES)
  status?: EnrollmentStatus;

  @ApiPropertyOptional({ default: ENROLLMENTS_PAGE_DEFAULT, minimum: 1, maximum: ENROLLMENTS_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ENROLLMENTS_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 512, description: 'Opaque `nextCursor` of the previous page; send it with the same filter' })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;
}

export class CreateEnrollmentDto {
  @ApiProperty({
    format: 'uuid',
    description: 'An invited or active user who holds the `student` role; the enrollment starts `active` (D-R18)',
  })
  @IsUUID('all')
  studentId: string;
}

export class ChangeEnrollmentStatusDto {
  @ApiProperty({
    enum: ENROLLMENT_STATUS_ACTIONS,
    description:
      'withdraw: active→withdrawn · complete: active→completed · cancel: active→cancelled · ' +
      'reactivate: withdrawn|cancelled→active (the class must be open or running and have a free seat)',
  })
  @IsIn(ENROLLMENT_STATUS_ACTIONS)
  action: EnrollmentStatusAction;

  @ApiPropertyOptional({
    maxLength: ENROLLMENT_REASON_MAX_LENGTH,
    description: 'Free text recorded in the audit event, and in `withdrawalReason` on withdraw; trimmed, blank = absent',
  })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, ENROLLMENT_REASON_MAX_LENGTH)
  reason?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * The enrolled student in the caller's projection (D-R07): `email`,
 * `username` and `phone` are null without `users.read_contact`. Never the
 * password hash, the login counters or the security timestamps.
 */
export class EnrollmentStudentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  fullName: string;

  @ApiProperty({ nullable: true })
  fullNameLatin: string | null;

  @ApiProperty({ nullable: true })
  displayName: string | null;

  @ApiProperty({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ enum: USER_STATUSES })
  status: UserStatus;

  @ApiProperty({ nullable: true, description: 'null without `users.read_contact`' })
  email: string | null;

  @ApiProperty({ nullable: true, description: 'null without `users.read_contact`' })
  username: string | null;

  @ApiProperty({ nullable: true, description: 'null without `users.read_contact`' })
  phone: string | null;

  @ApiProperty({ nullable: true, description: 'ISO 8601; set when the account was soft-deleted after enrolling (its enrollment stays)' })
  deletedAt: string | null;
}

export class EnrollmentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  classId: string;

  @ApiProperty({ enum: ENROLLMENT_STATUSES, description: 'Version 1 never writes `pending` (no waitlist — D-R18)' })
  status: EnrollmentStatus;

  @ApiProperty({ enum: ENROLLMENT_SOURCES, description: 'Version 1 writes `admin` only' })
  source: EnrollmentSource;

  @ApiProperty({ description: 'ISO 8601 — first enrollment; kept on reactivation' })
  enrolledAt: string;

  @ApiProperty({ nullable: true, description: 'ISO 8601 — last time the enrollment became active' })
  activatedAt: string | null;

  @ApiProperty({ nullable: true, description: 'ISO 8601' })
  completedAt: string | null;

  @ApiProperty({ nullable: true, description: 'ISO 8601' })
  withdrawnAt: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Set on withdraw; null for callers without `enrollments.manage` (an assigned teacher reading the roster sees `student.deletedAt` but not the reason)',
  })
  withdrawalReason: string | null;

  @ApiProperty({ type: EnrollmentStudentDto })
  student: EnrollmentStudentDto;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class EnrollmentListDto {
  @ApiProperty({ type: [EnrollmentDto], description: 'In enrollment order (time-ordered primary key)' })
  items: EnrollmentDto[];

  @ApiProperty({ nullable: true, description: 'Cursor of the next page; null on the last page' })
  nextCursor: string | null;
}
