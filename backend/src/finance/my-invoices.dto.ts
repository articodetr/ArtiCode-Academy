import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import type { MyClassRelation } from '../enrollments/my-classes.policy.js';
import { PaymentMethod } from '../generated/prisma/client.js';
import { InvoiceDto } from './invoices.dto.js';

const RELATIONS: MyClassRelation[] = ['self', 'child'];
const OWNER_STATUSES = ['issued', 'cancelled'] as const;
type OwnerStatus = (typeof OWNER_STATUSES)[number];

export class ListMyInvoicesQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'The invoices of this student only — the caller or one of their linked children' })
  @IsOptional()
  @IsUUID('all')
  studentId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The invoices tied to an enrollment of this class' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;

  @ApiPropertyOptional({ enum: OWNER_STATUSES, description: 'Drafts are never shown here (a `draft` filter is a 400)' })
  @IsOptional()
  @IsIn(OWNER_STATUSES)
  status?: OwnerStatus;
}

/** A valid receipt as its owner sees it. */
export class MyInvoicePaymentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'RCPT-2026-00001' })
  number: string;

  @ApiProperty()
  amount: number;

  @ApiProperty({ enum: PaymentMethod })
  method: PaymentMethod;

  @ApiProperty()
  paidAt: string;

  @ApiProperty({ type: String, nullable: true })
  reference: string | null;

  @ApiProperty({ type: String, nullable: true })
  payerName: string | null;
}

/** An invoice as its owner sees it: never the internal note, the issuer, the fee plan or a payment's recorder; completed payments only. */
export class MyInvoiceItemDto extends OmitType(InvoiceDto, ['notes', 'issuedBy', 'feePlan', 'payments'] as const) {
  @ApiProperty({ type: [MyInvoicePaymentDto], description: 'Completed payments (the valid receipts), newest first' })
  payments: MyInvoicePaymentDto[];

  @ApiProperty({ enum: RELATIONS, description: '`self` (invoices.read_own) or `child` (invoices.read_linked and the guardian role)' })
  relation: MyClassRelation;
}

export class MyInvoiceListDto {
  @ApiProperty({ type: [MyInvoiceItemDto], description: 'Issued and cancelled invoices, newest first' })
  items: MyInvoiceItemDto[];
}
