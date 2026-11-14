// The pure rules of the learner home (redesign, 2026-11-14): who gets it, the week's agenda, what is waiting for
// the student and the latest results. Every number is the server's; nothing is estimated here.
import type { MyClassItem, MyClassStudent } from '../api/enrollments'
import type { MyInvoice } from '../api/invoices'
import type { MyAssignmentItem } from '../api/myAssignments'
import type { MyExamItem } from '../api/myExams'
import type { MyGradeItem } from '../api/myGrades'
import type { MyLessonItem } from '../api/myLessons'
import type { LocalizedLabel } from '../api/users'
import { wallDate } from './dashboard.data'

const LEARNER_ROLES = new Set(['student', 'guardian'])

/** A student or a guardian with no other role: the staff dashboard has nothing for them (their reads are «my …»). */
export function isLearnerOnly(roles: readonly string[]): boolean {
  return roles.length > 0 && roles.every((role) => LEARNER_ROLES.has(role))
}

/** The students the home can be narrowed to, from «my classes»: the caller first, then each child once. */
export function learnersOf(items: readonly Pick<MyClassItem, 'relation' | 'student'>[]): Array<MyClassStudent & { relation: 'self' | 'child' }> {
  const seen = new Map<string, MyClassStudent & { relation: 'self' | 'child' }>()
  for (const item of items) if (!seen.has(item.student.id)) seen.set(item.student.id, { ...item.student, relation: item.relation })
  return [...seen.values()].sort((a, b) => (a.relation === b.relation ? 0 : a.relation === 'self' ? -1 : 1))
}

export interface AgendaDay {
  date: string
  lessons: MyLessonItem[]
}

/** The lessons grouped by their academy-zone day, in time order; days without a lesson are left out. */
export function agendaOf(lessons: readonly MyLessonItem[], zone: string): AgendaDay[] {
  const days = new Map<string, MyLessonItem[]>()
  for (const lesson of [...lessons].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
    const date = wallDate(lesson.startsAt, zone)
    days.set(date, [...(days.get(date) ?? []), lesson])
  }
  return [...days.entries()].map(([date, items]) => ({ date, lessons: items }))
}

/** The next lesson that has not ended and is not cancelled (one row per lesson × student: the first one). */
export function nextLessonOf(lessons: readonly MyLessonItem[], now: number): MyLessonItem | null {
  return [...lessons].filter((lesson) => lesson.status !== 'cancelled' && Date.parse(lesson.endsAt) > now).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null
}

/** Whole days from `today` to `day` (both `YYYY-MM-DD`); negative when the day has passed. */
export function daysUntil(day: string, today: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

export type TodoItem =
  | { kind: 'assignment'; key: string; item: MyAssignmentItem; dueDays: number | null; tier: number; sortAt: number }
  | { kind: 'exam'; key: string; item: MyExamItem; inDays: number; tier: number; sortAt: number }
  | { kind: 'invoice'; key: string; item: MyInvoice; tier: number; sortAt: number }

/**
 * What waits for the student: work they can still hand in (the server's `pending` list — never a row whose
 * submission is closed for good), the exams scheduled from today on, and the invoices with a balance (overdue
 * ones first). Sorted by urgency: overdue money, then by date.
 */
export function todoOf(input: { assignments: readonly MyAssignmentItem[]; exams: readonly MyExamItem[]; invoices: readonly MyInvoice[]; zone: string; today: string }): TodoItem[] {
  const items: TodoItem[] = []
  for (const item of input.assignments) {
    if (item.submitBlocker !== null && item.submitBlocker !== 'past_due') continue
    if (item.submitBlocker === 'past_due' && !item.allowLate) continue
    const due = item.dueAt ? wallDate(item.dueAt, input.zone) : null
    items.push({ kind: 'assignment', key: `a:${item.id}:${item.student.id}`, item, dueDays: due ? daysUntil(due, input.today) : null, tier: 1, sortAt: item.dueAt ? Date.parse(item.dueAt) : Number.MAX_SAFE_INTEGER })
  }
  for (const item of input.exams) {
    if (item.status !== 'scheduled' || !item.scheduledAt) continue
    const inDays = daysUntil(wallDate(item.scheduledAt, input.zone), input.today)
    if (inDays < 0) continue
    items.push({ kind: 'exam', key: `e:${item.id}:${item.student.id}`, item, inDays, tier: 1, sortAt: Date.parse(item.scheduledAt) })
  }
  for (const item of input.invoices) {
    if (item.status !== 'issued' || item.balance <= 0) continue
    const due = item.nextDue?.dueOn ? Date.parse(`${item.nextDue.dueOn}T00:00:00Z`) : Number.MAX_SAFE_INTEGER
    items.push({ kind: 'invoice', key: `i:${item.id}`, item, tier: item.overdue ? 0 : 1, sortAt: due })
  }
  return items.sort((a, b) => a.tier - b.tier || a.sortAt - b.sortAt)
}

export interface ResultRow {
  key: string
  kind: 'assignment' | 'exam' | 'final'
  title: LocalizedLabel
  className: LocalizedLabel
  student: MyClassStudent
  /** `score / max`, a percentage, or a word (absent, excused). */
  score: number | null
  max: number | null
  percent: number | null
  status: 'graded' | 'scored' | 'absent' | 'excused' | 'final'
  isPass: boolean | null
  band: LocalizedLabel | null
  at: string
}

/** The latest results: graded attempts, published exam results and final grades, newest first. */
export function resultsOf(input: { assignments: readonly MyAssignmentItem[]; exams: readonly MyExamItem[]; grades: readonly MyGradeItem[] }, limit = 6): ResultRow[] {
  const rows: ResultRow[] = []
  for (const item of input.assignments) {
    const latest = item.latest
    if (!latest || latest.status !== 'graded' || latest.score === null || !latest.gradedAt) continue
    rows.push({ key: `a:${item.id}:${item.student.id}`, kind: 'assignment', title: item.title, className: item.class.name, student: item.student, score: latest.score, max: item.maxScore, percent: null, status: 'graded', isPass: null, band: null, at: latest.gradedAt })
  }
  for (const item of input.exams) {
    if (item.status !== 'published' || !item.result || !item.publishedAt) continue
    const scored = item.result.status === 'scored'
    rows.push({
      key: `e:${item.id}:${item.student.id}`, kind: 'exam', title: item.title, className: item.class.name, student: item.student,
      score: scored ? item.result.score : null, max: scored ? item.maxScore : null, percent: null, status: item.result.status,
      isPass: scored && item.passScore !== null && item.result.score !== null ? item.result.score >= item.passScore : null, band: null, at: item.publishedAt,
    })
  }
  for (const item of input.grades) {
    if (!item.final) continue
    rows.push({ key: `f:${item.enrollmentId}`, kind: 'final', title: item.class.name, className: item.class.name, student: item.student, score: null, max: null, percent: item.final.percent, status: 'final', isPass: item.final.isPass, band: item.final.label, at: item.final.finalizedAt })
  }
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit)
}

/** A score as the server sent it, without trailing zeros (8.50 → 8.5). */
export function formatScore(value: number): string {
  return String(Number(value.toFixed(2)))
}
