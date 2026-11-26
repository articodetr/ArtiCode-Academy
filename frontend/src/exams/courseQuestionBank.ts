// CH-0376: the bank a question written from an exam is kept in — the bank of the exam's course. The one named
// «أسئلة <الدورة>» first, else the course's first bank the caller sees, else a new one with that name (API-261 —
// a teacher may file a bank under a course they teach a class of). Banks are read with API-260 filtered by course.
import { createQuestionBank, listQuestionBanks } from '../api/questionBanks'
import type { QuestionBank } from '../api/questionBanks'
import type { ScheduleCourse } from '../api/timetable'

const BANKS_READ = 100

export async function courseQuestionBank(course: ScheduleCourse, bankName: string, signal?: AbortSignal): Promise<QuestionBank> {
  const list = await listQuestionBanks({ courseId: course.id, limit: BANKS_READ }, signal)
  const named = list.items.find((bank) => bank.name.ar.trim() === bankName)
  if (named) return named
  if (list.items[0]) return list.items[0]
  return createQuestionBank({ name: { ar: bankName }, courseId: course.id })
}
