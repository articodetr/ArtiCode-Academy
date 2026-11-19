// The curriculum editor ↔ API-227 body (MOD-20, roadmap §4q — D-R130/D-R135), as
// pure rules unit-tested in curriculum.plan.test.ts. The editor holds a draft:
// the levels in order, each with its lessons in order, and the lessons outside
// every level (the trailing group). The PUT body is the COMPLETE structure — a
// level or lesson with an `id` is kept, without one it is created, a missing
// one is deleted; positions are the order of the body. An existing level or
// lesson keeps a Turkish text the editor does not show. The unchanged
// structure is never sent: the server would write nothing anyway.
import type { Curriculum, CurriculumInput, CurriculumItem, CurriculumItemInput, CurriculumSection, CurriculumSectionInput } from '../api/curriculum'
import { CURRICULUM_ITEMS_MAX, CURRICULUM_SECTIONS_MAX, CURRICULUM_TEXT_MAX, LESSON_MINUTES_MAX } from '../api/curriculum'
import type { LocalizedLabel } from '../api/users'
import { englishWithoutArabic, localizedOf, sameLabel } from '../courses/courses.form'

/** The key of the trailing group of lessons outside every level. */
export const LOOSE_GROUP = 'loose'

export interface LessonDraft {
  /** Stable client key: the id of a saved lesson, else a generated one. */
  key: string
  /** Present for a lesson the server already holds. */
  id?: string
  titleAr: string
  titleEn: string
  descriptionAr: string
  descriptionEn: string
  estimatedMinutes: number | null
  isRequired: boolean
  isPublished: boolean
}

export interface LevelDraft {
  key: string
  id?: string
  titleAr: string
  titleEn: string
  descriptionAr: string
  descriptionEn: string
  lessons: LessonDraft[]
}

export interface CurriculumDraft {
  levels: LevelDraft[]
  /** The lessons outside every level, in order. */
  loose: LessonDraft[]
}

export type LessonPatch = Partial<Omit<LessonDraft, 'key' | 'id'>>
export type LevelPatch = Partial<Omit<LevelDraft, 'key' | 'id' | 'lessons'>>

// --- From the server -------------------------------------------------------

export function lessonDraftOf(item: CurriculumItem): LessonDraft {
  return {
    key: item.id,
    id: item.id,
    titleAr: item.title.ar,
    titleEn: item.title.en ?? '',
    descriptionAr: item.description?.ar ?? '',
    descriptionEn: item.description?.en ?? '',
    estimatedMinutes: item.estimatedMinutes,
    isRequired: item.isRequired,
    isPublished: item.isPublished,
  }
}

export function levelDraftOf(section: CurriculumSection): LevelDraft {
  return {
    key: section.id,
    id: section.id,
    titleAr: section.title?.ar ?? '',
    titleEn: section.title?.en ?? '',
    descriptionAr: section.description?.ar ?? '',
    descriptionEn: section.description?.en ?? '',
    lessons: section.items.map(lessonDraftOf),
  }
}

export function curriculumDraftOf(curriculum: Curriculum): CurriculumDraft {
  return { levels: curriculum.sections.map(levelDraftOf), loose: curriculum.looseItems.map(lessonDraftOf) }
}

/** Every lesson of the curriculum in learning order (levels in order, then the loose lessons). */
export function itemsOf(curriculum: Curriculum): CurriculumItem[] {
  return [...curriculum.sections.flatMap((section) => section.items), ...curriculum.looseItems]
}

/** The curriculum with one lesson replaced by the server's answer of API-228 (the structure is untouched). */
export function withItem(curriculum: Curriculum, item: CurriculumItem): Curriculum {
  const swap = (items: CurriculumItem[]) => items.map((current) => (current.id === item.id ? item : current))
  return { ...curriculum, sections: curriculum.sections.map((section) => ({ ...section, items: swap(section.items) })), looseItems: swap(curriculum.looseItems) }
}

// --- Editing the draft -----------------------------------------------------

let draftSequence = 0

/** A client key for a level or lesson the server does not hold yet (never sent). */
export function newDraftKey(): string {
  draftSequence += 1
  return `new-${draftSequence}`
}

