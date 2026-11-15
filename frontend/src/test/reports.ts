// Fixtures of the MOD-13 report answers (API-156..163) as the backend sends them.
import type {
  AssignmentSubmissionsReport,
  AttendanceClassesReport,
  AttendanceStudentsReport,
  ClassPerformanceReport,
  CollectionsReport,
  ExamResultsReport,
  ReceivablesReport,
  ReportPeriod,
  RevenueReport,
} from '../api/reports'

export const REPORT_PERIOD: ReportPeriod = { from: '2026-10-16', to: '2026-11-14' }
const META = { timeZone: 'UTC', generatedAt: '2026-11-14T09:00:00.000Z', truncated: false }
const CLASS = { id: 'k1', code: 'PY-A', name: { ar: 'بايثون أ', en: 'Python A' }, status: 'running' }
const COURSE = { id: 'c1', code: 'PY', name: { ar: 'بايثون', en: 'Python' } }
const STUDENT = { id: 's1', fullName: 'ليلى أحمد', displayName: null }
const ZERO_AGING = { days1To30: 0, days31To60: 0, days61To90: 0, days91Plus: 0 }

export function makeAttendanceClasses(overrides: Partial<AttendanceClassesReport> = {}): AttendanceClassesReport {
  const records = { recorded: 10, present: 6, late: 1, absent: 3, excused: 0 }
  return {
    period: REPORT_PERIOD,
    ...META,
    rows: [{ class: CLASS, course: COURSE, lessons: 4, completedLessons: 3, recordedLessons: 2, completedWithoutAttendance: 1, records, attendanceRate: 70 }],
    totals: { classes: 1, lessons: 4, completedLessons: 3, recordedLessons: 2, completedWithoutAttendance: 1, records, attendanceRate: 70 },
    ...overrides,
  }
}

export function makeAttendanceStudents(overrides: Partial<AttendanceStudentsReport> = {}): AttendanceStudentsReport {
  const records = { recorded: 4, present: 2, late: 0, absent: 2, excused: 0 }
  return {
    period: REPORT_PERIOD,
    ...META,
    rows: [{ student: STUDENT, class: CLASS, course: COURSE, enrollmentStatus: 'active', records, attendanceRate: 50, absenceRate: 50 }],
    totals: { rows: 1, students: 1, records, attendanceRate: 50, absenceRate: 50 },
    ...overrides,
  }
}

export function makeClassPerformance(overrides: Partial<ClassPerformanceReport> = {}): ClassPerformanceReport {
  return {
    period: REPORT_PERIOD,
    ...META,
    rows: [{ class: CLASS, course: COURSE, finalGrades: 5, averagePercent: 78.4, passed: 4, passRate: 80, bands: [{ label: { ar: 'جيد جدًا' }, letter: 'B', count: 3 }] }],
    courses: [{ course: COURSE, classes: 1, finalGrades: 5, averagePercent: 78.4, passed: 4, passRate: 80 }],
    totals: { classes: 1, finalGrades: 5, averagePercent: 78.4, passed: 4, passRate: 80 },
    ...overrides,
  }
}

export function makeAssignmentSubmissions(): AssignmentSubmissionsReport {
  const counts = { students: 5, submitted: 4, onTime: 3, late: 1, notSubmitted: 1, awaitingReview: 1, graded: 3, returned: 0, submissionRate: 80, onTimeRate: 60, averagePercent: 72 }
  return {
    period: REPORT_PERIOD,
    ...META,
    rows: [{ assignment: { id: 'a1', title: { ar: 'واجب الحلقات' }, status: 'closed', dueAt: '2026-11-01T18:00:00.000Z', publishedAt: '2026-10-25T08:00:00.000Z', maxScore: 10, latePenaltyPercent: null }, class: CLASS, course: COURSE, ...counts }],
    totals: { assignments: 1, ...counts },
  }
}

export function makeExamResults(): ExamResultsReport {
  return {
    period: REPORT_PERIOD,
    ...META,
    rows: [
      {
        exam: { id: 'e1', title: { ar: 'اختبار منتصف الفصل' }, type: 'midterm', scheduledAt: '2026-11-05T09:00:00.000Z', publishedAt: '2026-11-07T09:00:00.000Z', maxScore: 50, passScore: 25 },
        class: CLASS,
        course: COURSE,
        students: 5,
        scored: 4,
        absent: 1,
        excused: 0,
        missing: 0,
        averagePercent: 64,
        minPercent: 40,
        maxPercent: 92,
        passed: 3,
        passRate: 60,
      },
    ],
    totals: { exams: 1, students: 5, scored: 4, absent: 1, excused: 0, missing: 0, averagePercent: 64, passRate: 60 },
  }
}

export function makeCollections(overrides: Partial<CollectionsReport> = {}): CollectionsReport {
  return {
    period: REPORT_PERIOD,
    ...META,
    rows: [
      { month: '2026-10', method: 'cash', currency: 'TRY', payments: 2, amount: 900 },
      { month: '2026-11', method: 'bank_transfer', currency: 'TRY', payments: 1, amount: 1500 },
    ],
    reversed: [],
    totals: [{ currency: 'TRY', payments: 3, amount: 2400, reversedPayments: 1, reversedAmount: 300 }],
    ...overrides,
  }
}

export function makeReceivables(overrides: Partial<ReceivablesReport> = {}): ReceivablesReport {
  const aging = { days1To30: 200, days31To60: 0, days61To90: 0, days91Plus: 100 }
  return {
    asOf: '2026-11-14',
    ...META,
    rows: [
      { student: STUDENT, currency: 'TRY', invoices: 2, total: 1200, paid: 600, balance: 600, overdue: 300, oldestOverdueDueOn: '2026-07-01', daysOverdue: 136, aging },
      { student: { id: 's2', fullName: 'عمر سالم', displayName: 'عمر' }, currency: 'TRY', invoices: 1, total: 500, paid: 300, balance: 200, overdue: 0, oldestOverdueDueOn: null, daysOverdue: null, aging: ZERO_AGING },
    ],
    totals: [{ currency: 'TRY', students: 2, invoices: 3, total: 1700, paid: 900, balance: 800, overdue: 300, aging }],
    ...overrides,
  }
}

export function makeRevenue(): RevenueReport {
  return {
    period: REPORT_PERIOD,
    ...META,
    rows: [
      { course: COURSE, month: '2026-11', currency: 'TRY', invoices: 2, invoiced: 2000, discounts: 100, payments: 1, collected: 1500 },
      { course: null, month: '2026-11', currency: 'TRY', invoices: 1, invoiced: 300, discounts: 0, payments: 0, collected: 0 },
    ],
    totals: [{ currency: 'TRY', invoices: 3, invoiced: 2300, discounts: 100, payments: 1, collected: 1500 }],
  }
}
