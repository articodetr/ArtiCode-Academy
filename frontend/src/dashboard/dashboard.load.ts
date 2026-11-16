// The paged reads of the staff dashboard: every lesson of a span of days (API-093) and every running or open
// class the caller may read (API-050), up to five pages of 100 each — a dashboard summary, not an export.
import { listClasses } from '../api/classes'
import type { AcademyClass, ClassStatus } from '../api/classes'
import { listLessons } from '../api/lessons'
import type { Lesson } from '../api/lessons'
import { dayStartIn } from '../common/timeZone'

const MAX_PAGES = 5

/** Every lesson starting between two academy-zone days (`to` exclusive). */
export async function loadLessonsBetween(from: string, to: string, zone: string, signal: AbortSignal): Promise<Lesson[]> {
  const start = dayStartIn(from, zone)
  const end = dayStartIn(to, zone)
  const items: Lesson[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const answer = await listLessons({ from: start, to: end ? new Date(Date.parse(end) - 1).toISOString() : undefined, limit: 100, cursor }, signal)
    items.push(...answer.items)
    if (!answer.nextCursor) break
    cursor = answer.nextCursor
  }
  return items
}

async function loadClassesIn(status: ClassStatus, signal: AbortSignal): Promise<AcademyClass[]> {
  const items: AcademyClass[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const answer = await listClasses({ status, limit: 100, cursor }, signal)
    items.push(...answer.items)
    if (!answer.nextCursor) break
    cursor = answer.nextCursor
  }
  return items
}

/** The running classes, then the open ones, that the caller may read (D-R16: a teacher's own classes). */
export async function loadActiveClasses(signal: AbortSignal): Promise<AcademyClass[]> {
  const [running, open] = await Promise.all([loadClassesIn('running', signal), loadClassesIn('open', signal)])
  return [...running, ...open]
}
