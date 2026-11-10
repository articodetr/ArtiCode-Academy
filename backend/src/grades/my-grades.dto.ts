import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { MyClassStudentDto } from '../enrollments/my-classes.dto.js';
import type { MyClassRelation } from '../enrollments/my-classes.policy.js';
import { EnrollmentStatus } from '../generated/prisma/client.js';
import { TimetableClassDto } from '../schedule/timetable.dto.js';
import type { CellStatus, ComponentKind } from './gradebook.calc.js';

const RELATIONS: MyClassRelation[] = ['self', 'child'];
const KINDS: ComponentKind[] = ['assignment', 'exam'];
const CELL_STATUSES: CellStatus[] = ['graded', 'awaiting_review', 'returned', 'scored', 'absent', 'excused', 'missing'];
const OWNED_ENROLLMENT_STATUSES: EnrollmentStatus[] = ['active', 'completed'];

export class ListMyGradesQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'The grades of this class only (a class the caller does not own matches nothing)' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The grades of this student only — the caller or one of their linked children' })
  @IsOptional()
  @IsUUID('all')
  studentId?: string;
}

export class MyGradeComponentDto {
  @ApiProperty({ enum: KINDS })
  kind: ComponentKind;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Localized title' })
  title: LocalizedText;

  @ApiProperty({ type: Number, nullable: true, description: 'Its weight in the final grade; null or 0 = not counted (D-R43)' })
  weight: number | null;

  @ApiProperty({ example: 20 })
  maxScore: number;

  @ApiProperty({ enum: CELL_STATUSES, description: 'That student’s state for the component (an exam appears once its results are published)' })
  status: CellStatus;

  @ApiProperty({ type: Number, nullable: true, description: 'The latest graded attempt’s score, or the exam score' })
  score: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'After the late penalty; 0 for an absence' })
  effectiveScore: number | null;

  @ApiProperty()
  late: boolean;
}

export class MyFinalGradeDto {
  @ApiProperty({ example: 87.5 })
  percent: number;

  @ApiProperty({ description: 'The grade scheme band at finalization (e.g. «جيد جداً»)' })
  label: LocalizedText;

  @ApiProperty({ type: String, nullable: true })
  letter: string | null;

  @ApiProperty()
  isPass: boolean;

  @ApiProperty({ description: 'ISO 8601' })
  finalizedAt: string;
}

export class MyGradeItemDto {
  @ApiProperty({ format: 'uuid' })
  enrollmentId: string;

  @ApiProperty({ enum: OWNED_ENROLLMENT_STATUSES })
  enrollmentStatus: EnrollmentStatus;

  @ApiProperty({ enum: RELATIONS, description: '`self` (needs grades.read_own) or `child` (needs grades.read_linked and the guardian role)' })
  relation: MyClassRelation;

  @ApiProperty({ type: MyClassStudentDto, description: 'Identity only' })
  student: MyClassStudentDto;

  @ApiProperty({ type: TimetableClassDto })
  class: TimetableClassDto;

  @ApiProperty({ type: [MyGradeComponentDto], description: 'The class’s assignments (no drafts) then its published exams' })
  components: MyGradeComponentDto[];

  @ApiProperty({ type: MyFinalGradeDto, nullable: true, description: 'The final grade once the class is finalized; null before (no running average — D-R48)' })
  final: MyFinalGradeDto | null;
}

export class MyGradeListDto {
  @ApiProperty({ type: [MyGradeItemDto], description: 'One item per owned enrollment, in enrollment order' })
  items: MyGradeItemDto[];
}
