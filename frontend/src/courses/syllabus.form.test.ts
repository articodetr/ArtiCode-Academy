import { describe, expect, it } from 'vitest'
import { SYLLABUS_ITEM_IDS, THREE_ITEMS } from '../test/courses'
import { buildSyllabusInput, emptySyllabusDraft, planSyllabusReplacement, syllabusDraftsOf, totalMinutes } from './syllabus.form'

describe('syllabus editor helpers (MOD-04-T06)', () => {
  it('sends nothing when the edited list equals the stored syllabus (AC1)', () => {
    const items = THREE_ITEMS()
    expect(planSyllabusReplacement(items, syllabusDraftsOf(items))).toBeNull()
    expect(planSyllabusReplacement([], [])).toBeNull()
  })

  it('builds the complete ordered list: ids kept, new items without id, filled fields only, Turkish text kept', () => {
    const items = THREE_ITEMS()
    const [first, , third] = syllabusDraftsOf(items)
    const drafts = [third!, { ...first!, titleEn: '' }, { ...emptySyllabusDraft(), titleAr: ' الدوال ', estimatedMinutes: 30 }]
    expect(planSyllabusReplacement(items, drafts)).toEqual([
      { id: SYLLABUS_ITEM_IDS[2], title: { ar: 'الحلقات', en: 'Loops', tr: 'Döngüler' } },
      { id: SYLLABUS_ITEM_IDS[0], title: { ar: 'المتغيرات' }, estimatedMinutes: 45 },
      { title: { ar: 'الدوال' }, estimatedMinutes: 30 },
    ])
  })

  it('detects a pure reorder, a cleared description and a removed estimate as changes', () => {
    const items = THREE_ITEMS()
    const drafts = syllabusDraftsOf(items)
    expect(planSyllabusReplacement(items, [drafts[1]!, drafts[0]!, drafts[2]!])).toHaveLength(3)
    const cleared = planSyllabusReplacement(items, [drafts[0]!, { ...drafts[1]!, descriptionAr: '', estimatedMinutes: null }, drafts[2]!])
    expect(cleared?.[1]).toEqual({ id: SYLLABUS_ITEM_IDS[1], title: { ar: 'الشروط' } })
    expect(buildSyllabusInput([drafts[0]!], items)).toEqual([{ id: SYLLABUS_ITEM_IDS[0], title: { ar: 'المتغيرات', en: 'Variables' }, estimatedMinutes: 45 }])
  })

  it('sums the estimates, counting an item without one as zero', () => {
    expect(totalMinutes(THREE_ITEMS())).toBe(105)
    expect(totalMinutes([])).toBe(0)
  })
})
