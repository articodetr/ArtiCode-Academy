// Maps a failed exams request to a translation key (and, where the backend
// code points at one input, the form field that should carry the message).
// Codes: the exams part of backend/src/grades/grades.errors.ts — the one
// MOD-09 dictionary (API-113..API-120) — plus the auth/permission guards.
// describeResultsFailure() adds what the results sheet (API-119/API-120) should
// do next, on the pattern of attendance/attendance.errors.ts. Unit-tested in
// exams.errors.test.ts.
//
// MOD-09 phase 2 — what API-115..API-118 answer for an online exam is worded in
// i18n/ar/examOnline.ts (`examOnline.errors.<code>`): `online_settings_not_allowed
// { fields }`, `window_invalid`, `exam_not_ready { problems, totalPoints,
// maxScore, questionIds }` (the problems in words), `exam_has_attempts {
// attemptCount }`, `exam_window_open { closesAt }` (when it closes, formatted by
// the caller) and `exam_not_deletable` when it carries an `attemptCount`.
// `exam_locked` keeps its key and now also names the online fields; why each
// one is locked is lockedFieldMessageKey(). The questions of an online exam
// and the key corrections have their own mapper (examQuestions.errors.ts).
import { ApiError } from '../api/client'
import { failureMessage as usersFailureMessage } from '../users/users.errors'
import type { UsersFailure } from '../users/users.errors'
import type { Translate } from '../users/users.format'
import { readinessProblemText } from './exams.format'
import type { ReadinessNumbers } from './exams.format'
import { isExamPatchField, patchFieldLabelKey } from './exams.patch'

/** `exam_not_ready`: what keeps an online exam from being made available, with the server's numbers. */
export interface ExamReadinessRefusal extends ReadinessNumbers {
  problems: string[]
  /** The linked questions that are not ready. */
  questionIds: string[]
}

/** A users failure plus, for `exam_locked`, the refused fields as the server names them and the exam's status then. */
export interface ExamsFailure extends UsersFailure {
  lockedFields?: string[]
  lockedStatus?: string
  /** `exam_locked`: the counts the server named — they tell why a field is locked (a result exists, somebody has started). */
  lockedResultCount?: number
  lockedAttemptCount?: number
  /** `online_settings_not_allowed`: the online settings the server refused on a manual exam. */
  refusedSettings?: string[]
  /** `exam_not_ready`. */
  readiness?: ExamReadinessRefusal
  /** `exam_window_open`: when the window closes (ISO 8601), or null when the server named none. */
  windowClosesAt?: string | null
}

/** A failed save of the results sheet, with what the sheet should do next. */
export interface ResultsFailure extends ExamsFailure {
  /**
   * `stale`: the exam or its class changed elsewhere (back to draft, class cancelled) — re-read the sheet and the exam;
   * `gone`: the exam no longer exists or is out of reach (404);
   * `refused`: the batch was refused as a whole because of some students (nothing was written) — mark their rows.
   */
  next?: 'stale' | 'gone' | 'refused'
  /** The students the server named: `not_enrolled`, the one of `score_out_of_range`, the repeated ones of `results_invalid`. */
  studentIds?: string[]
}

