import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, Min, Validate, ValidateIf, ValidatorConstraint } from 'class-validator';
import { IsDecimalNumber } from '../common/decimal-number.js';
import type { ValidationArguments, ValidatorConstraintInterface } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { EnrollmentStudentDto } from '../enrollments/enrollments.dto.js';
import { MyClassStudentDto, MyClassTeacherDto } from '../enrollments/my-classes.dto.js';
import { AssignmentStatus, EnrollmentStatus, SubmissionStatus } from '../generated/prisma/client.js';
import { nullableTextParam, textParam } from '../users/users.validation.js';
import { REVIEW_ACTIONS } from './submissions.policy.js';
import type { ReviewAction } from './submissions.policy.js';

export const TEXT_ANSWER_MAX_LENGTH = 20000;
export const LINK_URL_MAX_LENGTH = 2048;
export const FEEDBACK_MAX_LENGTH = 2000;
/** `https://` and no whitespace (CHECK `ck_assignment_submissions_link_url_https` is the backstop). */
export const LINK_URL_PATTERN = /^https:\/\/\S+$/;
const SUBMISSION_STATUSES = Object.values(SubmissionStatus) as SubmissionStatus[];
const ASSIGNMENT_STATUSES = Object.values(AssignmentStatus) as AssignmentStatus[];
const ENROLLMENT_STATUSES = Object.values(EnrollmentStatus) as EnrollmentStatus[];

/** Body numbers must be JSON numbers: no implicit "12" → 12. */
function rawValue({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  return obj[key];
}

/** `score` goes with `grade` (required) and never with `return`. */
@ValidatorConstraint({ name: 'scoreMatchesAction' })
class ScoreMatchesAction implements ValidatorConstraintInterface {
  validate(action: unknown, args: ValidationArguments): boolean {
    const score = (args.object as { score?: unknown }).score;
    if (action === 'grade') return score !== undefined && score !== null;
    return score === undefined;
  }

  defaultMessage(): string {
    return 'score is required with action grade and not allowed with action return';
  }
}

/** API-109: one attempt — text and/or an https link (D-R35); `submission_invalid` without either. */
export class SubmitAssignmentDto {
  @ApiPropertyOptional({ maxLength: TEXT_ANSWER_MAX_LENGTH, description: 'The answer as text; trimmed, blank = absent' })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, TEXT_ANSWER_MAX_LENGTH)
  textAnswer?: string;

  @ApiPropertyOptional({ maxLength: LINK_URL_MAX_LENGTH, example: 'https://docs.example.com/my-answer', description: '`https://` only; trimmed, blank = absent' })
  @IsOptional()
  @Transform(nullableTextParam)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @Length(1, LINK_URL_MAX_LENGTH)
  @Matches(LINK_URL_PATTERN, { message: 'linkUrl must be an https:// link without spaces' })
  linkUrl?: string | null;

  @ApiPropertyOptional({
    minimum: 1,
    example: 1,
    description: 'MOD-08-T07: the attempt the client means to create (its `attempts` + 1). Another number is `409 attempt_conflict { expected, next }` and writes nothing — a retried request whose first try already created the attempt does not use another one. A JSON integer; absent = no check',
  })
  @IsOptional()
  @Transform(rawValue)
  @IsInt()
  @Min(1)
  @Max(32767)
  attemptNo?: number;
}

/** API-111: the whole new review state of the submission (D-R39). */
export class ReviewSubmissionDto {
  @ApiProperty({ enum: REVIEW_ACTIONS, description: '`grade`: graded with `score` (0..maxScore — `score_out_of_range`) and optional feedback, repeatable · `return`: returned for rework with feedback (`feedback_required`), grants one more attempt' })
  @IsIn(REVIEW_ACTIONS)
  @Validate(ScoreMatchesAction)
  action: ReviewAction;

  @ApiPropertyOptional({ minimum: 0, example: 17.5, description: 'Required with `grade`, refused with `return`; a JSON number with at most two decimals' })
  @IsOptional()
  @Transform(rawValue)
  @IsDecimalNumber(2)
  score?: number;

