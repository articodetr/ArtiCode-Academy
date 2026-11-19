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

/** The i18n key of a failed progress write (API-234) shown beside the button. */
export function actionFailureKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'completion_by_playback') return 'learn.errors.completion_by_playback'
    if (error.code === 'completion_by_attendance') return 'learn.errors.completion_by_attendance'
    if (error.status === 429) return 'learn.errors.rate_limited'
    return 'learn.completion.failed'
  }
  return 'learn.errors.network'
}