/** A new lesson: required and published, as the server's defaults. */
export function emptyLessonDraft(key: string): LessonDraft {
  return { key, titleAr: '', titleEn: '', descriptionAr: '', descriptionEn: '', estimatedMinutes: null, isRequired: true, isPublished: true }
}

export function emptyLevelDraft(key: string): LevelDraft {
  return { key, titleAr: '', titleEn: '', descriptionAr: '', descriptionEn: '', lessons: [] }
}

export function lessonCount(draft: CurriculumDraft): number {
  return draft.levels.reduce((sum, level) => sum + level.lessons.length, draft.loose.length)
}

/** The group (`LOOSE_GROUP` or a level key) that holds the lesson; null when no group does. */
export function groupOfLesson(draft: CurriculumDraft, lessonKey: string): string | null {
  if (draft.loose.some((lesson) => lesson.key === lessonKey)) return LOOSE_GROUP
  return draft.levels.find((level) => level.lessons.some((lesson) => lesson.key === lessonKey))?.key ?? null
}

function mapGroups(draft: CurriculumDraft, map: (lessons: LessonDraft[], groupKey: string) => LessonDraft[]): CurriculumDraft {
  return { levels: draft.levels.map((level) => ({ ...level, lessons: map(level.lessons, level.key) })), loose: map(draft.loose, LOOSE_GROUP) }
}

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return [...list]
  const next = [...list]
  const [entry] = next.splice(from, 1)
  next.splice(to, 0, entry!)
  return next
}

export function addLevel(draft: CurriculumDraft, key: string): CurriculumDraft {
  return { ...draft, levels: [...draft.levels, emptyLevelDraft(key)] }
}

export function updateLevel(draft: CurriculumDraft, levelKey: string, patch: LevelPatch): CurriculumDraft {
  return { ...draft, levels: draft.levels.map((level) => (level.key === levelKey ? { ...level, ...patch } : level)) }
}

/** Removes a level together with its lessons (the save deletes them). */
export function removeLevel(draft: CurriculumDraft, levelKey: string): CurriculumDraft {
  return { ...draft, levels: draft.levels.filter((level) => level.key !== levelKey) }
}

export function moveLevel(draft: CurriculumDraft, levelKey: string, delta: -1 | 1): CurriculumDraft {
  const index = draft.levels.findIndex((level) => level.key === levelKey)
  return { ...draft, levels: moved(draft.levels, index, index + delta) }
}

export function addLesson(draft: CurriculumDraft, groupKey: string, key: string): CurriculumDraft {
  return mapGroups(draft, (lessons, group) => (group === groupKey ? [...lessons, emptyLessonDraft(key)] : lessons))
}

export function updateLesson(draft: CurriculumDraft, lessonKey: string, patch: LessonPatch): CurriculumDraft {
  return mapGroups(draft, (lessons) => lessons.map((lesson) => (lesson.key === lessonKey ? { ...lesson, ...patch } : lesson)))
}

export function removeLesson(draft: CurriculumDraft, lessonKey: string): CurriculumDraft {
  return mapGroups(draft, (lessons) => lessons.filter((lesson) => lesson.key !== lessonKey))
}

/** Up or down inside its own group. */
export function moveLesson(draft: CurriculumDraft, lessonKey: string, delta: -1 | 1): CurriculumDraft {
  return mapGroups(draft, (lessons) => {
    const index = lessons.findIndex((lesson) => lesson.key === lessonKey)
    return index < 0 ? lessons : moved(lessons, index, index + delta)
  })
}

/** To the end of another group (a level key or `LOOSE_GROUP`); the same group or an unknown one changes nothing. */
export function moveLessonTo(draft: CurriculumDraft, lessonKey: string, groupKey: string): CurriculumDraft {
  const from = groupOfLesson(draft, lessonKey)
  const exists = groupKey === LOOSE_GROUP || draft.levels.some((level) => level.key === groupKey)
  if (from === null || from === groupKey || !exists) return draft
  const lesson = (from === LOOSE_GROUP ? draft.loose : draft.levels.find((level) => level.key === from)!.lessons).find((entry) => entry.key === lessonKey)!
  return mapGroups(draft, (lessons, group) => {
    if (group === from) return lessons.filter((entry) => entry.key !== lessonKey)
    if (group === groupKey) return [...lessons, lesson]
    return lessons
  })
}

