import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import { MyClassStudentDto } from '../enrollments/my-classes.dto.js';
import type { MyClassRelation } from '../enrollments/my-classes.policy.js';
import { EnrollmentStatus, SubmissionStatus } from '../generated/prisma/client.js';
import { IsInstant } from '../lessons/lessons.time.js';
import { TimetableClassDto } from '../schedule/timetable.dto.js';
import { ASSIGNMENTS_PAGE_DEFAULT, ASSIGNMENTS_PAGE_MAX, AssignmentLessonDto } from './assignments.dto.js';
import { MY_ASSIGNMENT_STATUSES } from './my-assignments.policy.js';
import type { MyAssignmentStatus } from './my-assignments.policy.js';
import { SUBMIT_BLOCKERS } from './submissions.policy.js';
import type { SubmitBlocker } from './submissions.policy.js';

const RELATIONS: MyClassRelation[] = ['self', 'child'];
const SUBMISSION_STATUSES = Object.values(SubmissionStatus) as SubmissionStatus[];
const OWNED_ENROLLMENT_STATUSES: EnrollmentStatus[] = ['active', 'completed'];

/** Query booleans: `"true"`/`"1"` and `"false"`/`"0"`; anything else is left for @IsBoolean to reject (no implicit `Boolean("false")`). */
function booleanParam({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  const value = obj[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}

/** Filters of «my assignments»; the page is keyset-paginated on `(due_at NULLS LAST, id)` like API-102. */
export class ListMyAssignmentsQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Assignments of this class only (a class the caller does not own matches nothing)' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Assignments owned through this student only — the caller or one of their linked children (anyone else matches nothing)' })
  @IsOptional()
  @IsUUID('all')
  studentId?: string;

  @ApiPropertyOptional({ enum: MY_ASSIGNMENT_STATUSES, description: 'Only open or only closed assignments (drafts are never listed)' })
  @IsOptional()
  @IsIn(MY_ASSIGNMENT_STATUSES)
  status?: MyAssignmentStatus;

  @ApiPropertyOptional({ description: 'true: only the items waiting for the student — no attempt yet, or the latest attempt returned for rework with an attempt left (MOD-08-T07); false or absent: every item' })
  @IsOptional()
  @Transform(booleanParam)
  @IsBoolean()
  pending?: boolean;

  @ApiPropertyOptional({ example: '2026-11-01T00:00:00+03:00', description: 'Assignments due at or after this instant (ISO 8601 with an offset); undated ones never match' })
  @IsOptional()
  @IsInstant()
  dueFrom?: string;

  @ApiPropertyOptional({ example: '2026-11-30T23:59:59+03:00', description: 'Assignments due at or before this instant (ISO 8601 with an offset); undated ones never match' })
  @IsOptional()
  @IsInstant()
  dueTo?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc', description: 'By due date (undated last), then id' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: SortOrder;

  @ApiPropertyOptional({ default: ASSIGNMENTS_PAGE_DEFAULT, minimum: 1, maximum: ASSIGNMENTS_PAGE_MAX, description: 'Assignments per page (an assignment owned through two children yields two items)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ASSIGNMENTS_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 512, description: 'Opaque `nextCursor` of the previous page; send it with the same filters and order' })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** The student's latest attempt: its review, never the reviewer or anyone else's attempt (the answer is read through API-110). */
export class MyAssignmentLatestDto {
  @ApiProperty({ format: 'uuid', description: 'Read the answer through GET /api/submissions/:id' })
  id: string;

  @ApiProperty({ example: 1 })
  attemptNo: number;

  @ApiProperty({ description: 'ISO 8601' })
  submittedAt: string;

  @ApiProperty()
  isLate: boolean;

  @ApiProperty({ enum: SUBMISSION_STATUSES })
  status: SubmissionStatus;

  @ApiProperty({ type: Number, nullable: true, description: 'With `graded` only' })
  score: number | null;

  @ApiProperty({ type: String, nullable: true, description: 'The teacher’s feedback to the student' })
  feedback: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 — the last review, or null' })
  gradedAt: string | null;
}

export class MyAssignmentItemDto {
  @ApiProperty({ format: 'uuid', description: 'The assignment (repeated when the caller owns it through several students)' })
  id: string;

  @ApiProperty({ description: 'Localized title `{ ar, en?, tr? }`' })
  title: LocalizedText;

  @ApiProperty({ type: Object, nullable: true, description: 'Localized instructions or null' })
  instructions: LocalizedText | null;

  @ApiProperty({ enum: MY_ASSIGNMENT_STATUSES })
  status: MyAssignmentStatus;

  @ApiProperty({ example: 20 })
  maxScore: number;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 (UTC) or null' })
  dueAt: string | null;

  @ApiProperty({ example: 'Europe/Istanbul', description: 'IANA time zone to display the due date in: the linked lesson’s room branch, else the academy’s (D-R41)' })
  timeZone: string;

  @ApiProperty()
  allowLate: boolean;

  @ApiProperty({ type: Number, nullable: true })
  latePenaltyPercent: number | null;

  @ApiProperty({ example: 1 })
  maxAttempts: number;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601' })
  publishedAt: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 or null' })
  closedAt: string | null;

  @ApiProperty({ type: AssignmentLessonDto, nullable: true })
  lesson: AssignmentLessonDto | null;

  @ApiProperty({ type: TimetableClassDto, description: 'The class with its course' })
  class: TimetableClassDto;

  @ApiProperty({ enum: RELATIONS, description: '`self` = the caller is enrolled in the class; `child` = a student linked to the caller as guardian is' })
  relation: MyClassRelation;

  @ApiProperty({ type: MyClassStudentDto, description: 'The enrolled student the item is about (identity only)' })
  student: MyClassStudentDto;

  @ApiProperty({ example: 1, description: 'That student’s attempts' })
  attempts: number;

  @ApiProperty({ example: 1, description: 'maxAttempts plus one per returned attempt (D-R39)' })
  attemptsAllowed: number;

  @ApiProperty({ type: MyAssignmentLatestDto, nullable: true, description: 'That student’s latest attempt; null before the first submission' })
  latest: MyAssignmentLatestDto | null;

  @ApiProperty({ enum: OWNED_ENROLLMENT_STATUSES, description: 'MOD-08-T07: that student’s enrollment in the class — only `active` submits' })
  enrollmentStatus: EnrollmentStatus;

  @ApiProperty({
    enum: SUBMIT_BLOCKERS,
    nullable: true,
    description: 'MOD-08-T07: why that student could not submit now, in the order API-109 checks (`not_enrolled` → `not_published`/`closed`/`past_due` → `attempts_exhausted`); null = a submission now would be accepted. Computed at the server’s clock when the page is read',
  })
  submitBlocker: SubmitBlocker | null;

  @ApiProperty({ description: 'MOD-08-T07: a submission now would be accepted and marked late (false whenever `submitBlocker` is set)' })
  submitsLate: boolean;
}

export class MyAssignmentListDto {
  @ApiProperty({ type: [MyAssignmentItemDto], description: 'By due date (undated last), then id; inside one assignment `self` before `child`, then the student’s id' })
  items: MyAssignmentItemDto[];

  @ApiProperty({ nullable: true, description: 'Cursor of the next page; null on the last page' })
  nextCursor: string | null;
}
