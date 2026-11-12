// Fixtures for the reports screens (J-F53, MOD-13-T06): the answers of
// API-156..API-164 as the backend returns them (backend/src/reports/*.dto.ts),
// and the permission sets of the seeded roles that read them.
import type {
  AssignmentSubmissionRow,
  AssignmentSubmissionsReport,
  AttendanceClassRow,
  AttendanceClassesReport,
  AttendanceStudentRow,
  AttendanceStudentsReport,
  ClassPerformanceReport,
  ClassPerformanceRow,
  CollectionsReport,
  ExamResultsReport,
  ExamResultsRow,
  ReceivableRow,
  ReceivablesReport,
  ReportClassRef,
  ReportCourseRef,
  ReportEnvelope,
  ReportStudentRef,
  ReportsOverview,
  RevenueReport,
} from '../api/reports'

export const REPORT_COURSE_ID = '0192f0b0-0000-7000-8000-00000000c001'
export const REPORT_CLASS_ID = '0192f0b0-0000-7000-8000-00000000c101'
export const REPORT_CLASS_ID_2 = '0192f0b0-0000-7000-8000-00000000c102'
export const REPORT_STUDENT_ID = '0192f0b0-0000-7000-8000-00000000d001'
export const REPORT_STUDENT_ID_2 = '0192f0b0-0000-7000-8000-00000000d002'
export const REPORT_ASSIGNMENT_ID = '0192f0b0-0000-7000-8000-00000000e001'
export const REPORT_EXAM_ID = '0192f0b0-0000-7000-8000-00000000e101'

/** The academy's zone of the fixtures (makeAcademy()'s too). */
export const REPORT_TIME_ZONE = 'Asia/Riyadh'
export const REPORT_GENERATED_AT = '2026-11-11T11:10:00.000Z'

/** The keys of the seeded roles (backend/src/authorization/system-roles.ts): academy_admin holds all three, staff two. */
export const ALL_REPORT_PERMISSIONS = ['reports.attendance.view', 'reports.academic.view', 'reports.financial.view']
export const ADMIN_REPORTS_PERMISSIONS = [...ALL_REPORT_PERMISSIONS, 'courses.read', 'courses.manage', 'classes.read', 'classes.manage']
export const STAFF_REPORTS_PERMISSIONS = ['reports.financial.view', 'reports.attendance.view', 'courses.read', 'classes.read', 'classes.manage']

export const REPORT_COURSE: ReportCourseRef = { id: REPORT_COURSE_ID, code: 'ENG-A1', name: { ar: 'الإنجليزية — المستوى الأول', en: 'English — level one' } }

export function makeReportClass(overrides: Partial<ReportClassRef> = {}): ReportClassRef {
  return { id: REPORT_CLASS_ID, code: 'ENG-A1-2026-1', name: { ar: 'فصل الصباح', en: 'Morning class' }, status: 'running', ...overrides }
}

export function makeReportStudent(overrides: Partial<ReportStudentRef> = {}): ReportStudentRef {
  return { id: REPORT_STUDENT_ID, fullName: 'سارة أحمد', displayName: null, ...overrides }
}

function envelope(overrides: Partial<ReportEnvelope> = {}): ReportEnvelope {
  return { period: { from: '2026-10-13', to: '2026-11-11' }, timeZone: REPORT_TIME_ZONE, generatedAt: REPORT_GENERATED_AT, truncated: false, ...overrides }
}

const records = (present: number, late: number, absent: number, excused: number) => ({ recorded: present + late + absent + excused, present, late, absent, excused })

export function makeAttendanceClassRow(overrides: Partial<AttendanceClassRow> = {}): AttendanceClassRow {
  return {
    class: makeReportClass(),
    course: REPORT_COURSE,
    lessons: 12,
    completedLessons: 10,
    recordedLessons: 9,
    completedWithoutAttendance: 1,
    records: records(150, 12, 18, 6),
    attendanceRate: 90,
    ...overrides,
  }
}

export function makeAttendanceClassesReport(overrides: Partial<AttendanceClassesReport> = {}): AttendanceClassesReport {
  return {
    ...envelope(),
    rows: [makeAttendanceClassRow()],
    totals: { classes: 1, lessons: 12, completedLessons: 10, recordedLessons: 9, completedWithoutAttendance: 1, records: records(150, 12, 18, 6), attendanceRate: 90 },
    ...overrides,
  }
}

