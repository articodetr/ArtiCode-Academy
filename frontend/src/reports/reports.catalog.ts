// The eight reports of the /reports page (MOD-13-T06 — J-F53): which key opens
// each one (D-R68 — the same keys the server's guards enforce, see
// backend/src/reports/*.controller.ts), which filters its query DTO accepts,
// and the request one set of filter values makes for it. Pure; unit-tested in
// reports.catalog.test.ts.
//
// One set of filter values is shared by every report of a visit, so a period
// chosen for one report carries over to the next; each report sends only the
// parameters its query DTO declares — the server refuses an unknown parameter
// with a 400 (the receivables take no period at all, the revenue no class).
import {
  REPORTS_ACADEMIC_PERMISSION,
  REPORTS_ATTENDANCE_PERMISSION,
  REPORTS_FINANCIAL_PERMISSION,
  REPORT_PERMISSIONS,
  academicAssignmentsPath,
  academicClassesPath,
  academicExamsPath,
  attendanceClassesPath,
  attendanceStudentsPath,
  financialCollectionsPath,
  financialReceivablesPath,
  financialRevenuePath,
  getAcademicAssignmentsReport,
  getAcademicClassesReport,
  getAcademicExamsReport,
  getAttendanceClassesReport,
  getAttendanceStudentsReport,
  getFinancialCollectionsReport,
  getFinancialReceivablesReport,
  getFinancialRevenueReport,
} from '../api/reports'
import type {
  AcademicAssignmentsParams,
  AcademicClassesParams,
  AcademicExamsParams,
  AssignmentSubmissionsReport,
  AttendanceClassesParams,
  AttendanceClassesReport,
  AttendanceStudentsParams,
  AttendanceStudentsReport,
  ClassPerformanceReport,
  CollectionsReport,
  ExamResultsReport,
  FinancialCollectionsParams,
  FinancialReceivablesParams,
  FinancialRevenueParams,
  ReceivablesReport,
  ReportAssignmentStatus,
  ReportPaymentMethod,
  ReportPeriod,
  ReportPeriodParams,
  RevenueReport,
} from '../api/reports'
import type { ClassStatus } from '../api/classes'
import type { ExamType } from '../api/exams'

export const REPORT_FAMILIES = ['attendance', 'academic', 'financial'] as const
export type ReportFamily = (typeof REPORT_FAMILIES)[number]

/** The value of `?report=` — one per endpoint of API-156..API-163. */
export const REPORT_KEYS = [
  'attendance-classes',
  'attendance-students',
  'academic-classes',
  'academic-assignments',
  'academic-exams',
  'financial-collections',
  'financial-receivables',
  'financial-revenue',
] as const
export type ReportKey = (typeof REPORT_KEYS)[number]

/** A filter of the page; each report shows the ones its query DTO accepts. */
export type ReportFilterName =
  | 'period'
  | 'course'
  | 'class'
  | 'classStatus'
  | 'minAbsences'
  | 'minAbsenceRate'
  | 'assignmentStatus'
  | 'examType'
  | 'method'
  | 'overdueOnly'

export interface ReportDefinition {
  key: ReportKey
  family: ReportFamily
  /** The key the report's controller requires (`@RequirePermissions` at the controller). */
  permission: string
  /** `reports.catalog.<id>` holds its name and description. */
  i18nId: string
  /** In the order the filter bar shows them. */
  filters: readonly ReportFilterName[]
}

