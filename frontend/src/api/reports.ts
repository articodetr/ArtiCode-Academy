// MOD-13 reports (API-156..164) read by the dashboard and the reports page (redesign, 2026-11-14). Types mirror
// backend/src/reports/{reports,overview,attendance-reports,academic-reports,financial-reports}.dto.ts field by field.
// Every report is read-only and computed on read; the three keys below gate them on the server.
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

export const REPORT_KEYS = ['reports.attendance.view', 'reports.academic.view', 'reports.financial.view'] as const

export interface ReportPeriod {
  /** Calendar days in the academy zone, `YYYY-MM-DD`, both inclusive. */
  from: string
  to: string
}

export interface AttendanceCounts {
  present: number
  late: number
  absent: number
  excused: number
}

export interface ReportsOverview {
  asOf: string
  timeZone: string
  generatedAt: string
  general: { activeStudents: number; openClasses: number; runningClasses: number; lessonsToday: number }
  /** Null unless the caller holds `reports.attendance.view`; the last 30 days. */
  attendance: { period: ReportPeriod; records: AttendanceCounts; attendanceRate: number | null } | null
  /** Null unless the caller holds `reports.academic.view`. */
  academic: { period: ReportPeriod; finalGrades: number; averagePercent: number | null; passRate: number | null; awaitingReview: number } | null
  /** Null unless the caller holds `reports.financial.view`; collected = this month, outstanding = now. */
  financial: {
    period: ReportPeriod
    collected: Array<{ currency: string; payments: number; amount: number }>
    outstanding: Array<{ currency: string; balance: number; overdue: number; studentsOverdue: number }>
  } | null
}

/** `AttendanceCountsDto` of the detailed reports: the overview's counts plus `recorded` (records of any status). */
export interface ReportAttendanceCounts extends AttendanceCounts {
  recorded: number
}

export interface ReportCourseRef {
  id: string
  code: string
  name: LocalizedLabel
}

/** A student by identity only — the reports never carry a contact field (D-R68). */
export interface ReportStudentRef {
  id: string
  fullName: string
  displayName: string | null
}

export interface ReportClassRef {
  id: string
  code: string
  name: LocalizedLabel
  status: string
}

export interface AttendanceClassRow {
  class: ReportClassRef
  course: ReportCourseRef
  lessons: number
  completedLessons: number
  recordedLessons: number
  completedWithoutAttendance: number
  records: AttendanceCounts
  /** Percent 0..100 (present + late over present + late + absent), null without records. */
  attendanceRate: number | null
}

export interface AttendanceClassesTotals {
  classes: number
  lessons: number
  completedLessons: number
  recordedLessons: number
  completedWithoutAttendance: number
  records: ReportAttendanceCounts
  attendanceRate: number | null
}

export interface AttendanceClassesReport {
  period: ReportPeriod
  timeZone: string
  generatedAt?: string
  truncated: boolean
  rows: AttendanceClassRow[]
  /** Over every match, before the row cap. */
  totals?: AttendanceClassesTotals
}

/** API-157: one row per student × class, most absences first. */
export interface AttendanceStudentRow {
  student: ReportStudentRef
  class: ReportClassRef
  course: ReportCourseRef
  /** The enrollment status now; null when the student holds records but no enrollment any more. */
  enrollmentStatus: string | null
  records: ReportAttendanceCounts
  attendanceRate: number | null
  absenceRate: number | null
}

export interface AttendanceStudentsReport {
  period: ReportPeriod
  timeZone: string
  generatedAt: string
  truncated: boolean
  rows: AttendanceStudentRow[]
  totals: { rows: number; students: number; records: ReportAttendanceCounts; attendanceRate: number | null; absenceRate: number | null }
}

/* ---- API-158..160 (academic) ---- */

export interface GradeBandCount {
  label: LocalizedLabel
  letter: string | null
  count: number
}

