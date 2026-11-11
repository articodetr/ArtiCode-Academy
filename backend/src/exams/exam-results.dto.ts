import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Length, Max, Min, Validate, ValidateNested, ValidatorConstraint } from 'class-validator';
import { IsDecimalNumber } from '../common/decimal-number.js';
import type { ValidationArguments, ValidatorConstraintInterface } from 'class-validator';
import { EnrollmentStudentDto } from '../enrollments/enrollments.dto.js';
import { EnrollmentStatus, ExamResultStatus, ExamStatus } from '../generated/prisma/client.js';
import { textParam } from '../users/users.validation.js';
import { EXAM_SCORE_LIMIT } from './exams.dto.js';

/** At most this many results per request (a class is far smaller; the 1 MB route limit covers it — app.setup.ts LARGE_JSON_ROUTES). */
export const RESULTS_BATCH_MAX = 500;
export const RESULT_FEEDBACK_MAX_LENGTH = 500;
const RESULT_STATUSES = Object.values(ExamResultStatus) as ExamResultStatus[];
const ENROLLMENT_STATUSES = Object.values(EnrollmentStatus) as EnrollmentStatus[];
const EXAM_STATUSES = Object.values(ExamStatus) as ExamStatus[];

/** Body numbers must be JSON numbers: no implicit "12" → 12. */
function rawValue({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  return obj[key];
}

/** `score` goes with `scored` (required) and never with `absent` or `excused`. */
@ValidatorConstraint({ name: 'scoreMatchesResultStatus' })
class ScoreMatchesStatus implements ValidatorConstraintInterface {
  validate(status: unknown, args: ValidationArguments): boolean {
    const score = (args.object as { score?: unknown }).score;
    if (status === 'scored') return score !== undefined && score !== null;
    return score === undefined || score === null;
  }

  defaultMessage(): string {
    return 'score is required with status scored and not allowed with absent or excused';
  }
}

/** One result: the WHOLE new state of that student's result (an absent feedback clears it). */
export class ExamResultInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  studentId: string;

  @ApiProperty({ enum: RESULT_STATUSES, description: '`scored` with a score; `absent` counts 0 in the final grade; `excused` is left out of it (D-R45)' })
  @IsIn(RESULT_STATUSES)
  @Validate(ScoreMatchesStatus)
  status: ExamResultStatus;

  @ApiPropertyOptional({ minimum: 0, maximum: EXAM_SCORE_LIMIT, example: 41.5, description: 'Required with `scored`, refused otherwise; a JSON number with at most two decimals, at most the exam’s maxScore (`score_out_of_range`)' })
  @IsOptional()
  @Transform(rawValue)
  @IsDecimalNumber(2)
  @Min(0)
  @Max(EXAM_SCORE_LIMIT)
  score?: number | null;

  @ApiPropertyOptional({ maxLength: RESULT_FEEDBACK_MAX_LENGTH, description: 'The teacher’s feedback, shown to the student once the results are published; trimmed, blank = none' })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, RESULT_FEEDBACK_MAX_LENGTH)
  feedback?: string;
}

/** API-120: results of some or all students; unmentioned students are never touched. */
export class RecordExamResultsDto {
  @ApiProperty({ type: [ExamResultInputDto], minItems: 1, maxItems: RESULTS_BATCH_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(RESULTS_BATCH_MAX)
  @ValidateNested({ each: true })
  @Type(() => ExamResultInputDto)
  results: ExamResultInputDto[];
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class ResultRecorderDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  fullName: string;
}

export class ExamResultDto {
  @ApiProperty({ enum: RESULT_STATUSES })
  status: ExamResultStatus;

  @ApiProperty({ type: Number, nullable: true, description: 'With `scored` only' })
  score: number | null;

  @ApiProperty({ type: String, nullable: true })
  feedback: string | null;

  @ApiProperty({ type: ResultRecorderDto, nullable: true, description: 'The last writer (null when that account was deleted)' })
  recordedBy: ResultRecorderDto | null;

  @ApiProperty({ description: 'ISO 8601 — first recorded' })
  recordedAt: string;

  @ApiProperty({ description: 'ISO 8601 — last changed' })
  updatedAt: string;
}

export class ExamResultItemDto {
  @ApiProperty({ type: EnrollmentStudentDto, description: 'The student in the caller’s projection (D-R07)' })
  student: EnrollmentStudentDto;

  @ApiProperty({ enum: ENROLLMENT_STATUSES, nullable: true, description: 'The student’s enrollment in the class; a withdrawn student stays listed while they hold a result' })
  enrollmentStatus: EnrollmentStatus | null;

  @ApiProperty({ type: ExamResultDto, nullable: true })
  result: ExamResultDto | null;
}

export class ExamResultCountsSheetDto {
  @ApiProperty({ example: 14 })
  students: number;

  @ApiProperty({ example: 12 })
  scored: number;

  @ApiProperty({ example: 1 })
  absent: number;

  @ApiProperty({ example: 1 })
  excused: number;
}

export class ExamResultsSheetDto {
  @ApiProperty({ format: 'uuid' })
  examId: string;

  @ApiProperty({ format: 'uuid' })
  classId: string;

  @ApiProperty({ enum: EXAM_STATUSES })
  examStatus: ExamStatus;

  @ApiProperty({ example: 50 })
  maxScore: number;

  @ApiProperty({ description: 'True when the exam takes results now' })
  recordable: boolean;

  @ApiProperty({ type: String, nullable: true, enum: ['class_cancelled', 'not_scheduled'], description: 'Why it does not' })
  closedReason: 'class_cancelled' | 'not_scheduled' | null;

  @ApiProperty({ type: ExamResultCountsSheetDto })
  counts: ExamResultCountsSheetDto;

  @ApiProperty({ type: [ExamResultItemDto], description: 'Every student with an active or completed enrollment, plus anyone holding a result, in enrollment order' })
  items: ExamResultItemDto[];
}
