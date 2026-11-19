// How the learning workspace reads a refusal of API-230..234 (MOD-20 —
// backend/src/learning/learning.errors.ts). Access refusals replace the
// page with a clear explanation; a lesson that is gone sends the learner
// back to the course's resume target; everything else is a message.
import { ApiError } from '../api/client'

export type AccessFailure =
  /** 403 not_enrolled { reason: pending } — an own enrollment waits for payment or approval. */
  | { kind: 'pending' }
  /** 403 not_enrolled — no own active or completed enrollment in a class of the course (D-R132). */
  | { kind: 'not_enrolled' }
  /** 404 — the course does not exist (learning_course_not_found). */
  | { kind: 'not_found' }

function reasonOf(body: unknown): unknown {
  return typeof body === 'object' && body !== null && 'reason' in body ? (body as { reason: unknown }).reason : undefined
}

/** The refusal of a course's workspace (API-230) or of one of its lessons (API-231) that replaces the whole page, or null. */
export function accessFailureOf(error: unknown, scope: 'course' | 'lesson'): AccessFailure | null {
  if (!(error instanceof ApiError)) return null
  if (error.status === 403 && error.code === 'not_enrolled') return reasonOf(error.body) === 'pending' ? { kind: 'pending' } : { kind: 'not_enrolled' }
  // A lesson's 404 is not the course's: the lesson alone is gone (isLessonGone).
  if (scope === 'course' && error.status === 404) return { kind: 'not_found' }
  return null
}

/** API-231's 404 lesson_not_found (an unknown or unpublished lesson, or one of another course). */
export function isLessonGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A `YYYY-MM-DD` day, or null for anything else (a day handed through the router state is checked again here). */
export function calendarDayOrNull(value: unknown): string | null {
  return typeof value === 'string' && CALENDAR_DAY.test(value) ? value : null
}

/**
 * API-231's 403 level_not_open { itemId, opensOn } (D-R145): the lesson belongs to a level that opens on
 * `opensOn` (the academy's zone) — null when the body names no usable day. Null for any other failure.
 */
export function levelNotOpenOf(error: unknown): { opensOn: string | null } | null {
  if (!(error instanceof ApiError) || error.status !== 403 || error.code !== 'level_not_open') return null
  const body = error.body
  const opensOn = typeof body === 'object' && body !== null && 'opensOn' in body ? (body as { opensOn: unknown }).opensOn : null
  return { opensOn: calendarDayOrNull(opensOn) }
}

/** The i18n key of a failed progress write (API-234) shown beside the button. */
export function actionFailureKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'completion_by_playback') return 'learn.errors.completion_by_playback'
    if (error.code === 'completion_by_attendance') return 'learn.errors.completion_by_attendance'
    if (error.code === 'level_not_open') return 'learn.errors.level_not_open'
    if (error.status === 429) return 'learn.errors.rate_limited'
    return 'learn.completion.failed'
  }
  return 'learn.errors.network'
}
