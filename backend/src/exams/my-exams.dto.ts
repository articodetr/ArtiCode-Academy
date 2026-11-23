import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { AssignmentInstructionsDto, AssignmentLessonDto } from '../assignments/assignments.dto.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import { MyClassStudentDto } from '../enrollments/my-classes.dto.js';
import type { MyClassRelation } from '../enrollments/my-classes.policy.js';
import { ExamResultStatus, ExamType } from '../generated/prisma/client.js';
import { IsInstant } from '../lessons/lessons.time.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { TimetableClassDto } from '../schedule/timetable.dto.js';
import { TAKE_BLOCKERS } from './attempts.policy.js';
import type { TakeBlocker } from './attempts.policy.js';
import { EXAMS_PAGE_DEFAULT, EXAMS_PAGE_MAX } from './exams.dto.js';
import { EXAM_DELIVERIES, EXAM_RESULTS_RELEASES } from './exams.online.js';
import type { ExamDeliveryValue, ExamResultsReleaseValue } from './exams.online.js';
import { AttemptSummaryDto } from './my-attempts.dto.js';
import { MY_EXAM_STATUSES } from './my-exams.policy.js';
import type { MyExamStatus } from './my-exams.policy.js';

const RELATIONS: MyClassRelation[] = ['self', 'child'];
const RESULT_STATUSES = Object.values(ExamResultStatus) as ExamResultStatus[];
const EXAM_TYPES = Object.values(ExamType) as ExamType[];

