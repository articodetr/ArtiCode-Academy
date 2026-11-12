// Reports (MOD-13 — J-F53): API-156..API-163, the eight read-only reports, and
// API-164, the dashboard overview. Types mirror backend/src/reports/
// reports.dto.ts, attendance-reports.dto.ts, academic-reports.dto.ts,
// financial-reports.dto.ts and overview.dto.ts field by field; the limits mirror
// reports.policy.ts — keep them in sync. Every call goes through apiRequest
// (Bearer header, refresh-and-retry on 401).
//
// Academy-wide for a holder of the report's key, no class visibility (D-R68):
// `reports.attendance.view` (academy_admin and staff by seed) opens API-156/157,
// `reports.academic.view` (academy_admin) API-158..160, `reports.financial.view`
// (academy_admin and staff) API-161..163; the overview opens with any of the
// three and carries one section per key held. Every report answers the same
// envelope `{ period { from, to }, timeZone, generatedAt, truncated, rows,
// totals }` — the receivables are read «now» (`period: null`, `asOf`). The days
// are calendar days in the academy's zone (D-R69): an absent `to` is today
// there, an absent `from` the day that makes a 30-day period; more than 366
// inclusive days, or `from` after `to`, is `400 report_range_invalid { from, to,
// maxDays }`. Rates are numbers with two decimals, null when the denominator is
// zero; amounts JSON numbers with two decimals per currency (D-R70). At most
// 5,000 rows with `truncated: true`, the totals over everything that matched
// (D-R72). An unknown parameter is a 400 — every path builder below sends only
// the parameters its report accepts. Read-only: no audit event (D-R73).
import type { ClassStatus } from './classes'
import { apiRequest } from './client'
import type { EnrollmentStatus } from './enrollments'
import type { ExamType } from './exams'
import type { AttendanceCounts } from './lessons'
import type { LocalizedLabel } from './users'

/** The three report keys (`REPORT_PERMISSIONS` of reports.policy.ts); API-164 opens with any of them. */
export const REPORTS_ATTENDANCE_PERMISSION = 'reports.attendance.view'
export const REPORTS_ACADEMIC_PERMISSION = 'reports.academic.view'
export const REPORTS_FINANCIAL_PERMISSION = 'reports.financial.view'
export const REPORT_PERMISSIONS = [REPORTS_ATTENDANCE_PERMISSION, REPORTS_ACADEMIC_PERMISSION, REPORTS_FINANCIAL_PERMISSION] as const

/** D-R69: the longest period in inclusive days (`MAX_PERIOD_DAYS`). */
export const REPORT_MAX_PERIOD_DAYS = 366
/** D-R69: the server's period without `from` (`DEFAULT_PERIOD_DAYS`), ending on `to` (else today). */
export const REPORT_DEFAULT_PERIOD_DAYS = 30
/** D-R72: the most rows one report returns (`ROW_CAP`). */
export const REPORT_ROW_CAP = 5000

/** The assignment states API-159 filters on (`REPORT_ASSIGNMENT_STATUSES` — `grading`/`graded` are unused, D-R37). */
export const REPORT_ASSIGNMENT_STATUSES = ['open', 'closed'] as const
export type ReportAssignmentStatus = (typeof REPORT_ASSIGNMENT_STATUSES)[number]

/** The Prisma enum `payment_method`, in its order (API-161's `method`). */
export const REPORT_PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'cheque', 'other'] as const
export type ReportPaymentMethod = (typeof REPORT_PAYMENT_METHODS)[number]

// --- shared (reports.dto.ts) ------------------------------------------------

/** `ReportPeriodDto`: two calendar days `YYYY-MM-DD`, both inclusive, in the academy's zone. */
export interface ReportPeriod {
  from: string
  to: string
}

/** `ReportCourseRefDto`. */
export interface ReportCourseRef {
  id: string
  code: string
  name: LocalizedLabel
}

/** `ReportClassRefDto`: `status` is the class's state now. */
export interface ReportClassRef {
  id: string
  code: string
  name: LocalizedLabel
  status: ClassStatus
}

/** `ReportStudentRefDto`: a student by identity only — never a contact field (D-R68). */
export interface ReportStudentRef {
  id: string
  fullName: string
  displayName: string | null
}

