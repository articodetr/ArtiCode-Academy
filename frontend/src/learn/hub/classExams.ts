// Every exam of one class for one student, as «my exams» (API-121) lists them — the course panel's «اختبارات الدورة»
// and the window of the locked «الشهادة» (J-F68) read the class's exams the same way.
import { listMyExams } from '../../api/myExams'
import type { MyExamItem } from '../../api/myExams'

/** Pages of «my exams» read at most for one class (100 each). */
const MAX_EXAM_PAGES = 5

/** API-121 with `classId` + `studentId`: the class's scheduled or published exams for that student, in the server's order. */
export async function readClassExams(classId: string, studentId: string, signal: AbortSignal): Promise<MyExamItem[]> {
  const items: MyExamItem[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_EXAM_PAGES; page += 1) {
    const list = await listMyExams({ classId, studentId, limit: 100, cursor }, signal)
    items.push(...list.items.filter((item) => item.class.id === classId && item.student.id === studentId))
    if (!list.nextCursor) break
    cursor = list.nextCursor
  }
  return items
}
