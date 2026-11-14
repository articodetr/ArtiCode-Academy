// Academic (reports.academic.view): API-158 final grades per class and per course, API-159 assignment
// submission rates, API-160 published exam results — as three sub-tabs. Every number is the server's.
import { Tabs, Tag } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssignmentSubmissionRow, ClassPerformanceRow, CoursePerformanceRow, ExamResultsRow, ReportPeriod } from '../api/reports'
import { getAssignmentSubmissions, getClassPerformance, getExamResults } from '../api/reports'
import { labelIn } from '../dashboard/dashboard.data'
import { useLoad } from '../dashboard/useLoad'
import { useLocalized } from '../i18n/useLocalized'
import type { ReportColumn } from './ReportParts'
import { KpiStrip, Num, RateBar, ReportLoad, ReportSection } from './ReportParts'
import { formatPercent, namedCode } from './reports.format'

type AcademicView = 'grades' | 'assignments' | 'exams'

export function AcademicTab({ period }: { period: ReportPeriod }) {
  const { t } = useTranslation()
  const [view, setView] = useState<AcademicView>('grades')
  return (
    <Tabs
      className="rp-subtabs"
      size="small"
      activeKey={view}
      onChange={(key) => setView(key as AcademicView)}
      destroyOnHidden
      items={[
        { key: 'grades', label: t('reports.academic.grades'), children: <GradesView period={period} /> },
        { key: 'assignments', label: t('reports.academic.assignments'), children: <AssignmentsView period={period} /> },
        { key: 'exams', label: t('reports.academic.exams'), children: <ExamsView period={period} /> },
      ]}
    />
  )
}

function suffixOf(period: ReportPeriod) {
  return `${period.from}_${period.to}`
}

function GradesView({ period }: { period: ReportPeriod }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const loaded = useLoad(`academic:classes:${period.from}:${period.to}`, true, (signal) => getClassPerformance(period, signal))

  const classColumns: ReportColumn<ClassPerformanceRow>[] = [
    { key: 'class', title: t('reports.columns.class'), value: (row) => namedCode(row.class, language) },
    { key: 'course', title: t('reports.columns.course'), value: (row) => labelIn(row.course.name, language) },
    { key: 'grades', title: t('reports.columns.finalGrades'), numeric: true, value: (row) => row.finalGrades },
    { key: 'mean', title: t('reports.columns.averagePercent'), numeric: true, value: (row) => row.averagePercent, render: (row) => formatPercent(row.averagePercent, language) },
    { key: 'passed', title: t('reports.columns.passed'), numeric: true, value: (row) => row.passed },
    { key: 'passRate', title: t('reports.columns.passRate'), value: (row) => row.passRate, render: (row) => <RateBar value={row.passRate} /> },
    {
      key: 'bands',
      title: t('reports.columns.bands'),
      value: (row) => row.bands.map((band) => `${band.letter ?? labelIn(band.label, language)}: ${band.count}`).join(' · '),
      render: (row) => (
        <span className="rp-bands">
          {row.bands.map((band, index) => (
            <Tag key={index} variant="filled">
              {band.letter ?? labelIn(band.label, language)} · {band.count}
            </Tag>
          ))}
        </span>
      ),
    },
  ]
  const courseColumns: ReportColumn<CoursePerformanceRow>[] = [
    { key: 'course', title: t('reports.columns.course'), value: (row) => namedCode(row.course, language) },
    { key: 'classes', title: t('reports.columns.classes'), numeric: true, value: (row) => row.classes },
    { key: 'grades', title: t('reports.columns.finalGrades'), numeric: true, value: (row) => row.finalGrades },
    { key: 'mean', title: t('reports.columns.averagePercent'), numeric: true, value: (row) => row.averagePercent, render: (row) => formatPercent(row.averagePercent, language) },
    { key: 'passed', title: t('reports.columns.passed'), numeric: true, value: (row) => row.passed },
    { key: 'passRate', title: t('reports.columns.passRate'), value: (row) => row.passRate, render: (row) => <RateBar value={row.passRate} /> },
  ]

  return (
    <ReportLoad loaded={loaded}>
      {(report) => (
        <div className="db-stack">
          <KpiStrip
            cells={[
              { key: 'grades', label: t('reports.academic.finalGrades'), value: <Num value={report.totals.finalGrades} /> },
              { key: 'mean', label: t('reports.academic.average'), value: formatPercent(report.totals.averagePercent, language) },
              { key: 'passRate', label: t('reports.academic.passRate'), value: formatPercent(report.totals.passRate, language) },
            ]}
          />
          <ReportSection title={t('reports.academic.byClass')} fileName={`grades-classes_${suffixOf(period)}`} columns={classColumns} rows={report.rows} rowKey={(row) => row.class.id} />
          <ReportSection title={t('reports.academic.byCourse')} fileName={`grades-courses_${suffixOf(period)}`} columns={courseColumns} rows={report.courses} rowKey={(row) => row.course.id} />
        </div>
      )}
    </ReportLoad>
  )
}

