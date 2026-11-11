import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { IsDecimalNumber } from '../common/decimal-number.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { rawBoolean, rawNumber } from '../courses/courses.validation.js';
import { InvoiceStatus, PaymentMethod, PaymentStatus } from '../generated/prisma/client.js';
import { IsCalendarDate, trimParam } from '../users/users.validation.js';
import { FEE_PLAN_INSTALLMENTS_MAX, FEE_PLAN_LINES_MAX, FeePlanLineDto, MONEY_MAX } from './fee-plans.dto.js';
import { INVOICE_STATUS_ACTIONS } from './invoices.calc.js';
import type { InstallmentStatus, InvoiceStatusAction, PaymentState } from './invoices.calc.js';

export const INVOICES_PAGE_DEFAULT = 50;
export const INVOICES_PAGE_MAX = 100;
export const INVOICE_NOTES_MAX = 2000;
export const REASON_MAX = 500;
const INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'issued', 'cancelled'];
const PAYMENT_STATES: PaymentState[] = ['unpaid', 'partial', 'paid'];
const INSTALLMENT_STATUSES: InstallmentStatus[] = ['paid', 'partial', 'unpaid'];

/** One installment of an invoice: an amount due on a day. */
export class InvoiceInstallmentInputDto {
  @ApiProperty({ minimum: 0.01, maximum: MONEY_MAX, example: 1500, description: 'A JSON number with at most two decimals' })
  @Transform(rawNumber)
  @IsDecimalNumber(2)
  @Min(0.01)
  @Max(MONEY_MAX)
  amount: number;

  @ApiProperty({ example: '2026-12-01', description: 'Due day (YYYY-MM-DD); not before the previous installment' })
  @IsCalendarDate()
  dueOn: string;
}

/** API-146 body: a draft from a fee plan (its lines and shares are copied — D-R60) or from lines and installments. */
export class CreateInvoiceDto {
  @ApiProperty({ format: 'uuid', description: 'A user holding the student role' })
  @IsUUID('all')
  studentId: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'An enrollment of that student' })
  @IsOptional()
  @IsUUID('all')
  enrollmentId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'An active fee plan: its lines are copied and its shares split the total from today (academy zone); not with lines/installments' })
  @IsOptional()
  @IsUUID('all')
  feePlanId?: string;

  @ApiPropertyOptional({ type: [FeePlanLineDto], description: 'Required without feePlanId (1..50)' })
  @ValidateIf((dto: CreateInvoiceDto) => dto.lines !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FEE_PLAN_LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => FeePlanLineDto)
  lines?: FeePlanLineDto[];

  @ApiPropertyOptional({ type: [InvoiceInstallmentInputDto], description: 'Required without feePlanId (1..24), summing to the total' })
  @ValidateIf((dto: CreateInvoiceDto) => dto.installments !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FEE_PLAN_INSTALLMENTS_MAX)
  @ValidateNested({ each: true })
  @Type(() => InvoiceInstallmentInputDto)
  installments?: InvoiceInstallmentInputDto[];

  @ApiPropertyOptional({ minimum: 0, maximum: MONEY_MAX, default: 0, description: 'One invoice-level discount (D-R64), within the subtotal' })
  @IsOptional()
  @Transform(rawNumber)
  @IsDecimalNumber(2)
  @Min(0)
  @Max(MONEY_MAX)
  discountAmount?: number;

  @ApiPropertyOptional({ maxLength: REASON_MAX, description: 'Why the discount; only with a discount' })
  @IsOptional()
  @Transform(trimParam)
  @IsString()
  @Length(1, REASON_MAX)
  discountReason?: string;

  @ApiPropertyOptional({ maxLength: INVOICE_NOTES_MAX, description: 'Internal note — never shown to the student or the guardian' })
  @IsOptional()
  @Transform(trimParam)
  @IsString()
  @Length(1, INVOICE_NOTES_MAX)
  notes?: string;
}

