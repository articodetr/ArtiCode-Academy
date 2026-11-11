import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { ExamType } from '../generated/prisma/client.js';
import { ReportClassRefDto, ReportCourseRefDto, ReportPeriodDto, ReportPeriodQueryDto } from './reports.dto.js';

const EXAM_TYPES = Object.values(ExamType) as ExamType[];
/** The assignment states a report filters on — `grading`/`graded` are unused (D-R37). */
export const REPORT_ASSIGNMENT_STATUSES = ['open', 'closed'] as const;
export type ReportAssignmentStatus = (typeof REPORT_ASSIGNMENT_STATUSES)[number];

class CourseClassFilterDto extends ReportPeriodQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'The classes of this course only' })
  @IsOptional()
  @IsUUID('all')
  courseId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'This class only' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;
}

export class AcademicClassesQueryDto extends CourseClassFilterDto {}

export class AcademicAssignmentsQueryDto extends CourseClassFilterDto {
  @ApiPropertyOptional({ enum: REPORT_ASSIGNMENT_STATUSES })
  @IsOptional()
  @IsIn(REPORT_ASSIGNMENT_STATUSES)
  status?: ReportAssignmentStatus;
}

export class AcademicExamsQueryDto extends CourseClassFilterDto {
  @ApiPropertyOptional({ enum: EXAM_TYPES })
  @IsOptional()
  @IsIn(EXAM_TYPES)
  type?: ExamType;
}

// --- API-158 -------------------------------------------------------------

export class GradeBandCountDto {
  @ApiProperty({ description: 'The band’s label as frozen in the final grades (snapshot — D-R44)', example: { ar: 'جيد جداً' } })
  label: LocalizedText;

  @ApiProperty({ type: String, nullable: true, example: 'B' })
  letter: string | null;

  @ApiProperty({ example: 7 })
  count: number;
}

export class ClassPerformanceRowDto {
  @ApiProperty({ type: ReportClassRefDto })
  class: ReportClassRefDto;

  @ApiProperty({ type: ReportCourseRefDto })
  course: ReportCourseRefDto;

  @ApiProperty({ example: 18, description: 'Final grades of the class finalized in the period' })
  finalGrades: number;

  @ApiProperty({ type: Number, example: 81.37, description: 'Mean of their percentages, two decimals half-up' })
  averagePercent: number;

  @ApiProperty({ example: 16 })
  passed: number;

  @ApiProperty({ type: Number, example: 88.89, description: 'passed ÷ finalGrades, in %' })
  passRate: number;

  @ApiProperty({ type: [GradeBandCountDto], description: 'Counts per band, the highest grades’ band first' })
  bands: GradeBandCountDto[];
}

export class CoursePerformanceRowDto {
  @ApiProperty({ type: ReportCourseRefDto })
  course: ReportCourseRefDto;

  @ApiProperty({ description: 'Classes of the course with final grades in the period' })
  classes: number;

  @ApiProperty()
  finalGrades: number;

  @ApiProperty({ type: Number, description: 'Mean over every final grade of the course (not a mean of class means)' })
  averagePercent: number;

  @ApiProperty()
  passed: number;

  @ApiProperty({ type: Number })
  passRate: number;
}

export class PerformanceTotalsDto {
  @ApiProperty()
  classes: number;

  @ApiProperty()
  finalGrades: number;

  @ApiProperty({ type: Number, nullable: true })
  averagePercent: number | null;

  @ApiProperty()
  passed: number;

  @ApiProperty({ type: Number, nullable: true })
  passRate: number | null;
}

export class ClassPerformanceReportDto {
  @ApiProperty({ type: ReportPeriodDto })
  period: ReportPeriodDto;

  @ApiProperty({ example: 'Asia/Riyadh' })
  timeZone: string;

  @ApiProperty({ description: 'ISO 8601' })
  generatedAt: string;

  @ApiProperty({ description: 'True when more than 5,000 classes (or courses) matched' })
  truncated: boolean;

  @ApiProperty({ type: [ClassPerformanceRowDto], description: 'By course code, then class code' })
  rows: ClassPerformanceRowDto[];

  @ApiProperty({ type: [CoursePerformanceRowDto], description: 'One per course, by course code' })
  courses: CoursePerformanceRowDto[];

  @ApiProperty({ type: PerformanceTotalsDto })
  totals: PerformanceTotalsDto;
}

// --- API-159 -------------------------------------------------------------

export class ReportAssignmentRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Localized title `{ ar, en?, tr? }`' })
  title: LocalizedText;

  @ApiProperty({ enum: ['open', 'closed', 'grading', 'graded'] })
  status: string;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601' })
  dueAt: string | null;

  @ApiProperty({ type: String, description: 'ISO 8601 — the day an undated assignment counts on' })
  publishedAt: string;

  @ApiProperty({ example: 20 })
  maxScore: number;

  @ApiProperty({ type: Number, nullable: true })
  latePenaltyPercent: number | null;
}

export class AssignmentSubmissionRowDto {
  @ApiProperty({ type: ReportAssignmentRefDto })
  assignment: ReportAssignmentRefDto;

