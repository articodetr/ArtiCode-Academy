import { describe, expect, it } from 'vitest'
import type { GradebookCell } from '../api/gradebook'
import { GRADE_SCHEME_IDS, THREE_GRADE_SCHEMES, makeGradeScheme } from '../test/gradeSchemes'
import { DEFAULT_GRADEBOOK_SCHEME, READY, finalizedGradebook, fullGradebook, laylaRow, readyGradebook, saraRow, yousefRow } from '../test/gradebook'
import { canFinalize, cellOf, cellView, finalizeSchemeOptions, hasFinalGrades, hasStaleFinalGrades, isGradableClass, preselectedSchemeId, readinessChecks } from './gradebook.view'

const cell = (overrides: Partial<GradebookCell>): GradebookCell => ({ kind: 'assignment', id: 'a', status: 'graded', score: null, effectiveScore: null, late: false, ...overrides })

describe('cellOf', () => {
  it('takes the aligned cell, and finds it by kind and id when the order ever differs', () => {
    const gradebook = fullGradebook()
    const [homework, project] = gradebook.components
    expect(cellOf(saraRow(), homework!, 0)?.score).toBe(18)
    const shuffled = { cells: [...saraRow().cells].reverse() }
    expect(cellOf(shuffled, project!, 1)?.score).toBe(45)
    expect(cellOf({ cells: [] }, project!, 1)).toBeNull()
  })
})

describe('cellView (the server’s numbers, never a computed one)', () => {
  it('shows the counted score after the late penalty and the score before it only when they differ', () => {
    expect(cellView(cell({ score: 18, effectiveScore: 16.2, late: true }))).toEqual({ value: 16.2, before: 18, late: true, label: null, color: 'green' })
    // Late without a penalty: the same number, nothing «before».
    expect(cellView(cell({ score: 18, effectiveScore: 18, late: true }))).toMatchObject({ value: 18, before: null, late: true })
    expect(cellView(cell({ kind: 'exam', status: 'scored', score: 41.5, effectiveScore: 41.5 }))).toMatchObject({ value: 41.5, before: null, label: null })
  })

  it('names every other status: waiting for review (keeping an earlier graded score), sent back, absent as 0, excused, missing per kind', () => {
    expect(cellView(cell({ status: 'awaiting_review', score: 12, effectiveScore: 12 }))).toMatchObject({ value: 12, label: 'awaiting_review', color: 'gold' })
    expect(cellView(cell({ status: 'awaiting_review' }))).toMatchObject({ value: null, label: 'awaiting_review' })
    expect(cellView(cell({ status: 'returned' }))).toMatchObject({ value: null, label: 'returned' })
    expect(cellView(cell({ kind: 'exam', status: 'absent', effectiveScore: 0 }))).toMatchObject({ value: 0, label: 'absent', color: 'red' })
    expect(cellView(cell({ kind: 'exam', status: 'excused' }))).toMatchObject({ value: null, label: 'excused' })
    expect(cellView(cell({ status: 'missing' }))).toMatchObject({ value: null, label: 'missing_assignment' })
    expect(cellView(cell({ kind: 'exam', status: 'missing' }))).toMatchObject({ value: null, label: 'missing_exam' })
  })
})

describe('readiness (D-R45)', () => {
  it('lists the checks with the server’s counts, and the class status the server’s `ready` leaves out', () => {
    expect(readinessChecks(fullGradebook())).toEqual([
      { key: 'classStatus', ok: true },
      { key: 'weightedComponents', ok: true, count: 3 },
      { key: 'openAssignments', ok: false, count: 1 },
      { key: 'awaitingReview', ok: false, count: 1 },
      { key: 'unpublishedExams', ok: true, count: 0 },
    ])
    const empty = readyGradebook({ readiness: { openAssignments: 0, awaitingReview: 0, unpublishedExams: 2, weightedComponents: 0, ready: false } })
    expect(readinessChecks(empty).filter((check) => !check.ok).map((check) => check.key)).toEqual(['weightedComponents', 'unpublishedExams'])
  })

  it('offers a finalization for the server’s `ready` and a running or completed class only', () => {
    expect(canFinalize(readyGradebook())).toBe(true)
    expect(canFinalize(readyGradebook({ class: { ...readyGradebook().class, status: 'completed' } }))).toBe(true)
    expect(canFinalize(fullGradebook())).toBe(false)
    for (const status of ['planned', 'open', 'cancelled'] as const) {
      expect(isGradableClass(status)).toBe(false)
      expect(canFinalize(readyGradebook({ class: { ...readyGradebook().class, status }, readiness: { ...READY } }))).toBe(false)
    }
  })
})

describe('final grades', () => {
  it('tells whether a grade is fixed (withdrawable) and whether one is stale', () => {
    expect(hasFinalGrades(readyGradebook())).toBe(false)
    expect(hasFinalGrades(finalizedGradebook())).toBe(true)
    expect(hasStaleFinalGrades(finalizedGradebook())).toBe(false)
    expect(hasStaleFinalGrades({ students: [yousefRow(), laylaRow()] })).toBe(true)
  })
})

describe('the scheme picker of a finalization', () => {
  it('offers the active schemes in the server’s order and preselects the default', () => {
    const options = finalizeSchemeOptions(THREE_GRADE_SCHEMES())
    expect(options.map((scheme) => scheme.id)).toEqual([GRADE_SCHEME_IDS[0], GRADE_SCHEME_IDS[1]])
    expect(preselectedSchemeId(options, DEFAULT_GRADEBOOK_SCHEME)).toBe(GRADE_SCHEME_IDS[0])
  })

  it('falls back to the gradebook’s default when it is offered, and to nothing otherwise', () => {
    const unflagged = [makeGradeScheme({ id: GRADE_SCHEME_IDS[1], isDefault: false }), makeGradeScheme({ id: GRADE_SCHEME_IDS[0], isDefault: false })]
    expect(preselectedSchemeId(unflagged, DEFAULT_GRADEBOOK_SCHEME)).toBe(GRADE_SCHEME_IDS[0])
    expect(preselectedSchemeId([unflagged[0]!], DEFAULT_GRADEBOOK_SCHEME)).toBeNull()
    expect(preselectedSchemeId([], null)).toBeNull()
  })
})
