// Fixtures for «my lessons» (MOD-06-T04 — J-F11): the shapes of API-101 as the
// backend returns them (my-lessons.dto.ts). The lesson part reuses the J-F09
// fixture so the class, course and room are the same everywhere.
import type { MyLessonItem, MyLessonList } from '../api/myLessons'
import { LESSON_ID, makeLesson } from './lessons'

/** The signed-in student (relation `self`). */
export const SELF_STUDENT = { id: '0193d000-0000-7000-8000-00000000b001', fullName: 'سارة الطالبة', displayName: null }
/** Two children of the signed-in guardian (relation `child`), in student-id order. */
export const CHILD_ONE = { id: '0193d000-0000-7000-8000-00000000b002', fullName: 'عمر الأحمد', displayName: 'عمر' }
export const CHILD_TWO = { id: '0193d000-0000-7000-8000-00000000b003', fullName: 'ليلى الأحمد', displayName: null }

/** A scheduled lesson of PY-101-A owned by the student themselves, without an attendance record yet. */
export function makeMyLesson(overrides: Partial<MyLessonItem> = {}): MyLessonItem {
  const lesson = makeLesson()
  return {
    id: LESSON_ID,
    title: lesson.title,
    description: null,
    deliveryMode: lesson.deliveryMode,
    startsAt: lesson.startsAt,
    endsAt: lesson.endsAt,
    status: lesson.status,
    meetingUrl: null,
    room: lesson.room,
    teacher: { fullName: 'خالد المعلم', displayName: null },
    syllabusItem: lesson.syllabusItem,
    class: lesson.class,
    relation: 'self',
    student: SELF_STUDENT,
    attendance: null,
    ...overrides,
  }
}

export function makeMyLessonList(items: MyLessonItem[], nextCursor: string | null = null): MyLessonList {
  return { items, nextCursor }
}
