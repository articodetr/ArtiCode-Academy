// Exam actions menu and field locks of the exam drawer (J-F45): a manual
// mirror of the backend state machine (backend/src/exams/exams.status.ts) and
// of the class rules of backend/src/exams/exams.policy.ts — keep the two in
// sync. The server stays the boundary (409 invalid_transition / exam_has_results
// / exam_locked / exam_not_deletable / class_closed).
//
//   schedule    draft     → scheduled  (the learners see the exam; refused for a cancelled class)
//   unschedule  scheduled → draft      (only while the exam holds no result — exam_has_results)
//   publish     scheduled → published  (sets publishedAt; the learners see their results; refused for a cancelled class)
//   unpublish   published → scheduled  (clears publishedAt; the results are hidden again)
//   delete      a draft or scheduled exam without any result (API-118), whatever the class status
//
// Editing: every field in every status unless the class is cancelled (a
// completed class keeps its exams open for corrections — the D-R33 pattern);
// `maxScore` is locked once a result exists. A new exam needs a planned, open
// or running class.
import type { ClassStatus } from '../api/classes'
import { EXAM_STATUS_ACTIONS } from '../api/exams'
import type { Exam, ExamStatus, ExamStatusAction } from '../api/exams'

export type ExamMenuAction = ExamStatusAction | 'delete'

const TRANSITIONS: Readonly<Record<ExamStatusAction, Partial<Readonly<Record<ExamStatus, ExamStatus>>>>> = {
  schedule: { draft: 'scheduled' },
  unschedule: { scheduled: 'draft' },
  publish: { scheduled: 'published' },
  unpublish: { published: 'scheduled' },
}

/** A new exam is created for a class in one of these states (`EXAM_CREATE_CLASS_STATUSES`). */
export const EXAM_CREATE_CLASS_STATUSES: readonly ClassStatus[] = ['planned', 'open', 'running']

/** True when a new exam may be created for the class. */
export function isClassOpenForNewExam(status: ClassStatus): boolean {
  return EXAM_CREATE_CLASS_STATUSES.includes(status)
}

/** An exam of a cancelled class takes no edit, no `schedule`/`publish` and no result (`isClassFrozenForExams()`). */
export function isClassFrozenForExams(status: ClassStatus): boolean {
  return status === 'cancelled'
}

/** The status the action leads to from `from`, or null when not allowed. */
export function nextExamStatus(action: ExamStatusAction, from: ExamStatus): ExamStatus | null {
  return TRANSITIONS[action][from] ?? null
}

/** Actions allowed from a status, in catalogue order (the `allowed` detail of `invalid_transition`). */
export function allowedExamActions(from: ExamStatus): ExamStatusAction[] {
  return EXAM_STATUS_ACTIONS.filter((action) => TRANSITIONS[action][from] !== undefined)
}

/** `schedule` and `publish` move an exam forward — refused for a cancelled class. */
export function actionNeedsLiveClass(action: ExamStatusAction): boolean {
  return action === 'schedule' || action === 'publish'
}

/** Only a draft or scheduled exam without any result may be deleted. */
export function isExamDeletable(status: ExamStatus, resultCount: number): boolean {
  return (status === 'draft' || status === 'scheduled') && resultCount === 0
}

/** The fields a recorded result relies on — locked once a result exists (`EXAM_RESULT_LOCKED_FIELDS`). */
export const EXAM_RESULT_LOCKED_FIELDS = ['maxScore'] as const

/** Which of the requested fields the exam refuses: `maxScore` once a result exists, nothing otherwise (mirror of `lockedExamFields()`). */
export function lockedExamFields(resultCount: number, requested: readonly string[]): string[] {
  if (resultCount === 0) return []
  return requested.filter((field) => (EXAM_RESULT_LOCKED_FIELDS as readonly string[]).includes(field))
}

/**
 * The number of recorded results. The server counts `exam_results` rows; the
 * DTO's `results.students` counts the students holding one — one row per
 * student, so the two are the same number.
 */
export function resultCountOf(exam: Pick<Exam, 'results'>): number {
  return exam.results.students
}

export interface ExamEditability {
  /** The edit form may open at all (needs `exams.manage` and a class that is not cancelled). */
  editable: boolean
  /** `maxScore` is read-only (a result exists). */
  maxScoreLocked: boolean
}

export function examEditability(exam: Pick<Exam, 'class' | 'results'>, canManage: boolean): ExamEditability {
  const maxScoreLocked = resultCountOf(exam) > 0
  return { editable: canManage && !isClassFrozenForExams(exam.class.status), maxScoreLocked }
}

/**
 * What the menu offers: nothing without `exams.manage`; the status actions the
 * state machine allows — `schedule`/`publish` not for a cancelled class,
 * `unschedule` only without results (`exam_has_results`) — then `delete` for a
 * draft or scheduled exam without results, of a cancelled class too.
 */
export function availableExamActions(exam: Pick<Exam, 'status' | 'class' | 'results'>, canManage: boolean): ExamMenuAction[] {
  if (!canManage) return []
  const frozen = isClassFrozenForExams(exam.class.status)
  const results = resultCountOf(exam)
  const actions: ExamMenuAction[] = allowedExamActions(exam.status).filter(
    (action) => !(frozen && actionNeedsLiveClass(action)) && !(action === 'unschedule' && results > 0),
  )
  if (isExamDeletable(exam.status, results)) actions.push('delete')
  return actions
}

/** Actions shown in red and confirmed as dangerous: deleting cannot be undone (the others can be reversed). */
export function isDangerousExamAction(action: ExamMenuAction): boolean {
  return action === 'delete'
}
