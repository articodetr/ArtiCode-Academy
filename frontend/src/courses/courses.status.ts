// Course actions menu of the course drawer (MOD-04-T05): a manual mirror of
// the backend state machine (backend/src/courses/courses.status.ts) — keep the
// two in sync. The server stays the boundary (409 invalid_transition).
//
//   publish    draft → published
//   unpublish  published → draft
//   archive    draft | published → archived
//   restore    archived → draft
//   delete     draft only (API-047)
import type { CourseStatus, CourseStatusAction } from '../api/courses'

export type CourseMenuAction = CourseStatusAction | 'delete'

const TRANSITIONS: Readonly<Record<CourseStatusAction, Partial<Readonly<Record<CourseStatus, CourseStatus>>>>> = {
  publish: { draft: 'published' },
  unpublish: { published: 'draft' },
  archive: { draft: 'archived', published: 'archived' },
  restore: { archived: 'draft' },
}

const STATUS_ACTIONS = Object.keys(TRANSITIONS) as CourseStatusAction[]

export function nextCourseStatus(action: CourseStatusAction, from: CourseStatus): CourseStatus | null {
  return TRANSITIONS[action][from] ?? null
}

/** What the menu offers: nothing without `courses.manage`; deletion for drafts only. */
export function availableCourseActions(status: CourseStatus, canManage: boolean): CourseMenuAction[] {
  if (!canManage) return []
  const actions: CourseMenuAction[] = STATUS_ACTIONS.filter((action) => TRANSITIONS[action][status] !== undefined)
  if (status === 'draft') actions.push('delete')
  return actions
}

/** Actions shown in red and confirmed as dangerous. */
export function isDangerousCourseAction(action: CourseMenuAction): boolean {
  return action === 'archive' || action === 'delete'
}
