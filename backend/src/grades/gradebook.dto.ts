import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { EnrollmentStudentDto } from '../enrollments/enrollments.dto.js';
import { ClassStatus, EnrollmentStatus } from '../generated/prisma/client.js';
import type { CellStatus, ComponentKind } from './gradebook.calc.js';

const KINDS: ComponentKind[] = ['assignment', 'exam'];
const CELL_STATUSES: CellStatus[] = ['graded', 'awaiting_review', 'returned', 'scored', 'absent', 'excused', 'missing'];
const CLASS_STATUSES = Object.values(ClassStatus) as ClassStatus[];
const ENROLLMENT_STATUSES = Object.values(EnrollmentStatus) as EnrollmentStatus[];

/** API-127: finalize with the default grade scheme, or a chosen active one. */
export class FinalizeGradesDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'An active grade scheme; absent = the default (`grade_scheme_missing` without one)' })
  @IsOptional()
  @IsUUID('all')
  schemeId?: string;
}

export class GradebookClassDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`' })
  name: LocalizedText;

  @ApiProperty({ enum: CLASS_STATUSES })
  status: ClassStatus;
}

export class GradebookComponentDto {
  @ApiProperty({ enum: KINDS })
  kind: ComponentKind;

  @ApiProperty({ format: 'uuid', description: 'The assignment or exam' })
  id: string;

  @ApiProperty({ description: 'Localized title' })
  title: LocalizedText;

  @ApiProperty({ type: Number, nullable: true, description: 'null or 0 = informational (not counted — D-R43)' })
  weight: number | null;

  @ApiProperty({ example: 20 })
  maxScore: number;

  @ApiProperty({ type: Number, nullable: true, description: 'Assignments: the late penalty applied to a late graded attempt (D-R36)' })
  latePenaltyPercent: number | null;

  @ApiProperty({ description: 'The assignment’s (open|closed) or the exam’s (scheduled|published) status' })
  status: string;

  @ApiProperty({ description: 'True when the weight is above 0' })
  counted: boolean;
}

export class GradebookCellDto {
  @ApiProperty({ enum: KINDS })
  kind: ComponentKind;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: CELL_STATUSES, description: 'graded/awaiting_review/returned/missing for an assignment (by its latest attempt); scored/absent/excused/missing for an exam' })
  status: CellStatus;

  @ApiProperty({ type: Number, nullable: true, description: 'The latest graded attempt’s score, or the exam score' })
  score: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'After the late penalty (two decimals); 0 for an absence; null when missing or excused' })
  effectiveScore: number | null;

  @ApiProperty({ description: 'The counted attempt was late' })
  late: boolean;
}

export class FinalGradeRecorderDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  fullName: string;
}

export class FinalGradeDto {
  @ApiProperty({ example: 87.5 })
  percent: number;

  @ApiProperty({ format: 'uuid' })
  schemeId: string;

  @ApiProperty({ description: 'The band’s label at finalization (snapshot)' })
  label: LocalizedText;

  @ApiProperty({ type: String, nullable: true })
  letter: string | null;

  @ApiProperty()
  isPass: boolean;

  @ApiProperty({ description: 'ISO 8601' })
  finalizedAt: string;

  @ApiProperty({ type: FinalGradeRecorderDto, nullable: true })
  finalizedBy: FinalGradeRecorderDto | null;

  @ApiProperty({ description: 'A source (a component, a review, a result) changed after the finalization — finalize again to refresh it' })
  stale: boolean;
}

export class GradebookStudentDto {
  @ApiProperty({ format: 'uuid' })
  enrollmentId: string;

  @ApiProperty({ enum: ENROLLMENT_STATUSES })
  enrollmentStatus: EnrollmentStatus;

  @ApiProperty({ type: EnrollmentStudentDto, description: 'The student in the caller’s projection (D-R07)' })
  student: EnrollmentStudentDto;

  @ApiProperty({ type: [GradebookCellDto], description: 'Aligned with `components`' })
  cells: GradebookCellDto[];

  @ApiProperty({ type: Number, nullable: true, description: 'Weighted average over what is graded or recorded (missing work left out)' })
  current: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Weighted average with missing work counted as 0 — what a finalization would fix now (D-R45)' })
  projected: number | null;

  @ApiProperty({ type: FinalGradeDto, nullable: true })
  final: FinalGradeDto | null;
}

export class GradebookReadinessDto {
  @ApiProperty({ description: 'Weighted assignments still open' })
  openAssignments: number;

  @ApiProperty({ description: 'Weighted assignments × students whose latest attempt waits for review' })
  awaitingReview: number;

  @ApiProperty({ description: 'Weighted exams whose results are not published' })
  unpublishedExams: number;

  @ApiProperty({ description: 'Components with a weight above 0' })
  weightedComponents: number;

  @ApiProperty({ description: 'True when a finalization would be accepted now (also needs a running or completed class)' })
  ready: boolean;
}

export class GradebookSchemeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Localized name' })
  name: LocalizedText;
}

/** API-126: the gradebook of a class, computed on read (D-R44). */
export class GradebookDto {
  @ApiProperty({ type: GradebookClassDto })
  class: GradebookClassDto;

  @ApiProperty({ type: [GradebookComponentDto], description: 'The class’s assignments then exams that are not drafts' })
  components: GradebookComponentDto[];

  @ApiProperty({ type: [GradebookStudentDto], description: 'Every student with an active or completed enrollment, in enrollment order' })
  students: GradebookStudentDto[];

  @ApiProperty({ type: GradebookReadinessDto })
  readiness: GradebookReadinessDto;

  @ApiProperty({ type: GradebookSchemeDto, nullable: true, description: 'The default grade scheme a finalization would use' })
  defaultScheme: GradebookSchemeDto | null;
}
