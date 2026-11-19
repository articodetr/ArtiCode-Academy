import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { EnrollmentSource, EnrollmentStatus, UserStatus } from '../generated/prisma/client.js';
import { textParam } from '../users/users.validation.js';
import { REQUEST_PAYMENT_STATES } from './enrollment-requests.policy.js';
import type { RequestPaymentState } from './enrollment-requests.policy.js';
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
    description:
      'An invited or active user who holds the `student` role; the enrollment starts `active` (D-R18) for a free course. ' +
      'For a paid course (MOD-19, D-R127) it starts `pending` with an issued invoice from the course plan: record the payment (API-151), then `approve` it (API-059).',
  })
  @IsUUID('all')
  studentId: string;
}

export class ChangeEnrollmentStatusDto {
  @ApiProperty({
    enum: ENROLLMENT_STATUS_ACTIONS,
    description:
      'withdraw: active→withdrawn · complete: active→completed · cancel: active→cancelled · ' +
      'reactivate: withdrawn|cancelled→active (the class must be open or running and have a free seat; a row that never was active in a paid course also needs its invoices paid) · ' +
      'MOD-19: approve: pending→active (as reactivate, and every issued invoice of the enrollment paid in full — 409 payment_required) · ' +
      'reject: pending→cancelled (a reason is required; refused with a completed payment — 409 request_has_payments; the unpaid issued invoices are cancelled)',
  })
  @IsIn(ENROLLMENT_STATUS_ACTIONS)
  action: EnrollmentStatusAction;

  @ApiPropertyOptional({
    maxLength: ENROLLMENT_REASON_MAX_LENGTH,
    description: 'Free text recorded in the audit event, in `withdrawalReason` on withdraw and in `rejectionReason` on reject (required there); trimmed, blank = absent',
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

  @ApiProperty({ type: String, nullable: true })
  fullNameLatin: string | null;

  @ApiProperty({ type: String, nullable: true })
  displayName: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ enum: USER_STATUSES })
  status: UserStatus;

  @ApiProperty({ type: String, nullable: true, description: 'null without `users.read_contact`' })
  email: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'null without `users.read_contact`' })
  username: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'null without `users.read_contact`' })
  phone: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'ISO 8601; set when the account was soft-deleted after enrolling (its enrollment stays)' })
  deletedAt: string | null;
}

export class EnrollmentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  classId: string;

  @ApiProperty({ enum: ENROLLMENT_STATUSES, description: '`pending` = an enrollment request (MOD-19, D-R121): no access to the class until it is approved' })
  status: EnrollmentStatus;

  @ApiProperty({ enum: ENROLLMENT_SOURCES, description: '`admin` (the office, API-058) or `self` (the catalog, API-221 — MOD-19)' })
  source: EnrollmentSource;

  @ApiProperty({ description: 'ISO 8601 — first enrollment; kept on reactivation' })
  enrolledAt: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'ISO 8601 — last time the enrollment became active' })
  activatedAt: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'ISO 8601' })
  completedAt: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'ISO 8601' })
  withdrawnAt: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Set on withdraw; null for callers without `enrollments.manage` (an assigned teacher reading the roster sees `student.deletedAt` but not the reason)',
  })
  withdrawalReason: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'MOD-19: when the current request was made; null for an enrollment that was never a request' })
  requestedAt: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'MOD-19: set when the request was rejected' })
  rejectedAt: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'MOD-19: the rejection reason; null for callers without `enrollments.manage`' })
  rejectionReason: string | null;

  @ApiProperty({
    enum: REQUEST_PAYMENT_STATES,
    nullable: true,
    description: 'MOD-19: for a `pending` request only — computed from its issued invoices (not_required | missing | unpaid | partial | paid); null otherwise',
  })
  paymentState: RequestPaymentState | null;

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

  @ApiProperty({ type: String, nullable: true, description: 'Cursor of the next page; null on the last page' })
  nextCursor: string | null;
}
