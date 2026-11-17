// The names of the students a class batch skipped (API-150 answers `skipped` with ids only): read from the class's
// roster (API-057 — `enrollments.read` with `enrollments.manage` or a teacher assigned to the class), page by page
// until every skipped enrollment is found. The caller keeps the ids for any enrollment it cannot name (no key, a
// refusal, a failure).
import { listEnrollments } from '../api/enrollments'
import { personName } from './payments.format'

/** Roster pages read at most (100 each), as findEnrollment() does. */
const ROSTER_PAGES_MAX = 10

/** Enrollment id → the student's name, for the skipped enrollments the roster shows. */
export async function skippedStudentNames(classId: string, enrollmentIds: readonly string[], signal?: AbortSignal): Promise<Map<string, string>> {
  const wanted = new Set(enrollmentIds)
  const names = new Map<string, string>()
  let cursor: string | undefined
  for (let page = 0; page < ROSTER_PAGES_MAX && names.size < wanted.size; page += 1) {
    const list = await listEnrollments(classId, { limit: 100, cursor }, signal)
    for (const enrollment of list.items) if (wanted.has(enrollment.id)) names.set(enrollment.id, personName(enrollment.student))
    if (!list.nextCursor) break
    cursor = list.nextCursor
  }
  return names
}
