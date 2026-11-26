// What the lesson popup of «دوراتي» and «دروسي» says about the opened lesson (J-F69 — Jallal's reference: a card of
// «المادة / المعلم / نوع المحاضرة / الموعد» above the video). Pure — no React, no i18next instance; every value comes
// from the server's answers (API-229 the course card, API-230 the workspace, API-231 the lesson). Unit-tested in
// hubLesson.view.test.ts.
import type { LearningItemKind, LearningNeighbor, LearningWorkspace, LessonSession, MyLearningCourse, WorkspaceItem } from '../../api/learning'

/** «نوع المحاضرة»: a live lesson, a recorded lecture (a video or an audio), or the kind of anything else. */
export type LessonFormKey = 'live' | 'recorded' | 'text' | 'pdf' | 'image' | 'file'

export function lessonFormOf(kind: LearningItemKind): LessonFormKey {
  if (kind === 'live') return 'live'
  if (kind === 'video' || kind === 'audio') return 'recorded'
  return kind
}

/**
 * «الموعد»: the class session of the lesson the learner will meet next — the earliest one not cancelled that has not
 * ended at `now` — else the latest one held; null when the lesson has no session (a recorded lesson, as a rule).
 */
export function lessonSessionOf(sessions: readonly LessonSession[], now: number): LessonSession | null {
  const usable = sessions.filter((session) => session.status !== 'cancelled' && Number.isFinite(Date.parse(session.startsAt)))
  const upcoming = usable
    .filter((session) => Date.parse(session.endsAt) > now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  if (upcoming[0]) return upcoming[0]
  const held = [...usable].sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
  return held[0] ?? null
}

/** «المعلم»: the class's lead teacher by the name they show (API-229 names no other); null without one. */
export function teacherNameOf(course: Pick<MyLearningCourse, 'leadTeacher'>): string | null {
  const teacher = course.leadTeacher
  if (!teacher) return null
  return teacher.displayName?.trim() || teacher.fullName.trim() || null
}

/** The lesson's row in its course's workspace (API-230): it carries the lesson's exams and whether each was taken. */
export function workspaceItemOf(workspace: LearningWorkspace | null, itemId: string): WorkspaceItem | null {
  if (!workspace) return null
  for (const section of workspace.sections) {
    const found = section.items.find((item) => item.id === itemId)
    if (found) return found
  }
  return null
}

/** A step of the side arrows is possible toward a lesson that can be opened (D-R145 — a body without the field reads as open). */
export function isReachable(neighbor: LearningNeighbor | null): neighbor is LearningNeighbor {
  return neighbor !== null && neighbor.available !== false
}
