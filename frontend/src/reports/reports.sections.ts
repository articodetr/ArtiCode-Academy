// The tables of each report (MOD-13-T06 — J-F53): its columns in the UI
// language, one row per server row and its totals line(s), all values taken
// from the answer as they are — no sum, no average, no rate is computed here
// (D-R72: the totals come from the server, over every matching row even when
// the rows are cut). The table (ReportTable) and the CSV export (D-R71) are both
// drawn from these sections, so the file holds exactly the visible columns.
// Pure; unit-tested in reports.sections.test.ts.
import type {
  AttendanceCounts,
} from '../api/lessons'
import type {
  Aging,
  AssignmentSubmissionRow,
  AttendanceClassRow,
  AttendanceStudentRow,
  ClassPerformanceRow,
  CollectionRow,
  CoursePerformanceRow,
  ExamResultsRow,
  GradeBandCount,
  ReceivableRow,
  ReportClassRef,
  ReportCourseRef,
  RevenueRow,
} from '../api/reports'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'
import type { Translate } from '../users/users.format'
import type { CsvBlock } from './csv'
import type { LoadedReport, ReportDefinition, ReportFilters } from './reports.catalog'
import { csvValueOf } from './reports.format'
import type { CellValue, ColumnKind } from './reports.format'

export interface SectionColumn {
  key: string
  title: string
  kind: ColumnKind
}

/** A server row (or a totals line) as cells by column key; a totals line leaves the columns without a total out. */
export interface SectionRow {
  key: string
  cells: Readonly<Partial<Record<string, CellValue>>>
}

export interface ReportSection {
  key: string
  /** Shown above the table, and as the CSV block's title, when a report has more than one table. */
  title: string | null
  columns: SectionColumn[]
  rows: SectionRow[]
  /** The server's totals: one line, or one per currency for the financial reports. */
  totals: SectionRow[]
  emptyText: string
}

export interface SectionContext {
  t: Translate
  language: Language
}

interface ColumnDef<Row> extends SectionColumn {
  value: (row: Row) => CellValue
}

function section<Row>(
  key: string,
  title: string | null,
  columns: readonly ColumnDef<Row>[],
  rows: readonly Row[],
  rowKey: (row: Row) => string,
  totals: SectionRow[],
  emptyText: string,
): ReportSection {
  return {
    key,
    title,
    columns: columns.map(({ key: columnKey, title: columnTitle, kind }) => ({ key: columnKey, title: columnTitle, kind })),
    rows: rows.map((row) => ({ key: rowKey(row), cells: Object.fromEntries(columns.map((column) => [column.key, column.value(row)])) })),
    totals,
    emptyText,
  }
}

/** `ENG-A1-2026-1 — فصل الصباح`: the code, then the name in the UI language (Arabic when that language is missing). */
export function refLabel(ref: Pick<ReportCourseRef, 'code' | 'name'>, language: Language): string {
  return `${ref.code} — ${localizedLabel(ref.name, language)}`
}

/** `B — جيد جداً: 7 · C — جيد: 2` — the bands as frozen in the final grades (D-R44), the server's order. */
export function bandsLabel(bands: readonly GradeBandCount[], language: Language): string {
  return bands.map((band) => `${band.letter ? `${band.letter} — ` : ''}${localizedLabel(band.label, language)}: ${band.count}`).join(' · ')
}

function columns(context: SectionContext) {
  const { t, language } = context
  const title = (key: string) => t(`reports.columns.${key}`)
  const text = <Row>(key: string, value: (row: Row) => CellValue): ColumnDef<Row> => ({ key, title: title(key), kind: 'text', value })
  const of = <Row>(key: string, kind: ColumnKind, value: (row: Row) => CellValue): ColumnDef<Row> => ({ key, title: title(key), kind, value })
  const classRef = <Row extends { class: ReportClassRef }>(): ColumnDef<Row> => text('class', (row) => refLabel(row.class, language))
  const courseRef = <Row extends { course: ReportCourseRef }>(): ColumnDef<Row> => text('course', (row) => refLabel(row.course, language))
  const records = <Row extends { records: AttendanceCounts }>(): ColumnDef<Row>[] => [
    of('present', 'count', (row) => row.records.present),
    of('late', 'count', (row) => row.records.late),
    of('absent', 'count', (row) => row.records.absent),
    of('excused', 'count', (row) => row.records.excused),
    of('recorded', 'count', (row) => row.records.recorded),
  ]
  const aging = <Row extends { aging: Aging }>(): ColumnDef<Row>[] => [
    of('days1To30', 'amount', (row) => row.aging.days1To30),
    of('days31To60', 'amount', (row) => row.aging.days31To60),
    of('days61To90', 'amount', (row) => row.aging.days61To90),
    of('days91Plus', 'amount', (row) => row.aging.days91Plus),
  ]
  return { t, language, title, text, of, classRef, courseRef, records, aging }
}

