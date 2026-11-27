// The pure rules of the learner home (redesign, 2026-11-14): who gets it, the week's agenda, what is waiting for
// the student and the latest results. Every number is the server's; nothing is estimated here.
import type { MyClassItem, MyClassStudent } from '../api/enrollments'
import type { MyInvoice } from '../api/invoices'
import type { MyAssignmentItem } from '../api/myAssignments'
import type { MyExamItem, MyExamOnline } from '../api/myExams'
import type { MyGradeItem } from '../api/myGrades'
import type { MyLessonItem } from '../api/myLessons'
import type { LocalizedLabel } from '../api/users'
import { isOnlineItem } from '../exams/myExams.view'
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

/**
 * The link a lesson offers on the learner home (KI-062): every lesson with a stored link that is not cancelled, as
 * on «my lessons» — also while it runs and after it ended, when a recording may sit behind the link. «Join» only
 * fits a lesson that can still be joined; a recorded, finished or past one offers «open the link». Since J-F77 a
 * lesson's video (`recordingUrl`) comes first for a recorded lesson, for a lesson without a join link and for one that
 * has ended (a live lesson's recording): «watch the video».
 */
export function lessonLinkOf(
  lesson: Pick<MyLessonItem, 'status' | 'meetingUrl' | 'deliveryMode' | 'endsAt'> & { recordingUrl?: string | null },
  now: number,
): { url: string; action: 'join' | 'open' | 'watch' } | null {
  if (lesson.status === 'cancelled') return null
  const ended = lesson.status === 'completed' || Date.parse(lesson.endsAt) <= now
  if (lesson.recordingUrl && (lesson.deliveryMode === 'recorded' || ended || !lesson.meetingUrl)) return { url: lesson.recordingUrl, action: 'watch' }
  if (!lesson.meetingUrl) return null
  const joinable = lesson.deliveryMode !== 'recorded' && lesson.status === 'scheduled' && Date.parse(lesson.endsAt) > now
  return { url: lesson.meetingUrl, action: joinable ? 'join' : 'open' }
}

