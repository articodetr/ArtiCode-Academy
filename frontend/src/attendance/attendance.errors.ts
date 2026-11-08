// Maps a failed attendance request (API-099/API-100) to a translation key
// and to what the sheet should do next. The attendance codes of
// backend/src/lessons/lessons.errors.ts get their own messages here; every
// other failure (permission, origin, rate limit, validation, server, network)
// falls back to the lessons mapper.
import { ApiError } from '../api/client'
import { describeLessonsFailure } from '../lessons/lessons.errors'
import type { LessonsFailure } from '../lessons/lessons.errors'

export { failureMessage } from '../lessons/lessons.errors'

export interface AttendanceFailure extends LessonsFailure {
  /**
   * `stale`: the lesson or its class changed elsewhere (cancelled, not started) — re-read the sheet and the lesson;
   * `gone`: the lesson no longer exists or is out of reach (404);
   * `refused`: some students are no longer enrolled — the batch was refused as a whole, nothing was written.
   */
  next?: 'stale' | 'gone' | 'refused'
  /** `not_enrolled`: the students the server refused. */
  studentIds?: string[]
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function describeAttendanceFailure(error: unknown): AttendanceFailure {
  if (error instanceof ApiError) {
    const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
    if (error.code === 'attendance_closed') return { key: body.reason === 'not_started' ? 'attendance.errors.not_started' : 'attendance.errors.lesson_cancelled', next: 'stale' }
    // On this route class_closed only means a cancelled class (a completed one stays open for corrections — D-R33).
    if (error.code === 'class_closed') return { key: 'attendance.errors.class_cancelled', next: 'stale' }
    if (error.code === 'not_enrolled') return { key: 'attendance.errors.not_enrolled', next: 'refused', studentIds: strings(body.studentIds) }
    if (error.code === 'lesson_not_found') return { key: 'lessons.errors.lesson_not_found', next: 'gone' }
    if (error.status === 413) return { key: 'attendance.errors.too_large' }
  }
  return describeLessonsFailure(error)
}
