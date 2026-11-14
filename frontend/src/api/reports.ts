// MOD-13 reports (API-156..164) read by the dashboard (redesign, 2026-11-14). Types mirror
// backend/src/reports/{reports,overview,attendance-reports,financial-reports}.dto.ts field by field.
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

export interface ReportClassRef {
  id: string
  code: string
  name: LocalizedLabel
  status: string
}

export interface AttendanceClassRow {
  class: ReportClassRef
  course: { id: string; code: string; name: LocalizedLabel }
  lessons: number
  completedLessons: number
  recordedLessons: number
  completedWithoutAttendance: number
  records: AttendanceCounts
  /** Percent 0..100 (present + late over present + late + absent), null without records. */
  attendanceRate: number | null
}

export interface AttendanceClassesReport {
  period: ReportPeriod
  timeZone: string
  truncated: boolean
  rows: AttendanceClassRow[]
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

function withPeriod(path: string, period?: Partial<ReportPeriod>): string {
  const query = new URLSearchParams()
  if (period?.from) query.set('from', period.from)
  if (period?.to) query.set('to', period.to)
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

/** API-164: any of the three report keys; each section is null without its own key. */
export function getReportsOverview(signal?: AbortSignal): Promise<ReportsOverview> {
  return apiRequest<ReportsOverview>('/api/reports/overview', { signal })
}

/** API-156: `reports.attendance.view`; the last 30 days by default. */
export function getAttendanceByClass(period?: Partial<ReportPeriod>, signal?: AbortSignal): Promise<AttendanceClassesReport> {
  return apiRequest<AttendanceClassesReport>(withPeriod('/api/reports/attendance/classes', period), { signal })
}

/** API-161: `reports.financial.view`; completed payments per month × method × currency. */
export function getCollections(period?: Partial<ReportPeriod>, signal?: AbortSignal): Promise<CollectionsReport> {
  return apiRequest<CollectionsReport>(withPeriod('/api/reports/financial/collections', period), { signal })
}

/** API-162: `reports.financial.view`; balances as of today, overdue ones first when `overdueOnly`. */
export function getReceivables(overdueOnly = false, signal?: AbortSignal): Promise<ReceivablesReport> {
  return apiRequest<ReceivablesReport>(overdueOnly ? '/api/reports/financial/receivables?overdueOnly=true' : '/api/reports/financial/receivables', { signal })
}