/** What every report with a period answers around its rows and totals. */
export interface ReportEnvelope {
  period: ReportPeriod
  /** The academy's zone the days are read in (UTC without the academy row). */
  timeZone: string
  /** ISO 8601 — when the report was computed. */
  generatedAt: string
  /** True when more than REPORT_ROW_CAP rows matched; the first ones are returned. */
  truncated: boolean
}

/** `from`/`to` of `ReportPeriodQueryDto`. */
export interface ReportPeriodParams {
  /** `YYYY-MM-DD`; absent = the day that makes a 30-day period with `to`. */
  from?: string
  /** `YYYY-MM-DD`; absent = today in the academy's zone. */
  to?: string
}

// --- API-156 (attendance-reports.dto.ts) ------------------------------------

/** `AttendanceClassRowDto`: one class with non-cancelled lessons starting in the period. */
export interface AttendanceClassRow {
  class: ReportClassRef
  course: ReportCourseRef
  lessons: number
  completedLessons: number
  /** Of them, the ones whose attendance was taken. */
  recordedLessons: number
  completedWithoutAttendance: number
  records: AttendanceCounts
  /** (present + late) ÷ (present + late + absent) in %, excused left out (D-R70); null without such records. */
  attendanceRate: number | null
}

/** `AttendanceClassesTotalsDto`: over every matching row, even when truncated. */
export interface AttendanceClassesTotals {
  classes: number
  lessons: number
  completedLessons: number
  recordedLessons: number
  completedWithoutAttendance: number
  records: AttendanceCounts
  attendanceRate: number | null
}

/** `AttendanceClassesReportDto` — rows by course code, then class code. */
export interface AttendanceClassesReport extends ReportEnvelope {
  rows: AttendanceClassRow[]
  totals: AttendanceClassesTotals
}

/** `AttendanceClassesQueryDto`. */
export interface AttendanceClassesParams extends ReportPeriodParams {
  courseId?: string
  classId?: string
  /** The classes in this state now. */
  classStatus?: ClassStatus
}

// --- API-157 ----------------------------------------------------------------

/** `AttendanceStudentRowDto`: one (student × class) with records in the period's non-cancelled lessons. */
export interface AttendanceStudentRow {
  student: ReportStudentRef
  class: ReportClassRef
  course: ReportCourseRef
  /** The student's enrollment in the class now, or null (a student withdrawn later keeps their records). */
  enrollmentStatus: EnrollmentStatus | null
  records: AttendanceCounts
  attendanceRate: number | null
  /** absent ÷ (present + late + absent), in %. */
  absenceRate: number | null
}

/** `AttendanceStudentsTotalsDto`. */
export interface AttendanceStudentsTotals {
  /** Matching (student × class) rows, even when truncated. */
  rows: number
  /** Distinct students among them. */
  students: number
  records: AttendanceCounts
  attendanceRate: number | null
  absenceRate: number | null
}

/** `AttendanceStudentsReportDto` — most absences first, then the higher absence rate, the name and the class code. */
export interface AttendanceStudentsReport extends ReportEnvelope {
  rows: AttendanceStudentRow[]
  totals: AttendanceStudentsTotals
}

/** `AttendanceStudentsQueryDto`. */
export interface AttendanceStudentsParams extends ReportPeriodParams {
  courseId?: string
  classId?: string
  /** An integer ≥ 1. */
  minAbsences?: number
  /** 0..100 with at most two decimals (compared with the unrounded rate). */
  minAbsenceRate?: number
}

// --- API-158 (academic-reports.dto.ts) --------------------------------------

/** `GradeBandCountDto`: a band as frozen in the final grades (D-R44). */
export interface GradeBandCount {
  label: LocalizedLabel
  letter: string | null
  count: number
}

/** `ClassPerformanceRowDto`: a class with final grades finalized in the period. */
export interface ClassPerformanceRow {
  class: ReportClassRef
  course: ReportCourseRef
  finalGrades: number
  averagePercent: number
  passed: number
  /** passed ÷ finalGrades, in %. */
  passRate: number
  /** The highest grades' band first. */
  bands: GradeBandCount[]
}

