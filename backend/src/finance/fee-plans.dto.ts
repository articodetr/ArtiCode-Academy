import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDefined, IsInt, IsObject, IsOptional, IsUUID, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { IsDecimalNumber } from '../common/decimal-number.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { rawBoolean, rawNumber } from '../courses/courses.validation.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';

export const FEE_PLAN_LINES_MAX = 50;
export const FEE_PLAN_INSTALLMENTS_MAX = 24;
/** The largest amount numeric(12,2) holds. */
export const MONEY_MAX = 9_999_999_999.99;
export const DUE_OFFSET_DAYS_MAX = 3650;

/** A line of a plan: what is charged and how much. */
export class FeePlanLineDto {
  @ApiProperty({ type: LocalizedTextDto, description: 'Localized description `{ ar, en?, tr? }` (e.g. رسوم الدورة); `ar` is required' })
  @IsDefined()
  @IsObject({ message: 'description must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  description: LocalizedTextDto;

  @ApiProperty({ minimum: 0.01, maximum: MONEY_MAX, example: 1500, description: 'A JSON number with at most two decimals, in the academy currency' })
  @Transform(rawNumber)
  @IsDecimalNumber(2)
  @Min(0.01)
  @Max(MONEY_MAX)
  amount: number;
}

/** An installment share of a plan (D-R60): its percentage of the total and its due day, counted from the day an invoice is created from the plan. */
export class FeePlanShareDto {
  @ApiProperty({ minimum: 0.01, maximum: 100, example: 50, description: 'A JSON number with at most two decimals; the shares sum to exactly 100' })
  @Transform(rawNumber)
  @IsDecimalNumber(2)
  @Min(0.01)
  @Max(100)
  percent: number;

  @ApiProperty({ minimum: 0, maximum: DUE_OFFSET_DAYS_MAX, example: 30, description: 'Days after the day an invoice is created from the plan; not below the previous share' })
  @Transform(rawNumber)
  @IsInt()
  @Min(0)
  @Max(DUE_OFFSET_DAYS_MAX)
  dueOffsetDays: number;
}

/** API-141 body. */
export class CreateFeePlanDto {
  @ApiProperty({ type: LocalizedTextDto, description: 'Localized name; `ar` is required' })
  @IsDefined()
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name: LocalizedTextDto;

  @ApiPropertyOptional({ format: 'uuid', description: 'The course the plan prices (not with classId)' })
  @IsOptional()
  @IsUUID('all')
  courseId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The class the plan prices (not with courseId)' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;

  @ApiProperty({ type: [FeePlanLineDto], minItems: 1, maxItems: FEE_PLAN_LINES_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FEE_PLAN_LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => FeePlanLineDto)
  lines: FeePlanLineDto[];

  @ApiProperty({ type: [FeePlanShareDto], minItems: 1, maxItems: FEE_PLAN_INSTALLMENTS_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FEE_PLAN_INSTALLMENTS_MAX)
  @ValidateNested({ each: true })
  @Type(() => FeePlanShareDto)
  installments: FeePlanShareDto[];
}

/** API-142 body: absent = unchanged; `null` clears the course or the class; lines and installments are replaced whole. */
export class UpdateFeePlanDto {
  @ApiPropertyOptional({ type: LocalizedTextDto })
  @ValidateIf((dto: UpdateFeePlanDto) => dto.name !== undefined)
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name?: LocalizedTextDto;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((dto: UpdateFeePlanDto) => dto.courseId !== undefined && dto.courseId !== null)
  @IsUUID('all')
  courseId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((dto: UpdateFeePlanDto) => dto.classId !== undefined && dto.classId !== null)
  @IsUUID('all')
  classId?: string | null;

  @ApiPropertyOptional({ type: [FeePlanLineDto] })
  @ValidateIf((dto: UpdateFeePlanDto) => dto.lines !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FEE_PLAN_LINES_MAX)
  @ValidateNested({ each: true })
  @Type(() => FeePlanLineDto)
  lines?: FeePlanLineDto[];

  @ApiPropertyOptional({ type: [FeePlanShareDto] })
  @ValidateIf((dto: UpdateFeePlanDto) => dto.installments !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FEE_PLAN_INSTALLMENTS_MAX)
  @ValidateNested({ each: true })
  @Type(() => FeePlanShareDto)
  installments?: FeePlanShareDto[];

  @ApiPropertyOptional({ description: 'A JSON boolean; an inactive plan creates no invoice' })
  @ValidateIf((dto: UpdateFeePlanDto) => dto.isActive !== undefined)
  @Transform(rawBoolean)
  @IsBoolean()
  isActive?: boolean;
}

export class ListFeePlansQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  courseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;
}

export class FeePlanRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: LocalizedText;
}

export class FeePlanLineOutDto {
  @ApiProperty()
  description: LocalizedText;

  @ApiProperty({ example: 1500 })
  amount: number;
}

export class FeePlanShareOutDto {
  @ApiProperty({ example: 50 })
  percent: number;

  @ApiProperty({ example: 30 })
  dueOffsetDays: number;
}

export class FeePlanDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: LocalizedText;

  @ApiProperty({ type: FeePlanRefDto, nullable: true })
  course: FeePlanRefDto | null;

  @ApiProperty({ type: FeePlanRefDto, nullable: true })
  class: FeePlanRefDto | null;

  @ApiProperty({ type: [FeePlanLineOutDto] })
  lines: FeePlanLineOutDto[];

  @ApiProperty({ type: [FeePlanShareOutDto] })
  installments: FeePlanShareOutDto[];

  @ApiProperty({ example: 3000, description: 'The sum of the lines' })
  total: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ type: Number, nullable: true, description: 'Invoices created from the plan — for fee_plans.manage only, else null' })
  invoiceCount: number | null;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class FeePlanListDto {
  @ApiProperty({ type: [FeePlanDto] })
  items: FeePlanDto[];
}
