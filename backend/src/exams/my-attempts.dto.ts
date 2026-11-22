import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDefined, IsInt, IsObject, IsOptional, IsUUID, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { AssignmentInstructionsDto } from '../assignments/assignments.dto.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { ExamAttemptStatus, ExamType } from '../generated/prisma/client.js';
import { OptionTextDto, QuestionTextDto } from '../questions/questions.dto.js';
import { QUESTION_TYPES } from '../questions/questions.rules.js';
import type { QuestionTypeValue } from '../questions/questions.rules.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { TimetableClassDto } from '../schedule/timetable.dto.js';
import { EXAM_ATTEMPTS_MAX, EXAM_QUESTIONS_MAX, EXAM_RESULTS_RELEASES } from './exams.online.js';
import type { ExamResultsReleaseValue } from './exams.online.js';

const ATTEMPT_STATUSES = Object.values(ExamAttemptStatus) as ExamAttemptStatus[];
const EXAM_TYPES = Object.values(ExamType) as ExamType[];

/** Body numbers and booleans must be JSON numbers/booleans: no implicit "1" → 1 or "yes" → true. */
function rawValue({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  return obj[key];
}

export class StartAttemptDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: EXAM_ATTEMPTS_MAX,
    description:
      'The attempt the client means to start or resume (a JSON integer). When the server would give another number — the attempt was already finished, or another one started — the answer is `409 attempt_conflict { expected, next }` instead of a new attempt, so a repeated request never uses a second attempt',
  })
  // Absent, never null: a null is not «no number», and `IsOptional` would let it through as one.
  @ValidateIf((dto: StartAttemptDto) => dto.attemptNo !== undefined)
  @Transform(rawValue)
  @IsInt()
  @Min(1)
  @Max(EXAM_ATTEMPTS_MAX)
  attemptNo?: number;
}

export class AnswerEntryDto {
  @ApiProperty({ format: 'uuid', description: 'The question of the exam the answer is for (`questions[].id` of the attempt)' })
  @IsUUID('all')
  examQuestionId: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'The chosen option of a `single_choice` question' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  optionId?: string | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true, description: 'The answer to a `true_false` question (a JSON boolean)' })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsBoolean()
  value?: boolean | null;
}

/** The submit carries no body: a class without properties makes the validation pipe refuse any field sent with it. */
export class SubmitAttemptDto {}

/** One or more answers, each the whole new answer to its question; an entry with neither `optionId` nor `value` clears it. */
export class SaveAnswersDto {
  @ApiProperty({ type: [AnswerEntryDto], minItems: 1, maxItems: EXAM_QUESTIONS_MAX, description: 'No question twice' })
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(EXAM_QUESTIONS_MAX)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => AnswerEntryDto)
  answers: AnswerEntryDto[];
}

// ---------------------------------------------------------------------------
// Responses — what a learner may know. No key appears here before the exam releases it.
// ---------------------------------------------------------------------------

export class AttemptOptionDto {
  @ApiProperty({ format: 'uuid', description: 'What an answer names as `optionId`' })
  id: string;

  @ApiProperty({ type: () => OptionTextDto })
  text: LocalizedText;
}

export class AttemptAnswerDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  optionId: string | null;

  @ApiProperty({ type: Boolean, nullable: true })
  value: boolean | null;
}

/** The grading and the key of one question — only once the exam reveals answers, the result is released and the window has closed (D-R157). */
export class AttemptReviewDto {
  @ApiProperty({ description: 'False for a wrong answer and for a question left unanswered' })
  isCorrect: boolean;

  @ApiProperty({ example: 2 })
  pointsAwarded: number;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'The correct option of a `single_choice` question' })
  correctOptionId: string | null;

  @ApiProperty({ type: Boolean, nullable: true, description: 'The correct answer of a `true_false` question' })
  correctAnswer: boolean | null;

  @ApiProperty({ type: () => QuestionTextDto, nullable: true })
  explanation: LocalizedText | null;
}

export class AttemptQuestionDto {
  @ApiProperty({ format: 'uuid', description: 'The id an answer names as `examQuestionId`' })
  id: string;

  @ApiProperty({ example: 0 })
  sortOrder: number;

  @ApiProperty({ example: 2 })
  points: number;

  @ApiProperty({ enum: QUESTION_TYPES })
  type: QuestionTypeValue;

  @ApiProperty({ type: () => QuestionTextDto })
  prompt: LocalizedText;

  @ApiProperty({ type: [AttemptOptionDto], description: 'In display order, WITHOUT the key; empty for a `true_false` question' })
  options: AttemptOptionDto[];

  @ApiProperty({ type: () => AttemptAnswerDto, nullable: true, description: 'The learner’s saved answer; null while the question is unanswered' })
  answer: AttemptAnswerDto | null;

