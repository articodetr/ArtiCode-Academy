import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { makeMyExam, makeMyExamList, makePublishedMyExam } from '../test/myExams'
import { ApiError } from './client'
import { listMyExams, myExamsPath } from './myExams'

describe('my exams API (API-121)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the list path with the given parameters only, in a fixed order', () => {
    expect(myExamsPath()).toBe('/api/me/exams')
    expect(myExamsPath({ classId: '', studentId: undefined, status: undefined, from: '', cursor: '' })).toBe('/api/me/exams')
    expect(
      myExamsPath({
        cursor: 'c%1',
        limit: 100,
        order: 'desc',
        to: '2026-11-30T20:59:59.999Z',
        from: '2026-11-01T00:00:00.000Z',
        status: 'published',
        studentId: 's-1',
        classId: 'c-1',
      }),
    ).toBe('/api/me/exams?classId=c-1&studentId=s-1&status=published&from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-30T20%3A59%3A59.999Z&order=desc&limit=100&cursor=c%251')
  })

  it('encodes the + of an offset', () => {
    expect(myExamsPath({ from: '2026-11-01T00:00:00+03:00' })).toBe('/api/me/exams?from=2026-11-01T00%3A00%3A00%2B03%3A00')
  })

  it('reads one page with the Bearer token and the abort signal, and surfaces a refusal as an ApiError with its code', async () => {
    const list = makeMyExamList([makeMyExam(), makePublishedMyExam()], 'next-1')
    const fetchMock = mockFetch((url) =>
      url.includes('cursor=') ? jsonResponse(400, { statusCode: 400, code: 'cursor_invalid', message: 'cursor is invalid' }) : jsonResponse(200, list),
    )
    const controller = new AbortController()
    await expect(listMyExams({ studentId: 's-1', limit: 20 }, controller.signal)).resolves.toEqual(list)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/me/exams?studentId=s-1&limit=20')
    expect(init?.method ?? 'GET').toBe('GET')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(init?.signal).toBe(controller.signal)

    const refused = await listMyExams({ cursor: 'stale' }).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(ApiError)
    expect((refused as ApiError).code).toBe('cursor_invalid')
  })
})
