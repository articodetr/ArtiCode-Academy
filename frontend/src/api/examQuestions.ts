// The questions of an online exam (MOD-09 phase 2 — OEX-T07): API-270 `GET` and
// API-271 `PUT /api/exams/:id/questions`, and the audited corrections API-272
// `POST /api/exams/:id/questions/:examQuestionId/key` and API-273
// `POST /api/exams/:id/regrade`. Types mirror
// backend/src/exams/exam-questions.dto.ts and exam-attempts.dto.ts.
//
// Reading needs `exams.read`, replacing the set `exams.manage` AND
// `questions.manage`, correcting a key and regrading `exams.grade` — all
// through the exam's class visibility (D-R16; an exam of a class the caller is
// not assigned to is 404 unless they hold `classes.manage`). **The items carry
// the key**: this module is for the teacher's side only.
//
// While the exam is a draft the items show the bank's content as it is now and
// the set may be replaced (`editable`); once it is scheduled the items are the
// FROZEN copies the attempts are served and graded from (`frozen` — D-R158):
// the set is locked, and a wrong key is put right through API-272, which
// re-grades every finished attempt in one audited step. The points need not
// sum to `maxScore` while editing — `schedule` requires it (`problems`).
import { apiRequest } from './client'
import { examPath } from './exams'
import type { ExamDelivery, ExamStatus } from './exams'
import type { QuestionStatus, QuestionType } from './questionBanks'
import type { LocalizedLabel } from './users'

/** At most this many questions per exam (`EXAM_QUESTIONS_MAX`). */
export const EXAM_QUESTIONS_MAX = 200
/** A correction's reason, after trimming (`CORRECTION_REASON_MAX_LENGTH`). */
export const CORRECTION_REASON_MAX_LENGTH = 500

/** What keeps `schedule` from making an online draft available (`EXAM_READINESS_PROBLEMS` of exams.online.ts — keep in sync). */
export const EXAM_READINESS_PROBLEMS = ['no_questions', 'questions_not_ready', 'points_mismatch', 'window_missing', 'duration_missing', 'window_closed'] as const
export type ExamReadinessProblem = (typeof EXAM_READINESS_PROBLEMS)[number]

/** `key_invalid { problem }` of API-272. */
export const KEY_PROBLEMS = ['option_required', 'option_unknown', 'answer_required', 'not_allowed_for_type'] as const
export type KeyProblem = (typeof KEY_PROBLEMS)[number]

export interface ExamQuestionOption {
  id: string
  text: LocalizedLabel
  isCorrect: boolean
}

/** `ExamQuestionContentDto`: the bank's content in a draft, the frozen copy afterwards. */
export interface ExamQuestionContent {
  type: QuestionType
  prompt: LocalizedLabel
  explanation: LocalizedLabel | null
  /** In display order; empty for a `true_false` question. */
  options: ExamQuestionOption[]
  /** The key of a `true_false` question; null for `single_choice`. */
  correctAnswer: boolean | null
  /** The bank question's status while the exam is a draft; null once the copy is frozen. */
  status: QuestionStatus | null
}

/** One correction of a frozen question's key: who, when and why — never the key it replaced. */
export interface ExamKeyCorrection {
  /** ISO 8601. */
  at: string
  byUserId: string
  reason: string
}

/** `ExamQuestionItemDto`. */
export interface ExamQuestionItem {
  /** The id of the link — what an answer of an attempt and API-272 name. */
  id: string
  /** Position inside the exam (0 first). */
  sortOrder: number
  points: number
  /** The bank question it came from. */
  questionId: string
  bank: { id: string; name: LocalizedLabel }
  question: ExamQuestionContent
  /** Oldest first; empty for a question never corrected. */
  corrections: ExamKeyCorrection[]
}

/** `ExamQuestionsDto` (API-270, and the answer of API-271). A manual exam answers an empty list. */
export interface ExamQuestions {
  examId: string
  examStatus: ExamStatus
  delivery: ExamDelivery
  /** True once the exam is scheduled or published: the items are the frozen copies. */
  frozen: boolean
  /** True while the set may be replaced: an online draft of a class that is not cancelled. */
  editable: boolean
  maxScore: number
  /** The sum of the items' points; it must equal `maxScore` to make the exam available (D-R159). */
  totalPoints: number
  problems: ExamReadinessProblem[]
  items: ExamQuestionItem[]
}

/** One entry of API-271; without `points` the question's own default is taken. */
export interface ExamQuestionEntry {
  questionId: string
  /** A JSON number with at most two decimals, 0.01..9999.99. */
  points?: number
}

/** Body of API-272: the field of the question's type, and a required reason. */
export interface CorrectKeyInput {
  /** One of the question's own options — for a `single_choice` question. */
  correctOptionId?: string
  /** A JSON boolean — for a `true_false` question. */
  correctAnswer?: boolean
  /** 1–500 characters after trimming. */
  reason: string
}

/** `RegradeSummaryDto`. */
export interface RegradeSummary {
  /** Finished attempts graded again. */
  attempts: number
  /** Attempts whose grading changed. */
  changedAttempts: number
  /** Students whose counted result changed. */
  changedResults: number
}

/** `KeyCorrectionResultDto`: `changed: false` when the request named the key the question already had (nothing was written). */
export interface KeyCorrectionResult {
  changed: boolean
  question: ExamQuestionItem
  regrade: RegradeSummary
}

export const examQuestionsPath = (examId: string) => `${examPath(examId)}/questions`
export const examQuestionKeyPath = (examId: string, examQuestionId: string) => `${examQuestionsPath(examId)}/${encodeURIComponent(examQuestionId)}/key`
export const examRegradePath = (examId: string) => `${examPath(examId)}/regrade`

/** API-270. */
export function getExamQuestions(examId: string, signal?: AbortSignal): Promise<ExamQuestions> {
  return apiRequest<ExamQuestions>(examQuestionsPath(examId), { signal })
}

/**
 * API-271 — the WHOLE ordered list (0–200, no question twice). Refused before
 * any write: `exam_questions_invalid { duplicates }` (400), `exam_not_online`,
 * `exam_questions_locked { status }` (not a draft), `class_closed` (409),
 * `question_not_found { questionIds }` (404), `question_not_ready { questionIds }` (422).
 */
export function replaceExamQuestions(examId: string, questions: ExamQuestionEntry[]): Promise<ExamQuestions> {
  return apiRequest<ExamQuestions>(examQuestionsPath(examId), { method: 'PUT', body: { questions } })
}

/**
 * API-272 — corrects the key of one frozen question and re-grades every
 * finished attempt. Refused: `key_invalid { problem }` (400),
 * `question_not_found` (404), `exam_not_online`, `exam_not_frozen { status }`,
 * `class_closed`, `grades_certified { classId, certificateCount }` (409).
 */
export function correctExamQuestionKey(examId: string, examQuestionId: string, input: CorrectKeyInput): Promise<KeyCorrectionResult> {
  return apiRequest<KeyCorrectionResult>(examQuestionKeyPath(examId, examQuestionId), { method: 'POST', body: input })
}

/** API-273 — grades the finished attempts again from the frozen questions; the same refusals as API-272 (without the key ones). */
export function regradeExam(examId: string, reason: string): Promise<RegradeSummary> {
  return apiRequest<RegradeSummary>(examRegradePath(examId), { method: 'POST', body: { reason } })
}
