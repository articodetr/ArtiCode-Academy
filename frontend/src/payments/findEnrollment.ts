// The enrollment a draft invoice is tied to (API-146 `enrollmentId`). One read of the student's enrollments
// (API-200, CH-0226) finds it; a server without that route (404 without a code) falls back to reading the class's
// roster (API-057) page by page, as before.
import { ApiError } from '../api/client'
import { listEnrollments, listStudentEnrollments } from '../api/enrollments'

/** Roster pages read to find the student's enrollment on an older server (100 each). */
const ROSTER_PAGES_MAX = 10

/** The student's enrollment in the class (the newest when there are several), or null. */
export async function findEnrollment(classId: string, studentId: string): Promise<string | null> {
  try {
    const list = await listStudentEnrollments(studentId)
    return list.items.find((enrollment) => enrollment.class.id === classId)?.id ?? null
  } catch (error) {
    // A missing route answers 404 without a code; any other refusal is the server's verdict.
    if (!(error instanceof ApiError && error.status === 404 && !error.code)) throw error
  }
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
