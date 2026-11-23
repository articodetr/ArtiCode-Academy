// Question banks and their questions (MOD-09 phase 2 — OEX-T07): API-260..API-264
// `/api/question-banks`, API-266 `POST /api/question-banks/:id/questions` and
// API-265, API-267..API-269 `/api/questions`. Types mirror
// backend/src/questions/questions.dto.ts field by field; every call goes
// through apiRequest (Bearer header, refresh-and-retry on 401).
//
// Every route needs `questions.manage`. The server decides what is visible
// (D-R162): a holder of `classes.manage` sees every bank, anyone else the banks
// they created and those of a course they teach a class of — an invisible bank
// or question is 404. **The answers carry the key** (`isCorrect`,
// `correctAnswer`): nothing here is ever shown to a learner. A question is
// `draft` (may be incomplete), `ready` (passes every rule of its type and can
// be linked to an exam) or `archived`; a question an exam links is archived,
// never deleted (`question_in_use`). An exam that has been made available
// holds its own frozen copy, so editing a bank question never changes it.
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

/** In the order of the Prisma enum `question_type` (D-R163): the two auto-graded types of the first version. */
export const QUESTION_TYPES = ['single_choice', 'true_false'] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

/** In the order of the Prisma enum `question_status` (D-R164). */
export const QUESTION_STATUSES = ['draft', 'ready', 'archived'] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

/** A question is created as a draft or, when complete, straight as ready; `archived` comes through an update. */
export const QUESTION_CREATE_STATUSES = ['draft', 'ready'] as const
export type QuestionCreateStatus = (typeof QUESTION_CREATE_STATUSES)[number]

export const QUESTION_DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export type QuestionDifficulty = (typeof QUESTION_DIFFICULTIES)[number]

/** Mirrors of the limits (backend/src/questions/questions.rules.ts and questions.dto.ts — keep in sync). */
export const QUESTION_TEXT_MAX_LENGTH = 2000
export const OPTION_TEXT_MAX_LENGTH = 500
export const QUESTION_OPTIONS_MIN = 2
export const QUESTION_OPTIONS_MAX = 10
export const QUESTION_TAGS_MAX = 10
export const QUESTION_TAG_MAX_LENGTH = 40
/** `points`: `numeric(6,2)`, from 0.01. */
export const QUESTION_POINTS_MIN = 0.01
export const QUESTION_POINTS_LIMIT = 9999.99
export const BANK_NAME_MAX_LENGTH = 200
export const QUESTIONS_PAGE_MAX = 100
/** The `courseId` filter value for the banks filed under no course. */
export const NO_COURSE_FILTER = 'none'

/** What `question_invalid { problems }` and `QuestionDto.missing` name (`QUESTION_PROBLEMS` of questions.rules.ts — keep in sync). */
export const QUESTION_PROBLEMS = [
  'options_not_allowed',
  'correct_answer_not_allowed',
  'options_too_many',
  'multiple_correct_options',
  'duplicate_options',
  'options_too_few',
  'correct_option_required',
  'correct_answer_required',
] as const
export type QuestionProblem = (typeof QUESTION_PROBLEMS)[number]

export interface QuestionAuthor {
  userId: string
  fullName: string
}

export interface QuestionBankCourse {
  id: string
  code: string
  name: LocalizedLabel
}

/** `QuestionBankDto` (API-260..API-263). */
export interface QuestionBank {
  id: string
  name: LocalizedLabel
  description: LocalizedLabel | null
  /** The course the bank is filed under; null = none. */
  course: QuestionBankCourse | null
  /** Null when that account was deleted. */
  createdBy: QuestionAuthor | null
  /** Every question of the bank, archived ones included (`QuestionBanksService.toDtos()`). */
  questionCount: number
  /** The questions in `ready` status. */
  readyCount: number
  createdAt: string
  updatedAt: string
}

export interface QuestionBankList {
  items: QuestionBank[]
  nextCursor: string | null
}

export interface ListQuestionBanksParams {
  /** Part of the Arabic or English name, 1–100 characters. */
  q?: string
  /** A course id, or `none` for the banks without a course. */
  courseId?: string
  /** 1–100, server default 20. */
  limit?: number
  cursor?: string
}

/** Body of API-261. */
export interface CreateQuestionBankInput {
  name: LocalizedLabel
  description?: LocalizedLabel | null
  /** Any course with `classes.manage`, else one the caller teaches a class of (`course_not_found` otherwise). */
  courseId?: string | null
}

/** Body of API-263: absent = unchanged, null clears `description` and `courseId`; `name` is never null. `{}` is 400 `nothing_to_update`. */
export interface UpdateQuestionBankInput {
  name?: LocalizedLabel
  description?: LocalizedLabel | null
  courseId?: string | null
}

/** `QuestionOptionDto`: an option of a `single_choice` question, with its key. */
export interface QuestionOption {
  id: string
  text: LocalizedLabel
  isCorrect: boolean
}

/** `QuestionDto` (API-265..API-268). */
export interface Question {
  id: string
  bankId: string
  type: QuestionType
  status: QuestionStatus
  prompt: LocalizedLabel
  /** Shown to a learner with the correct answers, when the exam reveals them. */
  explanation: LocalizedLabel | null
  /** The default points when the question is linked to an exam. */
  points: number
  difficulty: QuestionDifficulty | null
  tags: string[]
  /** In display order; empty for a `true_false` question. */
  options: QuestionOption[]
  /** The key of a `true_false` question; null for `single_choice` and for a draft without one. */
  correctAnswer: boolean | null
  /** What keeps the question from being `ready` (empty for a complete one). */
  missing: QuestionProblem[]
  /** Exams that link the question. */
  examCount: number
  createdBy: QuestionAuthor | null
  createdAt: string
  updatedAt: string
}