/** The totals line of one table: the label in the first column, the server's values by column key. */
function totalsLine(key: string, cells: Record<string, CellValue>): SectionRow {
  return { key, cells }
}

function recordCells(records: AttendanceCounts): Record<string, CellValue> {
  return { present: records.present, late: records.late, absent: records.absent, excused: records.excused, recorded: records.recorded }
}

function agingCells(aging: Aging): Record<string, CellValue> {
  return { days1To30: aging.days1To30, days31To60: aging.days31To60, days61To90: aging.days61To90, days91Plus: aging.days91Plus }
}

/** The report's tables, in the order the page shows them. */
export function reportSections(report: LoadedReport, context: SectionContext): ReportSection[] {
  const c = columns(context)
  const { t, language } = c
  const empty = t('reports.empty')
  const counted = (labelKey: string, count: number) => t('reports.totals.count', { label: t(`reports.columns.${labelKey}`), count })
  const total = t('reports.totals.label')

  switch (report.key) {
    case 'attendance-classes': {
      const { rows, totals } = report.data
      const defs: ColumnDef<AttendanceClassRow>[] = [
        c.classRef(),
        c.courseRef(),
        c.text('classStatus', (row) => t(`labels.${row.class.status}`)),
        c.of('lessons', 'count', (row) => row.lessons),
        c.of('completedLessons', 'count', (row) => row.completedLessons),
        c.of('recordedLessons', 'count', (row) => row.recordedLessons),
        c.of('completedWithoutAttendance', 'count', (row) => row.completedWithoutAttendance),
        ...c.records<AttendanceClassRow>(),
        c.of('attendanceRate', 'percent', (row) => row.attendanceRate),
      ]
      const line = totalsLine('totals', {
        class: counted('classes', totals.classes),
        lessons: totals.lessons,
        completedLessons: totals.completedLessons,
        recordedLessons: totals.recordedLessons,
        completedWithoutAttendance: totals.completedWithoutAttendance,
        ...recordCells(totals.records),
        attendanceRate: totals.attendanceRate,
      })
      return [section('classes', null, defs, rows, (row) => row.class.id, [line], empty)]
    }
    case 'attendance-students': {
      const { rows, totals } = report.data
      const defs: ColumnDef<AttendanceStudentRow>[] = [
        c.text('student', (row) => row.student.fullName),
        c.classRef(),
        c.courseRef(),
        c.text('enrollmentStatus', (row) => (row.enrollmentStatus ? t(`labels.${row.enrollmentStatus}`) : null)),
        ...c.records<AttendanceStudentRow>(),
        c.of('attendanceRate', 'percent', (row) => row.attendanceRate),
        c.of('absenceRate', 'percent', (row) => row.absenceRate),
      ]
      const line = totalsLine('totals', {
        student: t('reports.totals.rowsAndStudents', { rows: totals.rows, students: totals.students }),
        ...recordCells(totals.records),
        attendanceRate: totals.attendanceRate,
        absenceRate: totals.absenceRate,
      })
      return [section('students', null, defs, rows, (row) => `${row.student.id}:${row.class.id}`, [line], empty)]
    }
    case 'academic-classes': {
      const { rows, courses, totals } = report.data
      const performance = { finalGrades: totals.finalGrades, averagePercent: totals.averagePercent, passed: totals.passed, passRate: totals.passRate }
      const byClass: ColumnDef<ClassPerformanceRow>[] = [
        c.classRef(),
        c.courseRef(),
        c.of('finalGrades', 'count', (row) => row.finalGrades),
        c.of('averagePercent', 'percent', (row) => row.averagePercent),
        c.of('passed', 'count', (row) => row.passed),
        c.of('passRate', 'percent', (row) => row.passRate),
        c.text('bands', (row) => bandsLabel(row.bands, language) || null),
      ]
      const byCourse: ColumnDef<CoursePerformanceRow>[] = [
        c.courseRef(),
        c.of('classes', 'count', (row) => row.classes),
        c.of('finalGrades', 'count', (row) => row.finalGrades),
        c.of('averagePercent', 'percent', (row) => row.averagePercent),
        c.of('passed', 'count', (row) => row.passed),
        c.of('passRate', 'percent', (row) => row.passRate),
      ]
      return [
        section('classes', t('reports.sections.byClass'), byClass, rows, (row) => row.class.id, [totalsLine('totals', { class: counted('classes', totals.classes), ...performance })], empty),
        section('courses', t('reports.sections.byCourse'), byCourse, courses, (row) => row.course.id, [totalsLine('totals', { course: total, classes: totals.classes, ...performance })], empty),
      ]
    }
    case 'academic-assignments': {
      const { rows, totals } = report.data
      const defs: ColumnDef<AssignmentSubmissionRow>[] = [
        c.text('assignment', (row) => localizedLabel(row.assignment.title, language)),
        c.classRef(),
        c.courseRef(),
        c.text('assignmentStatus', (row) => t(`labels.${row.assignment.status}`)),
        c.of('dueAt', 'instant', (row) => row.assignment.dueAt),
        c.of('publishedAt', 'instant', (row) => row.assignment.publishedAt),
        c.of('maxScore', 'score', (row) => row.assignment.maxScore),
        c.of('latePenalty', 'percent', (row) => row.assignment.latePenaltyPercent),
        c.of('students', 'count', (row) => row.students),
        c.of('submitted', 'count', (row) => row.submitted),
        c.of('onTime', 'count', (row) => row.onTime),
        c.of('submittedLate', 'count', (row) => row.late),
        c.of('notSubmitted', 'count', (row) => row.notSubmitted),
        c.of('awaitingReview', 'count', (row) => row.awaitingReview),
        c.of('graded', 'count', (row) => row.graded),
        c.of('returned', 'count', (row) => row.returned),
        c.of('submissionRate', 'percent', (row) => row.submissionRate),
        c.of('onTimeRate', 'percent', (row) => row.onTimeRate),
        c.of('averagePercent', 'percent', (row) => row.averagePercent),
      ]
      const line = totalsLine('totals', {
        assignment: counted('assignments', totals.assignments),
        students: totals.students,
        submitted: totals.submitted,
        onTime: totals.onTime,
        submittedLate: totals.late,
        notSubmitted: totals.notSubmitted,
        awaitingReview: totals.awaitingReview,
        graded: totals.graded,
        returned: totals.returned,
        submissionRate: totals.submissionRate,
        onTimeRate: totals.onTimeRate,
        averagePercent: totals.averagePercent,
      })
      return [section('assignments', null, defs, rows, (row) => row.assignment.id, [line], empty)]
    }
    case 'academic-exams': {
      const { rows, totals } = report.data
      const defs: ColumnDef<ExamResultsRow>[] = [
        c.text('exam', (row) => localizedLabel(row.exam.title, language)),
        c.text('examType', (row) => t(`exams.types.${row.exam.type}`)),
        c.classRef(),
        c.courseRef(),
        c.of('scheduledAt', 'instant', (row) => row.exam.scheduledAt),
        c.of('publishedAt', 'instant', (row) => row.exam.publishedAt),
        c.of('maxScore', 'score', (row) => row.exam.maxScore),
        c.of('passScore', 'score', (row) => row.exam.passScore),
        c.of('students', 'count', (row) => row.students),
        c.of('scored', 'count', (row) => row.scored),
        c.of('absent', 'count', (row) => row.absent),
        c.of('excused', 'count', (row) => row.excused),
        c.of('missing', 'count', (row) => row.missing),
        c.of('averagePercent', 'percent', (row) => row.averagePercent),
        c.of('minPercent', 'percent', (row) => row.minPercent),
        c.of('maxPercent', 'percent', (row) => row.maxPercent),
        c.of('passed', 'count', (row) => row.passed),
        c.of('passRate', 'percent', (row) => row.passRate),
      ]
      const line = totalsLine('totals', {
        exam: counted('exams', totals.exams),
        students: totals.students,
        scored: totals.scored,
        absent: totals.absent,
        excused: totals.excused,
        missing: totals.missing,
        averagePercent: totals.averagePercent,
        passRate: totals.passRate,
      })
      return [section('exams', null, defs, rows, (row) => row.exam.id, [line], empty)]
    }
    case 'financial-collections': {
      const { rows, reversed, totals } = report.data
      const defs: ColumnDef<CollectionRow>[] = [
        c.of('month', 'month', (row) => row.month),
        c.text('method', (row) => t(`reports.methods.${row.method}`)),
        c.text('currency', (row) => row.currency),
        c.of('payments', 'count', (row) => row.payments),
        c.of('amount', 'amount', (row) => row.amount),
      ]
      const rowKey = (row: CollectionRow) => `${row.month}:${row.method}:${row.currency}`
      return [
        section(
          'completed',
          t('reports.sections.completed'),
          defs,
          rows,
          rowKey,
          totals.map((line) => totalsLine(`totals:${line.currency}`, { month: total, currency: line.currency, payments: line.payments, amount: line.amount })),
          empty,
        ),
        section(
          'reversed',
          t('reports.sections.reversed'),
          defs,
          reversed,
          rowKey,
          totals.map((line) => totalsLine(`totals:${line.currency}`, { month: total, currency: line.currency, payments: line.reversedPayments, amount: line.reversedAmount })),
          t('reports.emptyReversed'),
        ),
      ]
    }
    case 'financial-receivables': {
      const { rows, totals } = report.data
      const defs: ColumnDef<ReceivableRow>[] = [
        c.text('student', (row) => row.student.fullName),
        c.text('currency', (row) => row.currency),
        c.of('invoices', 'count', (row) => row.invoices),
        c.of('invoicedTotal', 'amount', (row) => row.total),
        c.of('paid', 'amount', (row) => row.paid),
        c.of('balance', 'amount', (row) => row.balance),
        c.of('overdue', 'amount', (row) => row.overdue),
        c.of('oldestOverdueDueOn', 'day', (row) => row.oldestOverdueDueOn),
        c.of('daysOverdue', 'count', (row) => row.daysOverdue),
        ...c.aging<ReceivableRow>(),
      ]
      const lines = totals.map((line) =>
        totalsLine(`totals:${line.currency}`, {
          student: counted('students', line.students),
          currency: line.currency,
          invoices: line.invoices,
          invoicedTotal: line.total,
          paid: line.paid,
          balance: line.balance,
          overdue: line.overdue,
          ...agingCells(line.aging),
        }),
      )
      return [section('receivables', null, defs, rows, (row) => `${row.student.id}:${row.currency}`, lines, t('reports.emptyReceivables'))]
    }
    case 'financial-revenue': {
      const { rows, totals } = report.data
      const defs: ColumnDef<RevenueRow>[] = [
        c.text('course', (row) => (row.course ? refLabel(row.course, language) : t('reports.columns.noCourse'))),
        c.of('month', 'month', (row) => row.month),
        c.text('currency', (row) => row.currency),
        c.of('invoices', 'count', (row) => row.invoices),
        c.of('invoiced', 'amount', (row) => row.invoiced),
        c.of('discounts', 'amount', (row) => row.discounts),
        c.of('payments', 'count', (row) => row.payments),
        c.of('collected', 'amount', (row) => row.collected),
      ]
      const lines = totals.map((line) =>
        totalsLine(`totals:${line.currency}`, {
          course: total,
          currency: line.currency,
          invoices: line.invoices,
          invoiced: line.invoiced,
          discounts: line.discounts,
          payments: line.payments,
          collected: line.collected,
        }),
      )
      return [section('revenue', null, defs, rows, (row) => `${row.course?.id ?? 'none'}:${row.month}:${row.currency}`, lines, empty)]
    }
  }
}

