import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import type { LocalizedText } from '../authorization/localized-text.js';
import { IsDecimalNumber } from '../common/decimal-number.js';
import { TITLE_QUERY_MAX_LENGTH } from '../lessons/title-search.js';
import { LocalizedTextDto } from '../roles/roles.dto.js';
import { nullableTextParam, textParam, trimParam } from '../users/users.validation.js';
import {
  OPTION_TEXT_MAX_LENGTH,
  QUESTION_DIFFICULTIES,
  QUESTION_OPTIONS_MAX,
  QUESTION_POINTS_LIMIT,
  QUESTION_PROBLEMS,
  QUESTION_STATUSES,
  QUESTION_TAGS_MAX,
  QUESTION_TAG_MAX_LENGTH,
  QUESTION_TEXT_MAX_LENGTH,
  QUESTION_TYPES,
} from './questions.rules.js';
import type { QuestionDifficultyValue, QuestionStatusValue, QuestionTypeValue } from './questions.rules.js';

export const QUESTIONS_PAGE_DEFAULT = 20;
export const QUESTIONS_PAGE_MAX = 100;
/** `courseId=none` lists the banks filed under no course. */
export const NO_COURSE_FILTER = 'none';
/** A question is created as a draft or ready; `archived` comes later through PATCH. */
export const QUESTION_CREATE_STATUSES = ['draft', 'ready'] as const;

const COURSE_FILTER_MESSAGE = `courseId must be a uuid or "${NO_COURSE_FILTER}"`;
const SEARCH_DESCRIPTION = 'Substring of the Arabic or English text, case-insensitive; `%`, `_` and `\\` match literally. Trimmed; blank = absent; 1–100 characters';

/** Body numbers and booleans must be JSON numbers/booleans (or null in a PATCH): no implicit "12" → 12 or "yes" → true. */
function rawValue({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  return obj[key];
}

/** Localized text `{ ar, en?, tr? }` of a prompt or an explanation — like LocalizedTextDto with a longer limit (2,000 characters per locale). */
export class QuestionTextDto {
  @ApiProperty({ minLength: 1, maxLength: QUESTION_TEXT_MAX_LENGTH, example: 'ما ناتج print(2 + 3) في Python؟' })
  @Transform(trimParam)
  @IsString()
  @Length(1, QUESTION_TEXT_MAX_LENGTH)
  ar: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: QUESTION_TEXT_MAX_LENGTH, example: 'What does print(2 + 3) output in Python?' })
  @IsOptional()
  @Transform(nullableTextParam)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @Length(1, QUESTION_TEXT_MAX_LENGTH)
  en?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: QUESTION_TEXT_MAX_LENGTH })
  @IsOptional()
  @Transform(nullableTextParam)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @Length(1, QUESTION_TEXT_MAX_LENGTH)
  tr?: string | null;
}

/** Localized text of one option (500 characters per locale). */
export class OptionTextDto {
  @ApiProperty({ minLength: 1, maxLength: OPTION_TEXT_MAX_LENGTH, example: '5' })
  @Transform(trimParam)
  @IsString()
  @Length(1, OPTION_TEXT_MAX_LENGTH)
  ar: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: OPTION_TEXT_MAX_LENGTH })
  @IsOptional()
  @Transform(nullableTextParam)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @Length(1, OPTION_TEXT_MAX_LENGTH)
  en?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: OPTION_TEXT_MAX_LENGTH })
  @IsOptional()
  @Transform(nullableTextParam)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @Length(1, OPTION_TEXT_MAX_LENGTH)
  tr?: string | null;
}

/** Drops empty optional locales so the stored JSON holds strings only. */
export function toStoredText(dto: QuestionTextDto | OptionTextDto | LocalizedTextDto): LocalizedText {
  const text: LocalizedText = { ar: dto.ar };
  if (typeof dto.en === 'string') text.en = dto.en;
  if (typeof dto.tr === 'string') text.tr = dto.tr;
  return text;
}

// ---------------------------------------------------------------------------
// Question banks
// ---------------------------------------------------------------------------

