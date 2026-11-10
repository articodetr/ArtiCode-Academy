// The results sheet of an exam (MOD-09-T04 — J-F45): API-119 GET and API-120
// PUT /api/exams/:id/results. Types mirror backend/src/exams/exam-results.dto.ts;
// every call goes through apiRequest (Bearer header, refresh-and-retry on 401).
// Reading needs `exams.read`, recording `exams.grade`, both through the exam's
// class visibility (D-R16: an assigned teacher, or a holder of `classes.manage`;
// anyone else gets 404) — the server decides. Every result of a PUT is the
// WHOLE new state of that student's result (an absent `feedback` clears it);
// students absent from the batch are never touched and nothing is deleted.
// Instants are ISO 8601 in UTC; the sheet carries no display zone — the screen
// takes the exam's (API-114 `timeZone`, D-R41).
import { apiRequest } from './client'
import type { EnrollmentStatus, EnrollmentStudent } from './enrollments'
import { EXAMS_PATH } from './exams'
import type { ExamResultCounts, ExamStatus } from './exams'

/** In the order of the Prisma enum `exam_result_status`: `absent` counts 0 in the final grade, `excused` is left out of it (D-R45). */
export const EXAM_RESULT_STATUSES = ['scored', 'absent', 'excused'] as const
export type ExamResultStatus = (typeof EXAM_RESULT_STATUSES)[number]

/** A student may hold a result while their enrollment is one of these (`RESULT_ENROLLMENT_STATUSES`); anyone else is `not_enrolled`. */
export const RESULT_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = ['active', 'completed']

/** Why a PUT is refused right now: `class_cancelled` (→ `409 class_closed`) or `not_scheduled` (a draft → `409 exam_not_recordable`). */
export const RESULTS_BLOCKERS = ['class_cancelled', 'not_scheduled'] as const
export type ResultsBlocker = (typeof RESULTS_BLOCKERS)[number]

/** Mirrors of the DTO limits (backend/src/exams/exam-results.dto.ts). */
export const RESULTS_BATCH_MAX = 500
export const RESULT_FEEDBACK_MAX_LENGTH = 500

/** `ResultRecorderDto`: who last wrote the result (null when that account was deleted). */
export interface ExamResultRecorder {
  userId: string
  fullName: string
}

/** `ExamResultDto`. */
export interface ExamResult {
  status: ExamResultStatus
  /** With `scored` only. */
  score: number | null
  /** Shown to the student once the results are published. */
  feedback: string | null
  recordedBy: ExamResultRecorder | null
  /** When the result was first recorded. */
  recordedAt: string
  updatedAt: string
}

/** `ExamResultItemDto`: one student of the sheet (in the caller's D-R07 projection) with their result or null. */
export interface ExamResultItem {
  student: EnrollmentStudent
  /** A withdrawn student stays listed while they hold a result but can no longer be recorded. */
  enrollmentStatus: EnrollmentStatus | null
  result: ExamResult | null
}

/** `ExamResultsSheetDto` (API-119), also the answer of every successful PUT (API-120). */
export interface ExamResultsSheet {
  examId: string
  classId: string
  examStatus: ExamStatus
  maxScore: number
  /** True when a PUT would be accepted right now (a scheduled or published exam of a class that is not cancelled). */
  recordable: boolean
  closedReason: ResultsBlocker | null
  counts: ExamResultCounts
  /** Every student with an active or completed enrollment, plus anyone holding a result; in enrollment order. */
  items: ExamResultItem[]
}

/** One result of a PUT — the whole new state of that student's result. */
export interface ExamResultInput {
  studentId: string
  status: ExamResultStatus
  /** Required with `scored` (0..maxScore, two decimals at most), refused otherwise. */
  score?: number
  /** Up to 500 characters; absent = none. */
  feedback?: string
}

/** `RecordExamResultsDto` (API-120): 1–500 results, no student twice. */
export interface RecordExamResultsInput {
  results: ExamResultInput[]
}

export function examResultsPath(examId: string): string {
  return `${EXAMS_PATH}/${encodeURIComponent(examId)}/results`
}

/** API-119 — the results sheet of an exam. */
export function getExamResults(examId: string, signal?: AbortSignal): Promise<ExamResultsSheet> {
  return apiRequest<ExamResultsSheet>(examResultsPath(examId), { signal })
}

/** API-120 — records or corrects a batch; answers with the sheet after the write (an identical batch writes nothing). */
export function recordExamResults(examId: string, input: RecordExamResultsInput): Promise<ExamResultsSheet> {
  return apiRequest<ExamResultsSheet>(examResultsPath(examId), { method: 'PUT', body: input })
}