export function makeAttendanceStudentRow(overrides: Partial<AttendanceStudentRow> = {}): AttendanceStudentRow {
  return {
    student: makeReportStudent(),
    class: makeReportClass(),
    course: REPORT_COURSE,
    enrollmentStatus: 'active',
    records: records(6, 1, 3, 0),
    attendanceRate: 70,
    absenceRate: 30,
    ...overrides,
  }
}

export function makeAttendanceStudentsReport(overrides: Partial<AttendanceStudentsReport> = {}): AttendanceStudentsReport {
  return {
    ...envelope(),
    rows: [makeAttendanceStudentRow()],
    totals: { rows: 1, students: 1, records: records(6, 1, 3, 0), attendanceRate: 70, absenceRate: 30 },
    ...overrides,
  }
}

export function makeClassPerformanceRow(overrides: Partial<ClassPerformanceRow> = {}): ClassPerformanceRow {
  return {
    class: makeReportClass({ status: 'completed' }),
    course: REPORT_COURSE,
    finalGrades: 18,
    averagePercent: 81.37,
    passed: 16,
    passRate: 88.89,
    bands: [
      { label: { ar: 'ممتاز', en: 'Excellent' }, letter: 'A', count: 5 },
      { label: { ar: 'جيد جداً', en: 'Very good' }, letter: 'B', count: 11 },
      { label: { ar: 'راسب', en: 'Fail' }, letter: null, count: 2 },
    ],
    ...overrides,
  }
}

export function makeClassPerformanceReport(overrides: Partial<ClassPerformanceReport> = {}): ClassPerformanceReport {
  return {
    ...envelope(),
    rows: [makeClassPerformanceRow()],
    courses: [{ course: REPORT_COURSE, classes: 1, finalGrades: 18, averagePercent: 81.37, passed: 16, passRate: 88.89 }],
    totals: { classes: 1, finalGrades: 18, averagePercent: 81.37, passed: 16, passRate: 88.89 },
    ...overrides,
  }
}

export function makeAssignmentSubmissionRow(overrides: Partial<AssignmentSubmissionRow> = {}): AssignmentSubmissionRow {
  return {
    assignment: {
      id: REPORT_ASSIGNMENT_ID,
      title: { ar: 'مقال قصير', en: 'Short essay' },
      status: 'closed',
      dueAt: '2026-11-05T17:00:00.000Z',
      publishedAt: '2026-10-28T07:00:00.000Z',
      maxScore: 20,
      latePenaltyPercent: 10,
    },
    class: makeReportClass(),
    course: REPORT_COURSE,
    students: 20,
    submitted: 18,
    onTime: 15,
    late: 3,
    notSubmitted: 2,
    awaitingReview: 4,
    graded: 13,
    returned: 1,
    submissionRate: 90,
    onTimeRate: 75,
    averagePercent: 78.5,
    ...overrides,
  }
}

export function makeAssignmentSubmissionsReport(overrides: Partial<AssignmentSubmissionsReport> = {}): AssignmentSubmissionsReport {
  return {
    ...envelope(),
    rows: [makeAssignmentSubmissionRow()],
    totals: {
      assignments: 1,
      students: 20,
      submitted: 18,
      onTime: 15,
      late: 3,
      notSubmitted: 2,
      awaitingReview: 4,
      graded: 13,
      returned: 1,
      submissionRate: 90,
      onTimeRate: 75,
      averagePercent: 78.5,
    },
    ...overrides,
  }
}

export function makeExamResultsRow(overrides: Partial<ExamResultsRow> = {}): ExamResultsRow {
  return {
    exam: {
      id: REPORT_EXAM_ID,
      title: { ar: 'اختبار منتصف الفصل', en: 'Midterm' },
      type: 'midterm',
      scheduledAt: '2026-11-02T06:00:00.000Z',
      publishedAt: '2026-11-04T09:00:00.000Z',
      maxScore: 50,
      passScore: 25,
    },
    class: makeReportClass(),
    course: REPORT_COURSE,
    students: 20,
    scored: 17,
    absent: 1,
    excused: 1,
    missing: 1,
    averagePercent: 72.11,
    minPercent: 34,
    maxPercent: 98,
    passed: 15,
    passRate: 83.33,
    ...overrides,
  }
}

