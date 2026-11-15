import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { EnrollmentSource } from '../generated/prisma/client.js';
import type { EnrollmentStatus } from '../generated/prisma/client.js';
import { ENROLLMENT_STATUSES } from './enrollments.dto.js';
import { MyClassSummaryDto } from './my-classes.dto.js';

const ENROLLMENT_SOURCES = Object.values(EnrollmentSource) as EnrollmentSource[];

export class ListStudentEnrollmentsQueryDto {
  @ApiPropertyOptional({ enum: ENROLLMENT_STATUSES, description: 'Only enrollments in this status (default: every status)' })
  @IsOptional()
  @IsIn(ENROLLMENT_STATUSES)
  status?: EnrollmentStatus;
}

export class StudentEnrollmentItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ENROLLMENT_STATUSES })
  status: EnrollmentStatus;

  @ApiProperty({ enum: ENROLLMENT_SOURCES })
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
    description: 'Set on withdraw; null for callers without `enrollments.manage` (a holder of `invoices.manage` alone never reads it)',
  })
  withdrawalReason: string | null;

  @ApiProperty({ type: MyClassSummaryDto, description: 'The class, its course and its lead teacher by name — the «my classes» summary' })
  class: MyClassSummaryDto;
}

export class StudentEnrollmentListDto {
  @ApiProperty({
    type: [StudentEnrollmentItemDto],
    description: 'Newest enrollment first, every class; empty for a user without enrollments (a user who is not a student included)',
  })
  items: StudentEnrollmentItemDto[];
}
