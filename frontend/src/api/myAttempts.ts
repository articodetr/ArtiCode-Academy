// A learner's own attempts at an online exam (MOD-09 phase 2 — OEX-T07):
// API-276 `POST /api/me/exams/:id/attempts`, API-277
// `GET /api/me/exam-attempts/:id`, API-278 `PUT …/answers` and API-279
// `POST …/submit`. Types mirror backend/src/exams/my-attempts.dto.ts.
//
// Everything is the caller's own: the exam through their enrollment in its
// class, the attempt by its owner — anything else is 404. The three writes
// need `exams.take` (seeded to students) and are rate-limited per (IP, user):
// 30 starts or submits and 240 saves a minute (429 `rate_limited`).
//
// **The clock is the server's (D-R152).** `expiresAt` is fixed when the
// attempt starts and never moves; show `remainingSeconds` (computed at
// `serverNow`) and count down from the moment the answer arrived — never from
// the device clock. A write is taken up to 5 seconds after the deadline; after
// that the server closes the attempt with what was saved (`attempt_closed`).
// Leaving the page does not stop the clock and does not submit: reading the
// attempt again gives the saved answers and the time left.
//
// **Nothing here carries a key before the exam releases it.** Options come as
// `{ id, text }`; `result` is null while the attempt is in progress and until
// `resultReleased`; `review` (the correct answers and explanations) is null
// unless `reviewReleased`. No score is ever computed in the browser.
import type { ExamAttemptStatus, AttemptAnswer } from './examAttempts'
import { apiRequest } from './client'
import type { ExamResultsRelease, ExamType } from './exams'
import { MY_EXAMS_PATH } from './myExams'
import type { QuestionType } from './questionBanks'
import type { ScheduleClass } from './timetable'
import type { LocalizedLabel } from './users'

/** At most this many answers per save (`EXAM_QUESTIONS_MAX`). */
export const ANSWERS_BATCH_MAX = 200

/** `exam_not_open { reason }` of API-276. */
export const EXAM_NOT_OPEN_REASONS = ['not_open_yet', 'closed', 'results_published'] as const
export type ExamNotOpenReason = (typeof EXAM_NOT_OPEN_REASONS)[number]

/** `AttemptOptionDto`: an option WITHOUT its key. */
export interface AttemptOption {
  /** What an answer names as `optionId`. */
  id: string
  text: LocalizedLabel
}

/** `AttemptReviewDto`: the grading and the key of one question — only once released (D-R157). */
export interface AttemptReview {
  /** False for a wrong answer and for a question left unanswered. */
  isCorrect: boolean
  pointsAwarded: number
  /** The correct option of a `single_choice` question. */
  correctOptionId: string | null
  /** The correct answer of a `true_false` question. */
  correctAnswer: boolean | null
  explanation: LocalizedLabel | null
}

/** `AttemptQuestionDto`. */
export interface AttemptQuestion {
  /** The id an answer names as `examQuestionId`. */
  id: string
  sortOrder: number
  points: number
  type: QuestionType
  prompt: LocalizedLabel
  /** In display order; empty for a `true_false` question. */
  options: AttemptOption[]
  /** The learner's saved answer; null while unanswered. */
  answer: AttemptAnswer | null
  /** Null unless `reviewReleased` and the attempt is finished. */
  review: AttemptReview | null
}

/** `AttemptExamDto`: what a learner may know of the exam. */
export interface AttemptExam {
  id: string
  title: LocalizedLabel
  /** The exam's instructions. */
  description: LocalizedLabel | null
  type: ExamType
  maxScore: number
  passScore: number | null
  /** Minutes one attempt may take. */
  durationMinutes: number | null
  /** When the window opens. */
  scheduledAt: string | null
  /** When the window closes. */
  closesAt: string | null
  /** IANA zone to display the window in (D-R41). */
  timeZone: string
  attemptsAllowed: number
  resultsRelease: ExamResultsRelease
  revealAnswers: boolean
  class: ScheduleClass
}

/** `AttemptResultDto`. */
export interface AttemptResult {
  score: number
  maxScore: number
  correctCount: number
  questionCount: number
  /** Against the exam's pass score; null when the exam names none. */
  isPass: boolean | null
  /** True when this attempt is the one that counts — the highest finished attempt, the earliest on a tie. */
  counted: boolean
}

