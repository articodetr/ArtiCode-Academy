// MOD-19 (roadmap §4p) — the views of an enrollment request: the office's
// list and detail (API-224/225, `enrollments.manage`) and the student's own
// requests (API-222). A request is an enrollment with a `requested_at`
// (D-R121); its id is the enrollment id, so API-059 approves or rejects it.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { COURSE_PRICINGS } from '../courses/courses.dto.js';
import type { CoursePricing } from '../courses/courses.dto.js';
import { ClassStatus, EnrollmentSource, EnrollmentStatus, InvoiceStatus, PaymentMethod, PaymentStatus } from '../generated/prisma/client.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { textParam } from '../users/users.validation.js';
import { REQUEST_PAYMENT_STATES, REQUEST_STATES } from './enrollment-requests.policy.js';
import type { RequestPaymentState, RequestState } from './enrollment-requests.policy.js';
import { EnrollmentStudentDto } from './enrollments.dto.js';

export const REQUESTS_PAGE_DEFAULT = 50;
export const REQUESTS_PAGE_MAX = 100;
/** The office list's filters: the request states, `pending` (both pending states) and `approved` (enrolled, completed or withdrawn after approval). */
export const REQUEST_LIST_STATES = ['pending', 'pending_payment', 'pending_approval', 'approved', 'rejected', 'cancelled', 'all'] as const;
export type RequestListState = (typeof REQUEST_LIST_STATES)[number];
export const REQUEST_ACTIONS = ['approve', 'reject'] as const;
export type RequestAction = (typeof REQUEST_ACTIONS)[number];
/** Why `approve` would be refused now (pending requests only); null = it would pass the class and payment checks. */
export const APPROVE_BLOCKERS = ['payment_required', 'class_not_enrollable', 'class_full'] as const;
export type ApproveBlocker = (typeof APPROVE_BLOCKERS)[number];

const CLASS_STATUSES = Object.values(ClassStatus) as ClassStatus[];
const ENROLLMENT_STATUSES = Object.values(EnrollmentStatus) as EnrollmentStatus[];
const ENROLLMENT_SOURCES = Object.values(EnrollmentSource) as EnrollmentSource[];
const INVOICE_STATUSES = Object.values(InvoiceStatus) as InvoiceStatus[];
const PAYMENT_METHODS = Object.values(PaymentMethod) as PaymentMethod[];
const PAYMENT_STATUSES = Object.values(PaymentStatus) as PaymentStatus[];

export class ListEnrollmentRequestsQueryDto {
  @ApiPropertyOptional({ enum: REQUEST_LIST_STATES, default: 'pending', description: 'pending = pending_payment + pending_approval' })
  @IsOptional()
  @IsIn(REQUEST_LIST_STATES)
  state?: RequestListState;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  courseId?: string;

  @ApiPropertyOptional({ maxLength: 100, description: 'Literal, case-insensitive: the student name, or the class code' })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ default: REQUESTS_PAGE_DEFAULT, minimum: 1, maximum: REQUESTS_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(REQUESTS_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 512, description: 'Opaque `nextCursor` of the previous page; send it with the same filters' })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;
}

export class RequestPaymentLineDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'RCPT-2026-00052' })
  number: string;

  @ApiProperty({ type: Number })
  amount: number;

  @ApiProperty({ enum: PAYMENT_METHODS })
  method: PaymentMethod;

  @ApiProperty({ enum: PAYMENT_STATUSES })
  status: PaymentStatus;

  @ApiProperty({ format: 'date-time' })
  paidAt: string;
}

export class RequestInvoiceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, nullable: true, example: 'INV-2026-00082' })
  number: string | null;

  @ApiProperty({ enum: INVOICE_STATUSES })
  status: InvoiceStatus;

  @ApiProperty({ type: Number })
  total: number;

  @ApiProperty({ type: Number })
  paid: number;

  @ApiProperty({ type: Number })
  balance: number;

  @ApiProperty({ example: 'SAR' })
  currency: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  issuedAt: string | null;

  @ApiProperty({
    type: [RequestPaymentLineDto],
    nullable: true,
    description: 'API-225 only, for holders of invoices.read_all, invoices.manage or payments.record; null otherwise (and always in lists)',
  })
  payments: RequestPaymentLineDto[] | null;
}

