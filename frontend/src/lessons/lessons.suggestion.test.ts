// LRN-T06 (TEST-264, D-R143): the next curriculum lesson of a class — the first lesson, in curriculum order, that no
// non-cancelled session of the class covers.
import { describe, expect, it } from 'vitest'
import { SYLLABUS_ITEM_IDS, THREE_ITEMS } from '../test/courses'
import { makeLesson } from '../test/lessons'
import { coveredSyllabusItems, nextCurriculumItem } from './lessons.suggestion'

const onItem = (index: number, status: 'scheduled' | 'completed' | 'cancelled' = 'scheduled') =>
  makeLesson({ id: `l-${index}-${status}`, status, syllabusItem: { id: SYLLABUS_ITEM_IDS[index]!, sortOrder: index, title: { ar: 'درس' } } })

describe('next curriculum lesson (LRN-T06)', () => {
  it('collects the items of the non-cancelled sessions only; a session without an item covers nothing', () => {
    const covered = coveredSyllabusItems([onItem(0, 'completed'), onItem(1, 'cancelled'), makeLesson({ id: 'free', syllabusItem: null })])
    expect([...covered]).toEqual([SYLLABUS_ITEM_IDS[0]])
  })

  it('picks the first uncovered lesson in curriculum order, whatever order the list came in, and none when all are covered', () => {
    const items = THREE_ITEMS()
    expect(nextCurriculumItem(items, new Set())?.id).toBe(SYLLABUS_ITEM_IDS[0])
    expect(nextCurriculumItem([...items].reverse(), new Set([SYLLABUS_ITEM_IDS[0]]))?.id).toBe(SYLLABUS_ITEM_IDS[1])
    // A gap is filled first: the third lesson covered, the second not.
    expect(nextCurriculumItem(items, new Set([SYLLABUS_ITEM_IDS[0], SYLLABUS_ITEM_IDS[2]]))?.id).toBe(SYLLABUS_ITEM_IDS[1])
    expect(nextCurriculumItem(items, new Set(SYLLABUS_ITEM_IDS))).toBeNull()
    expect(nextCurriculumItem([], new Set())).toBeNull()
  })
})