/**
 * Puts back the lessons the server refused to delete (409 lesson_has_progress — learners have progress on them):
 * each at its saved position in its saved level when that level is still in the draft, else outside every level.
 * A lesson still in the draft, or unknown to the saved curriculum, is left alone.
 */
export function restoreLessons(draft: CurriculumDraft, saved: Curriculum, itemIds: readonly string[]): CurriculumDraft {
  let next = draft
  for (const itemId of itemIds) {
    if (groupOfLesson(next, itemId) !== null) continue
    const section = saved.sections.find((entry) => entry.items.some((item) => item.id === itemId))
    const items = section ? section.items : saved.looseItems
    const index = items.findIndex((item) => item.id === itemId)
    if (index < 0) continue
    const lesson = lessonDraftOf(items[index]!)
    const target = section && next.levels.some((level) => level.id === section.id) ? next.levels.find((level) => level.id === section.id)!.key : LOOSE_GROUP
    next = mapGroups(next, (lessons, group) => {
      if (group !== target) return lessons
      const copy = [...lessons]
      copy.splice(Math.min(index, copy.length), 0, lesson)
      return copy
    })
  }
  return next
}

// --- To the server ---------------------------------------------------------

/** One lesson of the body; only a filled description and a set estimate travel (absent = none). */
function lessonInputOf(draft: LessonDraft, previous: CurriculumItem | undefined): CurriculumItemInput {
  const item: CurriculumItemInput = {
    title: localizedOf(draft.titleAr, draft.titleEn, previous?.title.tr) ?? { ar: draft.titleAr.trim() },
    isRequired: draft.isRequired,
    isPublished: draft.isPublished,
  }
  if (draft.id) item.id = draft.id
  const description = localizedOf(draft.descriptionAr, draft.descriptionEn, previous?.description?.tr)
  if (description) item.description = description
  if (draft.estimatedMinutes !== null) item.estimatedMinutes = draft.estimatedMinutes
  return item
}

/** One level of the body; only a filled title or description travels (absent = none). */
function levelInputOf(draft: LevelDraft, previous: CurriculumSection | undefined, items: ReadonlyMap<string, CurriculumItem>): CurriculumSectionInput {
  const level: CurriculumSectionInput = { items: draft.lessons.map((lesson) => lessonInputOf(lesson, lesson.id ? items.get(lesson.id) : undefined)) }
  if (draft.id) level.id = draft.id
  const title = localizedOf(draft.titleAr, draft.titleEn, previous?.title?.tr)
  if (title) level.title = title
  const description = localizedOf(draft.descriptionAr, draft.descriptionEn, previous?.description?.tr)
  if (description) level.description = description
  return level
}

/** The PUT body of the draft: every level in order with its lessons, then the loose lessons (always present, even empty). */
export function buildCurriculumInput(draft: CurriculumDraft, saved: Curriculum): CurriculumInput {
  const sections = new Map(saved.sections.map((section) => [section.id, section]))
  const items = new Map(itemsOf(saved).map((item) => [item.id, item]))
  return {
    sections: draft.levels.map((level) => levelInputOf(level, level.id ? sections.get(level.id) : undefined, items)),
    looseItems: draft.loose.map((lesson) => lessonInputOf(lesson, lesson.id ? items.get(lesson.id) : undefined)),
  }
}

function sameLessons(inputs: readonly CurriculumItemInput[], stored: readonly CurriculumItem[]): boolean {
  return (
    inputs.length === stored.length &&
    inputs.every((input, index) => {
      const item = stored[index]!
      return (
        input.id === item.id &&
        sameLabel(input.title, item.title) &&
        sameLabel(input.description ?? null, item.description) &&
        (input.estimatedMinutes ?? null) === item.estimatedMinutes &&
        input.isRequired === item.isRequired &&
        input.isPublished === item.isPublished
      )
    })
  )
}

/** The PUT body, or null when the draft equals the stored curriculum (same levels, lessons, order and values). */
export function planCurriculumSave(saved: Curriculum, draft: CurriculumDraft): CurriculumInput | null {
  const input = buildCurriculumInput(draft, saved)
  const unchanged =
    input.sections.length === saved.sections.length &&
    input.sections.every((level, index) => {
      const stored = saved.sections[index]!
      return (
        level.id === stored.id &&
        sameLabel(level.title ?? null, stored.title) &&
        sameLabel(level.description ?? null, stored.description) &&
        sameLessons(level.items, stored.items)
      )
    }) &&
    sameLessons(input.looseItems ?? [], saved.looseItems)
  return unchanged ? null : input
}

