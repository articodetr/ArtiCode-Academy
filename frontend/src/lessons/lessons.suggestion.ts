// The next curriculum lesson of a class (LRN-T06, D-R143): when a session is
// added by hand for a class, the lesson form suggests the first lesson of the
// course's curriculum — in curriculum order (API-048 lists the curriculum's
// lessons flattened: the levels in order, then the lessons outside them) —
// that no session of that class covers yet. A cancelled session covers
// nothing (the curriculum lesson still needs one). Pure rules, unit-tested in
// lessons.suggestion.test.ts; the reading lives in useCoveredSyllabusItems.ts.
import type { Lesson } from '../api/lessons'
import type { SyllabusItem } from '../api/syllabus'

/** The curriculum lessons the class's sessions cover: every non-cancelled session's syllabus item. */
export function coveredSyllabusItems(lessons: readonly Pick<Lesson, 'status' | 'syllabusItem'>[]): Set<string> {
  const covered = new Set<string>()
  for (const lesson of lessons) {
    if (lesson.status !== 'cancelled' && lesson.syllabusItem) covered.add(lesson.syllabusItem.id)
  }
  return covered
}

/** The first curriculum lesson, in curriculum order, that no session covers; null when every one is covered or there is none. */
export function nextCurriculumItem(items: readonly SyllabusItem[], covered: ReadonlySet<string>): SyllabusItem | null {
  const ordered = [...items].sort((a, b) => a.sortOrder - b.sortOrder)
  return ordered.find((item) => !covered.has(item.id)) ?? null
}
