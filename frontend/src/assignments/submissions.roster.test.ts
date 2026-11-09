import { describe, expect, it } from 'vitest'
import { rosterOfFour } from '../test/submissions'
import { ROSTER_FILTERS, filterRoster, rosterItemMatches, rosterScoreOf, rosterStateOf } from './submissions.roster'

const names = (items: ReturnType<typeof rosterOfFour>) => items.map((item) => item.student.fullName)

describe('the submissions roster helpers', () => {
  it('shows the latest attempt state, or none without an attempt', () => {
    expect(rosterOfFour().map(rosterStateOf)).toEqual(['submitted', 'graded', 'returned', 'none'])
  })

  it('filters the loaded roster by the latest attempt, in the server order; late is the server isLate', () => {
    const roster = rosterOfFour()
    expect(names(filterRoster(roster, 'all'))).toEqual(['سارة الطالبة', 'يوسف الطالب', 'ليلى المنسحبة', 'عمر الخريج'])
    expect(names(filterRoster(roster, 'awaiting'))).toEqual(['سارة الطالبة'])
    expect(names(filterRoster(roster, 'notSubmitted'))).toEqual(['عمر الخريج'])
    expect(names(filterRoster(roster, 'graded'))).toEqual(['يوسف الطالب'])
    expect(names(filterRoster(roster, 'returned'))).toEqual(['ليلى المنسحبة'])
    expect(names(filterRoster(roster, 'late'))).toEqual(['يوسف الطالب'])
    // Every filter is a predicate on the row alone.
    for (const filter of ROSTER_FILTERS) expect(roster.filter((item) => rosterItemMatches(item, filter))).toEqual(filterRoster(roster, filter))
  })

  it('shows the latest graded score, marked as an earlier attempt when the latest is not graded', () => {
    const [sara, yousef, layla, omar] = rosterOfFour()
    expect(rosterScoreOf(sara!)).toBeNull()
    expect(rosterScoreOf(yousef!)).toEqual({ score: 17.5, earlier: false })
    expect(rosterScoreOf(layla!)).toEqual({ score: 12, earlier: true })
    expect(rosterScoreOf(omar!)).toBeNull()
  })
})
