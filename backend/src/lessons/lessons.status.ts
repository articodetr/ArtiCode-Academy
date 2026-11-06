// Lesson state machine of MOD-06-T02 (D-R33: manual actions, `in_progress`
// unused in the first version) as pure functions, unit-tested in
// lessons.status.spec.ts:
//
//   complete  scheduled → completed   (only once the start time has passed)
//   cancel    scheduled → cancelled   (the reason goes to cancellation_reason)
//   restore   cancelled → scheduled   (the EXCLUDE constraints re-check conflicts)
//
// Deleting is a separate rule (DELETE /api/lessons/:id): only a scheduled
// lesson without any attendance record; every other lesson is cancelled.
// Editing: time, room and teacher change for a scheduled lesson only; title,
// description, syllabus item, delivery mode and meeting link for any lesson
// that is not cancelled (roadmap §4f.4 API-096).
import type { LessonStatus } from '../generated/prisma/client.js';

export const LESSON_STATUS_ACTIONS = ['complete', 'cancel', 'restore'] as const;
export type LessonStatusAction = (typeof LESSON_STATUS_ACTIONS)[number];

const TRANSITIONS: Readonly<Record<LessonStatusAction, Partial<Readonly<Record<LessonStatus, LessonStatus>>>>> = {
  complete: { scheduled: 'completed' },
  cancel: { scheduled: 'cancelled' },
  restore: { cancelled: 'scheduled' },
};

/** The status the action leads to from `from`, or null when not allowed. */
export function nextLessonStatus(action: LessonStatusAction, from: LessonStatus): LessonStatus | null {
  return TRANSITIONS[action][from] ?? null;
}

/** Actions allowed from a status, in catalogue order (the `allowed` detail of `invalid_transition`). */
export function allowedLessonActions(from: LessonStatus): LessonStatusAction[] {
  return LESSON_STATUS_ACTIONS.filter((action) => TRANSITIONS[action][from] !== undefined);
}

/** `complete` needs the start time to have passed (D-R33: attendance is taken from the start, the lesson is closed after). */
export function hasStarted(startsAt: Date, now: Date = new Date()): boolean {
  return startsAt.getTime() <= now.getTime();
}

/** Only a scheduled lesson without any attendance record may be deleted. */
export function isLessonDeletable(status: LessonStatus, attendanceCount: number): boolean {
  return status === 'scheduled' && attendanceCount === 0;
}

/** Fields that move the lesson or its resources — editable while the lesson is scheduled only. */
export const LESSON_TIMING_FIELDS = ['startsAt', 'endsAt', 'roomId', 'teacherUserId'] as const;
export type LessonTimingField = (typeof LESSON_TIMING_FIELDS)[number];

/**
 * Which of the requested fields the lesson's status refuses: everything for a
 * cancelled lesson, the timing fields for a completed (or in-progress) one,
 * nothing for a scheduled one.
 */
export function lockedFields(status: LessonStatus, requested: readonly string[]): string[] {
  if (status === 'scheduled') return [];
  if (status === 'cancelled') return [...requested];
  return requested.filter((field) => (LESSON_TIMING_FIELDS as readonly string[]).includes(field));
}
