// The learning progress of a class (MOD-20 «My School», roadmap §4q, D-R137):
// API-235 GET /api/classes/:id/learning-progress. Types mirror
// backend/src/learning/learning-reports.dto.ts (the contract of agent C). Read
// with `enrollments.read` by whoever may read the class roster —
// `enrollments.manage`, or a teacher of the class; anyone else gets 404
// class_not_found. The server computes every number (D-R133); the screen shows
// them as they come.
import { apiRequest } from './client'
import type { EnrollmentStudent } from './enrollments'
import type { ProgressCounts } from './learning'
import type { LocalizedLabel } from './users'

export interface ClassLearningStudent {
  enrollmentId: string
  enrollmentStatus: 'active' | 'completed'
  /** The caller's projection (D-R07) — contact fields are null without `users.read_contact`. */
  student: EnrollmentStudent
  progress: ProgressCounts
  lastActivityAt: string | null
  lastLesson: { id: string; title: LocalizedLabel } | null
}

export interface ClassLearningProgress {
  classId: string
  course: { id: string; code: string; name: LocalizedLabel }
  /** Published lessons of the course, and the required ones among them. */
  totals: { lessons: number; required: number }
  /** The active and completed enrollments, in enrollment order. */
  students: ClassLearningStudent[]
}

export const classLearningProgressPath = (classId: string) => `/api/classes/${encodeURIComponent(classId)}/learning-progress`

/** API-235 */
export function getClassLearningProgress(classId: string, signal?: AbortSignal): Promise<ClassLearningProgress> {
  return apiRequest<ClassLearningProgress>(classLearningProgressPath(classId), { signal })
}
