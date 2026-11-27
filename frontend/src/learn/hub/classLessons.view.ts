// J-F81: the class lessons (MOD-06 — the lessons a teacher adds to a class, API-101) on «دوراتي»: which of the
// learner's lessons belong to one card (a class × a student), how many the card counts, and which the panel's
// «الكل / المباشرة / المسجلة» keeps. The curriculum lessons (MOD-20, API-229/230) keep their own rules (hub.view.ts).
// Unit-tested in classLessons.view.test.ts.
import type { MyLessonItem } from '../../api/myLessons'
import type { HubFilter } from './hub.view'

type Owned = Pick<MyLessonItem, 'class' | 'student'>

function belongsTo(item: Owned, classId: string, studentId: string): boolean {
  return item.class.id === classId && item.student.id === studentId
}

/** The lessons of one enrollment — its class, through its student — in the order the server sent them. */
export function enrollmentLessonsOf<T extends Owned>(items: readonly T[], classId: string, studentId: string): T[] {
  return items.filter((item) => belongsTo(item, classId, studentId))
}

/** How many lessons a card counts: the enrollment's lessons that are not cancelled. */
export function enrollmentLessonCount(items: readonly (Owned & Pick<MyLessonItem, 'status'>)[], classId: string, studentId: string): number {
  return items.filter((item) => belongsTo(item, classId, studentId) && item.status !== 'cancelled').length
}

/** «المسجلة» keeps the recorded lessons; «المباشرة» every other kind (online, in person, hybrid). */
export function matchesLessonFilter(item: Pick<MyLessonItem, 'deliveryMode'>, filter: HubFilter): boolean {
  if (filter === 'recorded') return item.deliveryMode === 'recorded'
  if (filter === 'live') return item.deliveryMode !== 'recorded'
  return true
}