export interface QuestionList {
  items: Question[]
  nextCursor: string | null
}

export interface ListQuestionsParams {
  bankId?: string
  /** Part of the Arabic or English prompt, 1–100 characters. */
  q?: string
  type?: QuestionType
  /** Absent = drafts and ready questions; archived ones only on request. */
  status?: QuestionStatus
  difficulty?: QuestionDifficulty
  tag?: string
  /** 1–100, server default 20. */
  limit?: number
  cursor?: string
}

export interface QuestionOptionInput {
  text: LocalizedLabel
  /** A JSON boolean. */
  isCorrect: boolean
}

/** Body of API-266. `options` only for `single_choice` (2–10, exactly one correct once `ready`), `correctAnswer` only for `true_false`. */
export interface CreateQuestionInput {
  type: QuestionType
  prompt: LocalizedLabel
  explanation?: LocalizedLabel | null
  /** A JSON number with at most two decimals, 0.01..9999.99 (default 1). */
  points?: number
  difficulty?: QuestionDifficulty | null
  tags?: string[]
  status?: QuestionCreateStatus
  options?: QuestionOptionInput[]
  correctAnswer?: boolean | null
}

/**
 * Body of API-268: absent = unchanged, null clears `explanation`, `difficulty`
 * and `correctAnswer`; `options` replaces the whole ordered list. The type is
 * fixed at creation. `{}` is 400 `nothing_to_update`.
 */
export interface UpdateQuestionInput {
  prompt?: LocalizedLabel
  explanation?: LocalizedLabel | null
  points?: number
  difficulty?: QuestionDifficulty | null
  tags?: string[]
  status?: QuestionStatus
  options?: QuestionOptionInput[]
  correctAnswer?: boolean | null
}

export const QUESTION_BANKS_PATH = '/api/question-banks'
export const QUESTIONS_PATH = '/api/questions'

/** `/api/question-banks?…` with the given parameters only, in a fixed order. */
export function questionBanksListPath(params: ListQuestionBanksParams = {}): string {
  const query = new URLSearchParams()
  if (params.q?.trim()) query.set('q', params.q.trim().slice(0, 100))
  if (params.courseId) query.set('courseId', params.courseId)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${QUESTION_BANKS_PATH}?${search}` : QUESTION_BANKS_PATH
}

/** `/api/questions?…` with the given parameters only, in a fixed order. */
export function questionsListPath(params: ListQuestionsParams = {}): string {
  const query = new URLSearchParams()
  if (params.bankId) query.set('bankId', params.bankId)
  if (params.q?.trim()) query.set('q', params.q.trim().slice(0, 100))
  if (params.type) query.set('type', params.type)
  if (params.status) query.set('status', params.status)
  if (params.difficulty) query.set('difficulty', params.difficulty)
  if (params.tag?.trim()) query.set('tag', params.tag.trim())
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `${QUESTIONS_PATH}?${search}` : QUESTIONS_PATH
}

export const questionBankPath = (id: string) => `${QUESTION_BANKS_PATH}/${encodeURIComponent(id)}`
export const bankQuestionsPath = (bankId: string) => `${questionBankPath(bankId)}/questions`
export const questionPath = (id: string) => `${QUESTIONS_PATH}/${encodeURIComponent(id)}`

/** API-260. */
export function listQuestionBanks(params: ListQuestionBanksParams = {}, signal?: AbortSignal): Promise<QuestionBankList> {
  return apiRequest<QuestionBankList>(questionBanksListPath(params), { signal })
}

/** API-261: 404 `course_not_found` for a course the caller may not file a bank under. */
export function createQuestionBank(input: CreateQuestionBankInput): Promise<QuestionBank> {
  return apiRequest<QuestionBank>(QUESTION_BANKS_PATH, { method: 'POST', body: input })
}

/** API-262: 404 `question_bank_not_found` for a bank the caller may not see. */
export function getQuestionBank(id: string, signal?: AbortSignal): Promise<QuestionBank> {
  return apiRequest<QuestionBank>(questionBankPath(id), { signal })
}

/** API-263. */
export function updateQuestionBank(id: string, input: UpdateQuestionBankInput): Promise<QuestionBank> {
  return apiRequest<QuestionBank>(questionBankPath(id), { method: 'PATCH', body: input })
}

/** API-264: with its questions, unless an exam links one of them (409 `question_bank_in_use { linkedQuestionCount }`); resolves on 204. */
export function deleteQuestionBank(id: string): Promise<void> {
  return apiRequest<void>(questionBankPath(id), { method: 'DELETE' })
}

/** API-265. */
export function listQuestions(params: ListQuestionsParams = {}, signal?: AbortSignal): Promise<QuestionList> {
  return apiRequest<QuestionList>(questionsListPath(params), { signal })
}

/** API-266: 400 `question_invalid { problems }` when the content breaks a rule of its type or status. */
export function createQuestion(bankId: string, input: CreateQuestionInput): Promise<Question> {
  return apiRequest<Question>(bankQuestionsPath(bankId), { method: 'POST', body: input })
}

/** API-267. */
export function getQuestion(id: string, signal?: AbortSignal): Promise<Question> {
  return apiRequest<Question>(questionPath(id), { signal })
}

/** API-268. */
export function updateQuestion(id: string, input: UpdateQuestionInput): Promise<Question> {
  return apiRequest<Question>(questionPath(id), { method: 'PATCH', body: input })
}

/** API-269: 409 `question_in_use { examCount }` for a question an exam links — archive it instead; resolves on 204. */
export function deleteQuestion(id: string): Promise<void> {
  return apiRequest<void>(questionPath(id), { method: 'DELETE' })
}
