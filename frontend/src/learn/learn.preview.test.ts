// TEST-263 (LRN-T06, D-R144) — the author's curriculum (API-226) as the
// course player's shapes: published lessons only unless the drafts are asked
// for, a level without a shown lesson left out and the levels renumbered, the
// lessons outside every level last, every level open with its release rule,
// nothing started, and the neighbours in the shown order.
import { describe, expect, it } from 'vitest'
import type { Curriculum, CurriculumItem, CurriculumSection } from '../api/curriculum'
import { previewItemOf, previewModelOf, releaseDaysOf } from './learn.preview'

function lesson(id: string, isPublished = true): CurriculumItem {
  const value = {
    id,
    sortOrder: 0,
    title: { ar: id },
    description: null,
    estimatedMinutes: 10,
    kind: 'text' as const,
    content: null,
    resources: [],
    isRequired: true,
    isPublished,
    completionMode: 'manual' as const,
    durationSeconds: 600,
    progressCount: 0,
    sessionCount: 0,
    updatedAt: '2026-11-19T10:00:00.000Z',
  }
  return value as CurriculumItem
}

function level(id: string, items: CurriculumItem[], releaseAfterDays: number | null = null): CurriculumSection {
  const value = { id, number: 1, sortOrder: 0, title: null, description: null, releaseAfterDays, items }
  return value as CurriculumSection
}

const curriculum: Curriculum = {
  courseId: 'c1',
  courseCode: 'PY-101',
  canManage: true,
  sections: [level('draftsOnly', [lesson('d1', false)]), level('s2', [lesson('a'), lesson('b', false)], 7), level('empty', [])],
  looseItems: [lesson('loose')],
}

describe('previewModelOf / previewItemOf', () => {
  it('shows the published lessons only, numbers the shown levels and keeps the loose lessons last', () => {
    const model = previewModelOf(curriculum, { showDrafts: false })
    expect(model.workspace.sections.map((section) => [section.id, section.number, section.items.map((item) => item.id)])).toEqual([
      ['s2', 1, ['a']],
      [null, 2, ['loose']],
    ])
    expect(model.order).toEqual(['a', 'loose'])
    expect(model.hiddenDrafts).toBe(2)
    expect(model.drafts.size).toBe(0)
    expect(model.releaseAfterDays.get('s2')).toBe(7)
    expect(model.workspace.sections.every((section) => section.isOpen && section.opensOn === null)).toBe(true)
    expect(model.workspace.sections[0]!.items[0]).toMatchObject({ state: 'not_started', available: true })
    expect(model.workspace.progress).toMatchObject({ total: 2, required: 2, completed: 0, percent: 0 })
    expect(model.workspace.sessions).toEqual([])
  })

  it('adds the drafts when asked, marked as drafts', () => {
    const model = previewModelOf(curriculum, { showDrafts: true })
    expect(model.order).toEqual(['d1', 'a', 'b', 'loose'])
    expect([...model.drafts].sort()).toEqual(['b', 'd1'])
    expect(model.hiddenDrafts).toBe(0)
  })

  it('gives a shown lesson its level and its neighbours in the shown order — and nothing for a hidden one', () => {
    const model = previewModelOf(curriculum, { showDrafts: false })
    const item = previewItemOf(model, 'loose', 85)!
    expect(item.section).toEqual({ id: null, number: 2, title: null })
    expect(item.neighbors).toEqual({ previous: { id: 'a', title: { ar: 'a' }, available: true }, next: null })
    expect(item.completionPercent).toBe(85)
    expect(item.progress.state).toBe('not_started')
    expect(previewItemOf(model, 'b', 85)).toBeNull()
  })

  it('states a release rule of 0..365 whole days only', () => {
    expect(releaseDaysOf(level('x', [], 0))).toBe(0)
    expect(releaseDaysOf(level('x', [], 365))).toBe(365)
    expect(releaseDaysOf(level('x', [], 400))).toBeNull()
    expect(releaseDaysOf(level('x', [], null))).toBeNull()
  })
})