function AssignmentsView({ period }: { period: ReportPeriod }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const loaded = useLoad(`academic:assignments:${period.from}:${period.to}`, true, (signal) => getAssignmentSubmissions(period, signal))
  const columns: ReportColumn<AssignmentSubmissionRow>[] = [
    { key: 'assignment', title: t('reports.columns.assignment'), value: (row) => labelIn(row.assignment.title, language) },
    { key: 'class', title: t('reports.columns.class'), value: (row) => namedCode(row.class, language) },
    { key: 'students', title: t('reports.columns.students'), numeric: true, value: (row) => row.students },
    { key: 'submitted', title: t('reports.columns.submitted'), numeric: true, value: (row) => row.submitted },
    { key: 'late', title: t('reports.columns.lateSubmissions'), numeric: true, value: (row) => row.late },
    { key: 'notSubmitted', title: t('reports.columns.notSubmitted'), numeric: true, value: (row) => row.notSubmitted },
    {
      key: 'awaiting',
      title: t('reports.columns.awaitingReview'),
      numeric: true,
      value: (row) => row.awaitingReview,
      render: (row) => <span className={row.awaitingReview > 0 ? 'rp-mark' : undefined}><Num value={row.awaitingReview} /></span>,
    },
    { key: 'submissionRate', title: t('reports.columns.submissionRate'), value: (row) => row.submissionRate, render: (row) => <RateBar value={row.submissionRate} /> },
    { key: 'onTimeRate', title: t('reports.columns.onTimeRate'), value: (row) => row.onTimeRate, render: (row) => <RateBar value={row.onTimeRate} /> },
    { key: 'mean', title: t('reports.columns.averagePercent'), numeric: true, value: (row) => row.averagePercent, render: (row) => formatPercent(row.averagePercent, language) },
  ]
  return (
    <ReportLoad loaded={loaded}>
      {(report) => (
        <div className="db-stack">
          <KpiStrip
            cells={[
              { key: 'assignments', label: t('reports.academic.assignmentCount'), value: <Num value={report.totals.assignments} /> },
              { key: 'submissionRate', label: t('reports.academic.submissionRate'), value: formatPercent(report.totals.submissionRate, language) },
              { key: 'onTimeRate', label: t('reports.academic.onTimeRate'), value: formatPercent(report.totals.onTimeRate, language) },
              { key: 'awaiting', label: t('reports.academic.awaitingReview'), value: <Num value={report.totals.awaitingReview} />, tone: report.totals.awaitingReview > 0 ? 'mark' : undefined },
            ]}
          />
          <ReportSection title={t('reports.academic.assignments')} fileName={`assignments_${suffixOf(period)}`} columns={columns} rows={report.rows} rowKey={(row) => row.assignment.id} />
        </div>
      )}
    </ReportLoad>
  )
}

function ExamsView({ period }: { period: ReportPeriod }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const loaded = useLoad(`academic:exams:${period.from}:${period.to}`, true, (signal) => getExamResults(period, signal))
  const columns: ReportColumn<ExamResultsRow>[] = [
    { key: 'exam', title: t('reports.columns.exam'), value: (row) => labelIn(row.exam.title, language) },
    { key: 'type', title: t('reports.columns.examType'), value: (row) => t(`exams.types.${row.exam.type}`, { defaultValue: row.exam.type }) },
    { key: 'class', title: t('reports.columns.class'), value: (row) => namedCode(row.class, language) },
    { key: 'students', title: t('reports.columns.students'), numeric: true, value: (row) => row.students },
    { key: 'scored', title: t('reports.columns.scored'), numeric: true, value: (row) => row.scored },
    { key: 'absent', title: t('reports.columns.absent'), numeric: true, value: (row) => row.absent },
    { key: 'excused', title: t('reports.columns.excused'), numeric: true, value: (row) => row.excused },
    { key: 'missing', title: t('reports.columns.missing'), numeric: true, value: (row) => row.missing },
    { key: 'mean', title: t('reports.columns.averagePercent'), numeric: true, value: (row) => row.averagePercent, render: (row) => formatPercent(row.averagePercent, language) },
    { key: 'min', title: t('reports.columns.minPercent'), numeric: true, value: (row) => row.minPercent, render: (row) => formatPercent(row.minPercent, language) },
    { key: 'max', title: t('reports.columns.maxPercent'), numeric: true, value: (row) => row.maxPercent, render: (row) => formatPercent(row.maxPercent, language) },
    { key: 'passRate', title: t('reports.columns.passRate'), value: (row) => row.passRate, render: (row) => <RateBar value={row.passRate} /> },
  ]
  return (
    <ReportLoad loaded={loaded}>
      {(report) => (
        <div className="db-stack">
          <KpiStrip
            cells={[
              { key: 'exams', label: t('reports.academic.examCount'), value: <Num value={report.totals.exams} /> },
              { key: 'mean', label: t('reports.academic.average'), value: formatPercent(report.totals.averagePercent, language) },
              { key: 'passRate', label: t('reports.academic.passRate'), value: formatPercent(report.totals.passRate, language) },
            ]}
          />
          <ReportSection title={t('reports.academic.exams')} fileName={`exams_${suffixOf(period)}`} columns={columns} rows={report.rows} rowKey={(row) => row.exam.id} before={<p className="db-muted rp-note">{t('reports.academic.examsNote')}</p>} />
        </div>
      )}
    </ReportLoad>
  )
}
