// Pure presentation rules of the question banks page (MOD-09 phase 2 —
// OEX-T07): the status tags, the short form of a prompt for an action's
// accessible name, the row actions each status offers and the status each of
// them asks API-268 for, and whether a written row still belongs to the list on
// screen. No React, no i18next instance. Unit-tested in questions.format.test.ts.
import type { Question, QuestionCreateStatus, QuestionStatus } from '../api/questionBanks'

/** Tag colours of the three statuses (`questionBanks.statuses.*` carries the texts): a draft still needs work. */
export const QUESTION_STATUS_COLORS: Readonly<Record<QuestionStatus, string>> = {
  draft: 'gold',
  ready: 'green',
  archived: 'default',
}

export const PROMPT_EXCERPT_LENGTH = 48

/** A prompt on one line, cut after `max` characters (never inside a surrogate pair) — the name a row's buttons carry. */
export function promptExcerpt(prompt: string, max = PROMPT_EXCERPT_LENGTH): string {
  const characters = Array.from(prompt.trim().replace(/\s+/g, ' '))
  return characters.length <= max ? characters.join('') : `${characters.slice(0, max).join('').trimEnd()}…`
}

/** The actions of a row besides «edit», which every status has. */
export type QuestionStatusAction = 'markReady' | 'backToDraft' | 'archive' | 'restore'

/** The status actions a question offers, in display order. */
export function statusActionsOf(status: QuestionStatus): QuestionStatusAction[] {
  if (status === 'draft') return ['markReady', 'archive']
  if (status === 'ready') return ['backToDraft', 'archive']
  return ['restore']
}

/**
 * The status a question leaves the archive with: `ready` when the server names
 * nothing it lacks, else `draft` — API-268 would refuse `ready` for an
 * incomplete question (`question_invalid`).
 */
export function restoredStatusOf(question: Pick<Question, 'missing'>): QuestionCreateStatus {
  return question.missing.length === 0 ? 'ready' : 'draft'
}

/** The `status` an action sends in its PATCH (API-268). */
export function statusOfAction(question: Pick<Question, 'missing'>, action: QuestionStatusAction): QuestionStatus {
  if (action === 'markReady') return 'ready'
  if (action === 'backToDraft') return 'draft'
  if (action === 'archive') return 'archived'
  return restoredStatusOf(question)
}

/** «make it ready» for a question the server says is incomplete would be refused (`question_invalid`): the button says why instead. */
export function isIncomplete(question: Pick<Question, 'missing'>): boolean {
  return question.missing.length > 0
}

/** A question an exam links is archived, never deleted (`question_in_use`): the button says so instead. */
export function isLinkedToExams(question: Pick<Question, 'examCount'>): boolean {
  return question.examCount > 0
}

/** Whether a question of this status belongs to the list a status filter shows: no filter = drafts and ready ones (API-265). */
export function matchesStatusFilter(status: QuestionStatus, filter: QuestionStatus | undefined): boolean {
  return filter === undefined ? status !== 'archived' : status === filter
}