/** Whole days from `today` to `day` (both `YYYY-MM-DD`); negative when the day has passed. */
export function daysUntil(day: string, today: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

export type TodoItem =
  | { kind: 'assignment'; key: string; item: MyAssignmentItem; dueDays: number | null; tier: number; sortAt: number }
  | { kind: 'invoice'; key: string; item: MyInvoice; tier: number; sortAt: number }

/**
 * What waits for the student: work they can still hand in (the server's `pending` list — never a row whose
 * submission is closed for good) and the invoices with a balance (overdue ones first). Sorted by urgency: overdue
 * money, then by date. The exams have their own panel (examBoardOf).
 */
export function todoOf(input: { assignments: readonly MyAssignmentItem[]; invoices: readonly MyInvoice[]; zone: string; today: string }): TodoItem[] {
  const items: TodoItem[] = []
  for (const item of input.assignments) {
    if (item.submitBlocker !== null && item.submitBlocker !== 'past_due') continue
    if (item.submitBlocker === 'past_due' && !item.allowLate) continue
    const due = item.dueAt ? wallDate(item.dueAt, input.zone) : null
    items.push({ kind: 'assignment', key: `a:${item.id}:${item.student.id}`, item, dueDays: due ? daysUntil(due, input.today) : null, tier: 1, sortAt: item.dueAt ? Date.parse(item.dueAt) : Number.MAX_SAFE_INTEGER })
  }
  for (const item of input.invoices) {
    if (item.status !== 'issued' || item.balance <= 0) continue
    const due = item.nextDue?.dueOn ? Date.parse(`${item.nextDue.dueOn}T00:00:00Z`) : Number.MAX_SAFE_INTEGER
    items.push({ kind: 'invoice', key: `i:${item.id}`, item, tier: item.overdue ? 0 : 1, sortAt: due })
  }
  return items.sort((a, b) => a.tier - b.tier || a.sortAt - b.sortAt)
}

/** How many lessons the list under the featured one shows; the rest are on «my lessons». */
export const LESSON_ROWS_MAX = 5
/** On a phone the list stays short, so the exams are not a long scroll away. */
export const LESSON_ROWS_PHONE = 2

export interface LessonBoard {
  /** The lessons running now, else the next one (every row of it: a guardian's two children share a lesson). */
  featured: MyLessonItem[]
  /** True when `featured` are running now. */
  live: boolean
  /** The other lessons by day: within a day the ones still to come first, then the ones that ended. */
  days: AgendaDay[]
  /** Lessons left out of `days` by the cap. */
  hidden: number
}

/** The lessons panel: what runs now (or comes next) on top, then a short list of the rest. */
export function lessonBoardOf(lessons: readonly MyLessonItem[], now: number, zone: string, maxRows = LESSON_ROWS_MAX): LessonBoard {
  const running = lessons.filter((lesson) => lesson.status === 'scheduled' && Date.parse(lesson.startsAt) <= now && Date.parse(lesson.endsAt) > now)
  const next = running.length ? null : nextLessonOf(lessons, now)
  const featured = running.length ? running : next ? lessons.filter((lesson) => lesson.id === next.id) : []
  const shown = new Set(featured)
  const others = lessons.filter((lesson) => !shown.has(lesson))
  const ended = (lesson: MyLessonItem) => Date.parse(lesson.endsAt) <= now
  const byStart = (a: MyLessonItem, b: MyLessonItem) => Date.parse(a.startsAt) - Date.parse(b.startsAt)
  // The cap keeps what is still to come before a lesson that is over.
  const kept = new Set([...others.filter((lesson) => !ended(lesson)).sort(byStart), ...others.filter(ended).sort(byStart)].slice(0, maxRows))
  const days = agendaOf([...kept], zone).map((day) => ({ date: day.date, lessons: [...day.lessons.filter((lesson) => !ended(lesson)), ...day.lessons.filter(ended)] }))
  return { featured, live: running.length > 0, days, hidden: others.length - kept.size }
}

export interface ExamBoard {
  /** Can be taken or continued now (for a guardian: the window of a child's exam is open). In progress first. */
  now: Array<MyExamItem & { online: MyExamOnline }>
  /** Announced and still to come, soonest first. */
  upcoming: MyExamItem[]
}

/**
 * The exams panel, from the server's state of each item: an online exam by `inProgress`/`canStart`/`blocker` (the
 * rule the start route enforces — its window may have opened days ago), a manual one by its date. An exam that can no
 * longer be taken (closed window, no attempt left, results out) is not listed here.
 */
export function examBoardOf(exams: readonly MyExamItem[], zone: string, today: string): ExamBoard {
  const now: ExamBoard['now'] = []
  const upcoming: MyExamItem[] = []
  for (const item of exams) {
    if (item.status !== 'scheduled') continue
    if (isOnlineItem(item)) {
      const { online } = item
      if (online.inProgress || online.canStart) now.push(item)
      else if (online.blocker === 'not_open_yet') upcoming.push(item)
      else if (online.blocker === 'not_self') {
        // A guardian's item is never startable, so its place comes from the window at the server's clock.
        const serverNow = Date.parse(online.serverNow)
        if (online.closesAt && Date.parse(online.closesAt) <= serverNow) continue
        // The child has used every attempt and none is running: nothing is left to take.
        if (online.attemptsUsed >= online.attemptsAllowed && !online.attempts.some((attempt) => attempt.status === 'in_progress')) continue
        if (item.scheduledAt && Date.parse(item.scheduledAt) > serverNow) upcoming.push(item)
        else now.push(item)
      }
      continue
    }
    if (item.scheduledAt && daysUntil(wallDate(item.scheduledAt, zone), today) >= 0) upcoming.push(item)
  }
  const closing = (item: ExamBoard['now'][number]) => (item.online.closesAt ? Date.parse(item.online.closesAt) : Number.MAX_SAFE_INTEGER)
  now.sort((a, b) => Number(Boolean(b.online.inProgress)) - Number(Boolean(a.online.inProgress)) || closing(a) - closing(b))
  upcoming.sort((a, b) => Date.parse(a.scheduledAt ?? '') - Date.parse(b.scheduledAt ?? ''))
  return { now, upcoming }
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
