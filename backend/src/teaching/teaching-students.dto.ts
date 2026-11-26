// «طلابي» for a teacher (CH-0370, API-301/302): the students of the classes the
// caller teaches, read only. Contact fields and guardians are shown to the
// teacher of the student's class (the session's decision of 2026-11-26).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { ClassStatus, EnrollmentStatus, GuardianRelationship, LessonStatus } from '../generated/prisma/client.js';
import type { AttendanceStatus } from '../generated/prisma/client.js';
import { FinalGradeDto, GradebookCellDto, GradebookComponentDto } from '../grades/gradebook.dto.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { TEACHING_STUDENT_FILTERS } from './teaching-students.policy.js';
import type { TeachingStudentFilter } from './teaching-students.policy.js';

const ATTENDANCE_STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'excused'];

export class ListTeachingStudentsQueryDto {
  @ApiPropertyOptional({ description: 'Name, e-mail or phone contains this text (1–100 characters, case-insensitive)', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only the students of this class (one the caller teaches; another class matches nothing)' })
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional({ enum: TEACHING_STUDENT_FILTERS, description: 'Enrollment state; default `active` (studying now). `all` = active, completed and withdrawn' })
  @IsOptional()
  @IsIn(TEACHING_STUDENT_FILTERS)
  status?: TeachingStudentFilter;
}

export class TeachingCourseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty({ type: LocalizedTextDto })
  name: LocalizedText;
}

export class TeachingClassDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty({ type: LocalizedTextDto })
  name: LocalizedText;

  @ApiProperty({ enum: ClassStatus })
  status: ClassStatus;

  @ApiProperty({ type: () => TeachingCourseDto })
  course: TeachingCourseDto;
}

export class TeachingEnrollmentDto {
  @ApiProperty({ format: 'uuid' })
  enrollmentId: string;

  @ApiProperty({ enum: EnrollmentStatus })
  enrollmentStatus: EnrollmentStatus;

  @ApiProperty({ type: () => TeachingClassDto })
  class: TeachingClassDto;
}

/** The student with contact fields (the teacher of their class sees them). */
export class TeachingStudentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  fullName: string;

  @ApiProperty({ type: String, nullable: true })
  displayName: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  email: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone: string | null;
}

/** Attendance counts over the lessons that have records; `rate` = (present + late) ÷ (present + late + absent), whole percent. */
export class TeachingAttendanceCountsDto {
  @ApiProperty({ type: 'integer' })
  present: number;

  @ApiProperty({ type: 'integer' })
  late: number;

  @ApiProperty({ type: 'integer' })
  absent: number;

  @ApiProperty({ type: 'integer' })
  excused: number;

  @ApiProperty({ type: 'integer', nullable: true, description: 'Whole percent; null before any present, late or absent record' })
  rate: number | null;
}

export class TeachingStudentListItemDto {
  @ApiProperty({ type: () => TeachingStudentDto })
  student: TeachingStudentDto;

  @ApiProperty({ type: () => [TeachingEnrollmentDto], description: 'The caller’s classes this student is in (matching the filters)' })
  classes: TeachingEnrollmentDto[];

  @ApiProperty({ type: () => TeachingAttendanceCountsDto, nullable: true, description: 'Across those classes; null without `attendance.read`' })
  attendance: TeachingAttendanceCountsDto | null;
}

export class TeachingStudentListDto {
  @ApiProperty({ type: () => [TeachingStudentListItemDto] })
  items: TeachingStudentListItemDto[];

  @ApiProperty({ description: `True when more than the cap matched (the list shows the first by name)` })
  truncated: boolean;
}

export class TeachingGuardianDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  fullName: string;

  @ApiProperty({ type: String, nullable: true })
  displayName: string | null;

  @ApiProperty({ enum: GuardianRelationship })
  relationship: GuardianRelationship;

  @ApiProperty()
  isPrimary: boolean;

  @ApiProperty({ type: String, nullable: true })
  email: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone: string | null;
}

export class TeachingLessonAttendanceDto {
  @ApiProperty({ format: 'uuid' })
  lessonId: string;

  @ApiProperty({ type: LocalizedTextDto })
  title: LocalizedText;

  @ApiProperty({ format: 'date-time' })
  startsAt: string;

  @ApiProperty({ enum: LessonStatus })
  lessonStatus: LessonStatus;

  @ApiProperty({ enum: ATTENDANCE_STATUSES, nullable: true, description: 'Null = not recorded' })
  status: AttendanceStatus | null;

  @ApiProperty({ type: 'integer', nullable: true })
  minutesLate: number | null;
}

export class TeachingClassAttendanceDto extends TeachingAttendanceCountsDto {
  @ApiProperty({ type: () => [TeachingLessonAttendanceDto], description: 'The class’s lessons that have started (not cancelled), newest first' })
  lessons: TeachingLessonAttendanceDto[];
}

/** The student’s row of the class gradebook (API-126) — the same numbers, never recomputed here. */
export class TeachingClassGradesDto {
  @ApiProperty({ type: () => [GradebookComponentDto] })
  components: GradebookComponentDto[];

  @ApiProperty({ type: () => [GradebookCellDto] })
  cells: GradebookCellDto[];

  @ApiProperty({ type: Number, nullable: true })
  current: number | null;

  @ApiProperty({ type: Number, nullable: true })
  projected: number | null;

  @ApiProperty({ type: () => FinalGradeDto, nullable: true })
  final: FinalGradeDto | null;
}

export class TeachingStudentClassDto extends TeachingEnrollmentDto {
  @ApiProperty({ type: () => TeachingClassAttendanceDto, nullable: true, description: 'Null without `attendance.read`' })
  attendance: TeachingClassAttendanceDto | null;

  @ApiProperty({ type: () => TeachingClassGradesDto, nullable: true, description: 'Null without `grades.read_all`, or when the gradebook does not list the student' })
  grades: TeachingClassGradesDto | null;
}

export class TeachingStudentDetailDto {
  @ApiProperty({ type: () => TeachingStudentDto })
  student: TeachingStudentDto;

  @ApiProperty({ type: () => [TeachingGuardianDto] })
  guardians: TeachingGuardianDto[];

  @ApiProperty({ type: () => [TeachingStudentClassDto], description: 'Each class the caller teaches that the student is (or was) in' })
  classes: TeachingStudentClassDto[];
}
