// State of the questions table of one bank (MOD-09 phase 2 — OEX-T07): API-265
// through the shared keyset hook, always inside the bank on screen (`bankId`),
// with the filters the contract supports — part of the prompt (`q`), the type,
// the status, the difficulty and a tag. No status = the drafts and the ready
// questions; archived ones are listed only when asked for. Newest first.
import { listQuestions } from '../api/questionBanks'
import type { Question, QuestionDifficulty, QuestionStatus, QuestionType } from '../api/questionBanks'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'

export const QUESTION_PAGE_SIZES = [20, 50, 100] as const

export interface QuestionsListFilters {
  /** The bank on screen: fixed for the life of the list. */
  bankId: string
  /** Part of the Arabic or English prompt. */
  q: string | undefined
  type: QuestionType | undefined
  /** Absent = drafts and ready questions. */
  status: QuestionStatus | undefined
  difficulty: QuestionDifficulty | undefined
  tag: string | undefined
  limit: (typeof QUESTION_PAGE_SIZES)[number]
}

/** Every draft and ready question of the bank, newest first, 20 per page. */
export function defaultQuestionFilters(bankId: string): QuestionsListFilters {
  return { bankId, q: undefined, type: undefined, status: undefined, difficulty: undefined, tag: undefined, limit: 20 }
}

/** True when the list is narrowed beyond its bank: a text, a type, a status, a difficulty or a tag. */
export function hasActiveQuestionFilters(filters: QuestionsListFilters): boolean {
  return Boolean(filters.q || filters.type || filters.status || filters.difficulty || filters.tag)
}

const loadQuestions: KeysetLoader<Question, QuestionsListFilters> = (filters, cursor, signal) =>
  listQuestions(
    { bankId: filters.bankId, q: filters.q, type: filters.type, status: filters.status, difficulty: filters.difficulty, tag: filters.tag, limit: filters.limit, cursor },
    signal,
  )

export function useQuestionsList(initialFilters: QuestionsListFilters) {
  return useKeysetList(loadQuestions, initialFilters)
}
