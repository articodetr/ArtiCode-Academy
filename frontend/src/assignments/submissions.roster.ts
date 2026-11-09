// Helpers of the submissions roster (J-F41). API-108 takes no filter and has
// no pagination (a class's roster is bounded by its capacity), so the tab
// filters the rows it loaded — exact, since it holds the whole roster — by the
// state of each student's latest attempt as the server answered it; lateness is
// the server's `isLate`, never this device's clock. Pure; unit-tested in
// submissions.roster.test.ts.
import type { SubmissionRosterItem, SubmissionStatus } from '../api/submissions'

/** `awaiting` = the latest attempt waits for review (`submitted`); `notSubmitted` = no attempt yet; `late` = the latest attempt came late. */
export const ROSTER_FILTERS = ['all', 'awaiting', 'notSubmitted', 'graded', 'returned', 'late'] as const
export type RosterFilter = (typeof ROSTER_FILTERS)[number]

/** The state the roster shows for a student: their latest attempt's status, or `none`. */
export type RosterState = SubmissionStatus | 'none'

export function rosterStateOf(item: Pick<SubmissionRosterItem, 'latest'>): RosterState {
  return item.latest?.status ?? 'none'
}

export function rosterItemMatches(item: Pick<SubmissionRosterItem, 'latest'>, filter: RosterFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'awaiting':
      return item.latest?.status === 'submitted'
    case 'notSubmitted':
      return item.latest === null
    case 'graded':
    case 'returned':
      return item.latest?.status === filter
    case 'late':
      return item.latest?.isLate === true
  }
}

/** The rows of `items` the filter keeps, in the server's (enrollment) order. */
export function filterRoster<T extends Pick<SubmissionRosterItem, 'latest'>>(items: readonly T[], filter: RosterFilter): T[] {
  return items.filter((item) => rosterItemMatches(item, filter))
}

/**
 * The score the roster shows: the latest attempt's when it is graded; else the
 * latest graded attempt's (`lastGradedScore` — an earlier attempt), marked as
 * such; else none.
 */
export function rosterScoreOf(item: Pick<SubmissionRosterItem, 'latest' | 'lastGradedScore'>): { score: number; earlier: boolean } | null {
  if (item.latest?.status === 'graded' && item.latest.score !== null) return { score: item.latest.score, earlier: false }
  if (item.lastGradedScore !== null) return { score: item.lastGradedScore, earlier: true }
  return null
}