/** `AttemptSummaryDto`: one of the learner's attempts at the exam. */
export interface AttemptSummary {
  id: string
  attemptNo: number
  status: ExamAttemptStatus
  startedAt: string
  /** The deadline itself for an attempt the server closed. */
  submittedAt: string | null
  /** Null while in progress and until the result is released. */
  score: number | null
}

/** `MyAttemptDto` (API-276, API-277, API-279). */
export interface MyAttempt {
  id: string
  attemptNo: number
  status: ExamAttemptStatus
  startedAt: string
  /** The server's deadline, fixed at the start. */
  expiresAt: string
  submittedAt: string | null
  /** The server clock of this answer. */
  serverNow: string
  /** Whole seconds left at `serverNow`; 0 once the deadline has passed or the attempt is finished. */
  remainingSeconds: number
  /** True when the attempt is still open on the server but its deadline has passed: submit it to see it closed. */
  timeUp: boolean
  answeredCount: number
  questionCount: number
  exam: AttemptExam
  /** The frozen questions in the exam's order, without their key. */
  questions: AttemptQuestion[]
  /** True when the learner may see the score: the results are published, or the exam releases on submit. */
  resultReleased: boolean
  /** True when the learner may see the correct answers and explanations. */
  reviewReleased: boolean
  /** Null while in progress and until `resultReleased`. */
  result: AttemptResult | null
  /** Every attempt of the learner at this exam, in order. */
  attempts: AttemptSummary[]
}

/** One answer of API-278 — the whole new answer to its question; with neither field it clears the answer. */
export interface AnswerEntry {
  examQuestionId: string
  /** For a `single_choice` question. */
  optionId?: string | null
  /** For a `true_false` question (a JSON boolean). */
  value?: boolean | null
}

/** `SaveAnswersResultDto` (API-278). */
export interface SaveAnswersResult {
  attemptId: string
  /** Answers written or cleared by this request. */
  saved: number
  answeredCount: number
  questionCount: number
  expiresAt: string
  serverNow: string
  remainingSeconds: number
}

export const myExamAttemptsPath = (examId: string) => `${MY_EXAMS_PATH}/${encodeURIComponent(examId)}/attempts`
export const myAttemptPath = (attemptId: string) => `/api/me/exam-attempts/${encodeURIComponent(attemptId)}`

/**
 * API-276 — starts the next attempt or answers the one in progress («resume or
 * create»: a double click never opens a second attempt). With `attemptNo` the
 * server refuses any other number (409 `attempt_conflict { expected, next }`),
 * so a repeated request never uses a second attempt. Refusals: 404
 * `exam_not_found`; 403 `enrollment_required { enrollmentStatus }` or
 * `permission_denied`; 409 `exam_not_open { reason, opensAt, closesAt }`,
 * `attempts_exhausted { attemptsAllowed, attempts }`, `class_closed`.
 */
export function startMyAttempt(examId: string, attemptNo?: number): Promise<MyAttempt> {
  return apiRequest<MyAttempt>(myExamAttemptsPath(examId), { method: 'POST', body: attemptNo === undefined ? {} : { attemptNo } })
}

/** API-277 — read-only: an attempt whose deadline has passed comes back `in_progress` with `timeUp: true`. 404 `attempt_not_found` for anybody else's. */
export function getMyAttempt(attemptId: string, signal?: AbortSignal): Promise<MyAttempt> {
  return apiRequest<MyAttempt>(myAttemptPath(attemptId), { signal })
}

/**
 * API-278 — saves or clears answers (1–200, no question twice). 400
 * `answers_invalid { unknown, duplicates, malformed }`; 409
 * `attempt_closed { status }` once the attempt is finished or its time is over.
 */
export function saveMyAnswers(attemptId: string, answers: AnswerEntry[], signal?: AbortSignal): Promise<SaveAnswersResult> {
  return apiRequest<SaveAnswersResult>(`${myAttemptPath(attemptId)}/answers`, { method: 'PUT', body: { answers }, signal })
}

/** API-279 — the final submit; repeating it answers the same finished attempt without grading again. */
export function submitMyAttempt(attemptId: string): Promise<MyAttempt> {
  return apiRequest<MyAttempt>(`${myAttemptPath(attemptId)}/submit`, { method: 'POST' })
}
