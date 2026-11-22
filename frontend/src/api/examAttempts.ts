// The attempts at an online exam as the teacher and the office see them
// (MOD-09 phase 2 — OEX-T07): API-274 `GET /api/exams/:id/attempts` and API-275
// `GET /api/exam-attempts/:id`. Types mirror
// backend/src/exams/exam-attempts.dto.ts field by field.
//
// Both need `exams.read` and go through the exam's class visibility (D-R16):
// an exam or an attempt of a class the caller is not assigned to is 404 unless
// they hold `classes.manage`. A learner holds `exams.read` but is assigned to
// no class, so nothing here reaches them — their own attempt is
// api/myAttempts.ts, which never carries a key. **API-275 carries the key.**
// Read-only: nothing here writes or closes an attempt. Every number is the
// server's (no score, mean or rate is computed in the browser).
import { apiRequest } from './client'
import type { EnrollmentStatus, EnrollmentStudent } from './enrollments'
import type { ExamResultSource, ExamResultStatus } from './examResults'
import { examPath } from './exams'
import type { ExamStatus } from './exams'
import type { QuestionType } from './questionBanks'
import type { LocalizedLabel } from './users'

/** In the order of the Prisma enum `exam_attempt_status`: `timed_out` = closed by the server at the deadline with what was saved. */
export const EXAM_ATTEMPT_STATUSES = ['in_progress', 'submitted', 'timed_out'] as const
export type ExamAttemptStatus = (typeof EXAM_ATTEMPT_STATUSES)[number]

/** Where the server clock falls in the exam's window. */
export const EXAM_WINDOW_STATES = ['not_open', 'open', 'closed'] as const
export type ExamWindowState = (typeof EXAM_WINDOW_STATES)[number]

/** `ExamAttemptRowDto`: one attempt of a student. */
export interface ExamAttemptRow {
  id: string
  attemptNo: number
  status: ExamAttemptStatus
  startedAt: string
  /** The server's deadline. */
  expiresAt: string
  submittedAt: string | null
  /** Null while in progress. */
  score: number | null
  correctCount: number | null
  /** True for the attempt that counts — the highest finished one, the earliest on a tie (D-R153). */
  counted: boolean
  /** True while the attempt is still open on the server but its deadline has passed: the server closes it within a minute. */
  timeUp: boolean
}

/** The student's counted result, if any: `online` = their counted attempt, `manual` = recorded on the results sheet. */
export interface ExamAttemptsResult {
  status: ExamResultStatus
  score: number | null
  source: ExamResultSource
}

/** `ExamAttemptsStudentDto`: one student of the roster (in the caller's D-R07 projection). */
export interface ExamAttemptsStudent {
  student: EnrollmentStudent
  enrollmentStatus: EnrollmentStatus | null
  result: ExamAttemptsResult | null
  /** In order; empty for a student who has not started. */
  attempts: ExamAttemptRow[]
}

/** `ExamAttemptsStatsDto`: the figures over the COUNTED scores. */
export interface ExamAttemptsStats {
  /** Students on the roster. */
  students: number
  /** Students with at least one attempt. */
  started: number
  inProgress: number
  /** Students with a finished attempt. */
  finished: number
  notStarted: number
  /** Null without a finished attempt. */
  mean: number | null
  highest: number | null
  lowest: number | null
  /** Null when the exam names no pass score. */
  passed: number | null
  failed: number | null
  /** passed ÷ finished as a percentage; null without a pass score or a finished attempt. */
  passRate: number | null
}

/** `ExamQuestionStatDto`: how one question went over each student's counted attempt. */
export interface ExamQuestionStat {
  examQuestionId: string
  sortOrder: number
  points: number
  answered: number
  correct: number
}

/** `ExamAttemptsDto` (API-274). A manual exam answers the roster with no attempts. */
export interface ExamAttempts {
  examId: string
  classId: string
  examStatus: ExamStatus
  maxScore: number
  passScore: number | null
  questionCount: number
  /** When the window opens. */
  scheduledAt: string | null
  closesAt: string | null
  window: ExamWindowState
  /** The server clock of this answer. */
  serverNow: string
  stats: ExamAttemptsStats
  questions: ExamQuestionStat[]
  /** Every student with an active or completed enrollment and anyone holding an attempt, in enrollment order. */
  items: ExamAttemptsStudent[]
}

export interface TeacherAttemptOption {
  id: string
  text: LocalizedLabel
  isCorrect: boolean
}

/** `AttemptAnswerDto`: the field of the question's type is set, the other null. */
export interface AttemptAnswer {
  optionId: string | null
  value: boolean | null
}

/** `TeacherAttemptQuestionDto`: a frozen question with its key and the student's answer. */
export interface TeacherAttemptQuestion {
  id: string
  sortOrder: number
  points: number
  type: QuestionType
  prompt: LocalizedLabel
  explanation: LocalizedLabel | null
  options: TeacherAttemptOption[]
  /** The key of a `true_false` question. */
  correctAnswer: boolean | null
  /** Null when unanswered. */
  answer: AttemptAnswer | null
  /** Null while the attempt is in progress; false for a wrong or missing answer once finished. */
  isCorrect: boolean | null
  pointsAwarded: number | null
}

/** `ExamAttemptDetailDto` (API-275). */
export interface ExamAttemptDetail {
  id: string
  examId: string
  attemptNo: number
  status: ExamAttemptStatus
  startedAt: string
  expiresAt: string
  submittedAt: string | null
  /** The last grading (the finish, or a later regrade). */
  gradedAt: string | null
  score: number | null
  maxScore: number
  correctCount: number | null
  questionCount: number
  counted: boolean
  student: EnrollmentStudent
  questions: TeacherAttemptQuestion[]
}

export const examAttemptsPath = (examId: string) => `${examPath(examId)}/attempts`
export const examAttemptPath = (attemptId: string) => `/api/exam-attempts/${encodeURIComponent(attemptId)}`

/** API-274. */
export function getExamAttempts(examId: string, signal?: AbortSignal): Promise<ExamAttempts> {
  return apiRequest<ExamAttempts>(examAttemptsPath(examId), { signal })
}

/** API-275: 404 `attempt_not_found` for an attempt of a class the caller may not see. */
export function getExamAttempt(attemptId: string, signal?: AbortSignal): Promise<ExamAttemptDetail> {
  return apiRequest<ExamAttemptDetail>(examAttemptPath(attemptId), { signal })
}
