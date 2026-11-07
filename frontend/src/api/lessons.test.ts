import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { CLASS_ID } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { LESSON_ID, makeLesson, makeLessonList } from '../test/lessons'
import { changeLessonStatus, createLesson, deleteLesson, getLesson, lessonsListPath, listLessons, updateLesson } from './lessons'

describe('lessons API (API-093..API-098)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the list path with the given parameters only, in a fixed order', () => {
    expect(lessonsListPath()).toBe('/api/lessons')
    expect(lessonsListPath({ classId: '', status: undefined, from: undefined })).toBe('/api/lessons')
    expect(
      lessonsListPath({ classId: 'c-1', teacherId: 't-1', status: 'scheduled', from: '2026-11-01T00:00:00.000Z', to: '2026-11-30T20:59:59.999Z', order: 'desc', limit: 50, cursor: 'c%1' }),
    ).toBe('/api/lessons?classId=c-1&teacherId=t-1&status=scheduled&from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-30T20%3A59%3A59.999Z&order=desc&limit=50&cursor=c%251')
  })

  it('reads with the Bearer token and the abort signal', async () => {
    const fetchMock = mockFetch((url) => jsonResponse(200, url.includes('?') ? makeLessonList([makeLesson()]) : makeLesson()))
    const controller = new AbortController()
    await listLessons({ status: 'cancelled' }, controller.signal)
    await getLesson(LESSON_ID, controller.signal)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/lessons?status=cancelled', `/api/lessons/${LESSON_ID}`])
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
      expect(init?.signal).toBe(controller.signal)
    }
  })

  it('writes with the documented methods, paths and bodies; DELETE resolves on 204', async () => {
    const fetchMock = mockFetch((_url, init) => (init?.method === 'DELETE' ? jsonResponse(204) : jsonResponse(init?.method === 'POST' ? 201 : 200, makeLesson())))
    await createLesson(CLASS_ID, { title: { ar: 'درس' }, startsAt: '2026-11-10T10:00:00.000Z', endsAt: '2026-11-10T11:30:00.000Z', teacherUserId: null })
    await updateLesson(LESSON_ID, { roomId: null, meetingUrl: 'https://meet.example.com/a' })
    await changeLessonStatus(LESSON_ID, { action: 'cancel', reason: 'عطلة' })
    await expect(deleteLesson(LESSON_ID)).resolves.toBeUndefined()
    const calls = fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])
    expect(calls).toEqual([
      [`/api/classes/${CLASS_ID}/lessons`, 'POST', JSON.stringify({ title: { ar: 'درس' }, startsAt: '2026-11-10T10:00:00.000Z', endsAt: '2026-11-10T11:30:00.000Z', teacherUserId: null })],
      [`/api/lessons/${LESSON_ID}`, 'PATCH', JSON.stringify({ roomId: null, meetingUrl: 'https://meet.example.com/a' })],
      [`/api/lessons/${LESSON_ID}/status`, 'POST', JSON.stringify({ action: 'cancel', reason: 'عطلة' })],
      [`/api/lessons/${LESSON_ID}`, 'DELETE', undefined],
    ])
  })
})
