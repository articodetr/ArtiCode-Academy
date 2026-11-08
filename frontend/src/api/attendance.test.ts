import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { STUDENT_IDS, makeAttendanceSheet } from '../test/attendance'
import { jsonResponse, mockFetch } from '../test/http'
import { LESSON_ID } from '../test/lessons'
import { attendancePath, getAttendanceSheet, recordAttendance } from './attendance'

describe('attendance API (API-099/API-100)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the sheet path of a lesson, encoding the id', () => {
    expect(attendancePath(LESSON_ID)).toBe(`/api/lessons/${LESSON_ID}/attendance`)
    expect(attendancePath('a/b?c')).toBe('/api/lessons/a%2Fb%3Fc/attendance')
  })

  it('reads the sheet with the Bearer token and the abort signal', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, makeAttendanceSheet()))
    const controller = new AbortController()
    const sheet = await getAttendanceSheet(LESSON_ID, controller.signal)
    expect(sheet.items).toHaveLength(4)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`/api/lessons/${LESSON_ID}/attendance`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(init?.signal).toBe(controller.signal)
  })

  it('writes the batch with PUT and answers with the sheet', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, makeAttendanceSheet()))
    const body = { records: [{ studentId: STUDENT_IDS[0], status: 'present' as const }, { studentId: STUDENT_IDS[1], status: 'late' as const, minutesLate: 7, note: 'المواصلات' }] }
    await expect(recordAttendance(LESSON_ID, body)).resolves.toEqual(makeAttendanceSheet())
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([[`/api/lessons/${LESSON_ID}/attendance`, 'PUT', JSON.stringify(body)]])
  })
})
