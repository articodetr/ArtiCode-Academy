import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { AssignmentLessonDto } from '../assignments/assignments.dto.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import { MyClassStudentDto } from '../enrollments/my-classes.dto.js';
import type { MyClassRelation } from '../enrollments/my-classes.policy.js';
import { ExamResultStatus, ExamType } from '../generated/prisma/client.js';
import { IsInstant } from '../lessons/lessons.time.js';
import { TimetableClassDto } from '../schedule/timetable.dto.js';
import { EXAMS_PAGE_DEFAULT, EXAMS_PAGE_MAX } from './exams.dto.js';
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

export class MyExamItemDto {
  @ApiProperty({ format: 'uuid', description: 'The exam (repeated when the caller owns it through several students)' })
  id: string;

  @ApiProperty({ description: 'Localized title `{ ar, en?, tr? }`' })
  title: LocalizedText;

  @ApiProperty({ type: Object, nullable: true })
  description: LocalizedText | null;

  @ApiProperty({ enum: EXAM_TYPES })
  type: ExamType;

  @ApiProperty({ enum: MY_EXAM_STATUSES, description: '`scheduled`: announced; `published`: the results are out' })
  status: MyExamStatus;

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

  @ApiProperty({ type: MyExamResultDto, nullable: true, description: 'That student’s own result once the results are published; null before, or without a result' })
  result: MyExamResultDto | null;
}

export class MyExamListDto {
  @ApiProperty({ type: [MyExamItemDto], description: 'By exam date (undated last), then id; inside one exam `self` before `child`, then the student’s id' })
  items: MyExamItemDto[];

  @ApiProperty({ nullable: true })
  nextCursor: string | null;
}