/**
 * Whether the editor holds unsaved work (the drawer's KI-054 rule): the structure differs from the stored one by
 * the comparison the save uses, or a text holds what the save would drop — an English text without its Arabic one.
 * A change changed back, or a level or lesson added and removed again, counts as no change.
 */
export function curriculumHasChanges(saved: Curriculum, draft: CurriculumDraft): boolean {
  const dropsEnglish = (entry: { titleAr: string; titleEn: string; descriptionAr: string; descriptionEn: string }) =>
    englishWithoutArabic(entry.titleAr, entry.titleEn) || englishWithoutArabic(entry.descriptionAr, entry.descriptionEn)
  const lessons = [...draft.levels.flatMap((level) => level.lessons), ...draft.loose]
  return draft.levels.some(dropsEnglish) || lessons.some(dropsEnglish) || planCurriculumSave(saved, draft) !== null
}

// --- Checks before the save ------------------------------------------------

/** One refused field: the i18n key of its message and its interpolation values. */
export interface DraftProblem {
  key: string
  params?: Record<string, number>
}

/** The field of a problem: `${draftKey}:${field}`. */
export const problemKey = (draftKey: string, field: string) => `${draftKey}:${field}`

/** The structure-wide problems (`CURRICULUM_PROBLEM`). */
export const CURRICULUM_PROBLEM = 'curriculum'

/** What the server would refuse, by field — mirrors of the DTO rules (Arabic first, lengths, minutes, the counts). */
export function curriculumProblems(draft: CurriculumDraft): Map<string, DraftProblem> {
  const problems = new Map<string, DraftProblem>()
  const text = (draftKey: string, field: string, value: string) => {
    if (value.trim().length > CURRICULUM_TEXT_MAX) problems.set(problemKey(draftKey, field), { key: 'curriculum.validation.maxLength', params: { max: CURRICULUM_TEXT_MAX } })
  }
  const arabicFirst = (draftKey: string, field: string, ar: string, en: string) => {
    if (englishWithoutArabic(ar, en)) problems.set(problemKey(draftKey, field), { key: 'curriculum.validation.arabicFirst' })
  }
  const checkTexts = (entry: LevelDraft | LessonDraft) => {
    for (const field of ['titleAr', 'titleEn', 'descriptionAr', 'descriptionEn'] as const) text(entry.key, field, entry[field])
    arabicFirst(entry.key, 'titleEn', entry.titleAr, entry.titleEn)
    arabicFirst(entry.key, 'descriptionEn', entry.descriptionAr, entry.descriptionEn)
  }
  const checkLesson = (lesson: LessonDraft) => {
    checkTexts(lesson)
    if (!lesson.titleAr.trim()) problems.set(problemKey(lesson.key, 'titleAr'), { key: 'curriculum.validation.titleArRequired' })
    const minutes = lesson.estimatedMinutes
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > LESSON_MINUTES_MAX)) {
      problems.set(problemKey(lesson.key, 'estimatedMinutes'), { key: 'curriculum.validation.minutes', params: { max: LESSON_MINUTES_MAX } })
    }
  }
  for (const level of draft.levels) {
    checkTexts(level)
    level.lessons.forEach(checkLesson)
  }
  draft.loose.forEach(checkLesson)
  if (draft.levels.length > CURRICULUM_SECTIONS_MAX) problems.set(CURRICULUM_PROBLEM, { key: 'curriculum.level.maxReached', params: { max: CURRICULUM_SECTIONS_MAX } })
  else if (lessonCount(draft) > CURRICULUM_ITEMS_MAX) problems.set(CURRICULUM_PROBLEM, { key: 'curriculum.lesson.maxReached', params: { max: CURRICULUM_ITEMS_MAX } })
  return problems
}

/** A level's title as typed (for its heading while editing): Arabic required for it to count, as the save does. */
export function draftLevelTitle(level: LevelDraft): LocalizedLabel | null {
  return localizedOf(level.titleAr, level.titleEn)
}
