// The enrollment a draft invoice is tied to (API-146 `enrollmentId`): found in the class's roster (API-057).
import { listEnrollments } from '../api/enrollments'

/** Roster pages read to find the student's enrollment (100 each). */
const ROSTER_PAGES_MAX = 10

/** The student's enrollment in the class (the latest one when there are several), or null. */
export async function findEnrollment(classId: string, studentId: string): Promise<string | null> {
  let cursor: string | undefined
  let found: string | null = null
  for (let page = 0; page < ROSTER_PAGES_MAX; page += 1) {
    const list = await listEnrollments(classId, { limit: 100, cursor })
    for (const enrollment of list.items) if (enrollment.student.id === studentId) found = enrollment.id
    if (!list.nextCursor) break
    cursor = list.nextCursor
  }
  return found
}
