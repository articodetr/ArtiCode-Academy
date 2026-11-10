import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { EXAM_ID, RESULT_STUDENT_IDS, makeResultsSheet } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { examResultsPath, getExamResults, recordExamResults } from './examResults'

describe('exam results API (API-119/API-120)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('reads the sheet with the Bearer token and the abort signal', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, makeResultsSheet()))
    const controller = new AbortController()
    await expect(getExamResults(EXAM_ID, controller.signal)).resolves.toEqual(makeResultsSheet())
    expect(examResultsPath('a/b')).toBe('/api/exams/a%2Fb/results')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`/api/exams/${EXAM_ID}/results`)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(init?.signal).toBe(controller.signal)
  })

  it('records a batch with PUT and the whole new state of each result', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, makeResultsSheet()))
    const body = { results: [{ studentId: RESULT_STUDENT_IDS[0], status: 'scored' as const, score: 47.25, feedback: 'ممتاز' }, { studentId: RESULT_STUDENT_IDS[3], status: 'excused' as const }] }
    await recordExamResults(EXAM_ID, body)
    const [url, init] = fetchMock.mock.calls[0]!
    expect([url, init?.method, init?.body]).toEqual([`/api/exams/${EXAM_ID}/results`, 'PUT', JSON.stringify(body)])
  })
})