/** Filters of «my exams»; the page is keyset-paginated on `(scheduled_at NULLS LAST, id)` like API-113. */
export class ListMyExamsQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Exams of this class only (a class the caller does not own matches nothing)' })
  @IsOptional()
  @IsUUID('all')
  classId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Exams owned through this student only — the caller or one of their linked children' })
  @IsOptional()
  @IsUUID('all')
  studentId?: string;

  @ApiPropertyOptional({ enum: MY_EXAM_STATUSES, description: 'Only scheduled or only published exams (drafts are never listed)' })
  @IsOptional()
  @IsIn(MY_EXAM_STATUSES)
  status?: MyExamStatus;

  @ApiPropertyOptional({ example: '2026-11-01T00:00:00+03:00', description: 'Exams taking place at or after this instant (ISO 8601 with an offset); undated ones never match' })
  @IsOptional()
  @IsInstant()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30T23:59:59+03:00', description: 'Exams taking place at or before this instant (ISO 8601 with an offset); undated ones never match' })
  @IsOptional()
  @IsInstant()
  to?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc', description: 'By exam date (undated last), then id' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: SortOrder;

  @ApiPropertyOptional({ default: EXAMS_PAGE_DEFAULT, minimum: 1, maximum: EXAMS_PAGE_MAX, description: 'Exams per page (an exam owned through two children yields two items)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(EXAMS_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;
}

export class MyExamResultDto {
  @ApiProperty({ enum: RESULT_STATUSES })
  status: ExamResultStatus;

  @ApiProperty({ type: Number, nullable: true })
  score: number | null;

  @ApiProperty({ type: String, nullable: true, description: 'The teacher’s feedback to the student' })
  feedback: string | null;
}

export class MyExamInProgressDto {
  @ApiProperty({ format: 'uuid', description: 'The attempt to resume (`GET /api/me/exam-attempts/:id`)' })
  id: string;

  @ApiProperty({ example: 1 })
  attemptNo: number;

  @ApiProperty({ description: 'ISO 8601 — the server’s deadline' })
  expiresAt: string;

  @ApiProperty({ example: 1260, description: 'Whole seconds left at `serverNow`' })
  remainingSeconds: number;
}

/** The online side of an exam for one student, computed at the server clock. */
export class MyExamOnlineDto {
  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 (UTC) — when the window closes (`scheduledAt` is when it opens)' })
  closesAt: string | null;

  @ApiProperty({ example: 2 })
  attemptsAllowed: number;

  @ApiProperty({ example: 1, description: 'Attempts the student has started, whatever their state' })
  attemptsUsed: number;

  @ApiProperty({ example: 5 })
  questionCount: number;

  @ApiProperty({ enum: EXAM_RESULTS_RELEASES, description: '`on_submit`: the score shows as soon as an attempt is finished; `on_publish`: once the teacher publishes the results' })
  resultsRelease: ExamResultsReleaseValue;

  @ApiProperty({ description: 'Whether the correct answers are shown with the released result once the window has closed' })
  revealAnswers: boolean;

  @ApiProperty({ description: 'True when the student may start a new attempt or resume the one in progress now (`POST /api/me/exams/:id/attempts`); always false on a `child` item' })
  canStart: boolean;

  @ApiProperty({
    type: String,
    enum: TAKE_BLOCKERS,
    nullable: true,
    description:
      'Why not, in this order: `not_self` (a guardian’s item) · `not_permitted` (no `exams.take`) · `results_published` · `not_enrolled` (the enrollment is not `active`) · `class_closed` · `not_open_yet` · `closed` · `attempts_exhausted`',
  })
  blocker: TakeBlocker | null;

  @ApiProperty({ type: () => MyExamInProgressDto, nullable: true, description: 'The attempt in progress whose deadline has not passed' })
  inProgress: MyExamInProgressDto | null;

  @ApiProperty({ type: [AttemptSummaryDto], description: 'The student’s attempts in order; a score only once the result is released (D-R156)' })
  attempts: AttemptSummaryDto[];

  @ApiProperty({ description: 'ISO 8601 — the server clock this state was computed at' })
  serverNow: string;
}

export class MyExamItemDto {
  @ApiProperty({ format: 'uuid', description: 'The exam (repeated when the caller owns it through several students)' })
  id: string;

  @ApiProperty({ type: () => LocalizedTextDto, description: 'Localized title `{ ar, en?, tr? }`' })
  title: LocalizedText;

  @ApiProperty({ type: () => AssignmentInstructionsDto, nullable: true })
  description: LocalizedText | null;

  @ApiProperty({ enum: EXAM_TYPES })
  type: ExamType;

  @ApiProperty({ enum: MY_EXAM_STATUSES, description: '`scheduled`: announced — an online exam is taken inside its window; `published`: the results are out' })
  status: MyExamStatus;

  @ApiProperty({ enum: EXAM_DELIVERIES, description: '`manual`: the teacher records the results; `online`: taken on the platform and graded by the server' })
  delivery: ExamDeliveryValue;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 (UTC)' })
  scheduledAt: string | null;

  @ApiProperty({ type: Number, nullable: true })
  durationMinutes: number | null;

  @ApiProperty({ example: 'Europe/Istanbul', description: 'IANA time zone to display the date in (D-R41)' })
  timeZone: string;

  @ApiProperty({ example: 50 })
  maxScore: number;

  @ApiProperty({ type: Number, nullable: true })
  passScore: number | null;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 — when the results were published' })
  publishedAt: string | null;

  @ApiProperty({ type: AssignmentLessonDto, nullable: true })
  lesson: AssignmentLessonDto | null;

  @ApiProperty({ type: TimetableClassDto })
  class: TimetableClassDto;

  @ApiProperty({ enum: RELATIONS })
  relation: MyClassRelation;

  @ApiProperty({ type: MyClassStudentDto, description: 'The enrolled student the item is about (identity only)' })
  student: MyClassStudentDto;

  @ApiProperty({
    type: MyExamResultDto,
    nullable: true,
    description: 'That student’s own result once it is released — the results are published, or the exam is online and releases on submit (D-R156); null before, or without a result',
  })
  result: MyExamResultDto | null;

  @ApiProperty({ type: () => MyExamOnlineDto, nullable: true, description: 'The online side of the exam for this student; null for a manual exam' })
  online: MyExamOnlineDto | null;
}

export class MyExamListDto {
  @ApiProperty({ type: [MyExamItemDto], description: 'By exam date (undated last), then id; inside one exam `self` before `child`, then the student’s id' })
  items: MyExamItemDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor: string | null;
}
