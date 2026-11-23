import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { EnrollmentStudentDto } from '../enrollments/enrollments.dto.js';
import { EnrollmentStatus, ExamAttemptStatus, ExamResultStatus, ExamStatus } from '../generated/prisma/client.js';
import { OptionTextDto, QuestionTextDto } from '../questions/questions.dto.js';
import { QUESTION_TYPES } from '../questions/questions.rules.js';
import type { QuestionTypeValue } from '../questions/questions.rules.js';
import { textParam } from '../users/users.validation.js';
import { ExamQuestionItemDto } from './exam-questions.dto.js';
import { AttemptAnswerDto } from './my-attempts.dto.js';

const ATTEMPT_STATUSES = Object.values(ExamAttemptStatus) as ExamAttemptStatus[];
const ENROLLMENT_STATUSES = Object.values(EnrollmentStatus) as EnrollmentStatus[];
const RESULT_STATUSES = Object.values(ExamResultStatus) as ExamResultStatus[];
const EXAM_STATUSES = Object.values(ExamStatus) as ExamStatus[];
export const RESULT_SOURCES = ['manual', 'online'] as const;
export const EXAM_WINDOW_STATES = ['not_open', 'open', 'closed'] as const;
export const CORRECTION_REASON_MAX_LENGTH = 500;

/** Body booleans must be JSON booleans: no implicit "true" → true. */
function rawValue({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  return obj[key];
}

export class CorrectKeyDto {
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'The option that is really correct — one of the question’s own; for a `single_choice` question' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  correctOptionId?: string | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true, description: 'The answer that is really correct (a JSON boolean); for a `true_false` question' })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsBoolean()
  correctAnswer?: boolean | null;

  @ApiProperty({ minLength: 1, maxLength: CORRECTION_REASON_MAX_LENGTH, description: 'Why the key is corrected — kept with the question’s history and in the audit event; trimmed' })
  @Transform(textParam)
  @IsString()
  @Length(1, CORRECTION_REASON_MAX_LENGTH)
  reason: string;
}

export class RegradeExamDto {
  @ApiProperty({ minLength: 1, maxLength: CORRECTION_REASON_MAX_LENGTH, description: 'Why the attempts are graded again — recorded in the audit event; trimmed' })
  @Transform(textParam)
  @IsString()
  @Length(1, CORRECTION_REASON_MAX_LENGTH)
  reason: string;
}

export class RegradeSummaryDto {
  @ApiProperty({ example: 14, description: 'Finished attempts graded again' })
  attempts: number;

  @ApiProperty({ example: 3, description: 'Attempts whose grading changed' })
  changedAttempts: number;

  @ApiProperty({ example: 2, description: 'Students whose counted result changed' })
  changedResults: number;
}

export class KeyCorrectionResultDto {
  @ApiProperty({ description: 'False when the request named the key the question already had: nothing was written' })
  changed: boolean;

  @ApiProperty({ type: () => ExamQuestionItemDto, description: 'The question with its key after the correction' })
  question: ExamQuestionItemDto;

  @ApiProperty({ type: () => RegradeSummaryDto })
  regrade: RegradeSummaryDto;
}

export class ExamAttemptRowDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 1 })
  attemptNo: number;

  @ApiProperty({ enum: ATTEMPT_STATUSES })
  status: ExamAttemptStatus;

  @ApiProperty({ description: 'ISO 8601' })
  startedAt: string;

  @ApiProperty({ description: 'ISO 8601 — the server’s deadline' })
  expiresAt: string;

  @ApiProperty({ type: String, nullable: true })
  submittedAt: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Null while in progress' })
  score: number | null;

  @ApiProperty({ type: Number, nullable: true })
  correctCount: number | null;

  @ApiProperty({ description: 'True for the attempt that counts — the highest finished one (D-R153)' })
  counted: boolean;

  @ApiProperty({ description: 'True while the attempt is still open on the server but its deadline has passed: the server closes it within a minute' })
  timeUp: boolean;
}

export class ExamAttemptsResultDto {
  @ApiProperty({ enum: RESULT_STATUSES })
  status: ExamResultStatus;

  @ApiProperty({ type: Number, nullable: true })
  score: number | null;

  @ApiProperty({ enum: RESULT_SOURCES, description: '`online`: the counted attempt; `manual`: recorded on the results sheet (a student without an attempt)' })
  source: (typeof RESULT_SOURCES)[number];
}

export class ExamAttemptsStudentDto {
  @ApiProperty({ type: () => EnrollmentStudentDto, description: 'In the caller’s D-R07 projection' })
  student: EnrollmentStudentDto;

  @ApiProperty({ type: String, enum: ENROLLMENT_STATUSES, nullable: true })
  enrollmentStatus: EnrollmentStatus | null;

  @ApiProperty({ type: () => ExamAttemptsResultDto, nullable: true, description: 'The student’s counted result, if any' })
  result: ExamAttemptsResultDto | null;

  @ApiProperty({ type: [ExamAttemptRowDto], description: 'In order; empty for a student who has not started' })
  attempts: ExamAttemptRowDto[];
}

export class ExamAttemptsStatsDto {
  @ApiProperty({ example: 18, description: 'Students on the roster' })
  students: number;

