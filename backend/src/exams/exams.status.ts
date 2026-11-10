// Exam state machine of MOD-09-T03 (owner decision D-R47: manual actions; the
// online states of the second phase are not in the enum yet) as pure
// functions, unit-tested in exams.status.spec.ts:
//
//   schedule    draft     → scheduled  (the learners see the exam, its date and duration)
//   unschedule  scheduled → draft      (only while the exam holds no result — exam_has_results)
//   publish     scheduled → published  (sets published_at; the learners see their results)
//   unpublish   published → scheduled  (clears published_at; the results are hidden again)
//
// `schedule` and `publish` are refused for a cancelled class (class_closed);
// a completed class keeps its exams open. Deleting is a separate rule: a
// draft or scheduled exam without any result. Editing: every field in every
// status; `maxScore` is locked once a result exists (a recorded score must
// stay within it).
import type { ExamStatus } from '../generated/prisma/client.js';

export const EXAM_STATUS_ACTIONS = ['schedule', 'unschedule', 'publish', 'unpublish'] as const;
export type ExamStatusAction = (typeof EXAM_STATUS_ACTIONS)[number];

const TRANSITIONS: Readonly<Record<ExamStatusAction, Partial<Readonly<Record<ExamStatus, ExamStatus>>>>> = {
  schedule: { draft: 'scheduled' },
  unschedule: { scheduled: 'draft' },
  publish: { scheduled: 'published' },
  unpublish: { published: 'scheduled' },
};

/** The status the action leads to from `from`, or null when not allowed. */
export function nextExamStatus(action: ExamStatusAction, from: ExamStatus): ExamStatus | null {
  return TRANSITIONS[action][from] ?? null;
}

/** Actions allowed from a status, in catalogue order (the `allowed` detail of `invalid_transition`). */
export function allowedExamActions(from: ExamStatus): ExamStatusAction[] {
  return EXAM_STATUS_ACTIONS.filter((action) => TRANSITIONS[action][from] !== undefined);
}

/** `schedule` and `publish` move an exam forward — refused for a cancelled class. */
export function actionNeedsLiveClass(action: ExamStatusAction): boolean {
  return action === 'schedule' || action === 'publish';
}

/** Only a draft or scheduled exam without any result may be deleted. */
export function isExamDeletable(status: ExamStatus, resultCount: number): boolean {
  return (status === 'draft' || status === 'scheduled') && resultCount === 0;
}

/** The fields a recorded result relies on — locked once a result exists. */
export const EXAM_RESULT_LOCKED_FIELDS = ['maxScore'] as const;

/** Which of the requested fields the exam refuses: `maxScore` once a result exists, nothing otherwise. */
export function lockedExamFields(resultCount: number, requested: readonly string[]): string[] {
  if (resultCount === 0) return [];
  return requested.filter((field) => (EXAM_RESULT_LOCKED_FIELDS as readonly string[]).includes(field));
}
