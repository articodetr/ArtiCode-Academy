// Lesson actions menu and field locks of the lesson drawer (J-F09): a manual
// mirror of the backend state machine (backend/src/lessons/lessons.status.ts
// and lessons.policy.ts) — keep the two in sync. The server stays the
// boundary (409 invalid_transition / lesson_locked / lesson_not_deletable /
// class_closed).
//
//   complete  scheduled → completed   (only once the start time has passed — lesson_not_started)
//   cancel    scheduled → cancelled   (the reason goes to cancellationReason)
//   restore   cancelled → scheduled   (the room/teacher conflicts are checked again)
//   delete    a scheduled lesson without any attendance record (API-098)
//
// A lesson of a completed or cancelled class is frozen (class_closed): no
// action and no edit. Editing: time, room and teacher change for a scheduled
// lesson only; title, description, syllabus item, delivery mode and meeting
// link for any lesson that is not cancelled.
import type { ClassStatus } from '../api/classes'
import { LESSON_STATUS_ACTIONS } from '../api/lessons'
import type { Lesson, LessonStatus, LessonStatusAction } from '../api/lessons'

export type LessonMenuAction = LessonStatusAction | 'delete'

const TRANSITIONS: Readonly<Record<LessonStatusAction, Partial<Readonly<Record<LessonStatus, LessonStatus>>>>> = {
  complete: { scheduled: 'completed' },
  cancel: { scheduled: 'cancelled' },
  restore: { cancelled: 'scheduled' },
}

/** Lessons are created or edited for a class in one of these states (D-R33 (1)). */
export const LESSON_OPEN_CLASS_STATUSES: readonly ClassStatus[] = ['planned', 'open', 'running']

export function isClassOpenForLessons(status: ClassStatus): boolean {
  return LESSON_OPEN_CLASS_STATUSES.includes(status)
}

export function nextLessonStatus(action: LessonStatusAction, from: LessonStatus): LessonStatus | null {
  return TRANSITIONS[action][from] ?? null
}

/** `complete` needs the start time to have passed (D-R33). */
export function hasLessonStarted(startsAt: string, now: Date = new Date()): boolean {
  const start = new Date(startsAt).getTime()
  return !Number.isNaN(start) && start <= now.getTime()
}

/** Only a scheduled lesson without any attendance record may be deleted. */
export function isLessonDeletable(status: LessonStatus, attendanceRecorded: number): boolean {
  return status === 'scheduled' && attendanceRecorded === 0
}

/** Fields that move the lesson or its resources — editable while the lesson is scheduled only. */
export const LESSON_TIMING_FIELDS = ['startsAt', 'endsAt', 'roomId', 'teacherUserId'] as const

/** Which of the requested fields the lesson's status refuses (mirror of `lockedFields()`). */
export function lockedLessonFields(status: LessonStatus, requested: readonly string[]): string[] {
  if (status === 'scheduled') return []
  if (status === 'cancelled') return [...requested]
  return requested.filter((field) => (LESSON_TIMING_FIELDS as readonly string[]).includes(field))
}

export interface LessonEditability {
  /** The edit form may open at all (needs `lessons.manage`, an open class and a lesson that is not cancelled). */
  editable: boolean
  /** Time, room and teacher are read-only (a completed or in-progress lesson). */
  timingLocked: boolean
}

export function lessonEditability(lesson: Pick<Lesson, 'status' | 'class'>, canManage: boolean): LessonEditability {
  if (!canManage || !isClassOpenForLessons(lesson.class.status) || lesson.status === 'cancelled') return { editable: false, timingLocked: true }
  return { editable: true, timingLocked: lesson.status !== 'scheduled' }
}

/**
 * What the menu offers: nothing without `lessons.manage` or for a lesson of a
 * closed class; `complete` only once the lesson has started; `delete` only for
 * a scheduled lesson without attendance records.
 */
export function availableLessonActions(lesson: Pick<Lesson, 'status' | 'startsAt' | 'attendance' | 'class'>, canManage: boolean, now: Date = new Date()): LessonMenuAction[] {
  if (!canManage || !isClassOpenForLessons(lesson.class.status)) return []
  const actions: LessonMenuAction[] = LESSON_STATUS_ACTIONS.filter((action) => TRANSITIONS[action][lesson.status] !== undefined).filter(
    (action) => action !== 'complete' || hasLessonStarted(lesson.startsAt, now),
  )
  if (isLessonDeletable(lesson.status, lesson.attendance.recorded)) actions.push('delete')
  return actions
}

/** Actions shown in red and confirmed as dangerous. */
export function isDangerousLessonAction(action: LessonMenuAction): boolean {
  return action === 'cancel' || action === 'delete'
}