export interface ClassPerformanceRow {
  class: ReportClassRef
  course: ReportCourseRef
  finalGrades: number
  averagePercent: number
  passed: number
  passRate: number
  /** From the frozen snapshot of each final grade. */
  bands: GradeBandCount[]
}

export interface CoursePerformanceRow {
  course: ReportCourseRef
  classes: number
  finalGrades: number
  averagePercent: number
  passed: number
  passRate: number
}

export interface ClassPerformanceReport {
  period: ReportPeriod
  timeZone: string
  generatedAt: string
  truncated: boolean
  rows: ClassPerformanceRow[]
  courses: CoursePerformanceRow[]
  totals: { classes: number; finalGrades: number; averagePercent: number | null; passed: number; passRate: number | null }
}

export interface AssignmentSubmissionRow {
  assignment: { id: string; title: LocalizedLabel; status: string; dueAt: string | null; publishedAt: string; maxScore: number; latePenaltyPercent: number | null }
  class: ReportClassRef
  course: ReportCourseRef
  students: number
  submitted: number
  onTime: number
  late: number
  notSubmitted: number
  awaitingReview: number
  graded: number
  returned: number
  submissionRate: number | null
  onTimeRate: number | null
  averagePercent: number | null
}

export interface AssignmentSubmissionsReport {
  period: ReportPeriod
  timeZone: string
  generatedAt: string
  truncated: boolean
  rows: AssignmentSubmissionRow[]
  totals: Omit<AssignmentSubmissionRow, 'assignment' | 'class' | 'course'> & { assignments: number }
}

export interface ExamResultsRow {
  exam: { id: string; title: LocalizedLabel; type: string; scheduledAt: string | null; publishedAt: string; maxScore: number; passScore: number | null }
  class: ReportClassRef
  course: ReportCourseRef
  students: number
  scored: number
  absent: number
  excused: number
  missing: number
  /** Absent counts as 0, excused is left out. */
  averagePercent: number | null
  minPercent: number | null
  maxPercent: number | null
  passed: number | null
  passRate: number | null
}

export interface ExamResultsReport {
  period: ReportPeriod
  timeZone: string
  generatedAt: string
  truncated: boolean
  rows: ExamResultsRow[]
  totals: { exams: number; students: number; scored: number; absent: number; excused: number; missing: number; averagePercent: number | null; passRate: number | null }
}

export interface CollectionRow {
  /** `YYYY-MM` in the academy zone. */
  month: string
  method: string
  currency: string
  payments: number
  amount: number
}

export interface CollectionsReport {
  period: ReportPeriod
  timeZone: string
  truncated: boolean
  rows: CollectionRow[]
  /** Reversed payments by the same keys, apart from the collected ones. */
  reversed?: CollectionRow[]
  totals: Array<{ currency: string; payments: number; amount: number; reversedPayments: number; reversedAmount: number }>
}

export interface Aging {
  days1To30: number
  days31To60: number
  days61To90: number
  days91Plus: number
}

export interface ReceivableRow {
  student: { id: string; fullName: string; displayName: string | null }
  currency: string
  invoices: number
  total: number
  paid: number
  balance: number
  overdue: number
  oldestOverdueDueOn: string | null
  daysOverdue: number | null
  aging: Aging
}

export interface ReceivablesReport {
  asOf: string
  timeZone: string
  truncated: boolean
  rows: ReceivableRow[]
  totals: Array<{ currency: string; students: number; invoices: number; total: number; paid: number; balance: number; overdue: number; aging: Aging }>
}

export interface RevenueRow {
  /** Null for invoices without an enrollment. */
  course: ReportCourseRef | null
  month: string
  currency: string
  invoices: number
  invoiced: number
  discounts: number
  payments: number
  collected: number
}

export interface RevenueReport {
  period: ReportPeriod
  timeZone: string
  generatedAt: string
  truncated: boolean
  rows: RevenueRow[]
  totals: Array<{ currency: string; invoices: number; invoiced: number; discounts: number; payments: number; collected: number }>
}