/** `CoursePerformanceRowDto`: the mean is over every final grade of the course, not a mean of class means. */
export interface CoursePerformanceRow {
  course: ReportCourseRef
  classes: number
  finalGrades: number
  averagePercent: number
  passed: number
  passRate: number
}

/** `PerformanceTotalsDto`. */
export interface PerformanceTotals {
  classes: number
  finalGrades: number
  averagePercent: number | null
  passed: number
  passRate: number | null
}

/** `ClassPerformanceReportDto` — rows by course code then class code, courses by code. */
export interface ClassPerformanceReport extends ReportEnvelope {
  rows: ClassPerformanceRow[]
  courses: CoursePerformanceRow[]
  totals: PerformanceTotals
}

/** `AcademicClassesQueryDto` — the period on `final_grades.finalized_at`. */
export interface AcademicClassesParams extends ReportPeriodParams {
  courseId?: string
  classId?: string
}

// --- API-159 ----------------------------------------------------------------

/** `ReportAssignmentRefDto`. */
export interface ReportAssignmentRef {
  id: string
  title: LocalizedLabel
  /** `open`, `closed` (`grading`/`graded` are unused — D-R37). */
  status: string
  /** ISO 8601, or null for an undated assignment. */
  dueAt: string | null
  /** ISO 8601 — the day an undated assignment counts on. */
  publishedAt: string
  maxScore: number
  latePenaltyPercent: number | null
}

/** `AssignmentSubmissionRowDto`: a non-draft assignment due (else published) in the period. */
export interface AssignmentSubmissionRow {
  assignment: ReportAssignmentRef
  class: ReportClassRef
  course: ReportCourseRef
  /** Students with an active or completed enrollment in the class, plus anyone holding a submission. */
  students: number
  submitted: number
  /** By the latest attempt. */
  onTime: number
  late: number
  notSubmitted: number
  /** By the latest attempt's state. */
  awaitingReview: number
  graded: number
  returned: number
  /** submitted ÷ students, in %. */
  submissionRate: number | null
  /** onTime ÷ students, in %. */
  onTimeRate: number | null
  /** Mean of each student's latest graded attempt in % after the late penalty (`cellOutcome()` — D-R70). */
  averagePercent: number | null
}