/** API-147 body (a draft only): absent = unchanged, `null` clears; lines and installments are replaced whole. */
export class UpdateInvoiceDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((dto: UpdateInvoiceDto) => dto.enrollmentId !== undefined && dto.enrollmentId !== null)
  @IsUUID('all')
  enrollmentId?: string | null;

  @ApiPropertyOptional({ type: [FeePlanLineDto] })
  @ValidateIf((dto: UpdateInvoiceDto) => dto.lines !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FEE_PLAN_LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => FeePlanLineDto)
  lines?: FeePlanLineDto[];

  @ApiPropertyOptional({ type: [InvoiceInstallmentInputDto] })
  @ValidateIf((dto: UpdateInvoiceDto) => dto.installments !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FEE_PLAN_INSTALLMENTS_MAX)
  @ValidateNested({ each: true })
  @Type(() => InvoiceInstallmentInputDto)
  installments?: InvoiceInstallmentInputDto[];

  @ApiPropertyOptional({ minimum: 0, maximum: MONEY_MAX })
  @ValidateIf((dto: UpdateInvoiceDto) => dto.discountAmount !== undefined)
  @Transform(rawNumber)
  @IsDecimalNumber(2)
  @Min(0)
  @Max(MONEY_MAX)
  discountAmount?: number;

  @ApiPropertyOptional({ maxLength: REASON_MAX, nullable: true })
  @ValidateIf((dto: UpdateInvoiceDto) => dto.discountReason !== undefined && dto.discountReason !== null)
  @Transform(trimParam)
  @IsString()
  @Length(1, REASON_MAX)
  discountReason?: string | null;

  @ApiPropertyOptional({ maxLength: INVOICE_NOTES_MAX, nullable: true })
  @ValidateIf((dto: UpdateInvoiceDto) => dto.notes !== undefined && dto.notes !== null)
  @Transform(trimParam)
  @IsString()
  @Length(1, INVOICE_NOTES_MAX)
  notes?: string | null;
}

/** API-149 body. */
export class ChangeInvoiceStatusDto {
  @ApiProperty({ enum: INVOICE_STATUS_ACTIONS, description: 'issue: draft→issued (number INV-YYYY-NNNNN) · cancel: issued→cancelled (reason required; no completed payment)' })
  @IsIn(INVOICE_STATUS_ACTIONS)
  action: InvoiceStatusAction;

  @ApiPropertyOptional({ maxLength: REASON_MAX, description: 'Required to cancel (kept on the invoice); not read on issue' })
  @ValidateIf((dto: ChangeInvoiceStatusDto) => dto.action === 'cancel' || dto.reason !== undefined)
  @Transform(trimParam)
  @IsDefined({ message: 'reason is required to cancel an invoice' })
  @IsString()
  @Length(1, REASON_MAX)
  reason?: string;
}

/** API-150 body. */
export class IssueClassInvoicesDto {
  @ApiProperty({ format: 'uuid', description: 'An active fee plan' })
  @IsUUID('all')
  feePlanId: string;

  @ApiPropertyOptional({ default: false, description: 'A JSON boolean: issue the invoices at once (numbers given) instead of leaving drafts' })
  @IsOptional()
  @Transform(rawBoolean)
  @IsBoolean()
  issue?: boolean;
}

/** Query booleans arrive as text; only the literal `true` is true (implicit conversion would turn "false" into true). */
function queryBoolean({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  const raw = obj[key];
  return raw === 'true' ? true : raw === 'false' ? false : raw;
}

export class ListInvoicesQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  studentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  enrollmentId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Invoices of the enrollments of this class' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  feePlanId?: string;

  @ApiPropertyOptional({ enum: INVOICE_STATUSES })
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: InvoiceStatus;

  @ApiPropertyOptional({ enum: PAYMENT_STATES, description: 'Issued invoices by what is paid' })
  @IsOptional()
  @IsIn(PAYMENT_STATES)
  balance?: PaymentState;

  @ApiPropertyOptional({ description: 'true = issued invoices with an installment due before today and not covered' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  overdue?: boolean;

  @ApiPropertyOptional({ maxLength: 32, description: 'Part of the invoice number, literal, case-insensitive' })
  @IsOptional()
  @Transform(trimParam)
  @IsString()
  @Length(1, 32)
  q?: string;

  @ApiPropertyOptional({ default: INVOICES_PAGE_DEFAULT, minimum: 1, maximum: INVOICES_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(INVOICES_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class FinancePersonDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  fullName: string;

  @ApiProperty({ type: String, nullable: true })
  displayName: string | null;
}

export class FinanceActorDto {
  @ApiProperty()
  fullName: string;
}

export class InvoiceClassDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: LocalizedText;
}

export class InvoiceEnrollmentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: InvoiceClassDto })
  class: InvoiceClassDto;
}

export class InvoicePlanRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: LocalizedText;
}

export class InvoiceNextDueDto {
  @ApiProperty()
  seq: number;

  @ApiProperty({ example: '2026-12-01' })
  dueOn: string;

  @ApiProperty({ example: 1500 })
  remaining: number;
}

