// J-F81: the class lessons (MOD-06 — the lessons a teacher adds to a class, API-101) on «دوراتي»: which of the
// learner's lessons belong to one card (a class × a student), how many the card counts, and which the panel's
// «الكل / المباشرة / المسجلة» keeps. The curriculum lessons (MOD-20, API-229/230) keep their own rules (hub.view.ts).
// Unit-tested in classLessons.view.test.ts.
import type { WorkspaceItemExam } from '../../api/learning'
import type { MyExamItem } from '../../api/myExams'
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

/**
 * The class's exams (API-121 — scheduled or published) linked to one class lesson, in the shape a lesson row's
 * «الاختبار» takes: `done` once the learner has taken it — a result, or a finished online attempt (none in progress).
 */
export function lessonExamsOf(exams: readonly MyExamItem[], lessonId: string): WorkspaceItemExam[] {
  return exams
    .filter((exam) => exam.lesson?.id === lessonId)
    .map((exam) => ({
      id: exam.id,
      title: exam.title,
      delivery: exam.delivery,
      status: exam.status,
      scheduledAt: exam.scheduledAt,
      closesAt: exam.online?.closesAt ?? null,
      done: exam.result !== null || (exam.online !== null && exam.online.attemptsUsed > 0 && exam.online.inProgress === null),
    }))
}

/** «المسجلة» keeps the recorded lessons; «المباشرة» every other kind (online, in person, hybrid). */
export function matchesLessonFilter(item: Pick<MyLessonItem, 'deliveryMode'>, filter: HubFilter): boolean {
  if (filter === 'recorded') return item.deliveryMode === 'recorded'
  if (filter === 'live') return item.deliveryMode !== 'recorded'
  return true
}
