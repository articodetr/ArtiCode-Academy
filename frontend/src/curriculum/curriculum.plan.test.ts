// MOD-20 — the curriculum editor's pure rules: the draft of API-226, its edits, the API-227 body, the dirty check,
// the local checks and the lessons put back after a 409 lesson_has_progress; LRN-T06 (TEST-264): a new lesson is a
// draft (D-R144), «publish level» / «publish all» switch the draft only, a level's releaseAfterDays (D-R145).
import { describe, expect, it } from 'vitest'
import { ITEM_IDS, SECTION_IDS, makeCurriculum } from '../test/curriculum'
import { arabicOrdinal, formatMediaDuration, previewPath } from './curriculum.format'
import {
  CURRICULUM_PROBLEM,
  LOOSE_GROUP,
  addLesson,
  addLevel,
  buildCurriculumInput,
  curriculumDraftOf,
  curriculumHasChanges,
  curriculumProblems,
  groupOfLesson,
  lessonCount,
  moveLesson,
  moveLessonTo,
  moveLevel,
  planCurriculumSave,
  problemKey,
  publishAll,
  publishLevel,
  removeLesson,
  removeLevel,
  restoreLessons,
  unpublishedCount,
  updateLesson,
  updateLevel,
  withItem,
} from './curriculum.plan'

const keysOf = (lessons: { key: string }[]) => lessons.map((lesson) => lesson.key)