export const REPORTS: readonly ReportDefinition[] = [
  {
    key: 'attendance-classes',
    family: 'attendance',
    permission: REPORTS_ATTENDANCE_PERMISSION,
    i18nId: 'attendanceClasses',
    filters: ['period', 'course', 'class', 'classStatus'],
  },
  {
    key: 'attendance-students',
    family: 'attendance',
    permission: REPORTS_ATTENDANCE_PERMISSION,
    i18nId: 'attendanceStudents',
    filters: ['period', 'course', 'class', 'minAbsences', 'minAbsenceRate'],
  },
  { key: 'academic-classes', family: 'academic', permission: REPORTS_ACADEMIC_PERMISSION, i18nId: 'academicClasses', filters: ['period', 'course', 'class'] },
  {
    key: 'academic-assignments',
    family: 'academic',
    permission: REPORTS_ACADEMIC_PERMISSION,
    i18nId: 'academicAssignments',
    filters: ['period', 'course', 'class', 'assignmentStatus'],
  },
  { key: 'academic-exams', family: 'academic', permission: REPORTS_ACADEMIC_PERMISSION, i18nId: 'academicExams', filters: ['period', 'course', 'class', 'examType'] },
  {
    key: 'financial-collections',
    family: 'financial',
    permission: REPORTS_FINANCIAL_PERMISSION,
    i18nId: 'financialCollections',
    filters: ['period', 'method', 'course', 'class'],
  },
  // «Now» (D-R69): no period — `from`/`to` would be unknown parameters (400).
  { key: 'financial-receivables', family: 'financial', permission: REPORTS_FINANCIAL_PERMISSION, i18nId: 'financialReceivables', filters: ['course', 'class', 'overdueOnly'] },
  // The course alone: an invoice without an enrollment has no course, and the query takes no class.
  { key: 'financial-revenue', family: 'financial', permission: REPORTS_FINANCIAL_PERMISSION, i18nId: 'financialRevenue', filters: ['period', 'course'] },
]

/** The definition of a `?report=` value, or null for anything else. */
export function reportDefinitionOf(key: string | null | undefined): ReportDefinition | null {
  return REPORTS.find((report) => report.key === key) ?? null
}

/** The reports the caller's keys open, in catalog order. */
export function availableReports(permissions: readonly string[]): ReportDefinition[] {
  return REPORTS.filter((report) => permissions.includes(report.permission))
}

/** True when the caller holds any of the three report keys — the rule of API-164 (`reportsMissing()`) and of the `reports` entry. */
export function holdsReportKey(permissions: readonly string[]): boolean {
  return REPORT_PERMISSIONS.some((key) => permissions.includes(key))
}

/** The values of the filter bar, shared by every report of the page. */
export interface ReportFilters {
  /** `YYYY-MM-DD`; absent = the server's default (D-R69). */
  from?: string
  to?: string
  courseId?: string
  /** The chosen course as the picker showed it — for the printed filters line only. */
  courseLabel?: string
  classId?: string
  classLabel?: string
  classStatus?: ClassStatus
  minAbsences?: number
  minAbsenceRate?: number
  assignmentStatus?: ReportAssignmentStatus
  examType?: ExamType
  method?: ReportPaymentMethod
  overdueOnly?: boolean
}

export const EMPTY_REPORT_FILTERS: ReportFilters = {}

/** A loaded report, tagged with the report it answers (the screen never shows one report's rows under another's title). */
export type LoadedReport =
  | { key: 'attendance-classes'; data: AttendanceClassesReport }
  | { key: 'attendance-students'; data: AttendanceStudentsReport }
  | { key: 'academic-classes'; data: ClassPerformanceReport }
  | { key: 'academic-assignments'; data: AssignmentSubmissionsReport }
  | { key: 'academic-exams'; data: ExamResultsReport }
  | { key: 'financial-collections'; data: CollectionsReport }
  | { key: 'financial-receivables'; data: ReceivablesReport }
  | { key: 'financial-revenue'; data: RevenueReport }

/** One request of a report: its path (a new path is a new request) and the call. */
export interface ReportRequest {
  path: string
  load: (signal?: AbortSignal) => Promise<LoadedReport>
}

function periodParams(filters: ReportFilters): ReportPeriodParams {
  return { from: filters.from, to: filters.to }
}

