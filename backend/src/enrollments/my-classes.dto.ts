import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { ClassStatus } from '../generated/prisma/client.js';
import type { EnrollmentStatus } from '../generated/prisma/client.js';
import { ENROLLMENT_STATUSES } from './enrollments.dto.js';
import { MY_CLASSES_DEFAULT_STATUSES } from './my-classes.policy.js';
import type { MyClassRelation } from './my-classes.policy.js';

const CLASS_STATUSES = Object.values(ClassStatus) as ClassStatus[];
const RELATIONS: MyClassRelation[] = ['self', 'child'];

export class ListMyClassesQueryDto {
  @ApiPropertyOptional({
    enum: ENROLLMENT_STATUSES,
    description: `Only enrollments in this status; default: ${MY_CLASSES_DEFAULT_STATUSES.join(' and ')}`,
  })
  @IsOptional()
  @IsIn(ENROLLMENT_STATUSES)
  status?: EnrollmentStatus;
}

/** The enrolled student: the caller or one of their linked children — identity only, never contact fields. */
export class MyClassStudentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  fullName: string;

  @ApiProperty({ nullable: true })
  displayName: string | null;
}

export class MyClassCourseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'PY-101' })
  code: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`' })
  name: LocalizedText;
}

/** The lead teacher by name only (no id, no contact fields). */
export class MyClassTeacherDto {
  @ApiProperty()
  fullName: string;

  @ApiProperty({ nullable: true })
  displayName: string | null;
}

export class MyClassSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'PY-101-A' })
  code: string;

  @ApiProperty({ description: 'Localized name `{ ar, en?, tr? }`' })
  name: LocalizedText;

  @ApiProperty({ enum: CLASS_STATUSES })
  status: ClassStatus;

  @ApiProperty({ nullable: true, example: '2026-11-10', description: 'YYYY-MM-DD' })
  startsOn: string | null;

  @ApiProperty({ nullable: true, example: '2026-12-20', description: 'YYYY-MM-DD' })
  endsOn: string | null;

  @ApiProperty({ type: MyClassCourseDto })
  course: MyClassCourseDto;

  @ApiProperty({ type: MyClassTeacherDto, nullable: true, description: 'null while the class has no lead teacher' })
  leadTeacher: MyClassTeacherDto | null;
}

export class MyClassItemDto {
  @ApiProperty({ format: 'uuid' })
  enrollmentId: string;

  @ApiProperty({ enum: ENROLLMENT_STATUSES })
  enrollmentStatus: EnrollmentStatus;

  @ApiProperty({ description: 'ISO 8601' })
  enrolledAt: string;

  @ApiProperty({ nullable: true, description: 'ISO 8601' })
  completedAt: string | null;

  @ApiProperty({ enum: RELATIONS, description: '`self` = the caller is the student; `child` = a student linked to the caller as guardian' })
  relation: MyClassRelation;

  @ApiProperty({ type: MyClassStudentDto })
  student: MyClassStudentDto;

  @ApiProperty({ type: MyClassSummaryDto })
  class: MyClassSummaryDto;
}

export class MyClassListDto {
  @ApiProperty({ type: [MyClassItemDto], description: 'Newest enrollment first; empty for a user without enrollments or linked children' })
  items: MyClassItemDto[];
}