export class RequestPaymentDto {
  @ApiProperty({ enum: REQUEST_PAYMENT_STATES, description: 'Over the issued invoices of the enrollment (D-R125); computed, never stored' })
  state: RequestPaymentState;

  @ApiProperty({ description: 'true while the course is paid or an invoice was issued for the enrollment' })
  required: boolean;

  @ApiProperty({ type: Number, description: 'Sum over the issued invoices' })
  total: number;

  @ApiProperty({ type: Number })
  paid: number;

  @ApiProperty({ type: Number })
  balance: number;

  @ApiProperty({ type: String, nullable: true, description: 'The invoices currency (the academy currency, D15); null without an invoice' })
  currency: string | null;

  @ApiProperty({ type: [RequestInvoiceDto], description: 'Every invoice linked to the enrollment, in creation order (cancelled ones included)' })
  invoices: RequestInvoiceDto[];
}

export class RequestTeacherDto {
  @ApiProperty()
  fullName: string;

  @ApiProperty({ type: String, nullable: true })
  displayName: string | null;
}

export class RequestClassDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  name: LocalizedText;

  @ApiProperty({ enum: CLASS_STATUSES })
  status: ClassStatus;

  @ApiProperty({ type: String, nullable: true, description: 'YYYY-MM-DD' })
  startsOn: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'YYYY-MM-DD' })
  endsOn: string | null;

  @ApiProperty({ type: 'integer' })
  capacity: number;

  @ApiProperty({ type: 'integer', description: 'Active enrollments' })
  enrolledCount: number;

  @ApiProperty({ type: RequestTeacherDto, nullable: true, description: 'The lead teacher by name only' })
  leadTeacher: RequestTeacherDto | null;
}

export class RequestCourseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  name: LocalizedText;

  @ApiProperty({ type: String, nullable: true })
  coverImageUrl: string | null;

  @ApiProperty({ enum: COURSE_PRICINGS })
  pricing: CoursePricing;
}

/** The student's own request (API-222) — the class by name, never the reviewer. */
export class MyEnrollmentRequestDto {
  @ApiProperty({ format: 'uuid', description: 'The enrollment id' })
  id: string;

  @ApiProperty({ enum: ENROLLMENT_STATUSES })
  status: EnrollmentStatus;

  @ApiProperty({ enum: REQUEST_STATES, description: 'pending_payment · pending_approval · enrolled · completed · withdrawn · rejected · cancelled' })
  state: RequestState;

  @ApiProperty({ enum: ENROLLMENT_SOURCES })
  source: EnrollmentSource;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'null only for a free self-service enrollment (never a request)' })
  requestedAt: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'When it became active, was rejected or withdrawn' })
  decidedAt: string | null;

  @ApiProperty({ type: String, nullable: true, description: "The rejection reason — the student's own request" })
  rejectionReason: string | null;

  @ApiProperty({ type: RequestClassDto })
  class: RequestClassDto;

  @ApiProperty({ type: RequestCourseDto })
  course: RequestCourseDto;

  @ApiProperty({ type: RequestPaymentDto })
  payment: RequestPaymentDto;
}

export class MyEnrollmentRequestListDto {
  @ApiProperty({ type: [MyEnrollmentRequestDto], description: 'Newest request first' })
  items: MyEnrollmentRequestDto[];
}

/** The office's view (API-224/225): the student in the caller's D-R07 projection and what the office can do now. */
export class EnrollmentRequestDto extends MyEnrollmentRequestDto {
  @ApiProperty({ type: EnrollmentStudentDto })
  student: EnrollmentStudentDto;

  @ApiProperty({ enum: REQUEST_ACTIONS, isArray: true, description: 'API-059 actions that apply: approve and reject for a pending request' })
  allowedActions: RequestAction[];

  @ApiProperty({ enum: APPROVE_BLOCKERS, nullable: true, description: 'Why approve would be refused now (pending only)' })
  approveBlocker: ApproveBlocker | null;
}

export class EnrollmentRequestListDto {
  @ApiProperty({ type: [EnrollmentRequestDto], description: 'Newest request first (requestedAt, then id)' })
  items: EnrollmentRequestDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Cursor of the next page; null on the last page' })
  nextCursor: string | null;

  @ApiProperty({ type: 'integer', description: 'Pending requests over the whole academy (both pending states) — the office badge' })
  pendingCount: number;
}
