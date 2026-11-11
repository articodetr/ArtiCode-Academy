import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { IsDecimalNumber } from '../common/decimal-number.js';
import { ClassStatus, EnrollmentStatus } from '../generated/prisma/client.js';
import { AttendanceCountsDto } from '../lessons/lessons.dto.js';
import { ReportClassRefDto, ReportCourseRefDto, ReportPeriodDto, ReportPeriodQueryDto, ReportStudentRefDto } from './reports.dto.js';

const CLASS_STATUSES = Object.values(ClassStatus) as ClassStatus[];
const ENROLLMENT_STATUSES = Object.values(EnrollmentStatus) as EnrollmentStatus[];

export class AttendanceClassesQueryDto extends ReportPeriodQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'The classes of this course only' })
  @IsOptional()
  @IsUUID('all')
  courseId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'This class only' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;

  @ApiPropertyOptional({ enum: CLASS_STATUSES, description: 'The classes in this state now' })
  @IsOptional()
  @IsIn(CLASS_STATUSES)
  classStatus?: ClassStatus;
}

export class AttendanceStudentsQueryDto extends ReportPeriodQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'The classes of this course only' })
  @IsOptional()
  @IsUUID('all')
  courseId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'This class only' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;

  @ApiPropertyOptional({ minimum: 1, example: 3, description: 'The rows with at least this many absences' })
  @IsOptional()
  @IsInt()
  @Min(1)
  minAbsences?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, example: 20, description: 'The rows whose absence rate (absent ÷ present + late + absent, in %) is at least this; at most two decimals' })
  @IsOptional()
  @IsDecimalNumber(2)
  @Min(0)
  @Max(100)
  minAbsenceRate?: number;
}

export class AttendanceClassRowDto {
  @ApiProperty({ type: ReportClassRefDto })
  class: ReportClassRefDto;

  @ApiProperty({ type: ReportCourseRefDto })
  course: ReportCourseRefDto;

  @ApiProperty({ example: 12, description: 'The class’s lessons that start in the period and are not cancelled' })
  lessons: number;

  @ApiProperty({ example: 10, description: 'Of them, the completed ones' })
  completedLessons: number;

  @ApiProperty({ example: 10, description: 'Of them, the ones whose attendance was taken' })
  recordedLessons: number;

  @ApiProperty({ example: 1, description: 'Completed lessons without any attendance taken' })
  completedWithoutAttendance: number;

  @ApiProperty({ type: AttendanceCountsDto, description: 'The records of those lessons by status' })
  records: AttendanceCountsDto;

  @ApiProperty({ type: Number, nullable: true, example: 87.5, description: '(present + late) ÷ (present + late + absent), in % with two decimals; excused is left out (D-R70); null without such records' })
  attendanceRate: number | null;
}

export class AttendanceClassesTotalsDto {
  @ApiProperty({ example: 4, description: 'Classes with at least one lesson in the period (all matching rows, even when truncated)' })
  classes: number;

  @ApiProperty()
  lessons: number;

  @ApiProperty()
  completedLessons: number;

  @ApiProperty()
  recordedLessons: number;

  @ApiProperty()
  completedWithoutAttendance: number;

  @ApiProperty({ type: AttendanceCountsDto })
  records: AttendanceCountsDto;

  @ApiProperty({ type: Number, nullable: true })
  attendanceRate: number | null;
}

export class AttendanceClassesReportDto {
  @ApiProperty({ type: ReportPeriodDto })
  period: ReportPeriodDto;

  @ApiProperty({ example: 'Asia/Riyadh', description: 'The academy’s zone the days are read in (UTC without the academy row)' })
  timeZone: string;

  @ApiProperty({ description: 'ISO 8601 — when the report was computed' })
  generatedAt: string;

  @ApiProperty({ description: 'True when more than 5,000 rows matched; the first 5,000 are returned (D-R72)' })
  truncated: boolean;

  @ApiProperty({ type: [AttendanceClassRowDto], description: 'By course code, then class code' })
  rows: AttendanceClassRowDto[];

  @ApiProperty({ type: AttendanceClassesTotalsDto })
  totals: AttendanceClassesTotalsDto;
}

export class AttendanceStudentRowDto {
  @ApiProperty({ type: ReportStudentRefDto })
  student: ReportStudentRefDto;

  @ApiProperty({ type: ReportClassRefDto })
  class: ReportClassRefDto;

  @ApiProperty({ type: ReportCourseRefDto })
  course: ReportCourseRefDto;

  @ApiProperty({ enum: ENROLLMENT_STATUSES, nullable: true, description: 'The student’s enrollment in the class now (a student withdrawn later keeps their records)' })
  enrollmentStatus: EnrollmentStatus | null;

  @ApiProperty({ type: AttendanceCountsDto, description: 'The student’s records in the class’s lessons of the period' })
  records: AttendanceCountsDto;

  @ApiProperty({ type: Number, nullable: true, example: 75 })
  attendanceRate: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 25, description: 'absent ÷ (present + late + absent), in %' })
  absenceRate: number | null;
}

export class AttendanceStudentsTotalsDto {
  @ApiProperty({ description: 'Matching (student × class) rows, even when truncated' })
  rows: number;

  @ApiProperty({ description: 'Distinct students among them' })
  students: number;

  @ApiProperty({ type: AttendanceCountsDto })
  records: AttendanceCountsDto;

  @ApiProperty({ type: Number, nullable: true })
  attendanceRate: number | null;

  @ApiProperty({ type: Number, nullable: true })
  absenceRate: number | null;
}

export class AttendanceStudentsReportDto {
  @ApiProperty({ type: ReportPeriodDto })
  period: ReportPeriodDto;

  @ApiProperty({ example: 'Asia/Riyadh' })
  timeZone: string;

  @ApiProperty({ description: 'ISO 8601' })
  generatedAt: string;

  @ApiProperty()
  truncated: boolean;

  @ApiProperty({ type: [AttendanceStudentRowDto], description: 'Most absences first, then the higher absence rate, the student’s name and the class code' })
  rows: AttendanceStudentRowDto[];

  @ApiProperty({ type: AttendanceStudentsTotalsDto })
  totals: AttendanceStudentsTotalsDto;
}
