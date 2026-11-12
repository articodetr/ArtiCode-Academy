import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { REPORT_CLASS_ID, REPORT_COURSE_ID, makeAttendanceClassesReport, makeReceivablesReport, makeReportsOverview } from '../test/reports'
import {
  REPORT_PERMISSIONS,
  academicAssignmentsPath,
  academicClassesPath,
  academicExamsPath,
  attendanceClassesPath,
  attendanceStudentsPath,
  financialCollectionsPath,
  financialReceivablesPath,
  financialRevenuePath,
  getAttendanceClassesReport,
  getFinancialReceivablesReport,
  getReportsOverview,
} from './reports'

describe('reports API (API-156..API-164)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('mirrors the three report keys of reports.policy.ts', () => {
    expect(REPORT_PERMISSIONS).toEqual(['reports.attendance.view', 'reports.academic.view', 'reports.financial.view'])
  })

  it('builds each report path with the given parameters only, in a fixed order, and none when nothing is given', () => {
    expect(attendanceClassesPath()).toBe('/api/reports/attendance/classes')
    expect(attendanceClassesPath({ from: '', courseId: undefined })).toBe('/api/reports/attendance/classes')
    expect(attendanceClassesPath({ classStatus: 'running', classId: 'c-1', courseId: 'k-1', to: '2026-11-11', from: '2026-10-13' })).toBe(
      '/api/reports/attendance/classes?from=2026-10-13&to=2026-11-11&courseId=k-1&classId=c-1&classStatus=running',
    )
    expect(attendanceStudentsPath({ minAbsenceRate: 20.5, minAbsences: 3, to: '2026-11-11' })).toBe('/api/reports/attendance/students?to=2026-11-11&minAbsences=3&minAbsenceRate=20.5')
    expect(academicClassesPath({ classId: REPORT_CLASS_ID, courseId: REPORT_COURSE_ID })).toBe(`/api/reports/academic/classes?courseId=${REPORT_COURSE_ID}&classId=${REPORT_CLASS_ID}`)
    expect(academicAssignmentsPath({ status: 'closed', from: '2026-09-01' })).toBe('/api/reports/academic/assignments?from=2026-09-01&status=closed')
    expect(academicExamsPath({ type: 'midterm' })).toBe('/api/reports/academic/exams?type=midterm')
    expect(financialCollectionsPath({ classId: 'c-1', method: 'bank_transfer', from: '2026-11-01' })).toBe('/api/reports/financial/collections?from=2026-11-01&method=bank_transfer&classId=c-1')
    expect(financialRevenuePath({ courseId: 'k-1', to: '2026-11-30' })).toBe('/api/reports/financial/revenue?to=2026-11-30&courseId=k-1')
  })

  it('sends overdueOnly to the receivables only when true, and never a period (an unknown parameter there)', () => {
    expect(financialReceivablesPath()).toBe('/api/reports/financial/receivables')
    expect(financialReceivablesPath({ overdueOnly: false, courseId: 'k-1' })).toBe('/api/reports/financial/receivables?courseId=k-1')
    expect(financialReceivablesPath({ overdueOnly: true, classId: 'c-1' })).toBe('/api/reports/financial/receivables?classId=c-1&overdueOnly=true')
    // The type has no from/to: even a cast object cannot add them.
    expect(financialReceivablesPath({ from: '2026-01-01' } as unknown as Parameters<typeof financialReceivablesPath>[0])).toBe('/api/reports/financial/receivables')
  })

  it('reads a report and the overview with the Bearer token and the abort signal', async () => {
    const attendance = makeAttendanceClassesReport()
    const receivables = makeReceivablesReport()
    const overview = makeReportsOverview()
    const fetchMock = mockFetch((url) => {
      if (url.startsWith('/api/reports/attendance/')) return jsonResponse(200, attendance)
      if (url.startsWith('/api/reports/financial/')) return jsonResponse(200, receivables)
      return jsonResponse(200, overview)
    })
    const controller = new AbortController()
    await expect(getAttendanceClassesReport({ from: '2026-10-13' }, controller.signal)).resolves.toEqual(attendance)
    await expect(getFinancialReceivablesReport({ overdueOnly: true }, controller.signal)).resolves.toEqual(receivables)
    await expect(getReportsOverview(controller.signal)).resolves.toEqual(overview)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/reports/attendance/classes?from=2026-10-13',
      '/api/reports/financial/receivables?overdueOnly=true',
      '/api/reports/overview',
    ])
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method ?? 'GET').toBe('GET')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
      expect(init?.signal).toBe(controller.signal)
    }
  })

  it('rejects with the server code of a refused period', async () => {
    mockFetch(() => jsonResponse(400, { statusCode: 400, error: 'Bad Request', code: 'report_range_invalid', message: 'range', from: '2025-01-01', to: '2026-11-11', maxDays: 366 }))
    await expect(getAttendanceClassesReport({ from: '2025-01-01' })).rejects.toMatchObject({ status: 400, code: 'report_range_invalid' })
  })
})