export class ListQuestionBanksQueryDto {
  @ApiPropertyOptional({ maxLength: TITLE_QUERY_MAX_LENGTH, example: 'python', description: `Search in the bank name. ${SEARCH_DESCRIPTION}` })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, TITLE_QUERY_MAX_LENGTH)
  q?: string;

  @ApiPropertyOptional({ description: `A course id, or \`${NO_COURSE_FILTER}\` for the banks filed under no course; absent = every bank the caller sees` })
  @IsOptional()
  @Transform(trimParam)
  @IsString()
  @ValidateIf((dto: ListQuestionBanksQueryDto) => dto.courseId !== NO_COURSE_FILTER)
  @IsUUID('all', { message: COURSE_FILTER_MESSAGE })
  courseId?: string;

  @ApiPropertyOptional({ default: QUESTIONS_PAGE_DEFAULT, minimum: 1, maximum: QUESTIONS_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(QUESTIONS_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 512, description: 'Opaque `nextCursor` of the previous page; send it with the same filters' })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;
}

export class CreateQuestionBankDto {
  @ApiProperty({ type: LocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`; `ar` is required' })
  @IsDefined()
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name: LocalizedTextDto;

  @ApiPropertyOptional({ type: QuestionTextDto, nullable: true, description: 'Localized description (2,000 characters per locale); absent or null = none' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'description must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => QuestionTextDto)
  description?: QuestionTextDto | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'File the bank under this course: any course with `classes.manage`, else one the caller teaches a class of (`course_not_found` otherwise); absent or null = no course' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  courseId?: string | null;
}

/** PATCH semantics (as API-018): absent = unchanged, `null` clears `description` and `courseId`; `name` refuses null. */
export class UpdateQuestionBankDto {
  @ApiPropertyOptional({ type: LocalizedTextDto, description: 'Replaces the whole localized name; `ar` required; not nullable' })
  @ValidateIf((dto: UpdateQuestionBankDto) => dto.name !== undefined)
  @IsObject({ message: 'name must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name?: LocalizedTextDto;

  @ApiPropertyOptional({ type: QuestionTextDto, nullable: true, description: 'Replaces the whole localized description; null clears it' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'description must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => QuestionTextDto)
  description?: QuestionTextDto | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Another course the caller may file a bank under; null = no course' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID('all')
  courseId?: string | null;
}

export class QuestionAuthorDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ example: 'Sara Ali' })
  fullName: string;
}

export class QuestionBankCourseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'PY-101' })
  code: string;

  @ApiProperty({ type: () => LocalizedTextDto })
  name: LocalizedText;
}

export class QuestionBankDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => LocalizedTextDto, description: 'Localized name `{ ar, en?, tr? }`' })
  name: LocalizedText;

  @ApiProperty({ type: () => QuestionTextDto, nullable: true })
  description: LocalizedText | null;

  @ApiProperty({ type: () => QuestionBankCourseDto, nullable: true, description: 'The course the bank is filed under, if any' })
  course: QuestionBankCourseDto | null;

  @ApiProperty({ type: () => QuestionAuthorDto, nullable: true, description: 'Who created the bank; null once that account is gone' })
  createdBy: QuestionAuthorDto | null;

  @ApiProperty({ example: 24, description: 'Questions in the bank, archived ones included' })
  questionCount: number;

  @ApiProperty({ example: 20, description: 'Questions that are `ready` — the ones an exam can link' })
  readyCount: number;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class QuestionBankListDto {
  @ApiProperty({ type: [QuestionBankDto], description: 'Newest first' })
  items: QuestionBankDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Cursor of the next page; null on the last page' })
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export class QuestionOptionInputDto {
  @ApiProperty({ type: OptionTextDto, description: 'Localized text `{ ar, en?, tr? }`; `ar` is required' })
  @IsDefined()
  @IsObject({ message: 'text must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => OptionTextDto)
  text: OptionTextDto;

  @ApiProperty({ description: 'Exactly one option of a ready question is correct (a JSON boolean)' })
  @Transform(rawValue)
  @IsBoolean()
  isCorrect: boolean;
}

export class ListQuestionsQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Questions of this bank; absent = every bank the caller sees' })
  @IsOptional()
  @IsUUID('all')
  bankId?: string;

  @ApiPropertyOptional({ maxLength: TITLE_QUERY_MAX_LENGTH, example: 'print', description: `Search in the question text. ${SEARCH_DESCRIPTION}` })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, TITLE_QUERY_MAX_LENGTH)
  q?: string;

  @ApiPropertyOptional({ enum: QUESTION_TYPES })
  @IsOptional()
  @IsIn(QUESTION_TYPES)
  type?: QuestionTypeValue;

  @ApiPropertyOptional({ enum: QUESTION_STATUSES, description: 'Absent = drafts and ready questions; archived ones are listed only when asked for' })
  @IsOptional()
  @IsIn(QUESTION_STATUSES)
  status?: QuestionStatusValue;

  @ApiPropertyOptional({ enum: QUESTION_DIFFICULTIES })
  @IsOptional()
  @IsIn(QUESTION_DIFFICULTIES)
  difficulty?: QuestionDifficultyValue;

  @ApiPropertyOptional({ maxLength: QUESTION_TAG_MAX_LENGTH, example: 'loops', description: 'Questions carrying this tag (trimmed, lower-cased)' })
  @IsOptional()
  @Transform(textParam)
  @IsString()
  @Length(1, QUESTION_TAG_MAX_LENGTH)
  tag?: string;

  @ApiPropertyOptional({ default: QUESTIONS_PAGE_DEFAULT, minimum: 1, maximum: QUESTIONS_PAGE_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(QUESTIONS_PAGE_MAX)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 512, description: 'Opaque `nextCursor` of the previous page; send it with the same filters' })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  cursor?: string;
}

export class CreateQuestionDto {
  @ApiProperty({ enum: QUESTION_TYPES, description: '`single_choice`: 2–10 options, exactly one correct · `true_false`: no options, the key in `correctAnswer`. Fixed once created (D-R163)' })
  @IsIn(QUESTION_TYPES)
  type: QuestionTypeValue;

  @ApiProperty({ type: QuestionTextDto, description: 'Localized question text `{ ar, en?, tr? }`; `ar` is required' })
  @IsDefined()
  @IsObject({ message: 'prompt must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => QuestionTextDto)
  prompt: QuestionTextDto;

  @ApiPropertyOptional({ type: QuestionTextDto, nullable: true, description: 'Localized explanation of the answer; shown to a learner only when the exam reveals answers (D-R157)' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'explanation must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => QuestionTextDto)
  explanation?: QuestionTextDto | null;

  @ApiPropertyOptional({ minimum: 0.01, maximum: QUESTION_POINTS_LIMIT, default: 1, example: 2, description: 'Default points when linked to an exam; a JSON number with at most two decimals' })
  @IsOptional()
  @Transform(rawValue)
  @IsDecimalNumber(2)
  @Min(0.01)
  @Max(QUESTION_POINTS_LIMIT)
  points?: number;

  @ApiPropertyOptional({ enum: QUESTION_DIFFICULTIES, nullable: true })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsIn(QUESTION_DIFFICULTIES)
  difficulty?: QuestionDifficultyValue | null;

  @ApiPropertyOptional({ type: [String], maxItems: QUESTION_TAGS_MAX, example: ['loops', 'python'], description: 'Up to 10 topic labels of 1–40 characters; stored trimmed, lower-cased and without repeats' })
  @IsOptional()
  @Transform(rawValue)
  @IsArray()
  @ArrayMaxSize(QUESTION_TAGS_MAX)
  @IsString({ each: true })
  @Length(1, QUESTION_TAG_MAX_LENGTH, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ enum: QUESTION_CREATE_STATUSES, default: 'draft', description: '`draft` may be incomplete; `ready` must pass every rule of its type (`question_invalid` otherwise) — D-R164' })
  @IsOptional()
  @IsIn(QUESTION_CREATE_STATUSES)
  status?: (typeof QUESTION_CREATE_STATUSES)[number];

  @ApiPropertyOptional({ type: [QuestionOptionInputDto], maxItems: QUESTION_OPTIONS_MAX, description: 'The options of a `single_choice` question, in display order; refused for `true_false`' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(QUESTION_OPTIONS_MAX)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionInputDto)
  options?: QuestionOptionInputDto[];

  @ApiPropertyOptional({ type: Boolean, nullable: true, description: 'The key of a `true_false` question (a JSON boolean); refused for `single_choice`' })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsBoolean()
  correctAnswer?: boolean | null;
}

/**
 * PATCH semantics (as API-018): absent = unchanged, `null` clears
 * `explanation`, `difficulty` and `correctAnswer`; `options` replaces the whole
 * list. The type is fixed. The merged question must be valid for its
 * resulting status (`question_invalid`).
 */
export class UpdateQuestionDto {
  @ApiPropertyOptional({ type: QuestionTextDto, description: 'Replaces the whole localized text; `ar` required; not nullable' })
  @ValidateIf((dto: UpdateQuestionDto) => dto.prompt !== undefined)
  @IsObject({ message: 'prompt must be an object { ar, en?, tr? }' })
  @ValidateNested()
  @Type(() => QuestionTextDto)
  prompt?: QuestionTextDto;

  @ApiPropertyOptional({ type: QuestionTextDto, nullable: true, description: 'Replaces the whole localized explanation; null clears it' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsObject({ message: 'explanation must be an object { ar, en?, tr? } or null' })
  @ValidateNested()
  @Type(() => QuestionTextDto)
  explanation?: QuestionTextDto | null;

  @ApiPropertyOptional({ minimum: 0.01, maximum: QUESTION_POINTS_LIMIT, description: 'Not nullable' })
  @Transform(rawValue)
  @ValidateIf((dto: UpdateQuestionDto) => dto.points !== undefined)
  @IsDecimalNumber(2)
  @Min(0.01)
  @Max(QUESTION_POINTS_LIMIT)
  points?: number;

  @ApiPropertyOptional({ enum: QUESTION_DIFFICULTIES, nullable: true, description: 'null clears it' })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsIn(QUESTION_DIFFICULTIES)
  difficulty?: QuestionDifficultyValue | null;

  @ApiPropertyOptional({ type: [String], maxItems: QUESTION_TAGS_MAX, description: 'Replaces the whole list; `[]` clears it' })
  @Transform(rawValue)
  @ValidateIf((dto: UpdateQuestionDto) => dto.tags !== undefined)
  @IsArray()
  @ArrayMaxSize(QUESTION_TAGS_MAX)
  @IsString({ each: true })
  @Length(1, QUESTION_TAG_MAX_LENGTH, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ enum: QUESTION_STATUSES, description: '`ready` needs a complete question; `archived` keeps it for the exams that used it and hides it from new ones' })
  @ValidateIf((dto: UpdateQuestionDto) => dto.status !== undefined)
  @IsIn(QUESTION_STATUSES)
  status?: QuestionStatusValue;

  @ApiPropertyOptional({ type: [QuestionOptionInputDto], maxItems: QUESTION_OPTIONS_MAX, description: 'Replaces the whole ordered list of options' })
  @ValidateIf((dto: UpdateQuestionDto) => dto.options !== undefined)
  @IsArray()
  @ArrayMaxSize(QUESTION_OPTIONS_MAX)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionInputDto)
  options?: QuestionOptionInputDto[];

  @ApiPropertyOptional({ type: Boolean, nullable: true, description: 'The key of a `true_false` question; null clears it (a draft only)' })
  @IsOptional()
  @Transform(rawValue)
  @ValidateIf((_dto, value) => value !== null)
  @IsBoolean()
  correctAnswer?: boolean | null;
}

export class QuestionOptionDto {
  @ApiProperty({ format: 'uuid', description: 'Changes whenever the options are replaced; an exam keeps its own frozen copy' })
  id: string;

  @ApiProperty({ type: () => OptionTextDto })
  text: LocalizedText;

  @ApiProperty()
  isCorrect: boolean;
}

export class QuestionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  bankId: string;

  @ApiProperty({ enum: QUESTION_TYPES })
  type: QuestionTypeValue;

  @ApiProperty({ enum: QUESTION_STATUSES })
  status: QuestionStatusValue;

  @ApiProperty({ type: () => QuestionTextDto })
  prompt: LocalizedText;

  @ApiProperty({ type: () => QuestionTextDto, nullable: true })
  explanation: LocalizedText | null;

  @ApiProperty({ example: 2 })
  points: number;

  @ApiProperty({ type: String, enum: QUESTION_DIFFICULTIES, nullable: true })
  difficulty: QuestionDifficultyValue | null;

  @ApiProperty({ type: [String], example: ['loops'] })
  tags: string[];

  @ApiProperty({ type: [QuestionOptionDto], description: 'In display order; empty for a `true_false` question' })
  options: QuestionOptionDto[];

  @ApiProperty({ type: Boolean, nullable: true, description: 'The key of a `true_false` question; null for `single_choice` and for a draft without a key' })
  correctAnswer: boolean | null;

  @ApiProperty({ enum: QUESTION_PROBLEMS, isArray: true, description: 'What still keeps a draft from being `ready`; empty for a complete question' })
  missing: string[];

  @ApiProperty({ example: 1, description: 'Exams that link the question — it is archived, not deleted, while this is above zero' })
  examCount: number;

  @ApiProperty({ type: () => QuestionAuthorDto, nullable: true })
  createdBy: QuestionAuthorDto | null;

  @ApiProperty({ description: 'ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'ISO 8601' })
  updatedAt: string;
}

export class QuestionListDto {
  @ApiProperty({ type: [QuestionDto], description: 'Newest first' })
  items: QuestionDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Cursor of the next page; null on the last page' })
  nextCursor: string | null;
}
