// MOD-20 — the curriculum editor's pure rules: the draft of API-226, its edits, the API-227 body, the dirty check,
// the local checks and the lessons put back after a 409 lesson_has_progress.
import { describe, expect, it } from 'vitest'
import { ITEM_IDS, SECTION_IDS, makeCurriculum } from '../test/curriculum'
import { arabicOrdinal, formatMediaDuration } from './curriculum.format'
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
  removeLesson,
  removeLevel,
  restoreLessons,
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
    expect(body.sections[2]).toEqual({ title: { ar: 'المتقدم' }, items: [{ title: { ar: 'درس جديد' }, estimatedMinutes: 30, isRequired: true, isPublished: true }] })
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
  })
})