describe('curriculum plan (MOD-20)', () => {
  it('drafts the stored curriculum and sends nothing while it is unchanged', () => {
    const saved = makeCurriculum()
    const draft = curriculumDraftOf(saved)
    expect(draft.levels.map((level) => [level.key, level.titleAr, level.titleEn])).toEqual([
      [SECTION_IDS[0], 'البداية', 'Start'],
      [SECTION_IDS[1], '', ''],
    ])
    expect(keysOf(draft.levels[0]!.lessons)).toEqual([ITEM_IDS[0], ITEM_IDS[1]])
    expect(keysOf(draft.loose)).toEqual([ITEM_IDS[3]])
    expect(lessonCount(draft)).toBe(4)
    expect(planCurriculumSave(saved, draft)).toBeNull()
    expect(curriculumHasChanges(saved, draft)).toBe(false)
  })

  it('builds the complete body: levels in order with their lessons, the loose lessons, Turkish texts kept, only filled optional fields', () => {
    const saved = makeCurriculum()
    expect(buildCurriculumInput(curriculumDraftOf(saved), saved)).toEqual({
      sections: [
        {
          id: SECTION_IDS[0],
          title: { ar: 'البداية', en: 'Start' },
          items: [
            { id: ITEM_IDS[0], title: { ar: 'المتغيرات', en: 'Variables' }, estimatedMinutes: 45, isRequired: true, isPublished: true },
            { id: ITEM_IDS[1], title: { ar: 'الشروط' }, description: { ar: 'if و else' }, estimatedMinutes: 60, isRequired: true, isPublished: true },
          ],
        },
        { id: SECTION_IDS[1], items: [{ id: ITEM_IDS[2], title: { ar: 'الحلقات', en: 'Loops', tr: 'Döngüler' }, isRequired: true, isPublished: true }] },
      ],
      looseItems: [{ id: ITEM_IDS[3], title: { ar: 'مراجعة' }, isRequired: false, isPublished: false }],
    })
  })

  it('adds a level and a lesson, and a change changed back holds nothing', () => {
    const saved = makeCurriculum()
    let draft = addLevel(curriculumDraftOf(saved), 'new-l')
    draft = addLesson(draft, 'new-l', 'new-x')
    draft = updateLesson(draft, 'new-x', { titleAr: 'درس جديد', estimatedMinutes: 30 })
    draft = updateLevel(draft, 'new-l', { titleAr: 'المتقدم' })
    expect(groupOfLesson(draft, 'new-x')).toBe('new-l')
    const body = planCurriculumSave(saved, draft)!
    // A new lesson is an unpublished draft (D-R144); a new level opens at once (no releaseAfterDays in the body).
    expect(body.sections[2]).toEqual({ title: { ar: 'المتقدم' }, items: [{ title: { ar: 'درس جديد' }, estimatedMinutes: 30, isRequired: true, isPublished: false }] })
    expect(curriculumHasChanges(saved, draft)).toBe(true)

    draft = removeLevel(draft, 'new-l')
    expect(planCurriculumSave(saved, draft)).toBeNull()
    expect(curriculumHasChanges(saved, draft)).toBe(false)
    // A title typed away and back.
    draft = updateLesson(draft, ITEM_IDS[0], { titleAr: 'المتغيرات!' })
    expect(curriculumHasChanges(saved, draft)).toBe(true)
    draft = updateLesson(draft, ITEM_IDS[0], { titleAr: 'المتغيرات' })
    expect(curriculumHasChanges(saved, draft)).toBe(false)
  })

  it('moves lessons up, down and to another group, and levels up and down; out-of-range moves change nothing', () => {
    const saved = makeCurriculum()
    let draft = curriculumDraftOf(saved)
    draft = moveLesson(draft, ITEM_IDS[1], -1)
    expect(keysOf(draft.levels[0]!.lessons)).toEqual([ITEM_IDS[1], ITEM_IDS[0]])
    expect(moveLesson(draft, ITEM_IDS[1], -1)).toEqual(draft)
    draft = moveLessonTo(draft, ITEM_IDS[3], SECTION_IDS[0])
    expect(keysOf(draft.levels[0]!.lessons)).toEqual([ITEM_IDS[1], ITEM_IDS[0], ITEM_IDS[3]])
    expect(draft.loose).toEqual([])
    draft = moveLessonTo(draft, ITEM_IDS[2], LOOSE_GROUP)
    expect(draft.levels[1]!.lessons).toEqual([])
    expect(keysOf(draft.loose)).toEqual([ITEM_IDS[2]])
    expect(moveLessonTo(draft, ITEM_IDS[2], 'unknown-level')).toBe(draft)
    draft = moveLevel(draft, SECTION_IDS[1], -1)
    expect(draft.levels.map((level) => level.key)).toEqual([SECTION_IDS[1], SECTION_IDS[0]])
    expect(moveLevel(draft, SECTION_IDS[1], -1).levels.map((level) => level.key)).toEqual([SECTION_IDS[1], SECTION_IDS[0]])

    const body = planCurriculumSave(saved, draft)!
    expect(body.sections.map((section) => [section.id, section.items.map((item) => item.id)])).toEqual([
      [SECTION_IDS[1], []],
      [SECTION_IDS[0], [ITEM_IDS[1], ITEM_IDS[0], ITEM_IDS[3]]],
    ])
    expect(body.looseItems!.map((item) => item.id)).toEqual([ITEM_IDS[2]])
  })

  it('counts a removed lesson and a flipped switch as changes', () => {
    const saved = makeCurriculum()
    expect(planCurriculumSave(saved, removeLesson(curriculumDraftOf(saved), ITEM_IDS[0]))!.sections[0]!.items.map((item) => item.id)).toEqual([ITEM_IDS[1]])
    const body = planCurriculumSave(saved, updateLesson(curriculumDraftOf(saved), ITEM_IDS[3], { isPublished: true }))!
    expect(body.looseItems![0]).toEqual({ id: ITEM_IDS[3], title: { ar: 'مراجعة' }, isRequired: false, isPublished: true })
  })

  it('treats an English text without its Arabic one as unsaved work and as a problem', () => {
    const saved = makeCurriculum()
    const draft = updateLevel(curriculumDraftOf(saved), SECTION_IDS[1], { titleEn: 'Loops level' })
    // The save would drop it (the level title needs its Arabic text): nothing to send, still unsaved.
    expect(planCurriculumSave(saved, draft)).toBeNull()
    expect(curriculumHasChanges(saved, draft)).toBe(true)
    expect(curriculumProblems(draft).get(problemKey(SECTION_IDS[1], 'titleEn'))).toEqual({ key: 'curriculum.validation.arabicFirst' })
  })

  it('checks the lessons before the save: the Arabic title, the minutes, the structure size', () => {
    const saved = makeCurriculum()
    let draft = addLesson(curriculumDraftOf(saved), LOOSE_GROUP, 'new-1')
    draft = updateLesson(draft, ITEM_IDS[0], { estimatedMinutes: 2000 })
    const problems = curriculumProblems(draft)
    expect(problems.get(problemKey('new-1', 'titleAr'))).toEqual({ key: 'curriculum.validation.titleArRequired' })
    expect(problems.get(problemKey(ITEM_IDS[0], 'estimatedMinutes'))).toEqual({ key: 'curriculum.validation.minutes', params: { max: 1440 } })
    expect(problems.has(CURRICULUM_PROBLEM)).toBe(false)
    let big = curriculumDraftOf(saved)
    for (let index = 0; index < 49; index += 1) big = addLevel(big, `level-${index}`)
    expect(curriculumProblems(big).get(CURRICULUM_PROBLEM)).toEqual({ key: 'curriculum.level.maxReached', params: { max: 50 } })
  })

  it('puts back the lessons the server refused to delete, at their saved place, or outside the levels when their level is gone', () => {
    const saved = makeCurriculum()
    let draft = removeLesson(curriculumDraftOf(saved), ITEM_IDS[1])
    draft = removeLevel(draft, SECTION_IDS[1])
    draft = removeLesson(draft, ITEM_IDS[3])
    const restored = restoreLessons(draft, saved, [ITEM_IDS[1], ITEM_IDS[2], ITEM_IDS[3], 'unknown'])
    expect(keysOf(restored.levels[0]!.lessons)).toEqual([ITEM_IDS[0], ITEM_IDS[1]])
    expect(restored.levels).toHaveLength(1)
    expect(keysOf(restored.loose)).toEqual([ITEM_IDS[3], ITEM_IDS[2]])
    // A lesson still in the draft is left where it is.
    expect(restoreLessons(restored, saved, [ITEM_IDS[0]])).toBe(restored)
  })

  it('replaces one lesson by the answer of API-228 without touching the structure', () => {
    const saved = makeCurriculum()
    const updated = withItem(saved, { ...saved.sections[1]!.items[0]!, kind: 'pdf', content: { url: 'https://cdn.example.org/a.pdf' } })
    expect(updated.sections[1]!.items[0]!.kind).toBe('pdf')
    expect(planCurriculumSave(updated, curriculumDraftOf(saved))).toBeNull()
  })

  it('LRN-T06 — publishes one level or every lesson in the draft only, and changes nothing when all are published already (D-R144)', () => {
    const saved = makeCurriculum()
    let draft = addLesson(curriculumDraftOf(saved), SECTION_IDS[1], 'new-p')
    draft = updateLesson(draft, 'new-p', { titleAr: 'درس مسودة' })
    // The stored «مراجعة» (outside the levels) and the new lesson are unpublished.
    expect(unpublishedCount(draft)).toBe(2)
    expect(unpublishedCount(draft, SECTION_IDS[0])).toBe(0)
    expect(unpublishedCount(draft, SECTION_IDS[1])).toBe(1)
    expect(publishLevel(draft, SECTION_IDS[0])).toBe(draft)

    const level = publishLevel(draft, SECTION_IDS[1])
    expect(unpublishedCount(level, SECTION_IDS[1])).toBe(0)
    // Only that level: the lesson outside the levels stays a draft.
    expect(unpublishedCount(level)).toBe(1)
    const body = planCurriculumSave(saved, level)!
    expect(body.sections[1]!.items).toEqual([
      { id: ITEM_IDS[2], title: { ar: 'الحلقات', en: 'Loops', tr: 'Döngüler' }, isRequired: true, isPublished: true },
      { title: { ar: 'درس مسودة' }, isRequired: true, isPublished: true },
    ])
    expect(body.looseItems).toEqual([{ id: ITEM_IDS[3], title: { ar: 'مراجعة' }, isRequired: false, isPublished: false }])

    const all = publishAll(draft)
    expect(unpublishedCount(all)).toBe(0)
    expect(publishAll(all)).toBe(all)
    expect(planCurriculumSave(saved, all)!.looseItems).toEqual([{ id: ITEM_IDS[3], title: { ar: 'مراجعة' }, isRequired: false, isPublished: true }])
    // Publishing a stored lesson and switching it back is no change.
    const back = updateLesson(publishAll(curriculumDraftOf(saved)), ITEM_IDS[3], { isPublished: false })
    expect(planCurriculumSave(saved, back)).toBeNull()
    expect(curriculumHasChanges(saved, back)).toBe(false)
  })

  it('LRN-T06 — carries a level’s releaseAfterDays: read from the server, sent when set, part of the dirty check, checked 0..365 (D-R145)', () => {
    const saved = makeCurriculum({
      sections: [makeCurriculum().sections[0]!, { ...makeCurriculum().sections[1]!, releaseAfterDays: 14 }],
    })
    const draft = curriculumDraftOf(saved)
    expect(draft.levels.map((level) => level.releaseAfterDays)).toEqual([null, 14])
    expect(planCurriculumSave(saved, draft)).toBeNull()
    // Sent when set; absent when the level opens at once (absent = null on the server).
    const built = buildCurriculumInput(draft, saved)
    expect(built.sections[0]).not.toHaveProperty('releaseAfterDays')
    expect(built.sections[1]).toEqual({ id: SECTION_IDS[1], releaseAfterDays: 14, items: [{ id: ITEM_IDS[2], title: { ar: 'الحلقات', en: 'Loops', tr: 'Döngüler' }, isRequired: true, isPublished: true }] })

    // A changed value is a change; 0 (on the class's start day) differs from null (at once).
    const opened = updateLevel(draft, SECTION_IDS[0], { releaseAfterDays: 0 })
    expect(curriculumHasChanges(saved, opened)).toBe(true)
    expect(planCurriculumSave(saved, opened)!.sections[0]).toMatchObject({ id: SECTION_IDS[0], releaseAfterDays: 0 })
    const cleared = updateLevel(draft, SECTION_IDS[1], { releaseAfterDays: null })
    expect(planCurriculumSave(saved, cleared)!.sections[1]).not.toHaveProperty('releaseAfterDays')
    // Changed back: nothing to send.
    expect(planCurriculumSave(saved, updateLevel(cleared, SECTION_IDS[1], { releaseAfterDays: 14 }))).toBeNull()
    // A new level carries its value too.
    const added = updateLevel(addLevel(draft, 'new-r'), 'new-r', { releaseAfterDays: 30 })
    expect(planCurriculumSave(saved, added)!.sections[2]).toEqual({ releaseAfterDays: 30, items: [] })

    // The server's rule: a whole number 0..365.
    for (const days of [-1, 366, 2.5]) {
      expect(curriculumProblems(updateLevel(draft, SECTION_IDS[0], { releaseAfterDays: days })).get(problemKey(SECTION_IDS[0], 'releaseAfterDays'))).toEqual({
        key: 'curriculum.validation.releaseDays',
        params: { max: 365 },
      })
    }
    for (const days of [0, 365, null]) expect(curriculumProblems(updateLevel(draft, SECTION_IDS[0], { releaseAfterDays: days })).size).toBe(0)
  })

  it('names the levels with Arabic ordinals and formats media lengths', () => {
    expect([1, 2, 3, 10, 11, 12, 19, 20, 21, 22, 35, 50, 99, 100].map(arabicOrdinal)).toEqual([
      'الأول',
      'الثاني',
      'الثالث',
      'العاشر',
      'الحادي عشر',
      'الثاني عشر',
      'التاسع عشر',
      'العشرون',
      'الحادي والعشرون',
      'الثاني والعشرون',
      'الخامس والثلاثون',
      'الخمسون',
      'التاسع والتسعون',
      '100',
    ])
    expect([0, 59, 125, 3600, 3725].map(formatMediaDuration)).toEqual(['0:00', '0:59', '2:05', '1:00:00', '1:02:05'])
    expect(previewPath('c/1')).toBe('/learn/c%2F1/preview')
  })
})