export function makeExamResultsReport(overrides: Partial<ExamResultsReport> = {}): ExamResultsReport {
  return {
    ...envelope(),
    rows: [makeExamResultsRow()],
    totals: { exams: 1, students: 20, scored: 17, absent: 1, excused: 1, missing: 1, averagePercent: 72.11, passRate: 83.33 },
    ...overrides,
  }
}

export function makeCollectionsReport(overrides: Partial<CollectionsReport> = {}): CollectionsReport {
  return {
    ...envelope(),
    rows: [
      { month: '2026-10', method: 'cash', currency: 'SAR', payments: 12, amount: 9000 },
      { month: '2026-11', method: 'bank_transfer', currency: 'SAR', payments: 3, amount: 4500.5 },
    ],
    reversed: [{ month: '2026-11', method: 'card', currency: 'SAR', payments: 1, amount: 100 }],
    totals: [{ currency: 'SAR', payments: 15, amount: 13500.5, reversedPayments: 1, reversedAmount: 100 }],
    ...overrides,
  }
}

export function makeReceivableRow(overrides: Partial<ReceivableRow> = {}): ReceivableRow {
  return {
    student: makeReportStudent(),
    currency: 'SAR',
    invoices: 2,
    total: 3000,
    paid: 1200,
    balance: 1800,
    overdue: 900,
    oldestOverdueDueOn: '2026-09-30',
    daysOverdue: 42,
    aging: { days1To30: 300, days31To60: 600, days61To90: 0, days91Plus: 0 },
    ...overrides,
  }
}

export function makeReceivablesReport(overrides: Partial<ReceivablesReport> = {}): ReceivablesReport {
  return {
    period: null,
    asOf: '2026-11-11',
    timeZone: REPORT_TIME_ZONE,
    generatedAt: REPORT_GENERATED_AT,
    truncated: false,
    rows: [makeReceivableRow()],
    totals: [{ currency: 'SAR', students: 1, invoices: 2, total: 3000, paid: 1200, balance: 1800, overdue: 900, aging: { days1To30: 300, days31To60: 600, days61To90: 0, days91Plus: 0 } }],
    ...overrides,
  }
}

export function makeRevenueReport(overrides: Partial<RevenueReport> = {}): RevenueReport {
  return {
    ...envelope(),
    rows: [
      { course: REPORT_COURSE, month: '2026-11', currency: 'SAR', invoices: 4, invoiced: 4800, discounts: 200, payments: 3, collected: 2600 },
      { course: null, month: '2026-11', currency: 'SAR', invoices: 1, invoiced: 300, discounts: 0, payments: 0, collected: 0 },
    ],
    totals: [{ currency: 'SAR', invoices: 5, invoiced: 5100, discounts: 200, payments: 3, collected: 2600 }],
    ...overrides,
  }
}

/** The overview an academy admin reads (every section). */
export function makeReportsOverview(overrides: Partial<ReportsOverview> = {}): ReportsOverview {
  return {
    asOf: '2026-11-11',
    timeZone: REPORT_TIME_ZONE,
    generatedAt: REPORT_GENERATED_AT,
    general: { activeStudents: 1240, openClasses: 7, runningClasses: 31, lessonsToday: 18 },
    attendance: { period: { from: '2026-10-13', to: '2026-11-11' }, records: { recorded: 2050, present: 1800, late: 90, absent: 140, excused: 20 }, attendanceRate: 93.1 },
    academic: { period: { from: '2026-10-13', to: '2026-11-11' }, finalGrades: 64, averagePercent: 77.25, passRate: 89.06, awaitingReview: 23 },
    financial: {
      period: { from: '2026-11-01', to: '2026-11-11' },
      collected: [{ currency: 'SAR', payments: 41, amount: 52350 }],
      outstanding: [{ currency: 'SAR', balance: 18400, overdue: 6200, studentsOverdue: 9 }],
    },
    ...overrides,
  }
}
