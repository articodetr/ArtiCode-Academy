import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import {
  REPORT_COURSE,
  makeAssignmentSubmissionsReport,
  makeAttendanceClassesReport,
  makeAttendanceStudentRow,
  makeAttendanceStudentsReport,
  makeClassPerformanceReport,
  makeCollectionsReport,
  makeExamResultsReport,
  makeReceivablesReport,
  makeReportStudent,
  makeRevenueReport,
} from '../test/reports'
import { buildCsv } from './csv'
import { reportDefinitionOf } from './reports.catalog'
import { bandsLabel, csvBlocksOf, filtersSummary, refLabel, reportSections } from './reports.sections'
import type { ReportSection } from './reports.sections'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)
const context = { t, language: 'ar' as const }

function titles(section: ReportSection): string[] {
  return section.columns.map((column) => column.title)
}

describe('reportSections — the server rows and totals as they are', () => {
  it('lays out the attendance by class: one row per class, the counts, the rate, and the totals line', () => {
    const [section, ...more] = reportSections({ key: 'attendance-classes', data: makeAttendanceClassesReport() }, context)
    expect(more).toEqual([])
    const columns = ar.reports.columns
    expect(titles(section!)).toEqual([
      columns.class,
      columns.course,
      columns.classStatus,
      columns.lessons,
      columns.completedLessons,
      columns.recordedLessons,
      columns.completedWithoutAttendance,
      columns.present,
      columns.late,
      columns.absent,
      columns.excused,
      columns.recorded,
      columns.attendanceRate,
    ])
    expect(section!.title).toBeNull()
    expect(section!.rows).toHaveLength(1)
    expect(section!.rows[0]!.cells).toEqual({
      class: 'ENG-A1-2026-1 — فصل الصباح',
      course: 'ENG-A1 — الإنجليزية — المستوى الأول',
      classStatus: ar.labels.running,
      lessons: 12,
      completedLessons: 10,
      recordedLessons: 9,
      completedWithoutAttendance: 1,
      present: 150,
      late: 12,
      absent: 18,
      excused: 6,
      recorded: 186,
      attendanceRate: 90,
    })
    // The totals line names its count in the first column and leaves the course and status columns out.
    expect(section!.totals).toEqual([
      {
        key: 'totals',
        cells: {
          class: 'الإجمالي (الفصول: 1)',
          lessons: 12,
          completedLessons: 10,
          recordedLessons: 9,
          completedWithoutAttendance: 1,
          present: 150,
          late: 12,
          absent: 18,
          excused: 6,
          recorded: 186,
          attendanceRate: 90,
        },
      },
    ])
  })

  it('keeps a null rate null and an unknown enrollment as nothing (the absences by student)', () => {
    const data = makeAttendanceStudentsReport({
      rows: [makeAttendanceStudentRow({ enrollmentStatus: null, attendanceRate: null, absenceRate: null, records: { recorded: 1, present: 0, late: 0, absent: 0, excused: 1 } })],
      totals: { rows: 1, students: 1, records: { recorded: 1, present: 0, late: 0, absent: 0, excused: 1 }, attendanceRate: null, absenceRate: null },
    })
    const [section] = reportSections({ key: 'attendance-students', data }, context)
    expect(section!.rows[0]!.key).toBe(`${makeReportStudent().id}:${data.rows[0]!.class.id}`)
    expect(section!.rows[0]!.cells).toMatchObject({ student: 'سارة أحمد', enrollmentStatus: null, attendanceRate: null, absenceRate: null })
    expect(section!.totals[0]!.cells).toMatchObject({ student: 'الإجمالي (الصفوف: 1، الطلاب: 1)', attendanceRate: null, absenceRate: null })
  })

  it('shows the performance by class and by course as two tables, the bands as the grades froze them', () => {
    const sections = reportSections({ key: 'academic-classes', data: makeClassPerformanceReport() }, context)
    expect(sections.map((section) => section.title)).toEqual([ar.reports.sections.byClass, ar.reports.sections.byCourse])
    expect(sections[0]!.rows[0]!.cells).toMatchObject({ finalGrades: 18, averagePercent: 81.37, passed: 16, passRate: 88.89, bands: 'A — ممتاز: 5 · B — جيد جداً: 11 · راسب: 2' })
    expect(sections[1]!.rows[0]!.cells).toEqual({ course: refLabel(REPORT_COURSE, 'ar'), classes: 1, finalGrades: 18, averagePercent: 81.37, passed: 16, passRate: 88.89 })
    expect(sections[1]!.totals[0]!.cells).toEqual({ course: 'الإجمالي', classes: 1, finalGrades: 18, averagePercent: 81.37, passed: 16, passRate: 88.89 })
    expect(bandsLabel([], 'ar')).toBe('')
  })

  it('lays out the assignment submissions with their due and publish instants and the late count of the latest attempts', () => {
    const [section] = reportSections({ key: 'academic-assignments', data: makeAssignmentSubmissionsReport() }, context)
    expect(section!.rows[0]!.cells).toMatchObject({
      assignment: 'مقال قصير',
      assignmentStatus: ar.labels.closed,
      dueAt: '2026-11-05T17:00:00.000Z',
      maxScore: 20,
      latePenalty: 10,
      submittedLate: 3,
      averagePercent: 78.5,
    })
    expect(section!.totals[0]!.cells).toMatchObject({ assignment: 'الإجمالي (الواجبات: 1)', submittedLate: 3, onTimeRate: 75 })
  })

  it('lays out the exam results with the exam type and a pass count that may be null', () => {
    const data = makeExamResultsReport()
    data.rows[0]!.passed = null
    data.rows[0]!.passRate = null
    const [section] = reportSections({ key: 'academic-exams', data }, context)
    expect(section!.rows[0]!.cells).toMatchObject({ exam: 'اختبار منتصف الفصل', examType: ar.exams.types.midterm, passScore: 25, passed: null, passRate: null })
    expect(section!.totals[0]!.cells).toEqual({
      exam: 'الإجمالي (الاختبارات: 1)',
      students: 20,
      scored: 17,
      absent: 1,
      excused: 1,
      missing: 1,
      averagePercent: 72.11,
      passRate: 83.33,
    })
  })

  it('keeps the reversed payments apart from the collected ones, each with the totals of its currency', () => {
    const [completed, reversed] = reportSections({ key: 'financial-collections', data: makeCollectionsReport() }, context)
    expect(completed!.title).toBe(ar.reports.sections.completed)
    expect(completed!.rows.map((row) => row.cells)).toEqual([
      { month: '2026-10', method: ar.reports.methods.cash, currency: 'SAR', payments: 12, amount: 9000 },
      { month: '2026-11', method: ar.reports.methods.bank_transfer, currency: 'SAR', payments: 3, amount: 4500.5 },
    ])
    expect(completed!.totals).toEqual([{ key: 'totals:SAR', cells: { month: 'الإجمالي', currency: 'SAR', payments: 15, amount: 13500.5 } }])
    expect(reversed!.title).toBe(ar.reports.sections.reversed)
    expect(reversed!.rows.map((row) => row.cells.method)).toEqual([ar.reports.methods.card])
    expect(reversed!.totals).toEqual([{ key: 'totals:SAR', cells: { month: 'الإجمالي', currency: 'SAR', payments: 1, amount: 100 } }])
    expect(reversed!.emptyText).toBe(ar.reports.emptyReversed)
  })

  it('lays out the receivables «now» with the aging of the overdue amount, one totals line per currency', () => {
    const data = makeReceivablesReport({
      totals: [
        { currency: 'SAR', students: 1, invoices: 2, total: 3000, paid: 1200, balance: 1800, overdue: 900, aging: { days1To30: 300, days31To60: 600, days61To90: 0, days91Plus: 0 } },
        { currency: 'USD', students: 2, invoices: 2, total: 800, paid: 0, balance: 800, overdue: 0, aging: { days1To30: 0, days31To60: 0, days61To90: 0, days91Plus: 0 } },
      ],
    })
    const [section] = reportSections({ key: 'financial-receivables', data }, context)
    expect(section!.rows[0]!.cells).toMatchObject({ currency: 'SAR', invoicedTotal: 3000, balance: 1800, overdue: 900, oldestOverdueDueOn: '2026-09-30', daysOverdue: 42, days31To60: 600 })
    expect(section!.totals.map((line) => line.key)).toEqual(['totals:SAR', 'totals:USD'])
    expect(section!.totals[1]!.cells).toMatchObject({ student: 'الإجمالي (الطلاب: 2)', currency: 'USD', balance: 800 })
    expect(section!.totals[1]!.cells.oldestOverdueDueOn).toBeUndefined()
    expect(section!.emptyText).toBe(ar.reports.emptyReceivables)
  })

  it('names the invoices without an enrollment «no course» in the revenue', () => {
    const [section] = reportSections({ key: 'financial-revenue', data: makeRevenueReport() }, context)
    expect(section!.rows.map((row) => row.cells.course)).toEqual([refLabel(REPORT_COURSE, 'ar'), ar.reports.columns.noCourse])
    expect(section!.rows.map((row) => row.key)).toEqual([`${REPORT_COURSE.id}:2026-11:SAR`, 'none:2026-11:SAR'])
    expect(section!.totals[0]!.cells).toEqual({ course: 'الإجمالي', currency: 'SAR', invoices: 5, invoiced: 5100, discounts: 200, payments: 3, collected: 2600 })
  })

  it('names a class in the UI language, the Arabic standing in for a missing English name', () => {
    expect(refLabel({ code: 'ENG-A1', name: { ar: 'إنجليزي', en: 'English' } }, 'en')).toBe('ENG-A1 — English')
    expect(refLabel({ code: 'ENG-A1', name: { ar: 'إنجليزي' } }, 'en')).toBe('ENG-A1 — إنجليزي')
  })
})

