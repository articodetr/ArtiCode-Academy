import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { makeMyLesson, makeMyLessonList } from '../test/myLessons'
import { listMyLessons, myLessonsPath } from './myLessons'

describe('my lessons API (API-101)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the path with the given parameters only, in a fixed order', () => {
    expect(myLessonsPath()).toBe('/api/me/lessons')
    expect(myLessonsPath({ classId: '', studentId: undefined, status: undefined, cursor: '' })).toBe('/api/me/lessons')
    expect(
      myLessonsPath({
        cursor: 'c%1',
        limit: 100,
        order: 'desc',
        to: '2026-11-30T23:59:59.999Z',
        from: '2026-11-01T00:00:00.000Z',
        status: 'cancelled',
        studentId: 's-1',
        classId: 'c-1',
      }),
    ).toBe(
      '/api/me/lessons?classId=c-1&studentId=s-1&status=cancelled&from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-30T23%3A59%3A59.999Z&order=desc&limit=100&cursor=c%251',
    )
  })

  it('encodes the + of an offset (a raw + would reach the server as a space)', () => {
    expect(myLessonsPath({ from: '2026-11-01T00:00:00+03:00' })).toBe('/api/me/lessons?from=2026-11-01T00%3A00%3A00%2B03%3A00')
  })

  it('reads with the Bearer token and the abort signal', async () => {
    const list = makeMyLessonList([makeMyLesson()], 'next-1')
    const fetchMock = mockFetch(() => jsonResponse(200, list))
    const controller = new AbortController()
    await expect(listMyLessons({ studentId: 's-1', limit: 20 }, controller.signal)).resolves.toEqual(list)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/me/lessons?studentId=s-1&limit=20')
    expect(init?.method ?? 'GET').toBe('GET')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(init?.signal).toBe(controller.signal)
  })
})