const KNOWN_CODES = new Set([
  'exam_not_found',
  'class_not_found',
  'lesson_not_found',
  'lesson_mismatch',
  'class_closed',
  'pass_score_invalid',
  'exam_locked',
  'exam_has_results',
  'exam_not_deletable',
  'exam_not_recordable',
  'invalid_transition',
  'results_invalid',
  'not_enrolled',
  'score_out_of_range',
  'nothing_to_update',
  'cursor_invalid',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

/** The codes of the online phase that API-115..API-118 answer, worded under `examOnline.errors.*`. */
const ONLINE_CODES = new Set(['online_settings_not_allowed', 'window_invalid', 'exam_not_online', 'exam_not_ready', 'exam_has_attempts', 'exam_window_open'])

/** Form fields (ExamFormValues) a code points at; `class_*` only exist in the creation form. */
const FIELD_OF_CODE: Readonly<Record<string, string[]>> = {
  class_not_found: ['classId'],
  class_closed: ['classId'],
  lesson_not_found: ['lessonId'],
  lesson_mismatch: ['lessonId'],
  pass_score_invalid: ['passScore'],
  window_invalid: ['closesDate'],
}

/** How a message shows what only the screen can format. */
export interface FailureFormat {
  /** An instant as the screen shows it (the exam's zone and the active language). */
  instant?: (iso: string) => string
}

/**
 * The failure's text. `exam_locked` and `online_settings_not_allowed` list the
 * refused fields by their translated labels, not their API names;
 * `exam_not_ready` lists its problems in words; `exam_window_open` says when
 * the window closes when the caller can format the instant.
 */
export function failureMessage(t: Translate, failure: ExamsFailure, format: FailureFormat = {}): string {
  if (isExamsFailure(failure, 'exam_window_open')) {
    const when = failure.windowClosesAt && format.instant ? format.instant(failure.windowClosesAt) : null
    return when ? t('examOnline.errors.exam_window_open', { when }) : t('examOnline.errors.exam_window_open_undated')
  }
  const params: Record<string, string> = { ...failure.params }
  const fields = failure.lockedFields?.length ? failure.lockedFields : failure.refusedSettings
  if (fields?.length) params.list = `(${fields.map((field) => (isExamPatchField(field) ? t(patchFieldLabelKey(field)) : field)).join(t('exams.errors.listSeparator'))})`
  const { readiness } = failure
  if (readiness?.problems.length) params.list = readiness.problems.map((problem) => readinessProblemText(t, problem, readiness)).join(t('examOnline.errors.problemSeparator'))
  return usersFailureMessage(t, { ...failure, params })
}

/**
 * Why the server refused a field in `exam_locked` — the key of the text its
 * input carries. A manual exam only ever locks `maxScore` after a first result
 * (the first phase's text); an online exam locks its delivery outside a draft,
 * its maximum score once the learners can see it, and its window, time limit
 * and attempts as lockedOnlineFields() says — the counts of the refusal tell
 * the cases apart.
 */
export function lockedFieldMessageKey(field: string, failure: Pick<ExamsFailure, 'lockedResultCount' | 'lockedAttemptCount'>): string {
  const started = (failure.lockedAttemptCount ?? 0) > 0
  switch (field) {
    case 'delivery':
      return 'examOnline.locked.delivery'
    case 'maxScore':
      return failure.lockedResultCount === 0 ? 'examOnline.locked.maxScore' : 'exams.validation.lockedAfterResult'
    case 'scheduledAt':
    case 'durationMinutes':
      return started ? 'examOnline.locked.fixedOnceStarted' : 'examOnline.locked.clearedOnceVisible'
    case 'closesAt':
      return started ? 'examOnline.locked.closesOnlyLater' : 'examOnline.locked.clearedOnceVisible'
    case 'attemptsAllowed':
      return 'examOnline.locked.attemptsOnlyRise'
    default:
      return 'exams.validation.lockedAfterResult'
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

function bodyOf(error: ApiError): Record<string, unknown> {
  return (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
}

/** A refusal of the online phase (`examOnline.errors.<code>`), with the details its message and its screen need. */
function describeOnlineFailure(code: string, body: Record<string, unknown>): ExamsFailure {
  const failure: ExamsFailure = { key: `examOnline.errors.${code}` }
  const field = FIELD_OF_CODE[code]
  if (field) failure.field = field
  if (code === 'online_settings_not_allowed') failure.refusedSettings = strings(body.fields)
  if (code === 'exam_not_ready') {
    failure.readiness = { problems: strings(body.problems), totalPoints: numberOrNull(body.totalPoints), maxScore: numberOrNull(body.maxScore), questionIds: strings(body.questionIds) }
  }
  // Named `attempts`, not `count`: i18next would read `count` as a plural selector.
  if (code === 'exam_has_attempts' || code === 'exam_not_deletable') failure.params = { attempts: String(numberOrNull(body.attemptCount) ?? '') }
  if (code === 'exam_window_open') failure.windowClosesAt = typeof body.closesAt === 'string' ? body.closesAt : null
  return failure
}

export function describeExamsFailure(error: unknown): ExamsFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = bodyOf(error)
  if (error.code && ONLINE_CODES.has(error.code)) return describeOnlineFailure(error.code, body)
  // An online exam somebody has started: the same code as «not a draft or it holds results», another reason.
  if (error.code === 'exam_not_deletable' && (numberOrNull(body.attemptCount) ?? 0) > 0) return describeOnlineFailure(error.code, body)
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: ExamsFailure = { key: `exams.errors.${error.code}` }
    const field = FIELD_OF_CODE[error.code]
    if (field) failure.field = field
    if (error.code === 'exam_locked') {
      if (strings(body.fields).length > 0) failure.lockedFields = strings(body.fields)
      if (typeof body.status === 'string') failure.lockedStatus = body.status
      const resultCount = numberOrNull(body.resultCount)
      const attemptCount = numberOrNull(body.attemptCount)
      if (resultCount !== null) failure.lockedResultCount = resultCount
      if (attemptCount !== null) failure.lockedAttemptCount = attemptCount
    }
    const missing = strings(body.missing)
    if (missing.length > 0) failure.params = { list: `(${missing.join(', ')})` }
    // The maximum the server names: the pass score's and a result's limit.
    if ((error.code === 'pass_score_invalid' || error.code === 'score_out_of_range') && typeof body.maxScore === 'number') failure.params = { max: String(body.maxScore) }
    return failure
  }
  if (error.status === 400) return { key: 'exams.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}

/** True for the failure of one code — worded under `exams.errors.<code>`, or `examOnline.errors.<code>` for the online phase. */
export function isExamsFailure(failure: ExamsFailure, code: string): boolean {
  return failure.key === `exams.errors.${code}` || failure.key === `examOnline.errors.${code}`
}

/** A failed read or save of the results sheet (API-119/API-120); anything not specific to the sheet falls back to describeExamsFailure(). */
export function describeResultsFailure(error: unknown): ResultsFailure {
  if (error instanceof ApiError) {
    const body = bodyOf(error)
    // The exam went back to draft elsewhere (the only reason the server gives).
    if (error.code === 'exam_not_recordable') return { key: 'exams.results.errors.not_scheduled', next: 'stale' }
    // On this route class_closed only means a cancelled class (a completed one stays open for corrections — D-R33).
    if (error.code === 'class_closed') return { key: 'exams.results.errors.class_cancelled', next: 'stale' }
    if (error.code === 'not_enrolled') return { key: 'exams.results.errors.not_enrolled', next: 'refused', studentIds: strings(body.studentIds) }
    if (error.code === 'score_out_of_range') {
      const failure: ResultsFailure = { key: 'exams.results.errors.score_out_of_range', next: 'refused', studentIds: typeof body.studentId === 'string' ? [body.studentId] : [] }
      if (typeof body.maxScore === 'number') failure.params = { max: String(body.maxScore) }
      return failure
    }
    if (error.code === 'results_invalid') return { key: 'exams.results.errors.results_invalid', next: 'refused', studentIds: strings(body.duplicates) }
    if (error.code === 'exam_not_found') return { key: 'exams.errors.exam_not_found', next: 'gone' }
    if (error.status === 413) return { key: 'exams.results.errors.too_large' }
  }
  return describeExamsFailure(error)
}