/** The request `filters` make for `key` — only the parameters its query DTO declares. */
export function reportRequest(key: ReportKey, filters: ReportFilters): ReportRequest {
  const scope = { courseId: filters.courseId, classId: filters.classId }
  switch (key) {
    case 'attendance-classes': {
      const params: AttendanceClassesParams = { ...periodParams(filters), ...scope, classStatus: filters.classStatus }
      return { path: attendanceClassesPath(params), load: (signal) => getAttendanceClassesReport(params, signal).then((data) => ({ key, data })) }
    }
    case 'attendance-students': {
      const params: AttendanceStudentsParams = { ...periodParams(filters), ...scope, minAbsences: filters.minAbsences, minAbsenceRate: filters.minAbsenceRate }
      return { path: attendanceStudentsPath(params), load: (signal) => getAttendanceStudentsReport(params, signal).then((data) => ({ key, data })) }
    }
    case 'academic-classes': {
      const params: AcademicClassesParams = { ...periodParams(filters), ...scope }
      return { path: academicClassesPath(params), load: (signal) => getAcademicClassesReport(params, signal).then((data) => ({ key, data })) }
    }
    case 'academic-assignments': {
      const params: AcademicAssignmentsParams = { ...periodParams(filters), ...scope, status: filters.assignmentStatus }
      return { path: academicAssignmentsPath(params), load: (signal) => getAcademicAssignmentsReport(params, signal).then((data) => ({ key, data })) }
    }
    case 'academic-exams': {
      const params: AcademicExamsParams = { ...periodParams(filters), ...scope, type: filters.examType }
      return { path: academicExamsPath(params), load: (signal) => getAcademicExamsReport(params, signal).then((data) => ({ key, data })) }
    }
    case 'financial-collections': {
      const params: FinancialCollectionsParams = { ...periodParams(filters), method: filters.method, ...scope }
      return { path: financialCollectionsPath(params), load: (signal) => getFinancialCollectionsReport(params, signal).then((data) => ({ key, data })) }
    }
    case 'financial-receivables': {
      const params: FinancialReceivablesParams = { ...scope, overdueOnly: filters.overdueOnly }
      return { path: financialReceivablesPath(params), load: (signal) => getFinancialReceivablesReport(params, signal).then((data) => ({ key, data })) }
    }
    case 'financial-revenue': {
      const params: FinancialRevenueParams = { ...periodParams(filters), courseId: filters.courseId }
      return { path: financialRevenuePath(params), load: (signal) => getFinancialRevenueReport(params, signal).then((data) => ({ key, data })) }
    }
  }
}

/** The envelope of a loaded report, whatever its rows: the period (null for the receivables), `asOf`, zone, time and cap. */
export interface ReportMeta {
  period: ReportPeriod | null
  /** Only the receivables, read «now». */
  asOf: string | null
  timeZone: string
  generatedAt: string
  truncated: boolean
}

export function reportMetaOf(report: LoadedReport): ReportMeta {
  const { timeZone, generatedAt, truncated } = report.data
  if (report.key === 'financial-receivables') return { period: null, asOf: report.data.asOf, timeZone, generatedAt, truncated }
  return { period: report.data.period, asOf: null, timeZone, generatedAt, truncated }
}

/** `attendance-classes_2026-10-13_2026-11-11.csv` (the receivables: `_<asOf>`) — ASCII only, so every system keeps the name. */
export function reportFileName(key: ReportKey, meta: ReportMeta): string {
  const days = meta.period ? `${meta.period.from}_${meta.period.to}` : (meta.asOf ?? '')
  return `${key}${days ? `_${days}` : ''}.csv`
}

/** The filters a report shows and sends that hold a value — what «clear the filters» would drop. */
export function hasActiveFilters(report: ReportDefinition, filters: ReportFilters): boolean {
  return report.filters.some((name) => {
    switch (name) {
      case 'period':
        return Boolean(filters.from || filters.to)
      case 'course':
        return Boolean(filters.courseId)
      case 'class':
        return Boolean(filters.classId)
      case 'classStatus':
        return Boolean(filters.classStatus)
      case 'minAbsences':
        return filters.minAbsences !== undefined
      case 'minAbsenceRate':
        return filters.minAbsenceRate !== undefined
      case 'assignmentStatus':
        return Boolean(filters.assignmentStatus)
      case 'examType':
        return Boolean(filters.examType)
      case 'method':
        return Boolean(filters.method)
      case 'overdueOnly':
        return filters.overdueOnly === true
    }
  })
}
