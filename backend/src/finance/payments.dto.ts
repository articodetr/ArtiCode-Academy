import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min, registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';
import { rawNumber } from '../courses/courses.validation.js';
import { InvoiceStatus, PaymentMethod, PaymentStatus } from '../generated/prisma/client.js';
import { IsInstant, isInstant } from '../lessons/lessons.time.js';
import { trimParam } from '../users/users.validation.js';
import { MONEY_MAX } from './fee-plans.dto.js';
import type { PaymentState } from './invoices.calc.js';
import { FinanceActorDto, FinancePersonDto, REASON_MAX } from './invoices.dto.js';
import { PAYMENT_METHODS, isFutureInstant } from './payments.rules.js';

export const PAYMENTS_PAGE_DEFAULT = 50;
export const PAYMENTS_PAGE_MAX = 100;
export const PAYMENT_TEXT_MAX = 200;
export const PAYMENT_NOTES_MAX = 2000;
const PAYMENT_STATUSES: PaymentStatus[] = ['completed', 'reversed'];

/** class-validator rule: an ISO instant that is not ahead of the server clock (beyond the tolerated skew). */
export function IsNotFutureInstant(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isNotFutureInstant',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: `${String(propertyName)} must not be in the future`, ...options },
      validator: { validate: (value: unknown) => !isInstant(value) || !isFutureInstant(new Date(value), new Date()) },
    });
  };
}

/** API-151 body (D-R63): a manual payment of an issued invoice, within its balance. */
export class RecordPaymentDto {
  @ApiProperty({ minimum: 0.01, maximum: MONEY_MAX, example: 750, description: 'A JSON number with at most two decimals, not above the invoice balance; the invoice currency' })
  @Transform(rawNumber)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(MONEY_MAX)
  amount: number;

  @ApiProperty({ enum: PaymentMethod })
  @IsIn(PAYMENT_METHODS)
  method: PaymentMethod;

  @ApiPropertyOptional({ example: '2026-11-11T10:30:00+03:00', description: 'When the money was received — ISO 8601 with an offset, not in the future; default now' })
  @IsOptional()
  @IsInstant()
  @IsNotFutureInstant()
  paidAt?: string;

  @ApiPropertyOptional({ maxLength: PAYMENT_TEXT_MAX, description: 'Transfer or cheque reference' })
  @IsOptional()
  @Transform(trimParam)
  @IsString()
  @Length(1, PAYMENT_TEXT_MAX)
  reference?: string;

  @ApiPropertyOptional({ maxLength: PAYMENT_TEXT_MAX, description: 'Who paid, when not the student (e.g. the guardian)' })
  @IsOptional()
  @Transform(trimParam)
  @IsString()
  @Length(1, PAYMENT_TEXT_MAX)
  payerName?: string;

  @ApiPropertyOptional({ maxLength: PAYMENT_NOTES_MAX, description: 'Internal note — never shown to the student or the guardian' })
  @IsOptional()
  @Transform(trimParam)
  @IsString()
  @Length(1, PAYMENT_NOTES_MAX)
  notes?: string;
}

/** API-154 body. */
export class ReversePaymentDto {
  @ApiProperty({ maxLength: REASON_MAX, description: 'Why the payment is reversed (kept on the payment)' })
  @Transform(trimParam)
  @IsString()
  @Length(1, REASON_MAX)
  reason: string;
}

export class ListPaymentsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  invoiceId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The payments of this student’s invoices' })
  @IsOptional()
  @IsUUID('all')
  studentId?: string;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethod;

  @ApiPropertyOptional({ enum: PAYMENT_STATUSES })
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  status?: PaymentStatus;

  @ApiPropertyOptional({ example: '2026-11-01T00:00:00+03:00', description: 'paidAt ≥ from (ISO 8601 with an offset)' })
  @IsOptional()
  @IsInstant()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-01T00:00:00+03:00', description: 'paidAt < to (ISO 8601 with an offset)' })
  @IsOptional()
  @IsInstant()
  to?: string;

  @ApiPropertyOptional({ maxLength: 32, description: 'Part of the receipt number, literal, case-insensitive' })
  @IsOptional()
  @Transform(trimParam)
  @IsString()
  @Length(1, 32)
  q?: string;

  @ApiPropertyOptional({ default: PAYMENTS_PAGE_DEFAULT, minimum: 1, maximum: PAYMENTS_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PAYMENTS_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;
}

/** The invoice a payment belongs to, as it stands now. */
export class PaymentInvoiceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, nullable: true, example: 'INV-2026-00001' })
  number: string | null;

  @ApiProperty({ enum: InvoiceStatus })
  status: InvoiceStatus;

  @ApiProperty({ example: 'SAR' })
  currency: string;

  @ApiProperty()
  total: number;

  @ApiProperty()
  paid: number;

  @ApiProperty()
  balance: number;

  @ApiProperty({ enum: ['unpaid', 'partial', 'paid'] })
  paymentState: PaymentState;
}

/** A receipt (D-R63). */
export class PaymentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'RCPT-2026-00001' })
  number: string;

  @ApiProperty({ type: PaymentInvoiceDto })
  invoice: PaymentInvoiceDto;

  @ApiProperty({ type: FinancePersonDto })
  student: FinancePersonDto;

  @ApiProperty()
  amount: number;

  @ApiProperty({ example: 'SAR' })
  currency: string;

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

  @ApiProperty({ type: String, nullable: true, description: 'Internal note' })
  notes: string | null;

  @ApiProperty({ type: FinanceActorDto, nullable: true })
  recordedBy: FinanceActorDto | null;

  @ApiProperty({ type: String, nullable: true })
  reversedAt: string | null;

  @ApiProperty({ type: FinanceActorDto, nullable: true })
  reversedBy: FinanceActorDto | null;

  @ApiProperty({ type: String, nullable: true })
  reverseReason: string | null;

  @ApiProperty()
  createdAt: string;
}

export class PaymentListDto {
  @ApiProperty({ type: [PaymentDto], description: 'Newest first (creation order)' })
  items: PaymentDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor: string | null;
}