describe('csvBlocksOf — the CSV holds the visible columns, the rows then the totals', () => {
  it('exports the table of one report under the UI-language titles, numbers unformatted and guarded texts', () => {
    const data = makeAttendanceStudentsReport({ rows: [makeAttendanceStudentRow({ student: makeReportStudent({ fullName: '=cmd|"/c calc"!A1' }) })] })
    const sections = reportSections({ key: 'attendance-students', data }, context)
    const csv = buildCsv(csvBlocksOf(sections, data.timeZone))
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe(sections[0]!.columns.map((column) => column.title).join(','))
    expect(lines[1]).toBe(`"'=cmd|""/c calc""!A1",ENG-A1-2026-1 — فصل الصباح,ENG-A1 — الإنجليزية — المستوى الأول,${ar.labels.active},6,1,3,0,10,70,30`)
    expect(lines[2]).toBe('الإجمالي (الصفوف: 1، الطلاب: 1),,,,6,1,3,0,10,70,30')
    expect(lines[3]).toBe('')
  })

  it('titles each block only when a report has several tables, and writes instants on the zone wall clock', () => {
    const blocks = csvBlocksOf(reportSections({ key: 'academic-classes', data: makeClassPerformanceReport() }, context), 'Asia/Riyadh')
    expect(blocks.map((block) => block.title)).toEqual([ar.reports.sections.byClass, ar.reports.sections.byCourse])
    const single = csvBlocksOf(reportSections({ key: 'academic-assignments', data: makeAssignmentSubmissionsReport() }, context), 'Asia/Riyadh')
    expect(single[0]!.title).toBeNull()
    // dueAt 17:00Z, publishedAt 07:00Z → 20:00 and 10:00 in Riyadh.
    expect(single[0]!.rows[0]!.slice(4, 6)).toEqual(['2026-11-05 20:00', '2026-10-28 10:00'])
  })
})

describe('filtersSummary — the printed filters line', () => {
  it('lists the active filters the report sends, a chosen course or class by its label', () => {
    const report = reportDefinitionOf('attendance-students')!
    expect(filtersSummary(report, { from: '2026-10-01', courseId: 'k-1', courseLabel: 'ENG-A1 — الإنجليزية', minAbsences: 3, minAbsenceRate: 20.5, classStatus: 'running' }, t)).toEqual([
      `${ar.reports.filters.course}: ENG-A1 — الإنجليزية`,
      `${ar.reports.filters.minAbsences}: 3`,
      `${ar.reports.filters.minAbsenceRate}: 20.5%`,
    ])
    expect(filtersSummary(reportDefinitionOf('financial-receivables')!, { overdueOnly: true, method: 'cash' }, t)).toEqual([ar.reports.filters.overdueOnly])
    expect(filtersSummary(reportDefinitionOf('financial-collections')!, { method: 'cheque' }, t)).toEqual([`${ar.reports.filters.method}: ${ar.reports.methods.cheque}`])
  })
})