/**
 * The filters line of a printed report: every filter the report sends that
 * holds a value, as «label: value» (the period is the server's own, printed in
 * the line above it). A chosen course or class shows as its picker showed it.
 */
export function filtersSummary(report: ReportDefinition, filters: ReportFilters, t: Translate): string[] {
  const label = (key: string) => t(`reports.filters.${key}`)
  const parts: string[] = []
  for (const name of report.filters) {
    switch (name) {
      case 'period':
        break
      case 'course':
        if (filters.courseId) parts.push(`${label('course')}: ${filters.courseLabel ?? filters.courseId}`)
        break
      case 'class':
        if (filters.classId) parts.push(`${label('class')}: ${filters.classLabel ?? filters.classId}`)
        break
      case 'classStatus':
        if (filters.classStatus) parts.push(`${label('classStatus')}: ${t(`labels.${filters.classStatus}`)}`)
        break
      case 'minAbsences':
        if (filters.minAbsences !== undefined) parts.push(`${label('minAbsences')}: ${filters.minAbsences}`)
        break
      case 'minAbsenceRate':
        if (filters.minAbsenceRate !== undefined) parts.push(`${label('minAbsenceRate')}: ${filters.minAbsenceRate}%`)
        break
      case 'assignmentStatus':
        if (filters.assignmentStatus) parts.push(`${label('assignmentStatus')}: ${t(`labels.${filters.assignmentStatus}`)}`)
        break
      case 'examType':
        if (filters.examType) parts.push(`${label('examType')}: ${t(`exams.types.${filters.examType}`)}`)
        break
      case 'method':
        if (filters.method) parts.push(`${label('method')}: ${t(`reports.methods.${filters.method}`)}`)
        break
      case 'overdueOnly':
        if (filters.overdueOnly === true) parts.push(label('overdueOnly'))
        break
    }
  }
  return parts
}

/** The CSV blocks of the sections — the same columns and lines as the tables (titles only when there are several tables). */
export function csvBlocksOf(sections: readonly ReportSection[], timeZone: string): CsvBlock[] {
  return sections.map((reportSection) => {
    const line = (row: SectionRow) => reportSection.columns.map((column) => csvValueOf(column.kind, row.cells[column.key] ?? null, timeZone))
    return {
      title: sections.length > 1 ? reportSection.title : null,
      header: reportSection.columns.map((column) => column.title),
      rows: [...reportSection.rows.map(line), ...reportSection.totals.map(line)],
    }
  })
}