  @ApiProperty({ example: 15, description: 'Students with at least one attempt' })
  started: number;

  @ApiProperty({ example: 1, description: 'Students with an attempt in progress' })
  inProgress: number;

  @ApiProperty({ example: 14, description: 'Students with a finished attempt' })
  finished: number;

  @ApiProperty({ example: 3, description: 'Students who have not started' })
  notStarted: number;

  @ApiProperty({ type: Number, nullable: true, example: 7.25, description: 'Mean of the counted scores (two decimals); null without a finished attempt' })
  mean: number | null;

  @ApiProperty({ type: Number, nullable: true })
  highest: number | null;

  @ApiProperty({ type: Number, nullable: true })
  lowest: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Counted scores at or above the pass score; null when the exam names none' })
  passed: number | null;

  @ApiProperty({ type: Number, nullable: true })
  failed: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 78.57, description: 'passed ÷ finished as a percentage (two decimals); null without a pass score or a finished attempt' })
  passRate: number | null;
}

export class ExamQuestionStatDto {
  @ApiProperty({ format: 'uuid' })
  examQuestionId: string;

  @ApiProperty({ example: 0 })
  sortOrder: number;

  @ApiProperty({ example: 2 })
  points: number;

  @ApiProperty({ example: 13, description: 'Counted attempts that answered the question' })
  answered: number;

  @ApiProperty({ example: 9, description: 'Counted attempts that answered it correctly' })
  correct: number;
}

export class ExamAttemptsDto {
  @ApiProperty({ format: 'uuid' })
  examId: string;

  @ApiProperty({ format: 'uuid' })
  classId: string;

  @ApiProperty({ enum: EXAM_STATUSES })
  examStatus: ExamStatus;

  @ApiProperty({ example: 10 })
  maxScore: number;

  @ApiProperty({ type: Number, nullable: true })
  passScore: number | null;

  @ApiProperty({ example: 5 })
  questionCount: number;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 — the window opens' })
  scheduledAt: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 — the window closes' })
  closesAt: string | null;

  @ApiProperty({ enum: EXAM_WINDOW_STATES, description: 'Where the server clock falls in the window' })
  window: (typeof EXAM_WINDOW_STATES)[number];

  @ApiProperty({ description: 'ISO 8601 — the server clock of this answer' })
  serverNow: string;

  @ApiProperty({ type: () => ExamAttemptsStatsDto })
  stats: ExamAttemptsStatsDto;

  @ApiProperty({ type: [ExamQuestionStatDto], description: 'How each question went, over each student’s counted attempt' })
  questions: ExamQuestionStatDto[];

  @ApiProperty({ type: [ExamAttemptsStudentDto], description: 'Every student with an active or completed enrollment and anyone holding an attempt, in enrollment order' })
  items: ExamAttemptsStudentDto[];
}

export class TeacherAttemptOptionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => OptionTextDto })
  text: LocalizedText;

  @ApiProperty()
  isCorrect: boolean;
}

export class TeacherAttemptQuestionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 0 })
  sortOrder: number;

  @ApiProperty({ example: 2 })
  points: number;

  @ApiProperty({ enum: QUESTION_TYPES })
  type: QuestionTypeValue;

  @ApiProperty({ type: () => QuestionTextDto })
  prompt: LocalizedText;

  @ApiProperty({ type: () => QuestionTextDto, nullable: true })
  explanation: LocalizedText | null;

  @ApiProperty({ type: [TeacherAttemptOptionDto] })
  options: TeacherAttemptOptionDto[];

  @ApiProperty({ type: Boolean, nullable: true, description: 'The key of a `true_false` question' })
  correctAnswer: boolean | null;

  @ApiProperty({ type: () => AttemptAnswerDto, nullable: true, description: 'The student’s answer; null when unanswered' })
  answer: AttemptAnswerDto | null;

  @ApiProperty({ type: Boolean, nullable: true, description: 'Null while the attempt is in progress; false for a wrong or missing answer once finished' })
  isCorrect: boolean | null;

  @ApiProperty({ type: Number, nullable: true })
  pointsAwarded: number | null;
}

export class ExamAttemptDetailDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  examId: string;

  @ApiProperty({ example: 1 })
  attemptNo: number;

  @ApiProperty({ enum: ATTEMPT_STATUSES })
  status: ExamAttemptStatus;

  @ApiProperty({ description: 'ISO 8601' })
  startedAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  expiresAt: string;

  @ApiProperty({ type: String, nullable: true })
  submittedAt: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'ISO 8601 — the last grading (the finish, or a later regrade)' })
  gradedAt: string | null;

  @ApiProperty({ type: Number, nullable: true })
  score: number | null;

  @ApiProperty({ example: 10 })
  maxScore: number;

  @ApiProperty({ type: Number, nullable: true })
  correctCount: number | null;

  @ApiProperty({ example: 5 })
  questionCount: number;

  @ApiProperty({ description: 'True for the attempt that counts (D-R153)' })
  counted: boolean;

  @ApiProperty({ type: () => EnrollmentStudentDto })
  student: EnrollmentStudentDto;

  @ApiProperty({ type: [TeacherAttemptQuestionDto] })
  questions: TeacherAttemptQuestionDto[];
}
