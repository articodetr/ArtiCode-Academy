import { describe, expect, it } from 'vitest'
import { makeAttendanceClassesReport, makeReceivablesReport } from '../test/reports'
import {
  REPORTS,
  REPORT_KEYS,
  availableReports,
  hasActiveFilters,
  holdsReportKey,
  reportDefinitionOf,
  reportFileName,
  reportMetaOf,
  reportRequest,
} from './reports.catalog'
import type { ReportFilters } from './reports.catalog'

/** Every filter value at once: each report must send only its own. */
const EVERYTHING: ReportFilters = {
  from: '2026-10-01',
  to: '2026-10-31',
  courseId: 'k-1',
  courseLabel: 'ENG-A1 — الإنجليزية',
  classId: 'c-1',
  classLabel: 'ENG-A1-2026-1 — فصل الصباح',
  classStatus: 'running',
  minAbsences: 3,
  minAbsenceRate: 20,
  assignmentStatus: 'open',
  examType: 'final',
  method: 'cash',
  overdueOnly: true,
}

describe('reports catalog', () => {
  it('lists the eight reports of API-156..API-163 under the key their controller requires', () => {
    expect(REPORTS.map((report) => report.key)).toEqual([...REPORT_KEYS])
    expect(Object.fromEntries(REPORTS.map((report) => [report.key, report.permission]))).toEqual({
      'attendance-classes': 'reports.attendance.view',
      'attendance-students': 'reports.attendance.view',
      'academic-classes': 'reports.academic.view',
      'academic-assignments': 'reports.academic.view',
      'academic-exams': 'reports.academic.view',
      'financial-collections': 'reports.financial.view',
      'financial-receivables': 'reports.financial.view',
      'financial-revenue': 'reports.financial.view',
    })
  })

  it('opens to each key only its own reports: staff (attendance + financial by seed) see five, academy_admin eight', () => {
    expect(availableReports(['reports.attendance.view', 'reports.financial.view']).map((report) => report.key)).toEqual([
      'attendance-classes',
      'attendance-students',
      'financial-collections',
      'financial-receivables',
      'financial-revenue',
    ])
    expect(availableReports(['reports.academic.view']).map((report) => report.family)).toEqual(['academic', 'academic', 'academic'])
    expect(availableReports(['reports.attendance.view', 'reports.academic.view', 'reports.financial.view'])).toHaveLength(8)
    expect(availableReports(['users.read', 'classes.manage'])).toEqual([])
  })

  it('holds a report key with any one of the three, as API-164 opens', () => {
    expect(holdsReportKey(['reports.academic.view'])).toBe(true)
    expect(holdsReportKey(['reports.financial.view', 'users.read'])).toBe(true)
    expect(holdsReportKey(['grades.read_all', 'attendance.read', 'invoices.read_all'])).toBe(false)
    expect(holdsReportKey([])).toBe(false)
  })

  it('reads a `?report=` value, and nothing else, as a report', () => {
    expect(reportDefinitionOf('academic-exams')?.i18nId).toBe('academicExams')
    expect(reportDefinitionOf('academic')).toBeNull()
    expect(reportDefinitionOf('')).toBeNull()
    expect(reportDefinitionOf(null)).toBeNull()
  })

  it('makes each report send only the parameters its query DTO declares', () => {
    const paths = Object.fromEntries(REPORT_KEYS.map((key) => [key, reportRequest(key, EVERYTHING).path]))
    expect(paths).toEqual({
      'attendance-classes': '/api/reports/attendance/classes?from=2026-10-01&to=2026-10-31&courseId=k-1&classId=c-1&classStatus=running',
      'attendance-students': '/api/reports/attendance/students?from=2026-10-01&to=2026-10-31&courseId=k-1&classId=c-1&minAbsences=3&minAbsenceRate=20',
      'academic-classes': '/api/reports/academic/classes?from=2026-10-01&to=2026-10-31&courseId=k-1&classId=c-1',
      'academic-assignments': '/api/reports/academic/assignments?from=2026-10-01&to=2026-10-31&courseId=k-1&classId=c-1&status=open',
      'academic-exams': '/api/reports/academic/exams?from=2026-10-01&to=2026-10-31&courseId=k-1&classId=c-1&type=final',
      'financial-collections': '/api/reports/financial/collections?from=2026-10-01&to=2026-10-31&method=cash&courseId=k-1&classId=c-1',
      // «Now»: no period; and the revenue takes the course alone.
      'financial-receivables': '/api/reports/financial/receivables?courseId=k-1&classId=c-1&overdueOnly=true',
      'financial-revenue': '/api/reports/financial/revenue?from=2026-10-01&to=2026-10-31&courseId=k-1',
    })
    // Nothing chosen: the server's defaults (the last 30 days, every class).
    expect(REPORT_KEYS.map((key) => reportRequest(key, {}).path.includes('?'))).toEqual(REPORT_KEYS.map(() => false))
  })

  it('reads the envelope of a report, the receivables «now»', () => {
    expect(reportMetaOf({ key: 'attendance-classes', data: makeAttendanceClassesReport({ truncated: true }) })).toEqual({
      period: { from: '2026-10-13', to: '2026-11-11' },
      asOf: null,
      timeZone: 'Asia/Riyadh',
      generatedAt: '2026-11-11T11:10:00.000Z',
      truncated: true,
    })
    expect(reportMetaOf({ key: 'financial-receivables', data: makeReceivablesReport() })).toMatchObject({ period: null, asOf: '2026-11-11' })
  })

  it('names the CSV file by the report and its days, in ASCII', () => {
    expect(reportFileName('attendance-students', { period: { from: '2026-10-13', to: '2026-11-11' }, asOf: null, timeZone: 'UTC', generatedAt: '', truncated: false })).toBe(
      'attendance-students_2026-10-13_2026-11-11.csv',
    )
    expect(reportFileName('financial-receivables', { period: null, asOf: '2026-11-11', timeZone: 'UTC', generatedAt: '', truncated: false })).toBe('financial-receivables_2026-11-11.csv')
  })

  it('counts as active only the filters the report itself sends', () => {
    const receivables = reportDefinitionOf('financial-receivables')!
    const revenue = reportDefinitionOf('financial-revenue')!
    expect(hasActiveFilters(receivables, { from: '2026-10-01', minAbsences: 2 })).toBe(false)
    expect(hasActiveFilters(receivables, { overdueOnly: true })).toBe(true)
    expect(hasActiveFilters(revenue, { classId: 'c-1' })).toBe(false)
    expect(hasActiveFilters(revenue, { to: '2026-10-31' })).toBe(true)
  })
})