  @ApiPropertyOptional({ maxLength: FEEDBACK_MAX_LENGTH, description: 'Required with `return`; with `grade` it replaces the previous feedback (absent clears it); trimmed, blank = absent' })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, FEEDBACK_MAX_LENGTH)
  feedback?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '2026-11-10T16:40:12.345Z',
    description: 'MOD-08-T07: the `gradedAt` the reviewer saw (ISO 8601), or null when they saw no review yet. Another review written meanwhile is `409 review_conflict { submissionId, status, gradedAt }` and writes nothing; absent = no check',
  })
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== undefined && value !== null)
  @IsString()
  @IsISO8601({ strict: true, strictSeparator: true })
  expectedGradedAt?: string | null;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class SubmissionAssignmentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  classId: string;

  @ApiProperty({ description: 'Localized title `{ ar, en?, tr? }`' })
  title: LocalizedText;

  @ApiProperty({ enum: ASSIGNMENT_STATUSES })
  status: AssignmentStatus;

  @ApiProperty({ example: 20 })
  maxScore: number;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 (UTC) or null' })
  dueAt: string | null;

  @ApiProperty({ description: 'Late submissions are taken after the due date (MOD-08-T07)' })
  allowLate: boolean;

  @ApiProperty({ example: 'Europe/Istanbul', description: 'IANA time zone to display the due date in: the linked lesson’s room branch, else the academy’s (D-R41; MOD-08-T07)' })
  timeZone: string;
}

/** An attempt in the roster and in a submission’s history (no answer text — read it through API-110). */
export class SubmissionSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 1 })
  attemptNo: number;

  @ApiProperty({ description: 'ISO 8601' })
  submittedAt: string;

  @ApiProperty()
  isLate: boolean;

  @ApiProperty({ enum: SUBMISSION_STATUSES })
  status: SubmissionStatus;

  @ApiProperty({ type: Number, nullable: true })
  score: number | null;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 or null' })
  gradedAt: string | null;
}

/** One attempt (API-109/110/111): what its student, their guardian and the class's teachers may know. */
export class SubmissionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: SubmissionAssignmentDto })
  assignment: SubmissionAssignmentDto;

  @ApiProperty({ type: MyClassStudentDto, description: 'The student, identity only' })
  student: MyClassStudentDto;

  @ApiProperty({ example: 1 })
  attemptNo: number;

  @ApiProperty({ description: 'ISO 8601' })
  submittedAt: string;

  @ApiProperty({ description: 'Submitted after the due date under allowLate' })
  isLate: boolean;

  @ApiProperty({ type: String, nullable: true })
  textAnswer: string | null;

  @ApiProperty({ type: String, nullable: true })
  linkUrl: string | null;

  @ApiProperty({ enum: SUBMISSION_STATUSES })
  status: SubmissionStatus;

  @ApiProperty({ type: Number, nullable: true, description: 'With `graded` only' })
  score: number | null;

  @ApiProperty({ type: String, nullable: true })
  feedback: string | null;

  @ApiProperty({ type: MyClassTeacherDto, nullable: true, description: 'Who reviewed it, by name only (null before a review or when that account was deleted)' })
  gradedBy: MyClassTeacherDto | null;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 — the last review (graded or returned)' })
  gradedAt: string | null;

  @ApiProperty({ example: 1, description: 'The student’s attempts on this assignment' })
  attempts: number;

  @ApiProperty({ example: 2, description: 'maxAttempts plus one per returned attempt (D-R39)' })
  attemptsAllowed: number;

  @ApiProperty({ type: [SubmissionSummaryDto], description: 'MOD-08-T07: every attempt of this student on this assignment, in attempt order (this one included), without the answers — read each through API-110' })
  history: SubmissionSummaryDto[];
}

export class SubmissionRosterItemDto {
  @ApiProperty({ type: EnrollmentStudentDto, description: 'The student in the caller’s projection (`email`/`username`/`phone` need `users.read_contact` — D-R07)' })
  student: EnrollmentStudentDto;

  @ApiProperty({ enum: ENROLLMENT_STATUSES, nullable: true, description: 'The student’s enrollment in the class; a withdrawn student stays listed while they hold a submission' })
  enrollmentStatus: EnrollmentStatus | null;

  @ApiProperty({ example: 1 })
  attempts: number;

  @ApiProperty({ example: 2 })
  attemptsAllowed: number;

  @ApiProperty({ type: SubmissionSummaryDto, nullable: true, description: 'The latest attempt; null when the student has not submitted' })
  latest: SubmissionSummaryDto | null;

  @ApiProperty({ type: Number, nullable: true, description: 'The score of the latest graded attempt (what MOD-09 will read — D-R36)' })
  lastGradedScore: number | null;
}

/** The submission roster of an assignment (API-108). */
export class SubmissionRosterDto {
  @ApiProperty({ type: SubmissionAssignmentDto })
  assignment: SubmissionAssignmentDto;

  @ApiProperty({ example: 2 })
  maxAttempts: number;

  @ApiProperty({ type: [SubmissionRosterItemDto], description: 'Every student with an active or completed enrollment, plus anyone holding a submission, in enrollment order' })
  items: SubmissionRosterItemDto[];
}
