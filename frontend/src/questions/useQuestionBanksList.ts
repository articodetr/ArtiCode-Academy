// State of the banks table (MOD-09 phase 2 — OEX-T07): API-260 through the
// shared keyset hook, with the filters the contract supports — part of the
// name (`q`) and the course (a course id, or `none` for the banks filed under no
// course). The server lists the newest bank first and applies the visibility
// (D-R162): the page never filters by owner.
import { listQuestionBanks } from '../api/questionBanks'
import type { QuestionBank } from '../api/questionBanks'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'

export const BANK_PAGE_SIZES = [20, 50, 100] as const

export interface QuestionBanksFilters {
  /** Part of the Arabic or English name. */
  q: string | undefined
  /** A course id, or NO_COURSE_FILTER (`none`). */
  courseId: string | undefined
  limit: (typeof BANK_PAGE_SIZES)[number]
}

export const DEFAULT_BANK_FILTERS: QuestionBanksFilters = { q: undefined, courseId: undefined, limit: 20 }

/** True when the list is narrowed (the page size narrows nothing). */
export function hasActiveBankFilters(filters: QuestionBanksFilters): boolean {
  return Boolean(filters.q || filters.courseId)
}

const loadBanks: KeysetLoader<QuestionBank, QuestionBanksFilters> = (filters, cursor, signal) =>
  listQuestionBanks({ q: filters.q, courseId: filters.courseId, limit: filters.limit, cursor }, signal)

export function useQuestionBanksList(initialFilters: QuestionBanksFilters = DEFAULT_BANK_FILTERS) {
  return useKeysetList(loadBanks, initialFilters)
}
