import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaymentMethod } from '../generated/prisma/client.js';
import { ReportCourseRefDto, ReportPeriodDto, ReportPeriodQueryDto, ReportStudentRefDto } from './reports.dto.js';

const PAYMENT_METHODS = Object.values(PaymentMethod) as PaymentMethod[];

/** Query booleans read the raw value: implicit conversion would turn "false" into true. */
function booleanParam({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  const value = obj[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}

export class FinancialCollectionsQueryDto extends ReportPeriodQueryDto {
  @ApiPropertyOptional({ enum: PAYMENT_METHODS })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethod;

  @ApiPropertyOptional({ format: 'uuid', description: 'The payments of invoices tied to an enrollment in this course’s classes' })
  @IsOptional()
  @IsUUID('all')
  courseId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The payments of invoices tied to an enrollment in this class' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;
}

/** No period: the receivables are read as of now (D-R69). */
export class FinancialReceivablesQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'The invoices tied to an enrollment in this course’s classes' })
  @IsOptional()
  @IsUUID('all')
  courseId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The invoices tied to an enrollment in this class' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;

  @ApiPropertyOptional({ type: Boolean, description: 'Only the rows with an overdue amount' })
  @IsOptional()
  @Transform(booleanParam)
  @IsBoolean()
  overdueOnly?: boolean;
}

export class FinancialRevenueQueryDto extends ReportPeriodQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'This course only (an invoice without an enrollment has no course)' })
  @IsOptional()
  @IsUUID('all')
  courseId?: string;
}

// --- API-161 -------------------------------------------------------------

export class CollectionRowDto {
  @ApiProperty({ example: '2026-11', description: 'The month of `paid_at` in the academy’s zone' })
  month: string;

  @ApiProperty({ enum: PAYMENT_METHODS })
  method: PaymentMethod;

  @ApiProperty({ example: 'SAR' })
  currency: string;

  @ApiProperty({ example: 42 })
  payments: number;

  @ApiProperty({ example: 31500, description: 'A JSON number with two decimals, like the MOD-11 contracts' })
  amount: number;
}

export class CollectionTotalsDto {
  @ApiProperty({ example: 'SAR' })
  currency: string;

  @ApiProperty({ description: 'Completed payments' })
  payments: number;

  @ApiProperty()
  amount: number;

  @ApiProperty({ description: 'Payments of the period reversed since' })
  reversedPayments: number;

  @ApiProperty()
  reversedAmount: number;
}

export class CollectionsReportDto {
  @ApiProperty({ type: ReportPeriodDto })
  period: ReportPeriodDto;

  @ApiProperty()
  timeZone: string;

  @ApiProperty()
  generatedAt: string;

  @ApiProperty()
  truncated: boolean;

  @ApiProperty({ type: [CollectionRowDto], description: 'Completed payments paid in the period, by month, method and currency' })
  rows: CollectionRowDto[];

  @ApiProperty({ type: [CollectionRowDto], description: 'The reversed ones, the same way (not part of `rows`)' })
  reversed: CollectionRowDto[];

  @ApiProperty({ type: [CollectionTotalsDto], description: 'One per currency' })
  totals: CollectionTotalsDto[];
}

// --- API-162 -------------------------------------------------------------

export class AgingDto {
  @ApiProperty({ description: 'Overdue by 1–30 days' })
  days1To30: number;

  @ApiProperty({ description: '31–60 days' })
  days31To60: number;

  @ApiProperty({ description: '61–90 days' })
  days61To90: number;

  @ApiProperty({ description: '91 days or more' })
  days91Plus: number;
}

export class ReceivableRowDto {
  @ApiProperty({ type: ReportStudentRefDto })
  student: ReportStudentRefDto;

  @ApiProperty({ example: 'SAR' })
  currency: string;

  @ApiProperty({ description: 'Issued invoices with a balance' })
  invoices: number;

  @ApiProperty()
  total: number;

  @ApiProperty()
  paid: number;

  @ApiProperty()
  balance: number;

  @ApiProperty({ description: 'The uncovered part of the installments due before today (the paid amount covers the oldest first — `allocate()`)' })
  overdue: number;

  @ApiProperty({ type: String, nullable: true, example: '2026-09-30', description: 'Due day of the oldest uncovered overdue installment' })
  oldestOverdueDueOn: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Days since that day' })
  daysOverdue: number | null;

  @ApiProperty({ type: AgingDto, description: 'The overdue amount by the age of each installment' })
  aging: AgingDto;
}

export class ReceivableTotalsDto {
  @ApiProperty({ example: 'SAR' })
  currency: string;

  @ApiProperty()
  students: number;

  @ApiProperty()
  invoices: number;

  @ApiProperty()
  total: number;

  @ApiProperty()
  paid: number;

  @ApiProperty()
  balance: number;

  @ApiProperty()
  overdue: number;

  @ApiProperty({ type: AgingDto })
  aging: AgingDto;
}

export class ReceivablesReportDto {
  @ApiProperty({ type: Object, nullable: true, description: 'Always null — receivables are read as of today' })
  period: null;

  @ApiProperty({ example: '2026-11-11', description: 'Today in the academy’s zone' })
  asOf: string;

  @ApiProperty()
  timeZone: string;

  @ApiProperty()
  generatedAt: string;

  @ApiProperty()
  truncated: boolean;

  @ApiProperty({ type: [ReceivableRowDto], description: 'One per (student × currency) with an issued invoice and a balance; most overdue first' })
  rows: ReceivableRowDto[];

  @ApiProperty({ type: [ReceivableTotalsDto], description: 'One per currency, over every matching row' })
  totals: ReceivableTotalsDto[];
}

// --- API-163 -------------------------------------------------------------

export class RevenueRowDto {
  @ApiProperty({ type: ReportCourseRefDto, nullable: true, description: 'null = invoices without an enrollment' })
  course: ReportCourseRefDto | null;

  @ApiProperty({ example: '2026-11' })
  month: string;

  @ApiProperty({ example: 'SAR' })
  currency: string;

  @ApiProperty({ description: 'Invoices issued in the month and not cancelled' })
  invoices: number;

  @ApiProperty({ description: 'Their totals (after the discount)' })
  invoiced: number;

  @ApiProperty({ description: 'Their discounts' })
  discounts: number;

  @ApiProperty({ description: 'Completed payments paid in the month on the course’s invoices' })
  payments: number;

  @ApiProperty()
  collected: number;
}

export class RevenueTotalsDto {
  @ApiProperty({ example: 'SAR' })
  currency: string;

  @ApiProperty()
  invoices: number;

  @ApiProperty()
  invoiced: number;

  @ApiProperty()
  discounts: number;

  @ApiProperty()
  payments: number;

  @ApiProperty()
  collected: number;
}

export class RevenueReportDto {
  @ApiProperty({ type: ReportPeriodDto })
  period: ReportPeriodDto;

  @ApiProperty()
  timeZone: string;

  @ApiProperty()
  generatedAt: string;

  @ApiProperty()
  truncated: boolean;

  @ApiProperty({ type: [RevenueRowDto], description: 'By course code (no course last), month and currency' })
  rows: RevenueRowDto[];

  @ApiProperty({ type: [RevenueTotalsDto], description: 'One per currency' })
  totals: RevenueTotalsDto[];
}
