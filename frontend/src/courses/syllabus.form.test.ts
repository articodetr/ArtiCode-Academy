import { describe, expect, it } from 'vitest'
import { SYLLABUS_ITEM_IDS, THREE_ITEMS } from '../test/courses'
import { buildSyllabusInput, emptySyllabusDraft, planSyllabusReplacement, syllabusDraftsOf, syllabusHasChanges, totalMinutes } from './syllabus.form'

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

describe('syllabusHasChanges (KI-054 — J-F23)', () => {
  it('holds nothing for the stored list, an item changed back, or an item added and removed again', () => {
    const items = THREE_ITEMS()
    expect(syllabusHasChanges(items, syllabusDraftsOf(items))).toBe(false)
    expect(syllabusHasChanges([], [])).toBe(false)
  })

  it('holds a list that differs by the comparison of the save: an edit, a move, a removal, an empty new item', () => {
    const items = THREE_ITEMS()
    const drafts = syllabusDraftsOf(items)
    expect(syllabusHasChanges(items, [{ ...drafts[0]!, estimatedMinutes: 50 }, drafts[1]!, drafts[2]!])).toBe(true)
    expect(syllabusHasChanges(items, [drafts[1]!, drafts[0]!, drafts[2]!])).toBe(true)
    expect(syllabusHasChanges(items, drafts.slice(1))).toBe(true)
    expect(syllabusHasChanges(items, [...drafts, emptySyllabusDraft()])).toBe(true)
  })

  it('holds an English description typed without its Arabic text, which the save drops', () => {
    const items = THREE_ITEMS()
    const drafts = syllabusDraftsOf(items)
    const englishOnly = [{ ...drafts[0]!, descriptionEn: 'English only' }, drafts[1]!, drafts[2]!]
    expect(planSyllabusReplacement(items, englishOnly)).toBeNull()
    expect(syllabusHasChanges(items, englishOnly)).toBe(true)
  })
})
