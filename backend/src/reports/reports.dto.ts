import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { ClassStatus } from '../generated/prisma/client.js';
import { IsCalendarDate } from '../users/users.validation.js';

const CLASS_STATUSES = Object.values(ClassStatus) as ClassStatus[];

/** `from`/`to` of every report with a period (D-R69). */
export class ReportPeriodQueryDto {
  @ApiPropertyOptional({ example: '2026-10-13', description: 'First day (YYYY-MM-DD, inclusive) in the academy’s time zone; absent = the day that makes a 30-day period with `to`' })
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-11', description: 'Last day (YYYY-MM-DD, inclusive); absent = today in the academy’s time zone. At most 366 days from `from` (`report_range_invalid`)' })
  @IsOptional()
  @IsCalendarDate()
  to?: string;
}

export class ReportPeriodDto {
  @ApiProperty({ example: '2026-10-13' })
  from: string;

  @ApiProperty({ example: '2026-11-11' })
  to: string;
}

export class ReportCourseRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ENG-A1' })
  code: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`', example: { ar: 'الإنجليزية المستوى الأول' } })
  name: LocalizedText;
}

export class ReportClassRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ENG-A1-2026-1' })
  code: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`', example: { ar: 'فصل الصباح' } })
  name: LocalizedText;

  @ApiProperty({ enum: CLASS_STATUSES })
  status: ClassStatus;
}

/** A student by identity only — never a contact field (D-R68). */
export class ReportStudentRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'سارة أحمد' })
  fullName: string;

  @ApiProperty({ type: String, nullable: true })
  displayName: string | null;
}