/** `AssignmentTotalsDto`. */
export interface AssignmentTotals {
  assignments: number
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

/** `AssignmentSubmissionsReportDto` — by due date (else publish date), then id. */
export interface AssignmentSubmissionsReport extends ReportEnvelope {
  rows: AssignmentSubmissionRow[]
  totals: AssignmentTotals
}

/** `AcademicAssignmentsQueryDto` — the period on `due_at`, else `published_at`. */
export interface AcademicAssignmentsParams extends ReportPeriodParams {
  courseId?: string
  classId?: string
  status?: ReportAssignmentStatus
}

// --- API-160 ----------------------------------------------------------------

/** `ReportExamRefDto`. */
export interface ReportExamRef {
  id: string
  title: LocalizedLabel
  type: ExamType
  /** ISO 8601 or null. */
  scheduledAt: string | null
  /** ISO 8601. */
  publishedAt: string
  maxScore: number
  passScore: number | null
}

/** `ExamResultsRowDto`: a published exam scheduled (else published) in the period. */
export interface ExamResultsRow {
  exam: ReportExamRef
  class: ReportClassRef
  course: ReportCourseRef
  students: number
  scored: number
  absent: number
  excused: number
  /** Students without a result. */
  missing: number
  /** Over scored and absent (absent = 0); excused and missing left out (`cellOutcome()` — D-R70). */
  averagePercent: number | null
  minPercent: number | null
  maxPercent: number | null
  /** Scored results at or above `passScore`; null without a pass score. */
  passed: number | null
  /** passed ÷ (scored + absent), in %. */
  passRate: number | null
}

/** `ExamTotalsDto` — `passRate` over the exams with a pass score. */
export interface ExamTotals {
  exams: number
  students: number
  scored: number
  absent: number
  excused: number
  missing: number
  averagePercent: number | null
  passRate: number | null
}

/** `ExamResultsReportDto` — by scheduled date (else publish date), then id. */
export interface ExamResultsReport extends ReportEnvelope {
  rows: ExamResultsRow[]
  totals: ExamTotals
}

/** `AcademicExamsQueryDto` — the period on `scheduled_at`, else `published_at`. */
export interface AcademicExamsParams extends ReportPeriodParams {
  courseId?: string
  classId?: string
  type?: ExamType
}

// --- API-161 (financial-reports.dto.ts) -------------------------------------

/** `CollectionRowDto`: payments of one month (the academy's zone) × method × currency. */
export interface CollectionRow {
  /** `YYYY-MM`. */
  month: string
  method: ReportPaymentMethod
  currency: string
  payments: number
  /** A JSON number with two decimals. */
  amount: number
}

/** `CollectionTotalsDto`: one per currency. */
export interface CollectionTotals {
  currency: string
  /** Completed payments. */
  payments: number
  amount: number
  /** Payments of the period reversed since. */
  reversedPayments: number
  reversedAmount: number
}

/** `CollectionsReportDto`: `reversed` is not part of `rows`. */
export interface CollectionsReport extends ReportEnvelope {
  rows: CollectionRow[]
  reversed: CollectionRow[]
  totals: CollectionTotals[]
}

/** `FinancialCollectionsQueryDto` — the period on `payments.paid_at`; course and class through the invoice's enrollment. */
export interface FinancialCollectionsParams extends ReportPeriodParams {
  method?: ReportPaymentMethod
  courseId?: string
  classId?: string
}

// --- API-162 ----------------------------------------------------------------

/** `AgingDto`: the overdue amount by the age of each installment. */
export interface Aging {
  days1To30: number
  days31To60: number
  days61To90: number
  days91Plus: number
}

/** `ReceivableRowDto`: one (student × currency) with an issued invoice and a balance. */
export interface ReceivableRow {
  student: ReportStudentRef
  currency: string
  /** Issued invoices with a balance. */
  invoices: number
  total: number
  paid: number
  balance: number
  /** The uncovered part of the installments due before today (the paid amount covers the oldest first). */
  overdue: number
  /** `YYYY-MM-DD` — due day of the oldest uncovered overdue installment. */
  oldestOverdueDueOn: string | null
  /** Days since that day. */
  daysOverdue: number | null
  aging: Aging
}

/** `ReceivableTotalsDto`: one per currency, over every matching row. */
export interface ReceivableTotals {
  currency: string
  students: number
  invoices: number
  total: number
  paid: number
  balance: number
  overdue: number
  aging: Aging
}

/** `ReceivablesReportDto`: read as of today — no period. */
export interface ReceivablesReport {
  /** Always null. */
  period: null
  /** `YYYY-MM-DD` — today in the academy's zone. */
  asOf: string
  timeZone: string
  generatedAt: string
  truncated: boolean
  /** Most overdue first. */
  rows: ReceivableRow[]
  totals: ReceivableTotals[]
}

/** `FinancialReceivablesQueryDto` — no `from`/`to` (they would be unknown parameters). */
export interface FinancialReceivablesParams {
  courseId?: string
  classId?: string
  /** true = only the rows with an overdue amount; false = absent. */
  overdueOnly?: boolean
}

// --- API-163 ----------------------------------------------------------------

/** `RevenueRowDto`: one course × month × currency. */
export interface RevenueRow {
  /** null = invoices without an enrollment. */
  course: ReportCourseRef | null
  /** `YYYY-MM`. */
  month: string
  currency: string
  /** Invoices issued in the month and not cancelled. */
  invoices: number
  /** Their totals (after the discount). */
  invoiced: number
  discounts: number
  /** Completed payments paid in the month on the course's invoices. */
  payments: number
  collected: number
}

/** `RevenueTotalsDto`: one per currency. */
export interface RevenueTotals {
  currency: string
  invoices: number
  invoiced: number
  discounts: number
  payments: number
  collected: number
}

/** `RevenueReportDto` — by course code (no course last), month and currency. */
export interface RevenueReport extends ReportEnvelope {
  rows: RevenueRow[]
  totals: RevenueTotals[]
}

/** `FinancialRevenueQueryDto`. */
export interface FinancialRevenueParams extends ReportPeriodParams {
  courseId?: string
}

// --- API-164 (overview.dto.ts) ----------------------------------------------

/** `OverviewGeneralDto`: for a holder of any report key. */
export interface OverviewGeneral {
  /** Distinct students with an active enrollment. */
  activeStudents: number
  openClasses: number
  runningClasses: number
  /** Lessons starting today (the academy's day) and not cancelled. */
  lessonsToday: number
}

/** `OverviewAttendanceDto`: API-156's totals for the last 30 days. */
export interface OverviewAttendance {
  period: ReportPeriod
  records: AttendanceCounts
  attendanceRate: number | null
}

/** `OverviewAcademicDto`: API-158's totals for the last 30 days, and the attempts waiting for review (no period). */
export interface OverviewAcademic {
  period: ReportPeriod
  finalGrades: number
  averagePercent: number | null
  passRate: number | null
  awaitingReview: number
}

/** `OverviewCollectedDto`. */
export interface OverviewCollected {
  currency: string
  payments: number
  amount: number
}

/** `OverviewOutstandingDto`: as of today. */
export interface OverviewOutstanding {
  currency: string
  balance: number
  overdue: number
  /** Students with an overdue amount in this currency. */
  studentsOverdue: number
}

/** `OverviewFinancialDto`: this month so far (API-161's totals) and the balance now (API-162's totals). */
export interface OverviewFinancial {
  period: ReportPeriod
  collected: OverviewCollected[]
  outstanding: OverviewOutstanding[]
}

/** `ReportsOverviewDto`: a section whose key the caller lacks is null. */
export interface ReportsOverview {
  /** `YYYY-MM-DD` — today in the academy's zone. */
  asOf: string
  timeZone: string
  generatedAt: string
  general: OverviewGeneral
  attendance: OverviewAttendance | null
  academic: OverviewAcademic | null
  financial: OverviewFinancial | null
}

// --- paths and calls --------------------------------------------------------

export const REPORTS_PATH = '/api/reports'
export const ATTENDANCE_CLASSES_PATH = `${REPORTS_PATH}/attendance/classes`
export const ATTENDANCE_STUDENTS_PATH = `${REPORTS_PATH}/attendance/students`
export const ACADEMIC_CLASSES_PATH = `${REPORTS_PATH}/academic/classes`
export const ACADEMIC_ASSIGNMENTS_PATH = `${REPORTS_PATH}/academic/assignments`
export const ACADEMIC_EXAMS_PATH = `${REPORTS_PATH}/academic/exams`
export const FINANCIAL_COLLECTIONS_PATH = `${REPORTS_PATH}/financial/collections`
export const FINANCIAL_RECEIVABLES_PATH = `${REPORTS_PATH}/financial/receivables`
export const FINANCIAL_REVENUE_PATH = `${REPORTS_PATH}/financial/revenue`
export const REPORTS_OVERVIEW_PATH = `${REPORTS_PATH}/overview`

type QueryValue = string | number | undefined

/** `base?…` with the given entries that hold a value, in the order given. */
function withQuery(base: string, entries: readonly (readonly [string, QueryValue])[]): string {
  const query = new URLSearchParams()
  for (const [name, value] of entries) {
    if (value === undefined || value === '') continue
    query.set(name, String(value))
  }
  const search = query.toString()
  return search ? `${base}?${search}` : base
}

/** API-156 path. */
export function attendanceClassesPath(params: AttendanceClassesParams = {}): string {
  return withQuery(ATTENDANCE_CLASSES_PATH, [
    ['from', params.from],
    ['to', params.to],
    ['courseId', params.courseId],
    ['classId', params.classId],
    ['classStatus', params.classStatus],
  ])
}

/** API-157 path. */
export function attendanceStudentsPath(params: AttendanceStudentsParams = {}): string {
  return withQuery(ATTENDANCE_STUDENTS_PATH, [
    ['from', params.from],
    ['to', params.to],
    ['courseId', params.courseId],
    ['classId', params.classId],
    ['minAbsences', params.minAbsences],
    ['minAbsenceRate', params.minAbsenceRate],
  ])
}

/** API-158 path. */
export function academicClassesPath(params: AcademicClassesParams = {}): string {
  return withQuery(ACADEMIC_CLASSES_PATH, [
    ['from', params.from],
    ['to', params.to],
    ['courseId', params.courseId],
    ['classId', params.classId],
  ])
}

/** API-159 path. */
export function academicAssignmentsPath(params: AcademicAssignmentsParams = {}): string {
  return withQuery(ACADEMIC_ASSIGNMENTS_PATH, [
    ['from', params.from],
    ['to', params.to],
    ['courseId', params.courseId],
    ['classId', params.classId],
    ['status', params.status],
  ])
}

/** API-160 path. */
export function academicExamsPath(params: AcademicExamsParams = {}): string {
  return withQuery(ACADEMIC_EXAMS_PATH, [
    ['from', params.from],
    ['to', params.to],
    ['courseId', params.courseId],
    ['classId', params.classId],
    ['type', params.type],
  ])
}

/** API-161 path. */
export function financialCollectionsPath(params: FinancialCollectionsParams = {}): string {
  return withQuery(FINANCIAL_COLLECTIONS_PATH, [
    ['from', params.from],
    ['to', params.to],
    ['method', params.method],
    ['courseId', params.courseId],
    ['classId', params.classId],
  ])
}

/** API-162 path: `overdueOnly` is sent only when true (false and absent both mean every row). */
export function financialReceivablesPath(params: FinancialReceivablesParams = {}): string {
  return withQuery(FINANCIAL_RECEIVABLES_PATH, [
    ['courseId', params.courseId],
    ['classId', params.classId],
    ['overdueOnly', params.overdueOnly === true ? 'true' : undefined],
  ])
}

/** API-163 path. */
export function financialRevenuePath(params: FinancialRevenueParams = {}): string {
  return withQuery(FINANCIAL_REVENUE_PATH, [
    ['from', params.from],
    ['to', params.to],
    ['courseId', params.courseId],
  ])
}

/** API-156 (`reports.attendance.view`). */
export function getAttendanceClassesReport(params: AttendanceClassesParams = {}, signal?: AbortSignal): Promise<AttendanceClassesReport> {
  return apiRequest<AttendanceClassesReport>(attendanceClassesPath(params), { signal })
}

/** API-157 (`reports.attendance.view`). */
export function getAttendanceStudentsReport(params: AttendanceStudentsParams = {}, signal?: AbortSignal): Promise<AttendanceStudentsReport> {
  return apiRequest<AttendanceStudentsReport>(attendanceStudentsPath(params), { signal })
}

/** API-158 (`reports.academic.view`). */
export function getAcademicClassesReport(params: AcademicClassesParams = {}, signal?: AbortSignal): Promise<ClassPerformanceReport> {
  return apiRequest<ClassPerformanceReport>(academicClassesPath(params), { signal })
}

/** API-159 (`reports.academic.view`). */
export function getAcademicAssignmentsReport(params: AcademicAssignmentsParams = {}, signal?: AbortSignal): Promise<AssignmentSubmissionsReport> {
  return apiRequest<AssignmentSubmissionsReport>(academicAssignmentsPath(params), { signal })
}

/** API-160 (`reports.academic.view`). */
export function getAcademicExamsReport(params: AcademicExamsParams = {}, signal?: AbortSignal): Promise<ExamResultsReport> {
  return apiRequest<ExamResultsReport>(academicExamsPath(params), { signal })
}

/** API-161 (`reports.financial.view`). */
export function getFinancialCollectionsReport(params: FinancialCollectionsParams = {}, signal?: AbortSignal): Promise<CollectionsReport> {
  return apiRequest<CollectionsReport>(financialCollectionsPath(params), { signal })
}

/** API-162 (`reports.financial.view`). */
export function getFinancialReceivablesReport(params: FinancialReceivablesParams = {}, signal?: AbortSignal): Promise<ReceivablesReport> {
  return apiRequest<ReceivablesReport>(financialReceivablesPath(params), { signal })
}

/** API-163 (`reports.financial.view`). */
export function getFinancialRevenueReport(params: FinancialRevenueParams = {}, signal?: AbortSignal): Promise<RevenueReport> {
  return apiRequest<RevenueReport>(financialRevenuePath(params), { signal })
}

/** API-164: any of the three keys, else `403 permission_denied { missing: [the three] }`; no parameter. */
export function getReportsOverview(signal?: AbortSignal): Promise<ReportsOverview> {
  return apiRequest<ReportsOverview>(REPORTS_OVERVIEW_PATH, { signal })
}