/** Optional filters every detailed report accepts (more per report on the server; only these are used here). */
export interface ReportFilters {
  courseId?: string
  classId?: string
}

function withPeriod(path: string, period?: Partial<ReportPeriod>, filters: Record<string, string | boolean | undefined> = {}): string {
  const query = new URLSearchParams()
  if (period?.from) query.set('from', period.from)
  if (period?.to) query.set('to', period.to)
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '' && value !== false) query.set(key, String(value))
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

/** API-164: any of the three report keys; each section is null without its own key. */
export function getReportsOverview(signal?: AbortSignal): Promise<ReportsOverview> {
  return apiRequest<ReportsOverview>('/api/reports/overview', { signal })
}

/** API-156: `reports.attendance.view`; the last 30 days by default. */
export function getAttendanceByClass(period?: Partial<ReportPeriod>, signal?: AbortSignal, filters: ReportFilters = {}): Promise<AttendanceClassesReport> {
  return apiRequest<AttendanceClassesReport>(withPeriod('/api/reports/attendance/classes', period, { ...filters }), { signal })
}

/** API-157: `reports.attendance.view`; per student × class, most absences first. */
export function getAttendanceByStudent(period?: Partial<ReportPeriod>, signal?: AbortSignal, filters: ReportFilters = {}): Promise<AttendanceStudentsReport> {
  return apiRequest<AttendanceStudentsReport>(withPeriod('/api/reports/attendance/students', period, { ...filters }), { signal })
}

/** API-158: `reports.academic.view`; final grades finalized in the period, per class and per course. */
export function getClassPerformance(period?: Partial<ReportPeriod>, signal?: AbortSignal, filters: ReportFilters = {}): Promise<ClassPerformanceReport> {
  return apiRequest<ClassPerformanceReport>(withPeriod('/api/reports/academic/classes', period, { ...filters }), { signal })
}

/** API-159: `reports.academic.view`; non-draft assignments due (else published) in the period. */
export function getAssignmentSubmissions(period?: Partial<ReportPeriod>, signal?: AbortSignal, filters: ReportFilters = {}): Promise<AssignmentSubmissionsReport> {
  return apiRequest<AssignmentSubmissionsReport>(withPeriod('/api/reports/academic/assignments', period, { ...filters }), { signal })
}

/** API-160: `reports.academic.view`; published exams scheduled (else published) in the period. */
export function getExamResults(period?: Partial<ReportPeriod>, signal?: AbortSignal, filters: ReportFilters = {}): Promise<ExamResultsReport> {
  return apiRequest<ExamResultsReport>(withPeriod('/api/reports/academic/exams', period, { ...filters }), { signal })
}

/** API-163: `reports.financial.view`; invoiced (by issue day) and collected (by payment day) per course × month. */
export function getRevenue(period?: Partial<ReportPeriod>, signal?: AbortSignal, filters: Pick<ReportFilters, 'courseId'> = {}): Promise<RevenueReport> {
  return apiRequest<RevenueReport>(withPeriod('/api/reports/financial/revenue', period, { ...filters }), { signal })
}

/** API-161: `reports.financial.view`; completed payments per month × method × currency. */
export function getCollections(period?: Partial<ReportPeriod>, signal?: AbortSignal): Promise<CollectionsReport> {
  return apiRequest<CollectionsReport>(withPeriod('/api/reports/financial/collections', period), { signal })
}

/** API-162: `reports.financial.view`; balances as of today, overdue ones first when `overdueOnly`. */
export function getReceivables(overdueOnly = false, signal?: AbortSignal): Promise<ReceivablesReport> {
  return apiRequest<ReceivablesReport>(overdueOnly ? '/api/reports/financial/receivables?overdueOnly=true' : '/api/reports/financial/receivables', { signal })
}
