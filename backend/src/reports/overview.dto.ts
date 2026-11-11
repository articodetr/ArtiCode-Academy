import { ApiProperty } from '@nestjs/swagger';
import { AttendanceCountsDto } from '../lessons/lessons.dto.js';
import { ReportPeriodDto } from './reports.dto.js';

export class OverviewGeneralDto {
  @ApiProperty({ description: 'Distinct students with an active enrollment' })
  activeStudents: number;

  @ApiProperty({ description: 'Classes open for enrollment' })
  openClasses: number;

  @ApiProperty({ description: 'Classes running' })
  runningClasses: number;

  @ApiProperty({ description: 'Lessons starting today (the academy’s day) and not cancelled' })
  lessonsToday: number;
}

export class OverviewAttendanceDto {
  @ApiProperty({ type: ReportPeriodDto, description: 'The last 30 days' })
  period: ReportPeriodDto;

  @ApiProperty({ type: AttendanceCountsDto })
  records: AttendanceCountsDto;

  @ApiProperty({ type: Number, nullable: true, description: 'As API-156’s totals for the same period' })
  attendanceRate: number | null;
}

export class OverviewAcademicDto {
  @ApiProperty({ type: ReportPeriodDto, description: 'The last 30 days' })
  period: ReportPeriodDto;

  @ApiProperty({ description: 'Final grades finalized in the period (API-158’s totals)' })
  finalGrades: number;

  @ApiProperty({ type: Number, nullable: true })
  averagePercent: number | null;

  @ApiProperty({ type: Number, nullable: true })
  passRate: number | null;

  @ApiProperty({ description: 'Latest attempts waiting for review, over every non-draft assignment (no period)' })
  awaitingReview: number;
}

export class OverviewCollectedDto {
  @ApiProperty({ example: 'SAR' })
  currency: string;

  @ApiProperty()
  payments: number;

  @ApiProperty()
  amount: number;
}

export class OverviewOutstandingDto {
  @ApiProperty({ example: 'SAR' })
  currency: string;

  @ApiProperty({ description: 'Balance of the issued invoices (API-162’s totals)' })
  balance: number;

  @ApiProperty()
  overdue: number;

  @ApiProperty({ description: 'Students with an overdue amount in this currency' })
  studentsOverdue: number;
}

export class OverviewFinancialDto {
  @ApiProperty({ type: ReportPeriodDto, description: 'This month so far (the first day to today)' })
  period: ReportPeriodDto;

  @ApiProperty({ type: [OverviewCollectedDto], description: 'Completed payments of the month per currency (API-161’s totals)' })
  collected: OverviewCollectedDto[];

  @ApiProperty({ type: [OverviewOutstandingDto], description: 'As of today, per currency' })
  outstanding: OverviewOutstandingDto[];
}

export class ReportsOverviewDto {
  @ApiProperty({ example: '2026-11-11', description: 'Today in the academy’s zone' })
  asOf: string;

  @ApiProperty()
  timeZone: string;

  @ApiProperty()
  generatedAt: string;

  @ApiProperty({ type: OverviewGeneralDto, description: 'For a holder of any report key' })
  general: OverviewGeneralDto;

  @ApiProperty({ type: OverviewAttendanceDto, nullable: true, description: 'null without `reports.attendance.view`' })
  attendance: OverviewAttendanceDto | null;

  @ApiProperty({ type: OverviewAcademicDto, nullable: true, description: 'null without `reports.academic.view`' })
  academic: OverviewAcademicDto | null;

  @ApiProperty({ type: OverviewFinancialDto, nullable: true, description: 'null without `reports.financial.view`' })
  financial: OverviewFinancialDto | null;
}
