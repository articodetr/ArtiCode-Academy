import { describe, expect, it } from 'vitest'
import { jsonResponse, mockFetch } from '../test/http'
import { getAttendanceByStudent, getExamResults, getReceivables, getRevenue } from './reports'

describe('api/reports', () => {
  it('sends the period and the filters as query parameters', async () => {
    const urls: string[] = []
    mockFetch((url) => {
      urls.push(url)
      return jsonResponse(200, {})
    })
    await getAttendanceByStudent({ from: '2026-10-01', to: '2026-10-31' }, undefined, { classId: 'k1' })
    await getExamResults({ from: '2026-10-01', to: '2026-10-31' })
    await getRevenue(undefined, undefined, { courseId: 'c1' })
    await getReceivables(true)
    expect(urls).toEqual([
      '/api/reports/attendance/students?from=2026-10-01&to=2026-10-31&classId=k1',
      '/api/reports/academic/exams?from=2026-10-01&to=2026-10-31',
      '/api/reports/financial/revenue?courseId=c1',
      '/api/reports/financial/receivables?overdueOnly=true',
    ])
  })
})
