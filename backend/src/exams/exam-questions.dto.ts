import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDefined, IsObject, IsUUID, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { IsDecimalNumber } from '../common/decimal-number.js';
import { OptionTextDto, QuestionTextDto } from '../questions/questions.dto.js';
import { QUESTION_POINTS_LIMIT, QUESTION_STATUSES, QUESTION_TYPES } from '../questions/questions.rules.js';
import type { QuestionStatusValue, QuestionTypeValue } from '../questions/questions.rules.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { EXAM_STATUSES } from './exams.dto.js';
import { EXAM_DELIVERIES, EXAM_QUESTIONS_MAX, EXAM_READINESS_PROBLEMS } from './exams.online.js';
import type { ExamDeliveryValue } from './exams.online.js';
import type { ExamStatus } from '../generated/prisma/client.js';

/** Body numbers must be JSON numbers: no implicit "2" → 2. */
function rawValue({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  return obj[key];
}

export class ExamQuestionEntryDto {
  @ApiProperty({ format: 'uuid', description: 'A `ready` question of a bank the caller sees' })
  @IsUUID('all')
  questionId: string;

  @ApiPropertyOptional({ minimum: 0.01, maximum: QUESTION_POINTS_LIMIT, example: 2, description: 'The points of the question in this exam (a JSON number with at most two decimals); absent = the question’s own default' })
  // Absent, never null: `IsOptional` would let a null through to the service.
  @ValidateIf((dto: ExamQuestionEntryDto) => dto.points !== undefined)
  @Transform(rawValue)
  @IsDecimalNumber(2)
  @Min(0.01)
  @Max(QUESTION_POINTS_LIMIT)
  points?: number;
}

/** The whole ordered question set of the exam: the request replaces it (API-271). */
export class ReplaceExamQuestionsDto {
  @ApiProperty({ type: [ExamQuestionEntryDto], maxItems: EXAM_QUESTIONS_MAX, description: 'In display order; `[]` unlinks every question. No question twice' })
  @IsDefined()
  @IsArray()
  @ArrayMaxSize(EXAM_QUESTIONS_MAX)
  // Each entry is an object: `ValidateNested` alone would walk into a nested array.
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ExamQuestionEntryDto)
  questions: ExamQuestionEntryDto[];
}

export class ExamQuestionOptionDto {
  @ApiProperty({ format: 'uuid', description: 'In a scheduled exam: the id inside the frozen copy — the one an answer names' })
  id: string;

  @ApiProperty({ type: () => OptionTextDto })
  text: LocalizedText;

  @ApiProperty()
  isCorrect: boolean;
}

/** The question as the teacher sees it, with its key: the bank's content in a draft, the frozen copy afterwards. */
export class ExamQuestionContentDto {
  @ApiProperty({ enum: QUESTION_TYPES })
  type: QuestionTypeValue;

  @ApiProperty({ type: () => QuestionTextDto })
  prompt: LocalizedText;

  @ApiProperty({ type: () => QuestionTextDto, nullable: true })
  explanation: LocalizedText | null;

  @ApiProperty({ type: [ExamQuestionOptionDto], description: 'In display order; empty for a `true_false` question' })
  options: ExamQuestionOptionDto[];

  @ApiProperty({ type: Boolean, nullable: true, description: 'The key of a `true_false` question; null for `single_choice`' })
  correctAnswer: boolean | null;

  @ApiProperty({ type: String, enum: QUESTION_STATUSES, nullable: true, description: 'The bank question’s status while the exam is a draft; null once the copy is frozen (the bank no longer matters to the exam)' })
  status: QuestionStatusValue | null;
}

export class ExamQuestionBankDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  name: LocalizedText;
}

/** One correction of a frozen question's key (D-R161): who, when and why — the previous key stays in the stored copy and is not served. */
export class ExamKeyCorrectionDto {
  @ApiProperty({ description: 'ISO 8601' })
  at: string;

  @ApiProperty({ format: 'uuid', description: 'Who corrected the key' })
  byUserId: string;

  @ApiProperty({ description: 'The reason given' })
  reason: string;
}

export class ExamQuestionItemDto {
  @ApiProperty({ format: 'uuid', description: 'The id of the link — what an answer of an attempt names' })
  id: string;

  @ApiProperty({ example: 0, description: 'Position inside the exam (0 first)' })
  sortOrder: number;

  @ApiProperty({ example: 2 })
  points: number;

  @ApiProperty({ format: 'uuid', description: 'The bank question it came from' })
  questionId: string;

  @ApiProperty({ type: () => ExamQuestionBankDto })
  bank: ExamQuestionBankDto;

  @ApiProperty({ type: () => ExamQuestionContentDto })
  question: ExamQuestionContentDto;

  @ApiProperty({ type: [ExamKeyCorrectionDto], description: 'The corrections of this question’s key since the exam was made available, oldest first (API-272); empty for a question never corrected' })
  corrections: ExamKeyCorrectionDto[];
}

export class ExamQuestionsDto {
  @ApiProperty({ format: 'uuid' })
  examId: string;

  @ApiProperty({ enum: EXAM_STATUSES })
  examStatus: ExamStatus;

  @ApiProperty({ enum: EXAM_DELIVERIES })
  delivery: ExamDeliveryValue;

  @ApiProperty({ description: 'True once the exam is scheduled or published: the items are the frozen copies (D-R158)' })
  frozen: boolean;

  @ApiProperty({ description: 'True while the question set may be replaced: an online draft of a class that is not cancelled' })
  editable: boolean;

  @ApiProperty({ example: 10 })
  maxScore: number;

  @ApiProperty({ example: 10, description: 'The sum of the items’ points; it must equal `maxScore` to make the exam available (D-R159)' })
  totalPoints: number;

  @ApiProperty({ enum: EXAM_READINESS_PROBLEMS, isArray: true, description: 'What would keep `schedule` from making a draft available now; always empty once it is scheduled' })
  problems: string[];

  @ApiProperty({ type: [ExamQuestionItemDto], description: 'In display order' })
  items: ExamQuestionItemDto[];
}
