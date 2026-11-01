// Course publication state machine of MOD-04-T03 (D-R13/D-R14) as pure
// functions, unit-tested in courses.changes.spec.ts:
//
//   publish    draft → published
//   unpublish  published → draft
//   archive    draft | published → archived   (archiving replaces deletion)
//   restore    archived → draft                (re-published explicitly)
//
// Deleting is a separate rule (DELETE /api/courses/:id): only a draft.
import type { CourseStatus } from '../generated/prisma/client.js';

export const COURSE_STATUS_ACTIONS = ['publish', 'unpublish', 'archive', 'restore'] as const;
export type CourseStatusAction = (typeof COURSE_STATUS_ACTIONS)[number];

const TRANSITIONS: Readonly<Record<CourseStatusAction, Partial<Readonly<Record<CourseStatus, CourseStatus>>>>> = {
  publish: { draft: 'published' },
  unpublish: { published: 'draft' },
  archive: { draft: 'archived', published: 'archived' },
  restore: { archived: 'draft' },
};

/** The status the action leads to from `from`, or null when not allowed. */
export function nextCourseStatus(action: CourseStatusAction, from: CourseStatus): CourseStatus | null {
  return TRANSITIONS[action][from] ?? null;
}

/** Actions allowed from a status, in catalogue order (the `allowed` detail of `invalid_transition`). */
export function allowedCourseActions(from: CourseStatus): CourseStatusAction[] {
  return COURSE_STATUS_ACTIONS.filter((action) => TRANSITIONS[action][from] !== undefined);
}

/** Only a draft may be deleted (nothing outside MOD-04 references courses yet; later FKs are Restrict). */
export function isDeletable(status: CourseStatus): boolean {
  return status === 'draft';
}
