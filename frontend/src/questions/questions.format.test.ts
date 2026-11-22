import { describe, expect, it } from 'vitest'
import { QUESTION_STATUSES } from '../api/questionBanks'
import { PROMPT_EXCERPT_LENGTH, QUESTION_STATUS_COLORS, isIncomplete, isLinkedToExams, matchesStatusFilter, promptExcerpt, restoredStatusOf, statusActionsOf, statusOfAction } from './questions.format'

describe('promptExcerpt()', () => {
  it('keeps a short prompt as it is, on one line', () => {
    expect(promptExcerpt('ما ناتج 2 + 3؟')).toBe('ما ناتج 2 + 3؟')
    expect(promptExcerpt('  سطر أول\n\nسطر   ثانٍ  ')).toBe('سطر أول سطر ثانٍ')
    expect(promptExcerpt('')).toBe('')
  })

  it('cuts a long prompt after the limit with an ellipsis, never inside a surrogate pair', () => {
    const long = 'س'.repeat(PROMPT_EXCERPT_LENGTH + 10)
    expect(promptExcerpt(long)).toBe(`${'س'.repeat(PROMPT_EXCERPT_LENGTH)}…`)
    expect(promptExcerpt('أب جد هوز', 5)).toBe('أب جد…')
    // Each emoji is one character (two UTF-16 units): the cut keeps it whole.
    expect(promptExcerpt('😀😀😀😀', 2)).toBe('😀😀…')
    expect(promptExcerpt('😀😀', 2)).toBe('😀😀')
  })
})

describe('the row actions of a question', () => {
  it('offers each status its own actions, in display order', () => {
    expect(statusActionsOf('draft')).toEqual(['markReady', 'archive'])
    expect(statusActionsOf('ready')).toEqual(['backToDraft', 'archive'])
    expect(statusActionsOf('archived')).toEqual(['restore'])
  })

  it('asks API-268 for the status each action means', () => {
    const complete = { missing: [] }
    expect(statusOfAction(complete, 'markReady')).toBe('ready')
    expect(statusOfAction(complete, 'backToDraft')).toBe('draft')
    expect(statusOfAction(complete, 'archive')).toBe('archived')
  })

  it('restores a complete question as ready and an incomplete one as a draft — the server would refuse «ready» for it', () => {
    expect(restoredStatusOf({ missing: [] })).toBe('ready')
    expect(restoredStatusOf({ missing: ['correct_option_required'] })).toBe('draft')
    expect(statusOfAction({ missing: [] }, 'restore')).toBe('ready')
    expect(statusOfAction({ missing: ['options_too_few', 'correct_option_required'] }, 'restore')).toBe('draft')
  })

  it('reads what the server says about a row: incomplete, and linked by exams', () => {
    expect(isIncomplete({ missing: [] })).toBe(false)
    expect(isIncomplete({ missing: ['correct_answer_required'] })).toBe(true)
    expect(isLinkedToExams({ examCount: 0 })).toBe(false)
    expect(isLinkedToExams({ examCount: 2 })).toBe(true)
  })
})

describe('matchesStatusFilter()', () => {
  it('shows the drafts and the ready questions without a filter, and exactly the status asked for with one', () => {
    expect(QUESTION_STATUSES.filter((status) => matchesStatusFilter(status, undefined))).toEqual(['draft', 'ready'])
    expect(QUESTION_STATUSES.filter((status) => matchesStatusFilter(status, 'archived'))).toEqual(['archived'])
    expect(QUESTION_STATUSES.filter((status) => matchesStatusFilter(status, 'draft'))).toEqual(['draft'])
    expect(QUESTION_STATUSES.filter((status) => matchesStatusFilter(status, 'ready'))).toEqual(['ready'])
  })
})

describe('QUESTION_STATUS_COLORS', () => {
  it('has a colour for every status', () => {
    expect(Object.keys(QUESTION_STATUS_COLORS).sort()).toEqual([...QUESTION_STATUSES].sort())
  })
})
