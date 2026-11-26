// «طلابي» for a teacher (CH-0370): API-301 GET /api/teaching/students and
// API-302 GET /api/teaching/students/:id. Types mirror
// backend/src/teaching/teaching-students.dto.ts field by field — keep in sync.
// Read only; the marks are the class gradebook's own row (API-126), so the
// screen computes no grade and no rate — every number is the server's.
import { apiRequest } from './client'
import type { ClassStatus } from './classes'
import type { EnrollmentStatus } from './enrollments'
import type { FinalGrade, GradebookCell, GradebookComponent } from './gradebook'
import type { LessonStatus } from './lessons'
import type { GuardianRelationship, LocalizedLabel } from './users'

/** `TEACHING_STUDENT_FILTERS` of teaching-students.policy.ts — keep in sync; the server's default is `active`. */
export const TEACHING_STUDENT_FILTERS = ['active', 'completed', 'withdrawn', 'all'] as const
export type TeachingStudentFilter = (typeof TEACHING_STUDENT_FILTERS)[number]

export type TeachingAttendanceStatus = 'present' | 'absent' | 'late' | 'excused'

export interface TeachingStudent {
  id: string
  fullName: string
  displayName: string | null
  avatarUrl: string | null
  email: string | null
  phone: string | null
}

export interface TeachingEnrollment {
  enrollmentId: string
  enrollmentStatus: EnrollmentStatus
  class: { id: string; code: string; name: LocalizedLabel; status: ClassStatus; course: { id: string; code: string; name: LocalizedLabel } }
}

export interface TeachingAttendanceCounts {
  present: number
  late: number
  absent: number
  excused: number
  /** Whole percent, or null before any present, late or absent record. */
  rate: number | null
}

export interface TeachingStudentListItem {
  student: TeachingStudent
  classes: TeachingEnrollment[]
  attendance: TeachingAttendanceCounts | null
}

export interface TeachingStudentList {
  items: TeachingStudentListItem[]
  truncated: boolean
}

export interface TeachingGuardian {
  id: string
  fullName: string
  displayName: string | null
  relationship: GuardianRelationship
  isPrimary: boolean
  email: string | null
  phone: string | null
}

export interface TeachingLessonAttendance {
  lessonId: string
  title: LocalizedLabel
  startsAt: string
  lessonStatus: LessonStatus
  status: TeachingAttendanceStatus | null
  minutesLate: number | null
}

export interface TeachingClassGrades {
  components: GradebookComponent[]
  cells: GradebookCell[]
  current: number | null
  projected: number | null
  final: FinalGrade | null
}

export interface TeachingStudentClass extends TeachingEnrollment {
  attendance: (TeachingAttendanceCounts & { lessons: TeachingLessonAttendance[] }) | null
  grades: TeachingClassGrades | null
}

export interface TeachingStudentDetail {
  student: TeachingStudent
  guardians: TeachingGuardian[]
  classes: TeachingStudentClass[]
}

export interface ListTeachingStudentsParams {
  q?: string
  classId?: string
  status?: TeachingStudentFilter
}

export function teachingStudentsPath(params: ListTeachingStudentsParams = {}): string {
  const search = new URLSearchParams()
  const q = params.q?.trim()
  if (q) search.set('q', q)
  if (params.classId) search.set('classId', params.classId)
  if (params.status && params.status !== 'active') search.set('status', params.status)
  const query = search.toString()
  return `/api/teaching/students${query ? `?${query}` : ''}`
}

export function listTeachingStudents(params: ListTeachingStudentsParams = {}, signal?: AbortSignal): Promise<TeachingStudentList> {
  return apiRequest<TeachingStudentList>(teachingStudentsPath(params), { signal })
}

export function getTeachingStudent(studentId: string, signal?: AbortSignal): Promise<TeachingStudentDetail> {
  return apiRequest<TeachingStudentDetail>(`/api/teaching/students/${encodeURIComponent(studentId)}`, { signal })
}