  @ApiProperty({ type: () => AttemptReviewDto, nullable: true, description: 'Null unless `reviewReleased`' })
  review: AttemptReviewDto | null;
}

export class AttemptExamDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  title: LocalizedText;

  @ApiProperty({ type: () => AssignmentInstructionsDto, nullable: true, description: 'The exam’s instructions' })
  description: LocalizedText | null;

  @ApiProperty({ enum: EXAM_TYPES })
  type: ExamType;

  @ApiProperty({ example: 10 })
  maxScore: number;

  @ApiProperty({ type: Number, nullable: true })
  passScore: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 30, description: 'Minutes one attempt may take' })
  durationMinutes: number | null;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 (UTC) — when the window opens' })
  scheduledAt: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 (UTC) — when the window closes' })
  closesAt: string | null;

  @ApiProperty({ example: 'Europe/Istanbul', description: 'IANA time zone to display the window in (D-R41)' })
  timeZone: string;

  @ApiProperty({ example: 1 })
  attemptsAllowed: number;

  @ApiProperty({ enum: EXAM_RESULTS_RELEASES })
  resultsRelease: ExamResultsReleaseValue;

  @ApiProperty()
  revealAnswers: boolean;

  @ApiProperty({ type: TimetableClassDto })
  class: TimetableClassDto;
}

export class AttemptResultDto {
  @ApiProperty({ example: 6 })
  score: number;

  @ApiProperty({ example: 10 })
  maxScore: number;

  @ApiProperty({ example: 3 })
  correctCount: number;

  @ApiProperty({ example: 5 })
  questionCount: number;

  @ApiProperty({ type: Boolean, nullable: true, description: 'Against the exam’s pass score; null when the exam names none' })
  isPass: boolean | null;

  @ApiProperty({ description: 'True when this attempt is the one that counts — the highest finished attempt, the earliest on a tie (D-R153)' })
  counted: boolean;
}

export class AttemptSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 1 })
  attemptNo: number;

  @ApiProperty({ enum: ATTEMPT_STATUSES })
  status: ExamAttemptStatus;

  @ApiProperty({ description: 'ISO 8601' })
  startedAt: string;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601; the deadline itself for an attempt the server closed' })
  submittedAt: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Null while in progress and until the result is released' })
  score: number | null;
}

export class MyAttemptDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 1 })
  attemptNo: number;

  @ApiProperty({ enum: ATTEMPT_STATUSES, description: '`in_progress` · `submitted` (by the learner) · `timed_out` (closed by the server at the deadline with what was saved)' })
  status: ExamAttemptStatus;

  @ApiProperty({ description: 'ISO 8601' })
  startedAt: string;

  @ApiProperty({ description: 'ISO 8601 — the server’s deadline, fixed at the start (D-R152)' })
  expiresAt: string;

  @ApiProperty({ type: String, nullable: true })
  submittedAt: string | null;

  @ApiProperty({ description: 'ISO 8601 — the server clock of this answer; the timer is `expiresAt` − `serverNow`, never the device clock' })
  serverNow: string;

  @ApiProperty({ example: 1740, description: 'Whole seconds left at `serverNow`; 0 once the deadline has passed or the attempt is finished' })
  remainingSeconds: number;

  @ApiProperty({ description: 'True when the attempt is still open on the server but its deadline has passed: submit it to see it closed' })
  timeUp: boolean;

  @ApiProperty({ example: 3 })
  answeredCount: number;

  @ApiProperty({ example: 5 })
  questionCount: number;

  @ApiProperty({ type: () => AttemptExamDto })
  exam: AttemptExamDto;

  @ApiProperty({ type: [AttemptQuestionDto], description: 'The frozen questions in the exam’s order, without their key' })
  questions: AttemptQuestionDto[];

  @ApiProperty({ description: 'True when the learner may see the score: the results are published, or the exam releases on submit (D-R156)' })
  resultReleased: boolean;

  @ApiProperty({ description: 'True when the learner may see the correct answers and explanations (D-R157)' })
  reviewReleased: boolean;

  @ApiProperty({ type: () => AttemptResultDto, nullable: true, description: 'Null while in progress and until `resultReleased`' })
  result: AttemptResultDto | null;

  @ApiProperty({ type: [AttemptSummaryDto], description: 'Every attempt of the learner at this exam, in order' })
  attempts: AttemptSummaryDto[];
}

export class SaveAnswersResultDto {
  @ApiProperty({ format: 'uuid' })
  attemptId: string;

  @ApiProperty({ example: 1, description: 'Answers written or cleared by this request' })
  saved: number;

  @ApiProperty({ example: 3 })
  answeredCount: number;

  @ApiProperty({ example: 5 })
  questionCount: number;

  @ApiProperty({ description: 'ISO 8601' })
  expiresAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  serverNow: string;

  @ApiProperty({ example: 1700 })
  remainingSeconds: number;
}