export class InvoiceSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, nullable: true, example: 'INV-2026-00001', description: 'null for a draft' })
  number: string | null;

  @ApiProperty({ enum: InvoiceStatus })
  status: InvoiceStatus;

  @ApiProperty({ type: FinancePersonDto })
  student: FinancePersonDto;

  @ApiProperty({ type: InvoiceEnrollmentDto, nullable: true })
  enrollment: InvoiceEnrollmentDto | null;

  @ApiProperty({ type: InvoicePlanRefDto, nullable: true })
  feePlan: InvoicePlanRefDto | null;

  @ApiProperty({ example: 'SAR' })
  currency: string;

  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  discountAmount: number;

  @ApiProperty({ type: String, nullable: true })
  discountReason: string | null;

  @ApiProperty()
  total: number;

  @ApiProperty({ description: 'Sum of the completed payments' })
  paid: number;

  @ApiProperty({ description: 'total − paid' })
  balance: number;

  @ApiProperty({ enum: PAYMENT_STATES })
  paymentState: PaymentState;

  @ApiProperty({ description: 'An issued invoice with an installment due before today (academy zone) and not covered' })
  overdue: boolean;

  @ApiProperty({ type: InvoiceNextDueDto, nullable: true, description: 'The first installment not fully covered' })
  nextDue: InvoiceNextDueDto | null;

  @ApiProperty({ type: String, nullable: true })
  issuedAt: string | null;

  @ApiProperty({ type: FinanceActorDto, nullable: true })
  issuedBy: FinanceActorDto | null;

  @ApiProperty({ type: String, nullable: true })
  cancelledAt: string | null;

  @ApiProperty({ type: String, nullable: true })
  cancelReason: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Internal note' })
  notes: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export class InvoiceLineOutDto {
  @ApiProperty()
  sortOrder: number;

  @ApiProperty()
  description: LocalizedText;

  @ApiProperty()
  amount: number;
}

export class InvoiceInstallmentOutDto {
  @ApiProperty()
  seq: number;

  @ApiProperty()
  amount: number;

  @ApiProperty({ example: '2026-12-01' })
  dueOn: string;

  @ApiProperty({ description: 'Covered by the payments, oldest first (D-R62)' })
  paid: number;

  @ApiProperty()
  remaining: number;

  @ApiProperty({ enum: INSTALLMENT_STATUSES })
  status: InstallmentStatus;

  @ApiProperty()
  overdue: boolean;
}

export class InvoicePaymentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'RCPT-2026-00001' })
  number: string;

  @ApiProperty()
  amount: number;

  @ApiProperty({ enum: PaymentMethod })
  method: PaymentMethod;

  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;

  @ApiProperty()
  paidAt: string;

  @ApiProperty({ type: String, nullable: true })
  reference: string | null;

  @ApiProperty({ type: String, nullable: true })
  payerName: string | null;

  @ApiProperty({ type: FinanceActorDto, nullable: true })
  recordedBy: FinanceActorDto | null;

  @ApiProperty({ type: String, nullable: true })
  reversedAt: string | null;

  @ApiProperty({ type: String, nullable: true })
  reverseReason: string | null;
}

export class InvoiceDto extends InvoiceSummaryDto {
  @ApiProperty({ type: [InvoiceLineOutDto] })
  lines: InvoiceLineOutDto[];

  @ApiProperty({ type: [InvoiceInstallmentOutDto] })
  installments: InvoiceInstallmentOutDto[];

  @ApiProperty({ type: [InvoicePaymentDto], description: 'Newest first' })
  payments: InvoicePaymentDto[];
}

export class InvoiceListDto {
  @ApiProperty({ type: [InvoiceSummaryDto], description: 'Newest first' })
  items: InvoiceSummaryDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor: string | null;
}

export type SkippedInvoiceReason = 'already_invoiced' | 'student_deleted';

export class SkippedInvoiceDto {
  @ApiProperty({ format: 'uuid' })
  enrollmentId: string;

  @ApiProperty({ format: 'uuid' })
  studentId: string;

  @ApiProperty({ enum: ['already_invoiced', 'student_deleted'], description: 'already_invoiced: a non-cancelled invoice from this plan exists for the enrollment · student_deleted: the student was soft-deleted' })
  reason: SkippedInvoiceReason;
}

export class ClassInvoicesResultDto {
  @ApiProperty({ type: [InvoiceSummaryDto] })
  created: InvoiceSummaryDto[];

  @ApiProperty({ type: [SkippedInvoiceDto] })
  skipped: SkippedInvoiceDto[];
}
