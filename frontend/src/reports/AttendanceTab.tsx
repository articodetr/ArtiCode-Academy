// Attendance (reports.attendance.view): API-156 per class with its totals strip, API-157 per student × class.
// Every number is the server's; the page only formats it.
import { useTranslation } from 'react-i18next'
import type { AttendanceClassRow, AttendanceStudentRow, ReportPeriod } from '../api/reports'
import { getAttendanceByClass, getAttendanceByStudent } from '../api/reports'
import { StatusTag } from '../components/StatusTag'
import { labelIn } from '../dashboard/dashboard.data'
import { useLoad } from '../dashboard/useLoad'
import { useLocalized } from '../i18n/useLocalized'
import type { ReportColumn } from './ReportParts'
import { KpiStrip, Num, RateBar, ReportLoad, ReportSection } from './ReportParts'
import { LOW_ATTENDANCE_RATE, formatNumber, formatPercent, namedCode, studentName } from './reports.format'

function ClassCell({ name, code }: { name: string; code: string }) {
  return (
    <span className="list-primary">
      <b>{name}</b>
      <bdi dir="ltr">{code}</bdi>
    </span>
  )
}

export function AttendanceTab({ period }: { period: ReportPeriod }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const key = `${period.from}:${period.to}`
  const classes = useLoad(`attendance:classes:${key}`, true, (signal) => getAttendanceByClass(period, signal))
  const students = useLoad(`attendance:students:${key}`, true, (signal) => getAttendanceByStudent(period, signal))
  const fileSuffix = `${period.from}_${period.to}`

  const classColumns: ReportColumn<AttendanceClassRow>[] = [
    { key: 'class', title: t('reports.columns.class'), value: (row) => namedCode(row.class, language), render: (row) => <ClassCell name={labelIn(row.class.name, language)} code={row.class.code} /> },
    { key: 'course', title: t('reports.columns.course'), value: (row) => labelIn(row.course.name, language) },
    { key: 'lessons', title: t('reports.columns.lessons'), numeric: true, value: (row) => row.lessons },
    { key: 'completed', title: t('reports.columns.completedLessons'), numeric: true, value: (row) => row.completedLessons },
    { key: 'recorded', title: t('reports.columns.recordedLessons'), numeric: true, value: (row) => row.recordedLessons },
    {
      key: 'missing',
      title: t('reports.columns.withoutSheet'),
      numeric: true,
      value: (row) => row.completedWithoutAttendance,
      render: (row) => <span className={row.completedWithoutAttendance > 0 ? 'rp-mark' : undefined}>{formatNumber(row.completedWithoutAttendance, language)}</span>,
    },
    { key: 'present', title: t('reports.columns.present'), numeric: true, value: (row) => row.records.present },
    { key: 'late', title: t('reports.columns.late'), numeric: true, value: (row) => row.records.late },
    { key: 'absent', title: t('reports.columns.absent'), numeric: true, value: (row) => row.records.absent },
    { key: 'excused', title: t('reports.columns.excused'), numeric: true, value: (row) => row.records.excused },
    { key: 'rate', title: t('reports.columns.attendanceRate'), value: (row) => row.attendanceRate, render: (row) => <RateBar value={row.attendanceRate} lowBelow={LOW_ATTENDANCE_RATE} /> },
  ]

  const studentColumns: ReportColumn<AttendanceStudentRow>[] = [
    { key: 'student', title: t('reports.columns.student'), value: (row) => studentName(row.student) },
    { key: 'class', title: t('reports.columns.class'), value: (row) => namedCode(row.class, language), render: (row) => <ClassCell name={labelIn(row.class.name, language)} code={row.class.code} /> },
    {
      key: 'enrollment',
      title: t('reports.columns.enrollment'),
      value: (row) => (row.enrollmentStatus ? t(`labels.${row.enrollmentStatus}`, { defaultValue: row.enrollmentStatus }) : null),
      render: (row) => (row.enrollmentStatus ? <StatusTag value={row.enrollmentStatus} /> : '—'),
    },
    { key: 'present', title: t('reports.columns.present'), numeric: true, value: (row) => row.records.present },
    { key: 'late', title: t('reports.columns.late'), numeric: true, value: (row) => row.records.late },
    {
      key: 'absent',
      title: t('reports.columns.absent'),
      numeric: true,
      value: (row) => row.records.absent,
      render: (row) => <span className={row.records.absent > 0 ? 'db-bad' : undefined}>{formatNumber(row.records.absent, language)}</span>,
    },
    { key: 'excused', title: t('reports.columns.excused'), numeric: true, value: (row) => row.records.excused },
    { key: 'rate', title: t('reports.columns.attendanceRate'), value: (row) => row.attendanceRate, render: (row) => <RateBar value={row.attendanceRate} lowBelow={LOW_ATTENDANCE_RATE} /> },
    { key: 'absenceRate', title: t('reports.columns.absenceRate'), numeric: true, value: (row) => row.absenceRate, render: (row) => formatPercent(row.absenceRate, language) },
  ]

  return (
    <div className="db-stack">
      <ReportLoad loaded={classes}>
        {(report) => (
          <>
            {report.totals ? (
              <KpiStrip
                cells={[
                  { key: 'classes', label: t('reports.attendance.classes'), value: <Num value={report.totals.classes} /> },
                  { key: 'lessons', label: t('reports.attendance.lessons'), value: <Num value={report.totals.lessons} /> },
                  { key: 'recorded', label: t('reports.attendance.recordedLessons'), value: <Num value={report.totals.recordedLessons} /> },
                  { key: 'missing', label: t('reports.attendance.withoutSheet'), value: <Num value={report.totals.completedWithoutAttendance} />, tone: report.totals.completedWithoutAttendance > 0 ? 'mark' : undefined },
                  {
                    key: 'rate',
                    label: t('reports.attendance.rate'),
                    value: formatPercent(report.totals.attendanceRate, language),
                    tone: report.totals.attendanceRate !== null && report.totals.attendanceRate < LOW_ATTENDANCE_RATE ? 'mark' : undefined,
                  },
                ]}
              />
            ) : null}
            <ReportSection title={t('reports.attendance.byClass')} fileName={`attendance-classes_${fileSuffix}`} columns={classColumns} rows={report.rows} rowKey={(row) => row.class.id} />
          </>
        )}
      </ReportLoad>
      <ReportLoad loaded={students}>
        {(report) => (
          <ReportSection
            title={t('reports.attendance.byStudent')}
            fileName={`attendance-students_${fileSuffix}`}
            columns={studentColumns}
            rows={report.rows}
            rowKey={(row) => `${row.student.id}:${row.class.id}`}
            before={<p className="db-muted rp-note">{t('reports.attendance.byStudentNote')}</p>}
          />
        )}
      </ReportLoad>
    </div>
  )
}