  @ApiProperty({ type: ReportClassRefDto })
  class: ReportClassRefDto;

  @ApiProperty({ type: ReportCourseRefDto })
  course: ReportCourseRefDto;

  @ApiProperty({ description: 'Students with an active or completed enrollment in the class, plus anyone holding a submission' })
  students: number;

  @ApiProperty({ description: 'Students with at least one attempt' })
  submitted: number;

  @ApiProperty({ description: 'Of them, whose latest attempt is not late' })
  onTime: number;

  @ApiProperty({ description: 'Of them, whose latest attempt is late' })
  late: number;

  @ApiProperty({ description: 'students − submitted' })
  notSubmitted: number;

  @ApiProperty({ description: 'Latest attempt waiting for review' })
  awaitingReview: number;

  @ApiProperty({ description: 'Latest attempt graded' })
  graded: number;

  @ApiProperty({ description: 'Latest attempt returned for rework' })
  returned: number;

  @ApiProperty({ type: Number, nullable: true, description: 'submitted ÷ students, in %' })
  submissionRate: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'onTime ÷ students, in %' })
  onTimeRate: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Mean of each student’s latest graded attempt as % of the maximum, after the late penalty (`cellOutcome()` — D-R70); null without a graded attempt' })
  averagePercent: number | null;
}

export class AssignmentTotalsDto {
  @ApiProperty()
  assignments: number;

  @ApiProperty({ description: 'Σ students over the assignments' })
  students: number;

  @ApiProperty()
  submitted: number;

  @ApiProperty()
  onTime: number;

  @ApiProperty()
  late: number;

  @ApiProperty()
  notSubmitted: number;

  @ApiProperty()
  awaitingReview: number;

  @ApiProperty()
  graded: number;

  @ApiProperty()
  returned: number;

  @ApiProperty({ type: Number, nullable: true })
  submissionRate: number | null;

  @ApiProperty({ type: Number, nullable: true })
  onTimeRate: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Over every graded latest attempt of every matching assignment' })
  averagePercent: number | null;
}

export class AssignmentSubmissionsReportDto {
  @ApiProperty({ type: ReportPeriodDto })
  period: ReportPeriodDto;

  @ApiProperty()
  timeZone: string;

  @ApiProperty()
  generatedAt: string;

  @ApiProperty()
  truncated: boolean;

  @ApiProperty({ type: [AssignmentSubmissionRowDto], description: 'By due date (else publish date), then id' })
  rows: AssignmentSubmissionRowDto[];

  @ApiProperty({ type: AssignmentTotalsDto })
  totals: AssignmentTotalsDto;
}

// --- API-160 -------------------------------------------------------------

export class ReportExamRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Localized title `{ ar, en?, tr? }`' })
  title: LocalizedText;

  @ApiProperty({ enum: EXAM_TYPES })
  type: ExamType;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601' })
  scheduledAt: string | null;

  @ApiProperty({ description: 'ISO 8601' })
  publishedAt: string;

  @ApiProperty({ example: 50 })
  maxScore: number;

  @ApiProperty({ type: Number, nullable: true, example: 25 })
  passScore: number | null;
}

export class ExamResultsRowDto {
  @ApiProperty({ type: ReportExamRefDto })
  exam: ReportExamRefDto;

  @ApiProperty({ type: ReportClassRefDto })
  class: ReportClassRefDto;

  @ApiProperty({ type: ReportCourseRefDto })
  course: ReportCourseRefDto;

  @ApiProperty({ description: 'Students with an active or completed enrollment in the class, plus anyone holding a result' })
  students: number;

  @ApiProperty()
  scored: number;

  @ApiProperty()
  absent: number;

  @ApiProperty()
  excused: number;

  @ApiProperty({ description: 'students without a result' })
  missing: number;

  @ApiProperty({ type: Number, nullable: true, description: 'Mean % over scored and absent (absent = 0); excused and missing left out (`cellOutcome()` — D-R70)' })
  averagePercent: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Lowest % among the scored results' })
  minPercent: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Highest % among the scored results' })
  maxPercent: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Scored results at or above `passScore`; null without a pass score' })
  passed: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'passed ÷ (scored + absent), in %; null without a pass score or such results' })
  passRate: number | null;
}

export class ExamTotalsDto {
  @ApiProperty()
  exams: number;

  @ApiProperty()
  students: number;

  @ApiProperty()
  scored: number;

  @ApiProperty()
  absent: number;

  @ApiProperty()
  excused: number;

  @ApiProperty()
  missing: number;

  @ApiProperty({ type: Number, nullable: true })
  averagePercent: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Over the exams with a pass score' })
  passRate: number | null;
}

export class ExamResultsReportDto {
  @ApiProperty({ type: ReportPeriodDto })
  period: ReportPeriodDto;

  @ApiProperty()
  timeZone: string;

  @ApiProperty()
  generatedAt: string;

  @ApiProperty()
  truncated: boolean;

  @ApiProperty({ type: [ExamResultsRowDto], description: 'By scheduled date (else publish date), then id' })
  rows: ExamResultsRowDto[];

  @ApiProperty({ type: ExamTotalsDto })
  totals: ExamTotalsDto;
}
