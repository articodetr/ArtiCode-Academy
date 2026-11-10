import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { CLASS_ID } from '../test/classes'
import { EXAM_ID, makeExam, makeExamList } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { changeExamStatus, classExamsPath, createExam, deleteExam, examsListPath, getExam, listExams, updateExam } from './exams'

describe('exams API (API-113..API-118)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the list path with the given parameters only, in a fixed order', () => {
    expect(examsListPath()).toBe('/api/exams')
    expect(examsListPath({ classId: '', status: undefined, type: undefined, from: undefined })).toBe('/api/exams')
    expect(
      examsListPath({
        classId: 'c-1',
        lessonId: 'l-1',
        status: 'scheduled',
        type: 'final',
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-11-30T20:59:59.999Z',
        order: 'desc',
        limit: 50,
        cursor: 'c%1',
      }),
    ).toBe('/api/exams?classId=c-1&lessonId=l-1&status=scheduled&type=final&from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-30T20%3A59%3A59.999Z&order=desc&limit=50&cursor=c%251')
    expect(classExamsPath(CLASS_ID)).toBe(`/api/classes/${CLASS_ID}/exams`)
  })

  it('reads with the Bearer token and the abort signal', async () => {
    const fetchMock = mockFetch((url) => jsonResponse(200, url.includes('?') ? makeExamList([makeExam()]) : makeExam()))
    const controller = new AbortController()
    await listExams({ status: 'published' }, controller.signal)
    await getExam(EXAM_ID, controller.signal)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/exams?status=published', `/api/exams/${EXAM_ID}`])
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
      expect(init?.signal).toBe(controller.signal)
    }
  })

  it('writes with the documented methods, paths and bodies; DELETE resolves on 204', async () => {
    const fetchMock = mockFetch((_url, init) => (init?.method === 'DELETE' ? jsonResponse(204) : jsonResponse(init?.method === 'POST' ? 201 : 200, makeExam())))
    await createExam(CLASS_ID, { title: { ar: 'اختبار' }, type: 'quiz', maxScore: 20, scheduledAt: '2026-11-20T07:00:00.000Z' })
    await updateExam(EXAM_ID, { weight: null, durationMinutes: 45 })
    await changeExamStatus(EXAM_ID, { action: 'schedule', reason: 'جاهز' })
    await expect(deleteExam(EXAM_ID)).resolves.toBeUndefined()
    const calls = fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])
    expect(calls).toEqual([
      [`/api/classes/${CLASS_ID}/exams`, 'POST', JSON.stringify({ title: { ar: 'اختبار' }, type: 'quiz', maxScore: 20, scheduledAt: '2026-11-20T07:00:00.000Z' })],
      [`/api/exams/${EXAM_ID}`, 'PATCH', JSON.stringify({ weight: null, durationMinutes: 45 })],
      [`/api/exams/${EXAM_ID}/status`, 'POST', JSON.stringify({ action: 'schedule', reason: 'جاهز' })],
      [`/api/exams/${EXAM_ID}`, 'DELETE', undefined],
    ])
  })
})
